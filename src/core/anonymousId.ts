import { randomUUID } from 'node:crypto';

/**
 * 匿名身份（v3 之后的配置口径）。
 *
 * ## 为什么需要它
 *
 * 原本应用内配置（`/settings`）**必须登录知乎账号**才能保存 ——
 * 设计初衷是「记忆绑定身份」。但对「配置自己的 AI key」这件事，
 * 那个门槛是过度约束：玩家只是想用自己的 key 玩一局，
 * 不该被迫走一次 OAuth。
 *
 * 更重要的是一个**成本与安全**问题：
 * 如果服务端环境变量里留着一把共享 key，而访客没有自己的 key 时
 * 回退到它，那任何访问者都能白用那把 key（花的是部署者的钱）。
 * 因此正确做法是：
 *
 * > **访客也有身份 —— 一个匿名 cookie；配置按这个身份落盘；
 * > 环境变量不再作为访客的兜底。**
 *
 * ## 三条纪律
 *
 * 1. **只做身份，不做追踪**：这个 id 唯一用途是隔离配置文件，
 *    不进日志、不进统计、不与任何外部标识关联。
 * 2. **格式严格**：只接受 32 位十六进制（我们自己生成的形态），
 *    非法值一律当没有 —— 防止有人拿脏 cookie 去撞文件路径。
 * 3. **落盘前哈希**：与记忆存储同一套做法（`sha256(prefix:id)`），
 *    因此磁盘上不会出现这个 id 本身。
 */

export const ANON_COOKIE = 'zhihu_anon';

/** 匿名 id 的形态：32 位十六进制（`randomUUID` 去掉连字符后截断）。 */
const ANON_ID_PATTERN = /^[0-9a-f]{32}$/;

/** 一年。配置是长期有效的东西，cookie 不该一周就掉。 */
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=').trim();
      return value.length > 0 ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/** 已有的匿名 id（合法才返回）。 */
export function existingAnonymousId(request: Request): string | null {
  const raw = readCookie(request, ANON_COOKIE);
  return raw && ANON_ID_PATTERN.test(raw) ? raw : null;
}

/** 新生成一个匿名 id。 */
export function createAnonymousId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * 取出（或创建）匿名身份。
 *
 * @returns `id` 用于落盘隔离；`created` 为 true 时调用方**必须**把 cookie 写回响应，
 *          否则玩家下一次请求会拿到一个新 id，配置就"丢"了。
 */
export function ensureAnonymousIdentity(request: Request): {
  readonly id: string;
  readonly created: boolean;
} {
  const existing = existingAnonymousId(request);
  if (existing) {
    return { id: existing, created: false };
  }
  return { id: createAnonymousId(), created: true };
}

/** 需要写回 cookie 时的 `Set-Cookie` 值。 */
export function anonymousCookieHeader(id: string): string {
  const attrs = [
    `${ANON_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ANON_COOKIE_MAX_AGE}`,
  ];
  return attrs.join('; ');
}

/**
 * 匿名身份在**存储层**用的键。
 *
 * 刻意只是加一个前缀，**不再哈希一次** —— 因为下游的
 * `settingsFileFor` / `commitmentFileFor` 内部已经做了
 * `sha256(prefix:key)` 并只把哈希写进文件名，
 * 因此磁盘上不会出现身份本身，也不存在路径穿越。
 *
 * 前缀的作用是把「匿名身份」与「知乎 url_token」在同一个存储命名空间里区分开：
 * 两者的取值空间不同，加前缀可以避免理论上的一次碰撞导致读到别人的配置。
 */
export function anonymousStorageKey(id: string): string {
  return `anon:${id}`;
}
