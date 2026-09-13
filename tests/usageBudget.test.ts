import { describe, expect, it } from 'vitest';

import { SessionLlmBudget } from '@/core/usage/budget';
import { SessionQuota } from '@/core/usage/rateLimit';

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
