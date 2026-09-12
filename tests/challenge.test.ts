import { describe, expect, it } from 'vitest';

import { buildChallengeUrl, buildPlayUrlFromChallenge } from '@/core/challenge';

/**
 * 挑战链接的确定性契约。
 *
 * 这一组用例锁的是 P0 修掉的一个真实缺陷：链接里**必须带 scenario**，
 * 否则被挑战者会静默回落到默认剧本 —— 表面在比同一局，实际是两场推演。
 */

describe('buildChallengeUrl', () => {
  const base = 'https://example.com/play?scenario=ai-dm&seed=SEED-2026-ABC&origin=assassin&goal=%E5%A4%A7%E4%B8%89%E6%B3%95%E5%AD%A6';

  it('带上 seed / acts / result', () => {
    const url = new URL(buildChallengeUrl({ currentHref: base, seed: 'SEED-1', survivedTurns: 3, success: true }));

    expect(url.pathname).toBe('/challenge');
    expect(url.searchParams.get('seed')).toBe('SEED-1');
    expect(url.searchParams.get('acts')).toBe('3');
    expect(url.searchParams.get('result')).toBe('success');
  });

  it('**必须**把 scenario 带进链接（这是修复的核心）', () => {
    const url = new URL(buildChallengeUrl({ currentHref: base, seed: 'SEED-1', survivedTurns: 3, success: false }));

    expect(url.searchParams.get('scenario')).toBe('ai-dm');
  });

  it('显式传入的 scenarioId 优先于地址栏里的', () => {
    const url = new URL(
      buildChallengeUrl({ currentHref: base, seed: 'SEED-1', survivedTurns: 1, success: false, scenarioId: 'ai-dm-v2' }),
    );

    expect(url.searchParams.get('scenario')).toBe('ai-dm-v2');
  });

  it('目标与出身一并带上，让挑战卡能显示「他挑战的是什么」', () => {
    const url = new URL(buildChallengeUrl({ currentHref: base, seed: 'SEED-1', survivedTurns: 2, success: true }));

    expect(url.searchParams.get('origin')).toBe('assassin');
    expect(url.searchParams.get('goal')).toBe('大三法学');
  });

  it('没有 scenario 时不硬塞空参数', () => {
    const url = new URL(
      buildChallengeUrl({ currentHref: 'https://example.com/play', seed: 'SEED-1', survivedTurns: 1, success: false }),
    );

    expect(url.searchParams.has('scenario')).toBe(false);
  });

  it('服务端渲染（无 href）时返回空串，不抛异常', () => {
    expect(buildChallengeUrl({ currentHref: '', seed: 'S', survivedTurns: 1, success: true })).toBe('');
  });
});

describe('buildPlayUrlFromChallenge', () => {
  it('把 scenario 透传给推演舱', () => {
    const href = buildPlayUrlFromChallenge({ seed: 'SEED-9', originId: 'assassin', scenarioId: 'ai-dm' });
    const url = new URL(href, 'https://example.com');

    expect(url.pathname).toBe('/play');
    expect(url.searchParams.get('seed')).toBe('SEED-9');
    expect(url.searchParams.get('origin')).toBe('assassin');
    expect(url.searchParams.get('scenario')).toBe('ai-dm');
  });

  it('带目标，且不含空参数', () => {
    const withGoal = new URL(
      buildPlayUrlFromChallenge({ seed: 'S', originId: 'assassin', goal: '转码', scenarioId: null }),
      'https://example.com',
    );

    expect(withGoal.searchParams.get('goal')).toBe('转码');
    expect(withGoal.searchParams.has('scenario')).toBe(false);
  });

  it('空白 goal / scenario 视为未提供', () => {
    const href = buildPlayUrlFromChallenge({ seed: 'S', originId: 'assassin', goal: '   ', scenarioId: '  ' });
    const url = new URL(href, 'https://example.com');

    expect(url.searchParams.has('goal')).toBe(false);
    expect(url.searchParams.has('scenario')).toBe(false);
  });
});
