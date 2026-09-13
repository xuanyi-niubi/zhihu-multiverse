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
 */

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
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

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

/** 进程级默认预算：路由直接用这一个（单实例前提见文件头注释）。 */
export const appSessionLlmBudget = new SessionLlmBudget();
