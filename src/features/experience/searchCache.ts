import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type { ExperienceSearch } from '@/features/experience/retrieve';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 经验检索的持久化缓存（Phase 5）。
 *
 * ## 为什么在 Retrieve 层缓存，而不是改知乎客户端
 *
 * `createZhihuClient()` 里已经有进程内 LRU + TTL。但比赛现场真正
 * 要防的是**进程重启**（容器重启、路演机器重启）把配额烧一遍 ——
 * 进程内缓存帮不上忙。这一层落盘，重启后同一问题直接吃缓存。
 *
 * ## 失败纪律（顺序不能反）
 *
 * - 缓存坏掉（JSON 烂 / 超期）→ **忽略，继续真实搜索**；
 * - 真实搜索失败（或返回空）但有未过期缓存 → **返回缓存**。
 *   同一个 query 之前搜得到、现在搜不到，几乎一定是限流或网络问题，
 *   而缓存里的数据同样是真实检索所得（带 `retrievedAt`）。
 * - **绝不反过来**：缓存永远不能挡在有结果的真实搜索前面。
 */

/** 默认 12 小时。比赛一整天都在这个窗口里。 */
export const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface CachedExperienceSearch {
  readonly query: string;
  readonly count: number;
  /** ISO 抓取时间。展示层应该用它回答「这是什么时候搜到的」。 */
  readonly cachedAt: string;
  readonly sources: readonly KnowledgeSource[];
}

function baseDir(override?: string): string {
  return override ?? process.env.EXPERIENCE_SEARCH_CACHE_DIR ?? join(process.cwd(), 'data', 'experience-search-cache');
}

function ttlMs(): number {
  const raw = Number(process.env.EXPERIENCE_SEARCH_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

/** 规范化 query：空白折叠。同一问题的两种写法该命中同一份缓存。 */
function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

export function cacheKeyFor(query: string, count: number): string {
  return createHash('sha256').update(`${normalizeQuery(query)}::${count}`).digest('hex');
}

/** 读一份缓存；坏掉或超期返回 null（调用方当它不存在）。 */
export function readCachedSearch(
  query: string,
  count: number,
  options: { dir?: string; now?: number } = {},
): CachedExperienceSearch | null {
  try {
    const raw = readFileSync(join(baseDir(options.dir), `${cacheKeyFor(query, count)}.json`), 'utf-8');
    const parsed = JSON.parse(raw) as CachedExperienceSearch;
    if (!Array.isArray(parsed.sources) || typeof parsed.cachedAt !== 'string') {
      return null;
    }
    const age = (options.now ?? Date.now()) - Date.parse(parsed.cachedAt);
    if (!Number.isFinite(age) || age < 0 || age > ttlMs()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 写一份缓存。**尽力而为**：磁盘满、权限问题都不该让检索失败。 */
export function writeCachedSearch(entry: CachedExperienceSearch, dir?: string): void {
  try {
    const target = baseDir(dir);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${cacheKeyFor(entry.query, entry.count)}.json`), JSON.stringify(entry), 'utf-8');
  } catch {
    // 缓存写失败不构成检索失败
  }
}

/**
 * 给任意 `ExperienceSearch` 套上持久化缓存。
 *
 * 键 = 规范化 query + count。真实搜索**非空**才落盘 ——
 * 空结果不值得占磁盘，也不该把「暂时没搜到」固化下来。
 */
export function withExperienceSearchCache(
  search: ExperienceSearch,
  options: { dir?: string; now?: () => number } = {},
): ExperienceSearch {
  return async (query, count = 8) => {
    const effectiveCount = count;

    // 未过期缓存直接命中 —— 缓存永远不能挡在有结果的真实搜索前面，
    // 所以命中即返回，不绕道真实搜索。
    const cached = readCachedSearch(query, effectiveCount, {
      ...(options.dir ? { dir: options.dir } : {}),
      ...(options.now ? { now: options.now() } : {}),
    });
    if (cached) {
      return cached.sources;
    }

    const fresh = await search(query, effectiveCount);
    if (fresh.length > 0) {
      writeCachedSearch(
        {
          query: normalizeQuery(query),
          count: effectiveCount,
          cachedAt: new Date(options.now ? options.now() : Date.now()).toISOString(),
          sources: fresh,
        },
        options.dir,
      );
      return fresh;
    }

    // 真实搜索空 / 失败：没有可用缓存就只能如实返回空（调用方诚实降级）
    return fresh;
  };
}
