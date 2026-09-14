import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders, IpWindowLimiter } from '@/core/usage/ipRateLimit';
import { DEFAULT_USAGE_LIMITS, USAGE_LIMIT_ENV_KEYS, usageLimitsFromEnv } from '@/core/usage/limits';

/**
 * IP 维度防刷闸（方案 §7 补充层）。
 *
 * 身份闸的键是匿名 cookie —— 刷子清掉 cookie 就是「另一个人」。IP 是
 * 单实例部署下客户端唯一无法凭空重置的标识，所以这一层是防「盗刷
 * 服务器 key」的最后兜底。两个类都接受注入时钟：窗口滚动是真测出来的。
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

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('客户端 IP 解析', () => {
  it('X-Forwarded-For 取首跳（nginx 覆写前提下首跳才是客户端）', () => {
    expect(clientIpFromHeaders(headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7',
    );
  });

  it('XFF 只有单值时直接用', () => {
    expect(clientIpFromHeaders(headersOf({ 'x-forwarded-for': '198.51.100.23' }))).toBe('198.51.100.23');
  });

  it('没有 XFF 时退到 X-Real-IP', () => {
    expect(clientIpFromHeaders(headersOf({ 'x-real-ip': '192.0.2.44' }))).toBe('192.0.2.44');
  });

  it('XFF 首跳为空时继续退到 X-Real-IP', () => {
    expect(clientIpFromHeaders(headersOf({ 'x-forwarded-for': '  ', 'x-real-ip': '192.0.2.45' }))).toBe(
      '192.0.2.45',
    );
  });

  it('什么头都没有时进 unknown 共享桶（抹头 ≠ 拿到无限配额）', () => {
    expect(clientIpFromHeaders(headersOf({}))).toBe('unknown');
  });
});

describe('每 IP 滑动窗口限流', () => {
  it('窗口内允许到上限，超限拒绝并给出恢复时间', () => {
    const c = clock();
    const limiter = new IpWindowLimiter({ limit: 3, now: c.now });
    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(true);
    const denied = limiter.consume('ip1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('上限');
    expect(denied.retryAfterMs).not.toBeNull();
  });

  it('**被拒时不计数** —— 刷子的重试不会把恢复窗口越推越远', () => {
    const c = clock();
    const limiter = new IpWindowLimiter({ limit: 1, now: c.now });
    expect(limiter.consume('ip1').allowed).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      limiter.consume('ip1');
    }
    c.advance(60 * 60 * 1000 + 1);
    expect(limiter.consume('ip1').allowed).toBe(true);
  });

  it('窗口滑动：最早的一次滚出窗口后立刻恢复', () => {
    const c = clock();
    const limiter = new IpWindowLimiter({ limit: 2, windowMs: 1000, now: c.now });
    expect(limiter.consume('ip1').allowed).toBe(true);
    c.advance(400);
    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(false);
    c.advance(601); // 第一次已滚出 1000ms 窗口
    expect(limiter.consume('ip1').allowed).toBe(true);
  });

  it('不同 IP 各自计数；unknown 是所有无头请求共享的一个桶', () => {
    const limiter = new IpWindowLimiter({ limit: 1 });
    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip2').allowed).toBe(true);
    expect(limiter.consume('unknown').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(false);
    expect(limiter.consume('unknown').allowed).toBe(false);
  });

  it('peek 只看不用', () => {
    const limiter = new IpWindowLimiter({ limit: 1 });
    expect(limiter.peek('ip1').allowed).toBe(true);
    limiter.consume('ip1');
    expect(limiter.peek('ip1').allowed).toBe(false);
  });
});

describe('IP 闸门的环境变量', () => {
  it('默认：每 IP 每小时 10 局 / 30 次花钱调用', () => {
    expect(DEFAULT_USAGE_LIMITS.ipSessionsPerHour).toBe(10);
    expect(DEFAULT_USAGE_LIMITS.ipLlmCallsPerHour).toBe(30);
  });

  it('env 可配；配错（非正整数）回默认而不是把闸门关死', () => {
    const limits = usageLimitsFromEnv({
      [USAGE_LIMIT_ENV_KEYS.ipSessionsPerHour]: '40',
      [USAGE_LIMIT_ENV_KEYS.ipLlmCallsPerHour]: 'abc',
    });
    expect(limits.ipSessionsPerHour).toBe(40);
    expect(limits.ipLlmCallsPerHour).toBe(30);
  });
});
