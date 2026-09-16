import type { ExperienceSearch } from '@/features/experience/retrieve';

/**
 * 知乎检索的**全站日预算**（P2 护栏）。
 *
 * ## 为什么必须要有这一道
 *
 * 模型调用被五道闸保护（每局 / 每身份每小时 / 每身份每日 / 全站每日 / 每 IP），
 * 而**最稀缺的知乎检索配额此前只有「每局 ≤N 条」一个约束**。
 * 每局预算放宽到 8 条之后，一局就花掉 8 次额度 —— 几个访客就能把当天额度吃光。
 *
 * 更糟的是：**"额度用光"和"没有人讨论"在界面上长得一模一样**，
 * 而这个产品最不能犯的错就是把"我们没查"说成"没有人"。
 *
 * ## 纪律
 *
 * 1. 用满**不报错、不 5xx**：只是让检索停下来，并由调用方如实标注
 *    （`RetrieveRun.status = 'budget'` → 页面上说"今天的检索额度用完了"）。
 * 2. 缓存命中的请求**不消耗**额度：所以包装顺序必须是
 *    `withExperienceSearchCache(withSearchBudget(search))` —— 缓存在外层。
 * 3. 单实例进程内计数（与其它配额闸一致，属比赛版边界）。
 */

/** 被配额挡下时抛出的类型化错误：调用方据此**如实标注**，而不是当成"没找到"。 */
export class SearchBudgetExhaustedError extends Error {
  readonly code = 'search-budget-exhausted';

  constructor(limit: number) {
    super(`今天的知乎检索额度已用完（上限 ${limit} 次）`);
    this.name = 'SearchBudgetExhaustedError';
  }
}

/** 判断一个错误是不是"额度用尽"（跨模块实例也认，所以同时看 code）。 */
export function isSearchBudgetExhausted(error: unknown): boolean {
  if (error instanceof SearchBudgetExhaustedError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'search-budget-exhausted'
  );
}

const DEFAULT_DAILY_SEARCH_LIMIT = 900;

let dayKey = '';
let used = 0;

function currentDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function limitFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.APP_MAX_SEARCHES_PER_DAY);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_DAILY_SEARCH_LIMIT;
}

function roll(now: number): void {
  const key = currentDayKey(now);
  if (key !== dayKey) {
    dayKey = key;
    used = 0;
  }
}

export interface SearchBudgetDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  readonly reason: string | null;
}

/** 消费一次检索额度。只有允许时才计数（被拒的请求不推高数字）。 */
export function consumeSearchRequest(count = 1, now: number = Date.now()): SearchBudgetDecision {
  roll(now);
  const limit = limitFromEnv();
  if (used + count > limit) {
    return { allowed: false, used, limit, reason: `今天的知乎检索额度已用完（${used}/${limit}）` };
  }
  used += count;
  return { allowed: true, used, limit, reason: null };
}

export interface SearchBudgetState {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly dayKey: string;
}

export function searchBudgetState(now: number = Date.now()): SearchBudgetState {
  roll(now);
  const limit = limitFromEnv();
  return { used, limit, remaining: Math.max(0, limit - used), dayKey };
}

/** 仅供单测隔离状态。 */
export function resetSearchBudgetForTests(): void {
  dayKey = '';
  used = 0;
}

/**
 * 给任意 `ExperienceSearch` 套上日预算。
 *
 * 额度用尽时**抛类型化错误**（而不是返回空数组）—— 返回空数组会让
 * 上游把它记成"没搜到"，那正是我们要避免的谎言。返回空是"上游说没有"，
 * 抛错是"我们自己停下了"，两者必须可区分。
 */
export function withSearchBudget(search: ExperienceSearch): ExperienceSearch {
  return async (query, count = 8) => {
    const decision = consumeSearchRequest();
    if (!decision.allowed) {
      throw new SearchBudgetExhaustedError(decision.limit);
    }
    return search(query, count);
  };
}
