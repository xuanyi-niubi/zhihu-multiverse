/**
 * IP 维度的防刷闸门（产品化方案 §7 的补充层）。
 *
 * ## 为什么有了身份配额还要 IP 闸
 *
 * `rateLimit.ts` 的 `SessionQuota` 以**匿名 cookie 身份**为键 —— 这是产品
 * 体验上正确的粒度（不清 cookie 的正常用户按人计数）。但刷子只需要
 * 「每次请求前清 cookie」就能拿到一个全新的身份，身份闸对它形同虚设。
 *
 * IP 是单实例部署下**唯一无法被客户端凭空重置**的标识（换 IP 的成本远高于
 * 清 cookie），所以它是防「盗刷服务器 key」的最后一道应用层闸门。
 *
 * ## 部署前提（与 budget.ts 相同的单实例约定）
 *
 * 站点跑在 nginx 反代后面（`docker-compose.yml` 单副本），nginx 必须覆写
 * `X-Forwarded-For` / `X-Real-IP`（`proxy_set_header`）—— 客户端自报的
 * XFF 会被代理替换掉。直连暴露 Node 端口时 XFF 可被伪造，这一层会失效，
 * 所以**生产环境绝不直接暴露容器端口**（compose 里只发布 443/8443）。
 *
 * ## 两道 IP 闸的分工
 *
 * ```text
 * appIpSessionQuota —— 每个 IP 每小时最多开几局（兜底身份闸被绕过的情形）
 * appIpLlmWindow    —— 每个 IP 每小时最多几次 App 花钱调用
 *                      （覆盖 /api/dm、/api/profile、/api/boss/evaluate 这些
 *                       不以「开局」为入口的端点）
 * ```
 *
 * 与身份闸 / 预算闸一样：**只对 App provider 计数**。自带 key 的访客花的是
 * 自己的钱，任何一道闸都不该拦他。
 */

import { usageLimitsFromEnv } from './limits';

/** 从请求头解析客户端 IP：XFF 首跳优先，X-Real-IP 兜底，都没有进共享桶。 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // XFF 可能是 "client, proxy1, proxy2"：首跳才是客户端（nginx 覆写前提下可信）
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }
  /**
   * 拿不到 IP 时不放行也不报错，而是全部进 `'unknown'` 这个**共享桶** ——
   * 这样「想办法抹掉 IP 头」的攻击者彼此挤同一个配额，而不是每人一份。
   */
  return 'unknown';
}

export interface IpWindowDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
}

export interface IpWindowLimiterOptions {
  /** 窗口长度（默认 1 小时）。 */
  readonly windowMs?: number;
  /** 窗口内最多多少次。 */
  readonly limit?: number;
  readonly now?: () => number;
  /** 超过多久没活动的桶直接丢弃（防止长跑时 Map 无限增长）。 */
  readonly ttlMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * 每 IP 滑动窗口限流器：与 `SessionQuota` 同构（记录窗口内时间戳），
 * 但键是 IP、窗口只有一档（小时级），语义更粗 —— 它是防刷兜底，
 * 不是产品粒度的配额。
 */
export class IpWindowLimiter {
  private readonly events = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: IpWindowLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? HOUR_MS;
    this.limit = options.limit ?? 10;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? 6 * HOUR_MS;
  }

  peek(key: string): IpWindowDecision {
    return this.decide(this.recent(key), this.now());
  }

  /** 记一次；被拒时不计数（与预算闸同一纪律：重试不该把恢复窗口越推越远）。 */
  consume(key: string): IpWindowDecision {
    const now = this.now();
    const stamps = this.recent(key);
    const decision = this.decide(stamps, now);
    if (!decision.allowed) {
      return decision;
    }
    this.events.set(key, [...stamps, now]);
    return { allowed: true, reason: null, retryAfterMs: null };
  }

  reset(): void {
    this.events.clear();
  }

  private recent(key: string): readonly number[] {
    const now = this.now();
    const all = this.events.get(key) ?? [];
    const kept = all.filter((stamp) => now - stamp < this.windowMs);
    if (kept.length === 0) {
      this.events.delete(key);
    } else if (kept.length !== all.length) {
      this.events.set(key, kept);
    }
    return kept;
  }

  private decide(stamps: readonly number[], now: number): IpWindowDecision {
    if (stamps.length < this.limit) {
      return { allowed: true, reason: null, retryAfterMs: null };
    }
    const oldest = Math.min(...stamps);
    return {
      allowed: false,
      reason: `这个网络环境这一小时的使用次数已到上限（${this.limit} 次）—— 在自己的设置里填入模型密钥就不受这个限制。`,
      retryAfterMs: Math.max(0, this.windowMs - (now - oldest)),
    };
  }
}

/**
 * 进程级默认实例：路由直接用这两个（单实例前提见文件头注释）。
 *
 * 数字来自 `APP_MAX_SESSIONS_PER_IP_HOUR` / `APP_MAX_LLM_CALLS_PER_IP_HOUR`
 * （`limits.ts`），模块加载时读一次。
 */
const appLimits = usageLimitsFromEnv();

export const appIpSessionQuota = new IpWindowLimiter({ limit: appLimits.ipSessionsPerHour });
export const appIpLlmWindow = new IpWindowLimiter({ limit: appLimits.ipLlmCallsPerHour });
