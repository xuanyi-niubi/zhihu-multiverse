/**
 * 用量预算（产品化方案 §7 / §45）。
 *
 * ## 为什么必须有它
 *
 * 服务器提供 App provider 之后，公开部署就多了一种风险：
 *
 * > 任何人（包括爬虫）都能拿部署者的 key 无限调用 LLM。
 *
 * 旧版「env 兜底」正是因为**没有配套预算**才被判定为不可接受。所以 App
 * provider 与预算是同一次改动里必须同时存在的一对。
 *
 * ## 三条实现约束（方案 §7）
 *
 * 1. **不用 Redis、不用数据库**：比赛部署是单实例 VPS，内存计数足够；
 *    引入外部依赖只为限流，是拿运维复杂度换一个不需要的精确度。
 * 2. **只对 App provider 计数**：用户自带 key 时花的是他自己的钱，
 *    我们没有理由限制他。
 * 3. **时间可注入**：计数器不 sleep、不依赖真实时钟，因此可以被直接测试。
 *
 * ## 单实例前提
 *
 * 内存计数在**多实例**下会各算各的（宽松上限）。这与项目既有的
 * 「单实例部署」硬约束一致，已在 `DEPLOYED.md` 写明；换成多实例时
 * 这一层必须换成共享存储 —— 这是**唯一**需要改的地方，所以它被包在
 * 一个类里，而不是散落在路由里。
 *
 * ## 两道闸的分工
 *
 * ```text
 * SessionLlmBudget  —— 一局之内：最多几次调用（防止单局被拖长）
 * DailyLlmBudget    —— 全站当天：最多几次 App 调用（防止被刷爆，方案 §13）
 * ```
 *
 * 后者是**软上限**：用满只暂停 App provider，自带 key 的访客照常，
 * 其余人退回离线叙事 —— 绝不整个站点 500。
 *
 * 具体数字来自 `limits.ts`（`APP_MAX_*`），不写死在这里。
 */

import { usageLimitsFromEnv } from './limits';

/** 一次消费的结果：允许与否、已用多少、上限多少。 */
export interface BudgetDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  /** 被拒时的一句话原因（用于诊断与用户提示，不含内部细节）。 */
  readonly reason: string | null;
}

export interface SessionLlmBudgetOptions {
  /** 每局最多几次 LLM 调用（方案 §8：目标 3～5 次）。 */
  readonly limit?: number;
  readonly now?: () => number;
  /** 计数多久未再被触碰就丢弃（防止单实例长跑时 Map 无限增长）。 */
  readonly ttlMs?: number;
}

interface Counter {
  count: number;
  touchedAt: number;
}

const DEFAULT_SESSION_LLM_LIMIT = 5;
const DEFAULT_DAILY_LLM_LIMIT = 2000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 每局 LLM 调用预算。
 *
 * 键是**本局的身份**（session 模式用 sessionId；legacy 用 goal 的稳定摘要），
 * 所以「同一局里三次叙事 + 一次编译」共享同一个池子。
 */
export class SessionLlmBudget {
  private readonly counters = new Map<string, Counter>();
  private readonly limit: number;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: SessionLlmBudgetOptions = {}) {
    this.limit = options.limit ?? DEFAULT_SESSION_LLM_LIMIT;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** 先看还能不能用（不改计数）。 */
  peek(key: string): BudgetDecision {
    this.sweep();
    const used = this.counters.get(key)?.count ?? 0;
    return this.decide(used);
  }

  /**
   * 消费一次预算。
   *
   * **只有允许时才计数** —— 被拒的请求不该继续把数字推高（否则恢复窗口
   * 会被自己的重试无限延后）。
   */
  consume(key: string): BudgetDecision {
    this.sweep();
    const current = this.counters.get(key);
    const used = current?.count ?? 0;
    const decision = this.decide(used);
    if (!decision.allowed) {
      return decision;
    }
    this.counters.set(key, { count: used + 1, touchedAt: this.now() });
    return { allowed: true, used: used + 1, limit: this.limit, reason: null };
  }

  /** 测试与运维用：清空全部计数。 */
  reset(): void {
    this.counters.clear();
  }

  private decide(used: number): BudgetDecision {
    if (used < this.limit) {
      return { allowed: true, used, limit: this.limit, reason: null };
    }
    return {
      allowed: false,
      used,
      limit: this.limit,
      reason: `这一局已经用满 ${this.limit} 次模型调用，剩下的部分走离线叙事（不会中断这一局）。`,
    };
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, counter] of this.counters) {
      if (now - counter.touchedAt > this.ttlMs) {
        this.counters.delete(key);
      }
    }
  }
}

export interface DailyLlmBudgetOptions {
  readonly limit?: number;
  readonly now?: () => number;
  readonly windowMs?: number;
}

/**
 * 全站每天的 App 调用软上限（方案 §13）。
 *
 * 固定窗口（首次消费起算 24 小时）而不是滑动窗口：这里要的是「今天大概花了
 * 多少」这种量级的护栏，不是精确到秒的配额 —— 用最少的代码换最不容易出错的
 * 语义。窗口一到自动归零，不需要任何定时器。
 */
export class DailyLlmBudget {
  private count = 0;
  private resetAt: number;
  private readonly limit: number;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(options: DailyLlmBudgetOptions = {}) {
    this.limit = options.limit ?? DEFAULT_DAILY_LLM_LIMIT;
    this.now = options.now ?? (() => Date.now());
    this.windowMs = options.windowMs ?? DAY_MS;
    this.resetAt = this.now() + this.windowMs;
  }

  /** 先看还能不能用（不改计数）。 */
  peek(): BudgetDecision {
    this.roll();
    return this.decide();
  }

  /** 消费一次；**只有允许时才计数**（与 `SessionLlmBudget` 同一纪律）。 */
  consume(): BudgetDecision {
    this.roll();
    const decision = this.decide();
    if (!decision.allowed) {
      return decision;
    }
    this.count += 1;
    return { allowed: true, used: this.count, limit: this.limit, reason: null };
  }

  /** 测试与运维用：立即开启一个新窗口。 */
  reset(): void {
    this.count = 0;
    this.resetAt = this.now() + this.windowMs;
  }

  private roll(): void {
    if (this.now() >= this.resetAt) {
      this.count = 0;
      this.resetAt = this.now() + this.windowMs;
    }
  }

  private decide(): BudgetDecision {
    if (this.count < this.limit) {
      return { allowed: true, used: this.count, limit: this.limit, reason: null };
    }
    return {
      allowed: false,
      used: this.count,
      limit: this.limit,
      reason: `今天服务器提供的模型额度已经用满（${this.limit} 次）—— 在你自己的设置里填入模型密钥可以继续，不受这个限制；剩下的部分改成离线叙事。`,
    };
  }
}

/** 一次 App 调用要同时过两道闸：全局每日 → 本局上限。 */
export interface AppLlmAllocation {
  readonly allowed: boolean;
  /** 被哪一道闸拦下的；允许时为 null。 */
  readonly scope: 'daily' | 'session' | null;
  readonly reason: string | null;
}

/**
 * 申请一次**真正会花服务器 key** 的模型调用。
 *
 * 顺序是「先全局、后本局」，且任一道被拒时都**不动任何计数** ——
 * 否则「今天用满」会顺带把用户这一局的额度也吃掉，明天恢复时他这局已经废了。
 */
export function allocateAppLlmCall(input: {
  readonly session: SessionLlmBudget;
  readonly daily: DailyLlmBudget;
  readonly key: string;
}): AppLlmAllocation {
  const dailyPeek = input.daily.peek();
  if (!dailyPeek.allowed) {
    return { allowed: false, scope: 'daily', reason: dailyPeek.reason };
  }
  const session = input.session.consume(input.key);
  if (!session.allowed) {
    return { allowed: false, scope: 'session', reason: session.reason };
  }
  input.daily.consume();
  return { allowed: true, scope: null, reason: null };
}

/**
 * 进程级默认预算：路由直接用这两个（单实例前提见文件头注释）。
 *
 * 数字来自 `APP_MAX_*`（`limits.ts`），在模块加载时读一次 —— 与 Next.js
 * 「服务端进程长驻」一致，也让路由不必每次请求都重新解析环境变量。
 */
const appLimits = usageLimitsFromEnv();

export const appSessionLlmBudget = new SessionLlmBudget({ limit: appLimits.sessionLlmCalls });
export const appDailyLlmBudget = new DailyLlmBudget({ limit: appLimits.dailyLlmCalls });
