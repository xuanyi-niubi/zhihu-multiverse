import { describe, expect, it } from 'vitest';

import { allocateAppLlmCall, DailyLlmBudget, SessionLlmBudget } from '@/core/usage/budget';
import { SessionQuota } from '@/core/usage/rateLimit';
import {
  DEFAULT_USAGE_LIMITS,
  readPositiveInt,
  USAGE_LIMIT_ENV_KEYS,
  usageLimitsFromEnv,
} from '@/core/usage/limits';

/**
 * App provider 的预算与限流（产品化方案 §7 / §45）。
 *
 * 这一层与「App-owned provider」是同一次改动里必须同时存在的一对：
 * 服务器提供 key 却不在预算，等于把部署者的钱包交给所有访问者。
 *
 * 两个类都接受注入时钟，所以这里的窗口滚动是**真测**出来的，不是 sleep 等出来的。
 */

function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('每局 LLM 调用预算', () => {
  it('默认上限 5 次，前 5 次允许、第 6 次拒绝', () => {
    const budget = new SessionLlmBudget();
    for (let i = 1; i <= 5; i += 1) {
      expect(budget.consume('s1').allowed).toBe(true);
    }
    const denied = budget.consume('s1');
    expect(denied.allowed).toBe(false);
    expect(denied.limit).toBe(5);
    expect(denied.reason).toContain('离线叙事');
  });

  it('**被拒时不计数** —— 重试不会把恢复窗口越推越远', () => {
    const budget = new SessionLlmBudget({ limit: 1 });
    expect(budget.consume('s1').allowed).toBe(true);
    const first = budget.consume('s1');
    const second = budget.consume('s1');
    expect(first.used).toBe(1);
    expect(second.used).toBe(1);
  });

  it('不同局各自计数，互不影响', () => {
    const budget = new SessionLlmBudget({ limit: 1 });
    expect(budget.consume('s1').allowed).toBe(true);
    expect(budget.consume('s2').allowed).toBe(true);
    expect(budget.consume('s1').allowed).toBe(false);
    expect(budget.consume('s2').allowed).toBe(false);
  });

  it('peek 只看不用', () => {
    const budget = new SessionLlmBudget({ limit: 2 });
    expect(budget.peek('s1').used).toBe(0);
    budget.consume('s1');
    expect(budget.peek('s1').used).toBe(1);
    expect(budget.peek('s1').used).toBe(1);
  });

  it('长时间不再被触碰的计数会被丢弃（单实例长跑不涨内存）', () => {
    const c = clock();
    const budget = new SessionLlmBudget({ limit: 1, ttlMs: 1000, now: c.now });
    expect(budget.consume('s1').allowed).toBe(true);
    expect(budget.consume('s1').allowed).toBe(false);
    c.advance(2000);
    expect(budget.consume('s1').allowed).toBe(true);
  });
});

describe('每身份开局配额', () => {
  it('默认每小时 5 局、每天 20 局：第 6 局被拒并给出重试时间', () => {
    const c = clock();
    const quota = new SessionQuota({ now: c.now });
    for (let i = 1; i <= 5; i += 1) {
      expect(quota.consume('anon:1').allowed).toBe(true);
    }
    const denied = quota.consume('anon:1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('这一小时');
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('一小时后窗口滚动，可以继续开局', () => {
    const c = clock();
    const quota = new SessionQuota({ perHour: 2, perDay: 20, now: c.now });
    quota.consume('anon:1');
    quota.consume('anon:1');
    expect(quota.consume('anon:1').allowed).toBe(false);
    c.advance(60 * 60 * 1000 + 1);
    expect(quota.consume('anon:1').allowed).toBe(true);
  });

  it('日上限独立生效（小时窗口通了也可能撞到日上限）', () => {
    const c = clock();
    const quota = new SessionQuota({ perHour: 2, perDay: 3, now: c.now });
    for (let i = 0; i < 3; i += 1) {
      expect(quota.consume('anon:1').allowed).toBe(true);
      c.advance(60 * 60 * 1000 + 1); // 每次跨过一个小时窗口
    }
    const denied = quota.consume('anon:1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('今天');
    // 拒绝原因里要告诉用户「自己填 key 就不受限」——否则他只会觉得产品坏了
    expect(denied.reason).toContain('自己的');
  });

  it('**被拒时不计数**：反复重试不会延长自己的封锁', () => {
    const c = clock();
    const quota = new SessionQuota({ perHour: 1, perDay: 20, now: c.now });
    quota.consume('anon:1');
    for (let i = 0; i < 5; i += 1) {
      expect(quota.consume('anon:1').allowed).toBe(false);
    }
    c.advance(60 * 60 * 1000 + 1);
    // 如果重试也计数，这里就会仍然被拒
    expect(quota.consume('anon:1').allowed).toBe(true);
  });

  it('身份之间互不影响（一个被限流不影响别人）', () => {
    const c = clock();
    const quota = new SessionQuota({ perHour: 1, perDay: 20, now: c.now });
    quota.consume('anon:1');
    expect(quota.consume('anon:1').allowed).toBe(false);
    expect(quota.consume('anon:2').allowed).toBe(true);
  });

  it('peek 不改状态', () => {
    const c = clock();
    const quota = new SessionQuota({ perHour: 1, perDay: 20, now: c.now });
    expect(quota.peek('anon:1').allowed).toBe(true);
    expect(quota.peek('anon:1').allowed).toBe(true);
    quota.consume('anon:1');
    expect(quota.peek('anon:1').allowed).toBe(false);
  });
});

/**
 * 闸门数字来自 `APP_MAX_*`（产品化方案 §5）。
 *
 * 这里测的是**解析纪律**：写错的 env 不能把闸门关死（限成 0 = 全站 AI 停摆），
 * 也不能把「写错了」伪装成「配对了」（`parseInt('5abc') === 5` 那种静默容错）。
 */
describe('用量闸门的环境变量', () => {
  it('没配任何 APP_MAX_* → 全部回默认值', () => {
    expect(usageLimitsFromEnv({})).toEqual(DEFAULT_USAGE_LIMITS);
    expect(DEFAULT_USAGE_LIMITS).toEqual({
      sessionLlmCalls: 5,
      sessionsPerHour: 5,
      sessionsPerDay: 20,
      dailyLlmCalls: 2000,
      ipSessionsPerHour: 10,
      ipLlmCallsPerHour: 30,
    });
  });

  it('配了就按配的来（空白会被 trim）', () => {
    const limits = usageLimitsFromEnv({
      [USAGE_LIMIT_ENV_KEYS.sessionLlmCalls]: ' 8 ',
      [USAGE_LIMIT_ENV_KEYS.sessionsPerHour]: '2',
      [USAGE_LIMIT_ENV_KEYS.sessionsPerDay]: '50',
      [USAGE_LIMIT_ENV_KEYS.dailyLlmCalls]: '10000',
    });
    expect(limits).toEqual({
      sessionLlmCalls: 8,
      sessionsPerHour: 2,
      sessionsPerDay: 50,
      dailyLlmCalls: 10000,
      ipSessionsPerHour: 10,
      ipLlmCallsPerHour: 30,
    });
  });

  it('空白 / 非数字 / 0 / 负数 / 小数 / 无穷大 一律当没配（不能把闸门关死）', () => {
    const bad = ['', '   ', 'abc', '5abc', '0', '-1', '2.5', 'Infinity', 'NaN'];
    for (const raw of bad) {
      expect(readPositiveInt({ X: raw }, 'X', 7), `raw=${JSON.stringify(raw)}`).toBe(7);
    }
    expect(readPositiveInt({}, 'X', 7)).toBe(7);
  });
});

/**
 * 全站每日软上限（产品化方案 §7 / §13）。
 *
 * 它是**软**上限：用满只暂停 App provider，BYOK 与离线路径都不受影响 ——
 * 所以这里既测「用满会拒」，也测「拒了不计数」与「窗口到了能自愈」。
 */
describe('全站每日软上限', () => {
  it('默认 2000 次：第 2000 次允许、第 2001 次拒绝', () => {
    const daily = new DailyLlmBudget();
    for (let i = 1; i <= 2000; i += 1) {
      expect(daily.consume().allowed).toBe(true);
    }
    const denied = daily.consume();
    expect(denied.allowed).toBe(false);
    expect(denied.limit).toBe(2000);
    // 拒绝文案必须给出「用自己 key 不受影响」的出口，否则用户只会以为产品坏了
    expect(denied.reason).toContain('自己的');
    expect(denied.reason).toContain('离线叙事');
  });

  it('**被拒时不计数**：反复重试不会把窗口越推越远', () => {
    const daily = new DailyLlmBudget({ limit: 1 });
    expect(daily.consume().allowed).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      expect(daily.consume().used).toBe(1);
    }
  });

  it('满一个窗口后自动归零（不需要定时器）', () => {
    const c = clock();
    const daily = new DailyLlmBudget({ limit: 1, windowMs: 1000, now: c.now });
    expect(daily.consume().allowed).toBe(true);
    expect(daily.peek().allowed).toBe(false);
    c.advance(1001);
    expect(daily.peek().allowed).toBe(true);
    expect(daily.consume().allowed).toBe(true);
  });

  it('reset() 立即开始新窗口', () => {
    const daily = new DailyLlmBudget({ limit: 1 });
    daily.consume();
    expect(daily.peek().allowed).toBe(false);
    daily.reset();
    expect(daily.peek().allowed).toBe(true);
  });
});

/**
 * 一次 App 调用要同时过两道闸（全局每日 → 本局上限）。
 *
 * 顺序与「被拒时不动任何计数」都是刻意的：否则「今天用满」会顺带把用户
 * 这一局的额度也吃掉，明天恢复时他这局已经废了。
 */
describe('allocateAppLlmCall：两道闸一起过', () => {
  it('两道都有余量 → 允许，且两道都记了一次', () => {
    const session = new SessionLlmBudget({ limit: 2 });
    const daily = new DailyLlmBudget({ limit: 10 });
    const allocation = allocateAppLlmCall({ session, daily, key: 's1' });
    expect(allocation).toEqual({ allowed: true, scope: null, reason: null });
    expect(session.peek('s1').used).toBe(1);
    expect(daily.peek().used).toBe(1);
  });

  it('全局每日用满 → 拦在 daily，**本局额度一次都不动**', () => {
    const session = new SessionLlmBudget({ limit: 2 });
    const daily = new DailyLlmBudget({ limit: 1 });
    daily.consume();
    const allocation = allocateAppLlmCall({ session, daily, key: 's1' });
    expect(allocation.allowed).toBe(false);
    expect(allocation.scope).toBe('daily');
    expect(session.peek('s1').used).toBe(0);
  });

  it('本局用满 → 拦在 session，**全局计数不动**', () => {
    const session = new SessionLlmBudget({ limit: 1 });
    const daily = new DailyLlmBudget({ limit: 10 });
    expect(allocateAppLlmCall({ session, daily, key: 's1' }).allowed).toBe(true);
    const second = allocateAppLlmCall({ session, daily, key: 's1' });
    expect(second.allowed).toBe(false);
    expect(second.scope).toBe('session');
    expect(daily.peek().used).toBe(1);
  });

  it('两局各自计数（一局用满不影响另一局）', () => {
    const session = new SessionLlmBudget({ limit: 1 });
    const daily = new DailyLlmBudget({ limit: 10 });
    expect(allocateAppLlmCall({ session, daily, key: 's1' }).allowed).toBe(true);
    expect(allocateAppLlmCall({ session, daily, key: 's1' }).allowed).toBe(false);
    expect(allocateAppLlmCall({ session, daily, key: 's2' }).allowed).toBe(true);
  });
});
