/**
 * App provider 的用量闸门配置（产品化方案 §5 / §7 / §45）。
 *
 * ## 为什么上限要能配
 *
 * `budget.ts` / `rateLimit.ts` 里的类只负责**怎么算**；具体数字必须能从环境
 * 变量改 —— 否则「比赛现场」与「自己压测」就得改代码再发一次。
 *
 * ```env
 * APP_MAX_LLM_CALLS_PER_SESSION=5
 * APP_MAX_SESSIONS_PER_HOUR=5
 * APP_MAX_SESSIONS_PER_DAY=20
 * APP_MAX_DAILY_LLM_CALLS=2000
 * APP_MAX_SESSIONS_PER_IP_HOUR=10
 * APP_MAX_LLM_CALLS_PER_IP_HOUR=30
 * ```
 *
 * ## 三条纪律
 *
 * 1. **读不到就回默认值**：没配、配了空白、配了 `abc` / `0` / `-1` / `2.5`
 *    一律当没配 —— 一个打错的 env 不该把闸门关死（限成 0 等于全站 AI 停摆，
 *    而且现场没人会想到是环境变量干的）。
 * 2. **纯函数**：env 可注入，所以「配了 / 没配 / 配错」三种情况都能直接测。
 * 3. **只在服务端用**：这里不含任何密钥，但配额是服务端资源账本，
 *    与 `budget` / `rateLimit` 一样只该被路由读到。
 */

/** 四道闸的数值。 */
export interface UsageLimits {
  /** 一局之内最多几次真正的模型调用。 */
  readonly sessionLlmCalls: number;
  /** 一个身份每小时最多开几局。 */
  readonly sessionsPerHour: number;
  /** 一个身份每天最多开几局（比小时闸更粗的一道）。 */
  readonly sessionsPerDay: number;
  /** 全站每天最多几次 App provider 模型调用（软上限，超了只暂停 App）。 */
  readonly dailyLlmCalls: number;
  /**
   * 一个 IP 每小时最多开几局（`ipRateLimit.ts`）。
   *
   * 身份闸的兜底：匿名 cookie 可以被刷子重置，IP 不能。默认比身份闸宽
   * （一个公司 / 校园网出口会共用 IP），只拦「明显不是人」的量级。
   */
  readonly ipSessionsPerHour: number;
  /**
   * 一个 IP 每小时最多几次 App 花钱调用（模型 + 知乎检索）。
   *
   * 覆盖不以「开局」为入口的花钱端点（/api/dm、/api/profile、
   * /api/boss/evaluate）—— 没有这道闸，它们可以被脚本逐次白嫖。
   */
  readonly ipLlmCallsPerHour: number;
}

/** 环境变量名 → 闸门字段。改名字只改这里。 */
export const USAGE_LIMIT_ENV_KEYS = {
  sessionLlmCalls: 'APP_MAX_LLM_CALLS_PER_SESSION',
  sessionsPerHour: 'APP_MAX_SESSIONS_PER_HOUR',
  sessionsPerDay: 'APP_MAX_SESSIONS_PER_DAY',
  dailyLlmCalls: 'APP_MAX_DAILY_LLM_CALLS',
  ipSessionsPerHour: 'APP_MAX_SESSIONS_PER_IP_HOUR',
  ipLlmCallsPerHour: 'APP_MAX_LLM_CALLS_PER_IP_HOUR',
} as const satisfies Record<keyof UsageLimits, string>;

/**
 * 默认值：与产品化方案 §5 / §7 里写的数字一致。
 *
 * 单局 5 次是「理解 1 次 + 世界编译 1 次 + 三幕叙事各 1 次」的预算，
 * 而不是拍脑袋的整数；全站 2000 次是「比赛一天不会被刷爆」的量级。
 */
export const DEFAULT_USAGE_LIMITS: UsageLimits = {
  sessionLlmCalls: 5,
  sessionsPerHour: 5,
  sessionsPerDay: 20,
  dailyLlmCalls: 2000,
  ipSessionsPerHour: 10,
  ipLlmCallsPerHour: 30,
};

/**
 * 读一个正整数 env：空白、非数字、非整数、非正数、无穷大都当没配。
 *
 * 用 `Number()` 而不是 `parseInt()`：`parseInt('5abc')` 会得到 5，
 * 把「写错的配置」伪装成「配对了」，这种静默容错在现场最难查。
 */
export function readPositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

/** 从 env 读出全部闸门；任何一项读不到就用该项的默认值。 */
export function usageLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): UsageLimits {
  return {
    sessionLlmCalls: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.sessionLlmCalls, DEFAULT_USAGE_LIMITS.sessionLlmCalls),
    sessionsPerHour: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.sessionsPerHour, DEFAULT_USAGE_LIMITS.sessionsPerHour),
    sessionsPerDay: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.sessionsPerDay, DEFAULT_USAGE_LIMITS.sessionsPerDay),
    dailyLlmCalls: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.dailyLlmCalls, DEFAULT_USAGE_LIMITS.dailyLlmCalls),
    ipSessionsPerHour: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.ipSessionsPerHour, DEFAULT_USAGE_LIMITS.ipSessionsPerHour),
    ipLlmCallsPerHour: readPositiveInt(env, USAGE_LIMIT_ENV_KEYS.ipLlmCallsPerHour, DEFAULT_USAGE_LIMITS.ipLlmCallsPerHour),
  };
}
