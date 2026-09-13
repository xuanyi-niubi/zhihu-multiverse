/**
 * 知乎开放平台客户端。
 *
 * 协议要点（来自官方 http-api.md）：
 * - 鉴权：`Authorization: Bearer <Access Secret>` + `X-Request-Timestamp`（秒级 Unix）
 * - 搜索：`GET /api/v1/content/zhihu_search?Query=&Count=`（Count 上限 10）
 * - 热榜：`GET /api/v1/content/hot_list?Limit=`（上限 30）
 *
 * 配额保护：搜索 1000 次/天、热榜 100 次/天，所以这里带一个进程内 LRU + TTL 缓存，
 * 同一 query 在 TTL 内只打一次真实请求。
 *
 * 与其他层一致的契约：所有方法**永不抛出**，失败返回结构化结果。
 */

export interface ZhihuSearchItem {
  readonly Title: string;
  readonly ContentType: string;
  readonly ContentID: string;
  readonly ContentText: string;
  readonly Url: string;
  readonly CommentCount: number;
  readonly VoteUpCount: number;
  readonly AuthorName: string;
  readonly AuthorBadgeText?: string;
  readonly EditTime?: number;
  readonly AuthorityLevel?: string;
}

export interface ZhihuHotItem {
  readonly Title: string;
  readonly Url: string;
  readonly Summary: string;
}

export type ZhihuResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ZhihuConfig {
  readonly accessSecret: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** 缓存存活时间（毫秒）。 */
  readonly cacheTtlMs: number;
}

export interface ZhihuClient {
  readonly id: string;
  search(query: string, count?: number): Promise<ZhihuResult<readonly ZhihuSearchItem[]>>;
  hotList(limit?: number): Promise<ZhihuResult<readonly ZhihuHotItem[]>>;
}

const DEFAULT_BASE_URL = 'https://developer.zhihu.com';

function readEnv(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readEnv(env, key);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

/** 从环境变量解析知乎开放平台配置；没有 Access Secret 时返回 null。 */
export function resolveZhihuFromEnv(
  env: Record<string, string | undefined> = process.env,
): ZhihuConfig | null {
  const accessSecret =
    readEnv(env, 'ZHIHU_ACCESS_SECRET') ??
    readEnv(env, 'ZHIHU_API_KEY') ??
    readEnv(env, 'ZHIHU_ACCESS_TOKEN');

  if (!accessSecret) {
    return null;
  }

  return {
    accessSecret,
    baseUrl: readEnv(env, 'ZHIHU_BASE_URL') ?? DEFAULT_BASE_URL,
    timeoutMs: readNumber(env, 'ZHIHU_TIMEOUT_MS', 15_000, 1_000, 60_000),
    cacheTtlMs: readNumber(env, 'ZHIHU_CACHE_TTL_MS', 10 * 60_000, 0, 24 * 3600_000),
  };
}

interface CacheEntry<T> {
  readonly at: number;
  readonly value: T;
}

/** 极简 LRU：容量固定，超出时淘汰最旧条目。 */
function createLru<T>(capacity: number) {
  const store = new Map<string, CacheEntry<T>>();

  return {
    get(key: string, ttlMs: number): T | null {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }

      if (Date.now() - entry.at > ttlMs) {
        store.delete(key);
        return null;
      }

      // 触碰一次，维持 LRU 顺序
      store.delete(key);
      store.set(key, entry);

      return entry.value;
    },
    set(key: string, value: T): void {
      store.set(key, { at: Date.now(), value });
      if (store.size > capacity) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) {
          store.delete(oldest);
        }
      }
    },
    get size(): number {
      return store.size;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeItem(raw: unknown): ZhihuSearchItem {
  const item = isRecord(raw) ? raw : {};

  return {
    Title: asString(item.Title),
    ContentType: asString(item.ContentType),
    ContentID: asString(item.ContentID),
    ContentText: asString(item.ContentText),
    Url: asString(item.Url),
    CommentCount: asNumber(item.CommentCount),
    VoteUpCount: asNumber(item.VoteUpCount),
    AuthorName: asString(item.AuthorName),
    AuthorBadgeText: asString(item.AuthorBadgeText) || undefined,
    EditTime: asNumber(item.EditTime) || undefined,
    AuthorityLevel: asString(item.AuthorityLevel) || undefined,
  };
}

export function createZhihuClient(config: ZhihuConfig): ZhihuClient {
  const searchCache = createLru<readonly ZhihuSearchItem[]>(128);
  const hotCache = createLru<readonly ZhihuHotItem[]>(8);

  async function request<T>(
    path: string,
    params: Record<string, string>,
    pick: (data: Record<string, unknown>) => T,
  ): Promise<ZhihuResult<T>> {
    const url = new URL(path, config.baseUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${config.accessSecret}`,
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'content-type': 'application/json',
        },
        signal: controller.signal,
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!isRecord(payload)) {
        return { ok: false, code: `http-${response.status}`, message: '响应不是 JSON' };
      }

      const code = asNumber(payload.Code, -1);
      const message = asString(payload.Message, 'unknown');

      if (code !== 0) {
        return { ok: false, code: `zhihu-${code}`, message };
      }

      const data = isRecord(payload.Data) ? payload.Data : {};

      return { ok: true, data: pick(data) };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        code: aborted ? 'timeout' : 'network-error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    id: `zhihu-open-platform:${config.baseUrl}`,

    async search(query, count = 5) {
      const normalized = query.trim();
      if (normalized.length === 0) {
        return { ok: false, code: 'empty-query', message: 'Query 不能为空' };
      }

      const clamped = Math.min(Math.max(Math.round(count), 1), 10);
      const cacheKey = `${clamped}:${normalized}`;
      const cached = searchCache.get(cacheKey, config.cacheTtlMs);

      if (cached) {
        return { ok: true, data: cached };
      }

      const result = await request('/api/v1/content/zhihu_search', {
        Query: normalized,
        Count: String(clamped),
      }, (data) => {
        const items = Array.isArray(data.Items) ? data.Items : [];
        return items.map(normalizeItem).filter((item) => item.Title.length > 0);
      });

      if (result.ok) {
        searchCache.set(cacheKey, result.data);
      }

      return result;
    },

    async hotList(limit = 10) {
      const clamped = Math.min(Math.max(Math.round(limit), 1), 30);
      const cacheKey = String(clamped);
      const cached = hotCache.get(cacheKey, config.cacheTtlMs);

      if (cached) {
        return { ok: true, data: cached };
      }

      const result = await request('/api/v1/content/hot_list', { Limit: String(clamped) }, (data) => {
        const items = Array.isArray(data.Items) ? data.Items : [];
        return items.map((raw) => {
          const item = isRecord(raw) ? raw : {};
          return {
            Title: asString(item.Title),
            Url: asString(item.Url),
            Summary: asString(item.Summary),
          };
        });
      });

      if (result.ok) {
        hotCache.set(cacheKey, result.data);
      }

      return result;
    },

  };
}
