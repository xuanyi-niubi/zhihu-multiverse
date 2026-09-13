import { describe, expect, it } from 'vitest';

import {
  memoryEntriesFromResult,
  observedClaimsOf,
  resultStatusLabel,
} from '@/features/reality-memory/service';
import {
  FileRealityMemoryRepository,
  InMemoryRealityMemoryRepository,
} from '@/features/reality-memory/store';

import type { ExperimentResult, RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * 现实记忆（P1-3）。
 *
 * 这一层最容易自欺的地方：把「用户随口一说」升级成「反复验证过的事实」，
 * 然后用他自己的猜测去推翻他自己的判断。测试重点全在这里。
 */

function result(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    status: 'completed',
    observations: ['第三天没有记录'],
    actualTime: '一周实际投入 3 小时',
    producedArtifact: '一个能跑的小样',
    hitSuccessSignal: true,
    hitStopSignal: false,
    whatChanged: '我原来以为自己每周能挤出 8 小时，实际只有 3 小时。',
    newUnknowns: ['早上还是晚上更容易投入'],
    ...overrides,
  };
}

function entry(overrides: Partial<RealityMemoryEntry> = {}): RealityMemoryEntry {
  return {
    id: 'rm:old:0',
    claim: '实际投入：一周实际投入 5 小时',
    source: 'experiment-observed',
    confidence: 'observed-once',
    sessionId: 's-old',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('只记实验真的产出的东西', () => {
  it('实际投入 / 产出 / 信号 / 用户自己的判断各成一条', () => {
    const { entries } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result(),
      createdAt: '2026-09-13T00:00:00.000Z',
    });

    const claims = entries.map((item) => item.claim);
    expect(claims).toContain('实际投入：一周实际投入 3 小时');
    expect(claims).toContain('实际产出：一个能跑的小样');
    expect(claims.some((claim) => claim.includes('成功信号'))).toBe(true);
    expect(claims.some((claim) => claim.includes('以为') && claim.includes('3 小时'))).toBe(true);
  });

  it('字段为空时不写占位条目（宁可不记，也不记一条空话）', () => {
    const { entries } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result({
        actualTime: undefined,
        producedArtifact: undefined,
        hitSuccessSignal: null,
        hitStopSignal: null,
        whatChanged: '',
      }),
      createdAt: '2026-09-13T00:00:00.000Z',
    });
    expect(entries).toHaveLength(0);
  });

  it('**不从结果里推断人格**（不出现「执行力」「风险偏好」这类句子）', () => {
    const { entries } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result({ actualTime: '0 小时' }),
      createdAt: '2026-09-13T00:00:00.000Z',
    });
    for (const item of entries) {
      expect(item.claim).not.toMatch(/执行力|自律|风险偏好|意志力|性格/);
    }
  });

  it('命中停止信号记成一条**正确执行**，不是失败', () => {
    const { entries } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result({ status: 'stopped', hitStopSignal: true, hitSuccessSignal: null }),
      createdAt: '2026-09-13T00:00:00.000Z',
    });
    expect(entries.some((item) => item.claim.includes('停下了'))).toBe(true);
    expect(entries.every((item) => !item.claim.includes('失败'))).toBe(true);
  });
});

describe('来源与置信度：一道不许越过的线', () => {
  it('实验观测 → observed-once；用户自述 → stated', () => {
    const { entries } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result(),
      createdAt: '2026-09-13T00:00:00.000Z',
    });
    const observed = entries.find((item) => item.claim.startsWith('实际投入'));
    const stated = entries.find((item) => item.source === 'user-stated');
    expect(observed).toMatchObject({ source: 'experiment-observed', confidence: 'observed-once' });
    expect(stated).toMatchObject({ source: 'user-stated', confidence: 'stated' });
  });

  it('同一件事**再次被观测到** → 升级为 observed-repeatedly（且只留一条）', () => {
    const existing: readonly RealityMemoryEntry[] = [
      entry({ claim: '实际投入：一周实际投入 3 小时', confidence: 'observed-once' }),
    ];
    const { entries, merged } = memoryEntriesFromResult({
      sessionId: 's2',
      result: result({ actualTime: '一周实际投入 3 小时' }),
      createdAt: '2026-09-20T00:00:00.000Z',
      existing,
    });

    const upgraded = entries.find((item) => item.claim === '实际投入：一周实际投入 3 小时');
    expect(upgraded?.confidence).toBe('observed-repeatedly');
    // 同一句话不会堆两条几乎相同的记忆
    expect(merged.filter((item) => item.claim === '实际投入：一周实际投入 3 小时')).toHaveLength(1);
  });

  it('用户自己重复说同一句话**不构成验证**，置信度仍是 stated', () => {
    const existing: readonly RealityMemoryEntry[] = [
      entry({ claim: '我觉得我能坚持下来', source: 'user-stated', confidence: 'stated' }),
    ];
    const { entries } = memoryEntriesFromResult({
      sessionId: 's2',
      result: result({ whatChanged: '我觉得我能坚持下来' }),
      createdAt: '2026-09-20T00:00:00.000Z',
      existing,
    });
    const repeated = entries.find((item) => item.claim === '我觉得我能坚持下来');
    expect(repeated?.confidence).toBe('stated');
  });

  it('自相矛盾的结果（命中停止信号却报 completed）整条拒绝', () => {
    const { entries, merged } = memoryEntriesFromResult({
      sessionId: 's1',
      result: result({ status: 'completed', hitStopSignal: true }),
      createdAt: '2026-09-13T00:00:00.000Z',
      existing: [entry()],
    });
    expect(entries).toHaveLength(0);
    expect(merged).toHaveLength(1);
  });
});

describe('回灌下一次会话的声明', () => {
  it('只取观测到的，且上限 4 条（自我估计不参与）', () => {
    const many: RealityMemoryEntry[] = Array.from({ length: 6 }, (_, index) =>
      entry({ id: `rm:${index}`, claim: `观测 ${index}` }),
    );
    const claims = observedClaimsOf(many);
    expect(claims).toHaveLength(4);
    // 取最近的四条
    expect(claims).toEqual(['观测 2', '观测 3', '观测 4', '观测 5']);
  });

  it('用户自述的条目不会被当成下一局的硬条件', () => {
    const claims = observedClaimsOf([
      entry({ id: 'a', claim: '我自己说的', source: 'user-stated', confidence: 'stated' }),
    ]);
    expect(claims).toHaveLength(0);
  });
});

describe('仓储：文件与内存两个实现口径一致', () => {
  it('内存实现可写入、可读回', async () => {
    const repo = new InMemoryRealityMemoryRepository();
    expect(await repo.listByOwner('anon:1')).toHaveLength(0);
    await repo.save('anon:1', [entry()]);
    expect(await repo.listByOwner('anon:1')).toHaveLength(1);
    // 身份之间隔离
    expect(await repo.listByOwner('anon:2')).toHaveLength(0);
  });

  it('文件实现：没有文件时返回空数组而不是抛错', async () => {
    const repo = new FileRealityMemoryRepository();
    expect(Array.isArray(await repo.listByOwner('anon:never-written'))).toBe(true);
  });
});

describe('状态文案', () => {
  it('「按停止信号停下」不写成失败', () => {
    expect(resultStatusLabel('stopped')).toContain('停下');
    expect(resultStatusLabel('stopped')).not.toContain('失败');
  });
});
