/**
 * 每身份的开局配额（产品化方案 §7 / §45）。
 *
 * 与 `budget.ts` 的分工：
 *
 * ```text
 * SessionLlmBudget  —— 一局内部：最多几次模型调用（防止单局被拖长）
 * SessionQuota      —— 身份维度：一段时间内最多开几局（防止被刷）
 * ```
 *
 * 两道闸缺一不可：只有预算，刷子可以开无限多局、每局用 5 次；
 * 只有配额，单局也可能被拖成几十次调用。
 *
 * ## 只对 App provider 生效
 *
 * 用户自己带 key 时不受这里的限制 —— 花的是他的钱。配额只在「这一局会用
 * 服务器 key」时计入，判断由调用方（`/api/sessions`）通过 `secretOriginFor` 完成。
 *
 * ## 为什么是滑动窗口而不是固定窗口
 *
 * 固定窗口有一个众所周知的问题：窗口边界处可以瞬间打满两个窗口的量。
 * 这里用「记录最近 N 次的时间戳」的滑动窗口，实现同样没有外部依赖。
 */

export interface QuotaDecision {
  readonly allowed: boolean;
  /** 被拒时的一句话原因；允许时为 null。 */
  readonly reason: string | null;
  /** 建议多久之后再试（毫秒）；允许时为 null。 */
  readonly retryAfterMs: number | null;
}

export interface SessionQuotaOptions {
  /** 每小时最多开几局。 */
  readonly perHour?: number;
  /** 每天最多开几局。 */
  readonly perDay?: number;
  readonly now?: () => number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_PER_HOUR = 5;
const DEFAULT_PER_DAY = 20;

/**
 * 单身份的滑动窗口开局配额。
 *
 * 每次成功开局调用 `consume(identityKey)`；被拒时不计数。
 */
export class SessionQuota {
  private readonly events = new Map<string, number[]>();
  private readonly perHour: number;
  private readonly perDay: number;
  private readonly now: () => number;

  constructor(options: SessionQuotaOptions = {}) {
    this.perHour = options.perHour ?? DEFAULT_PER_HOUR;
    this.perDay = options.perDay ?? DEFAULT_PER_DAY;
    this.now = options.now ?? (() => Date.now());
  }

  /** 先看还能不能开局（不改计数）。 */
  peek(identityKey: string): QuotaDecision {
    const now = this.now();
    const stamps = this.recent(identityKey, now);
    return this.decide(stamps, now);
  }

  /** 记一次开局；被拒时不计数。 */
  consume(identityKey: string): QuotaDecision {
    const now = this.now();
    const stamps = this.recent(identityKey, now);
    const decision = this.decide(stamps, now);
    if (!decision.allowed) {
      return decision;
    }
    this.events.set(identityKey, [...stamps, now]);
    return { allowed: true, reason: null, retryAfterMs: null };
  }

  reset(): void {
    this.events.clear();
  }

  /** 该身份在窗口内的开局时间戳（已按天裁剪）。 */
  private recent(identityKey: string, now: number): readonly number[] {
    const all = this.events.get(identityKey) ?? [];
    const kept = all.filter((stamp) => now - stamp < DAY_MS);
    if (kept.length === 0) {
      this.events.delete(identityKey);
    } else if (kept.length !== all.length) {
      this.events.set(identityKey, kept);
    }
    return kept;
  }

  private decide(stamps: readonly number[], now: number): QuotaDecision {
    const withinHour = stamps.filter((stamp) => now - stamp < HOUR_MS);
    if (withinHour.length >= this.perHour) {
      const oldest = Math.min(...withinHour);
      return {
        allowed: false,
        reason: `这一小时里已经开了 ${this.perHour} 局，先歇一会儿再开下一局。`,
        retryAfterMs: Math.max(0, HOUR_MS - (now - oldest)),
      };
    }
    if (stamps.length >= this.perDay) {
      const oldest = Math.min(...stamps);
      return {
        allowed: false,
        reason: `今天已经开了 ${this.perDay} 局，明天再来 —— 或者在自己的设置里填入你的模型密钥，就不受这个限制。`,
        retryAfterMs: Math.max(0, DAY_MS - (now - oldest)),
      };
    }
    return { allowed: true, reason: null, retryAfterMs: null };
  }
}

/** 进程级默认配额：路由直接用这一个（单实例前提同 budget）。 */
export const appSessionQuota = new SessionQuota();
