import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendRun, clearAccountMemory, toArchiveRuns, readAccountMemory } from '@/core/memoryStore';
import { addCommitment, dueSummary, ledgerFrom, normalizeCommitment, readAccountCommitments } from '@/core/decision/commitmentStore';

import type { RunRecord } from '@/core/memoryStore';

/**
 * 命运档案馆的数据契约（v3 §15 / §23 P2-6）。
 *
 * 这个页面存在的唯一理由是让玩家理解「我的过去会影响我的未来」，
 * 因此测试要钉住两件事：
 * 1. 时间线**按时间降序**（档案馆是回看，不是按时间读小说）；
 * 2. 推演记录与承诺回执的**身份口径差异被如实保留**
 *    （记忆只认账号、回执匿名也有）—— 界面据此解释，不能假装一致。
 */

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    goal: '一次没有名字的推演',
    originId: 'assassin',
    lastAct: 3,
    status: 'OVER_SAN_DEPLETED',
    causeOfDeath: '在关键的一幕没能顶住',
    finalWords: '',
    personalityTags: [],
    finishedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('toArchiveRuns', () => {
  it('空档案返回空数组（界面据此显示空态，而不是崩）', () => {
    const result = toArchiveRuns({ version: 1, totalRuns: 0, lastRun: null, history: [], updatedAt: '' });
    expect(result.totalRuns).toBe(0);
    expect(result.runs).toHaveLength(0);
  });

  it('**按时间降序**（最新的在最前）', () => {
    const result = toArchiveRuns({
      version: 1,
      totalRuns: 3,
      lastRun: null,
      history: [
        run({ goal: '最早', finishedAt: '2026-09-01T00:00:00.000Z' }),
        run({ goal: '最新', finishedAt: '2026-09-10T00:00:00.000Z' }),
        run({ goal: '中间', finishedAt: '2026-09-05T00:00:00.000Z' }),
      ],
      updatedAt: '',
    });

    expect(result.runs.map((item) => item.goal)).toEqual(['最新', '中间', '最早']);
  });

  it('不改动入参数组（纯函数）', () => {
    const history = [
      run({ goal: 'A', finishedAt: '2026-09-01T00:00:00.000Z' }),
      run({ goal: 'B', finishedAt: '2026-09-10T00:00:00.000Z' }),
    ];
    const snapshot = history.map((item) => item.goal);
    toArchiveRuns({ version: 1, totalRuns: 2, lastRun: null, history, updatedAt: '' });
    expect(history.map((item) => item.goal)).toEqual(snapshot);
  });

  it('totalRuns 如实透传（含未登录时期的局数，不重算）', () => {
    const result = toArchiveRuns({
      version: 1,
      totalRuns: 42,
      lastRun: null,
      history: [run()],
      updatedAt: '',
    });
    expect(result.totalRuns).toBe(42);
    expect(result.runs).toHaveLength(1);
  });
});

describe('身份口径差异（必须被如实保留）', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zhihu-archive-'));
    process.env.MEMORY_DIR = dir;
    process.env.COMMITMENT_DIR = join(dir, 'commitments');
  });

  afterEach(() => {
    delete process.env.MEMORY_DIR;
    delete process.env.COMMITMENT_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('未登录（无账号）读不到推演记录 —— 那是账号承诺，不是「你还没玩过」', () => {
    // 别人账号下有一局记录
    appendRun('token-alice', run({ goal: 'alice 的局' }));

    // 未登录没有 key → 空档案（界面必须说「记录需要登录」，而不是「你还没玩过」）
    expect(readAccountMemory('anon:nobody').totalRuns).toBe(0);
    expect(readAccountMemory('token-alice').totalRuns).toBe(1);
  });

  it('承诺回执**匿名身份也能落盘**（与记忆的口径刻意不同）', () => {
    const commitment = normalizeCommitment(
      {
        runId: 'run-anon',
        action: '补一个能讲清的项目',
        timeBox: '本周内',
        signal: '能三分钟讲清',
        verifyHint: '写 300 字复盘',
      },
      'anon:deadbeef',
    );
    expect(commitment).not.toBeNull();
    if (!commitment) return;

    addCommitment('anon:deadbeef', commitment);

    // 记忆是空的，但回执在 —— 这正是「两个系统身份口径不同」的体现
    expect(readAccountMemory('anon:deadbeef').totalRuns).toBe(0);
    expect(readAccountCommitments('anon:deadbeef').commitments).toHaveLength(1);
  });

  it('清空账号记忆是能力内的（档案馆不该留幽灵数据）', () => {
    appendRun('token-alice', run({ goal: '要删掉的局' }));
    expect(readAccountMemory('token-alice').totalRuns).toBe(1);
    expect(clearAccountMemory('token-alice')).toBe(true);
    expect(readAccountMemory('token-alice').totalRuns).toBe(0);
  });
});

describe('档案页的两个数字', () => {
  it('dueSummary 与 ledger 对空承诺给出稳定的零值', () => {
    const summary = dueSummary([], Date.parse('2026-09-13T00:00:00.000Z'));
    expect(summary.due).toHaveLength(0);
    expect(summary.upcoming).toHaveLength(0);
    expect(summary.overdueDays).toBe(0);

    const ledger = ledgerFrom([]);
    expect(ledger.resolvedCommitments).toHaveLength(0);
    expect(ledger.openThreads).toHaveLength(0);
  });
});

describe('模块导出完整性', () => {
  it('memoryStore 暴露了档案馆需要的出口', () => {
    expect(typeof toArchiveRuns).toBe('function');
    expect(typeof readAccountMemory).toBe('function');
    expect(typeof appendRun).toBe('function');
    expect(typeof clearAccountMemory).toBe('function');
  });
});
