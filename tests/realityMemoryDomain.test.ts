import { describe, expect, it } from 'vitest';

import { checkExperimentResult, checkRealityMemory } from '@/features/experience/invariants';

import type { RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * Reality Memory 领域契约（Phase 1）。
 *
 * 守的是一个很容易自我欺骗的地方：**把「用户随口一说」升级成
 * 「反复验证过的事实」**。一旦允许，系统就会用用户自己的猜测
 * 去推翻用户自己的判断，而且还显得很有依据。
 */

function entry(overrides: Partial<RealityMemoryEntry> = {}): RealityMemoryEntry {
  return {
    id: 'm1',
    claim: '每周大概能挤出 8 小时',
    source: 'user-stated',
    confidence: 'stated',
    sessionId: 's-1',
    createdAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('现实记忆的置信度规则', () => {
  it('用户自述只能是 stated', () => {
    expect(checkRealityMemory(entry())).toBeNull();
  });

  it('**用户自述不得被标成「观测到一次 / 反复观测到」**', () => {
    expect(checkRealityMemory(entry({ confidence: 'observed-once' }))).toContain('只能是 stated');
    expect(checkRealityMemory(entry({ confidence: 'observed-repeatedly' }))).toContain('只能是 stated');
  });

  it('实验观测可以升级置信度', () => {
    expect(
      checkRealityMemory(entry({ source: 'experiment-observed', confidence: 'observed-once' })),
    ).toBeNull();
    expect(
      checkRealityMemory(entry({ source: 'experiment-observed', confidence: 'observed-repeatedly' })),
    ).toBeNull();
  });

  it('实验观测不得退化成 stated（否则白测了）', () => {
    expect(
      checkRealityMemory(entry({ source: 'experiment-observed', confidence: 'stated' })),
    ).toContain('不该退化成 stated');
  });

  it('空内容被拒', () => {
    expect(checkRealityMemory(entry({ claim: '  ' }))).toBeTruthy();
  });
});

describe('实验结果的状态自洽', () => {
  it('命中停止信号却报 completed 是矛盾的', () => {
    expect(checkExperimentResult({ status: 'completed', hitStopSignal: true })).toContain('stopped');
  });

  it('按停止信号停下报 stopped 是正确的', () => {
    expect(checkExperimentResult({ status: 'stopped', hitStopSignal: true })).toBeNull();
  });

  it('没碰到停止信号 → 各种状态都允许', () => {
    for (const status of ['completed', 'partial', 'abandoned'] as const) {
      expect(checkExperimentResult({ status, hitStopSignal: false })).toBeNull();
    }
  });

  it('没说有没有碰到信号（null）时不推断', () => {
    expect(checkExperimentResult({ status: 'completed', hitStopSignal: null })).toBeNull();
  });
});
