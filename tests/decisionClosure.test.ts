import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clarityOf, clarityVerdict } from '@/core/decision/clarity';
import {
  addCommitment,
  attachReceipt,
  constraintHintFrom,
  dueAtFrom,
  dueSummary,
  ledgerFrom,
  normalizeCommitment,
  readAccountCommitments,
  removeCommitment,
} from '@/core/decision/commitmentStore';
import { buildSandwich, deriveConstraints, sensitivityOf, DEFAULT_GAP, TIGHT_GAP } from '@/core/decision/sandwich';

import type { ConstraintProfile, DecisionPath, PathCard } from '@/types/evidence';

/**
 * 决策层剩余契约：双牌对比（§7.1）、四维结算（§9）、承诺回执（§7.2）。
 */

const NOW = Date.parse('2026-09-12T00:00:00.000Z');

function card(overrides: Partial<PathCard> = {}): PathCard {
  return {
    cardId: 'card-1',
    sourceId: 'src-1',
    author: '答主甲',
    authorUrlToken: null,
    sourceUrl: 'https://www.zhihu.com/answer/1',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    authority: 'high',
    authorityRank: 3,
    upvotes: 300,
    title: '在职备考两年上岸',
    quote: '我是在职备考两年上岸的，代价是两年没有周末。',
    shape: { from: '二本法学', move: '在职备考', duration: '两年', cost: [], outcome: '上岸' },
    status: 'verified',
    ...overrides,
  };
}

function path(overrides: Partial<DecisionPath> = {}): DecisionPath {
  return {
    pathId: 'path-full-time-pivot',
    label: '脱产转型',
    summary: '停下手里的事全力投入',
    cards: [card()],
    sampleSize: 3,
    grade: 'strong',
    evidenceStrength: 0.75,
    costProfile: {
      timeCostMonths: { min: 10, max: 12 },
      moneyCost: 'high',
      irreversible: true,
      requiresAlly: true,
    },
    ...overrides,
  };
}

describe('deriveConstraints / buildSandwich', () => {
  const base: ConstraintProfile = { runwayMonths: 6, drawdown: 50, ally: 40 };

  it('两组约束被钳进轴区间，不会造出不可能存在的处境', () => {
    const generous = deriveConstraints(base, DEFAULT_GAP);
    const tight = deriveConstraints(base, TIGHT_GAP);
    expect(generous.runwayMonths).toBe(12);
    expect(generous.drawdown).toBe(70);
    expect(generous.ally).toBe(100);
    expect(tight.runwayMonths).toBe(3);
    expect(tight.drawdown).toBe(30);
    expect(tight.ally).toBe(0);
  });

  it('极端倍数不会越出轴区间', () => {
    const extreme = deriveConstraints({ runwayMonths: 24, drawdown: 100, ally: 100 }, { ...DEFAULT_GAP, runwayFactor: 99, drawdownFactor: 99 });
    expect(extreme.runwayMonths).toBe(24);
    expect(extreme.drawdown).toBe(100);
  });

  it('同一份网格 × 两组约束 → 找出结论翻转的路线', () => {
    // 夹具刻意做成「唯一变量是 runway」：两条路线的资金（中等=55）、退路、
    // 并肩需求完全相同，只有时间成本不同。这样翻转只能归因于「可投入月数」，
    // 正是演示时最该指给评委看的那一类结论。
    const sharedProfile = {
      moneyCost: 'medium' as const,
      irreversible: true,
      requiresAlly: true,
    };
    const demand12 = path({ costProfile: { ...sharedProfile, timeCostMonths: { min: 10, max: 12 } } });
    const demand3 = path({
      pathId: 'path-part-time-pivot',
      label: '在职转型',
      costProfile: { ...sharedProfile, timeCostMonths: { min: 2, max: 3 } },
    });

    // base.runway 6 → 充足牌 12 个月、紧张牌 3 个月
    const sandwich = buildSandwich({
      meshId: 'mesh-test',
      paths: [demand12, demand3],
      constraints: { runwayMonths: 6, drawdown: 100, ally: 100 },
    });

    expect(sandwich.cardA.label).toBe('余量充足');
    expect(sandwich.cardB.label).toBe('余量紧张');
    // 充足牌：两条都能走
    expect(sandwich.cardA.viableCount).toBe(2);
    // 紧张牌：只有「在职转型」还能走（脱产缺 9 个月）
    expect(sandwich.cardB.viableCount).toBe(1);
    expect(sandwich.divergentPathIds).toContain('path-full-time-pivot');
    expect(sandwich.divergentPathIds).not.toContain('path-part-time-pivot');
  });

  it('两张牌都用同一份证据（唯一变量是约束）', () => {
    const sandwich = buildSandwich({
      meshId: 'm',
      paths: [path()],
      constraints: { runwayMonths: 6, drawdown: 100, ally: 100 },
    });
    const idsA = sandwich.cardA.verdicts.map((item) => item.pathId);
    const idsB = sandwich.cardB.verdicts.map((item) => item.pathId);
    expect(idsA).toEqual(idsB);
  });

  it('sensitivityOf 报告翻转与临界点', () => {
    // 显式约束：A 给足余量、B 把资金压到不够 —— 翻转必须来自 drawdown
    const result = sensitivityOf({
      path: path({ costProfile: { timeCostMonths: { min: 1, max: 2 }, moneyCost: 'high', irreversible: null, requiresAlly: null } }),
      constraints: { runwayMonths: 12, drawdown: 100, ally: 100 },
      gapB: { label: '资金归零', runwayFactor: 2, drawdownFactor: 0.2, allyValue: 0 },
    });
    expect(result.underA.kind).toBe('viable');
    expect(result.underB.kind).toBe('breached');
    expect(result.flips).toBe(true);
    expect(result.critical).not.toBeNull();
  });
});

describe('clarityOf', () => {
  const generous: ConstraintProfile = { runwayMonths: 14, drawdown: 90, ally: 90 };

  it('四维都是 0..100，总分是四者之和', () => {
    const score = clarityOf({ paths: [path()], constraints: generous, estimate: { runwayMonths: 10 } });
    for (const value of [score.clarity, score.evidenceCoverage, score.costAwareness, score.reversibility]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(score.total).toBe(score.clarity + score.evidenceCoverage + score.costAwareness + score.reversibility);
  });

  it('确定性：同输入同输出', () => {
    const input = { paths: [path()], constraints: generous, estimate: { runwayMonths: 12 } };
    expect(JSON.stringify(clarityOf(input))).toBe(JSON.stringify(clarityOf(input)));
  });

  it('看过临界点所在路线时清晰度更高', () => {
    const blind = clarityOf({ paths: [path()], constraints: { runwayMonths: 6, drawdown: 40, ally: 20 }, estimate: { runwayMonths: 6 } });
    const aware = clarityOf({
      paths: [path()],
      constraints: { runwayMonths: 6, drawdown: 40, ally: 20 },
      estimate: { runwayMonths: 6 },
      exploredPathIds: ['path-full-time-pivot'],
    });
    expect(aware.clarity).toBeGreaterThan(blind.clarity);
  });

  it('低估时间需求比高估扣分更重（不对称是刻意的）', () => {
    const underestimate = clarityOf({ paths: [path()], constraints: generous, estimate: { runwayMonths: 4 } });
    const overestimate = clarityOf({ paths: [path()], constraints: generous, estimate: { runwayMonths: 20 } });
    expect(underestimate.costAwareness).toBeLessThan(overestimate.costAwareness);
  });

  it('没有自评时不奖不罚（中性 50）', () => {
    const noEstimate = clarityOf({ paths: [path()], constraints: generous, estimate: null });
    expect(noEstimate.costAwareness).toBe(50);
  });

  it('没有样本时证据覆盖为 0，而不是给个好看的分', () => {
    const empty = path({ sampleSize: 0, grade: 'thin', evidenceStrength: 0, cards: [] });
    expect(clarityOf({ paths: [empty], constraints: generous }).evidenceCoverage).toBe(0);
  });

  it('结语给出最该补的那一项，且不出现裸分数', () => {
    const score = clarityOf({ paths: [path()], constraints: generous, estimate: { runwayMonths: 2 } });
    const text = clarityVerdict(score);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toMatch(/\d/);
  });
});

describe('commitmentStore', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zhihu-commit-'));
    process.env.COMMITMENT_DIR = dir;
  });

  afterEach(() => {
    delete process.env.COMMITMENT_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const valid = {
    runId: 'run-1',
    action: '把那个项目补完并写成三段说明',
    timeBox: '本周内',
    signal: '能在三分钟内讲清问题、做法与结果',
    verifyHint: '写完一篇 300 字的复盘',
    pathId: 'path-part-time-pivot',
  };

  it('未登录不落盘：账号之间互不可见', () => {
    const a = normalizeCommitment(valid, 'user-a');
    expect(a).not.toBeNull();
    if (!a) return;
    addCommitment('user-a', a);
    expect(readAccountCommitments('user-a').commitments).toHaveLength(1);
    expect(readAccountCommitments('user-b').commitments).toHaveLength(0);
  });

  it('非法承诺被整条拒绝（缺动作或缺可验证信号）', () => {
    expect(normalizeCommitment({ ...valid, action: '' }, 'u')).toBeNull();
    expect(normalizeCommitment({ ...valid, signal: '' }, 'u')).toBeNull();
    expect(normalizeCommitment(null, 'u')).toBeNull();
  });

  it('认下即写盘，且 ok 与 persisted 语义分离', () => {
    const record = normalizeCommitment(valid, 'user-a');
    expect(record).not.toBeNull();
    if (!record) return;
    const result = addCommitment('user-a', record);
    expect(result.persisted).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('回执是幂等的：重复提交同一条结果一致', () => {
    const record = normalizeCommitment(valid, 'user-a');
    if (!record) throw new Error('setup failed');
    addCommitment('user-a', record);

    const receipt = { reportedAt: '2026-09-19T00:00:00.000Z', outcome: 'partial' as const, note: '写了一半', blocker: '下班没有整块时间' };
    attachReceipt('user-a', record.commitmentId, receipt);
    const first = readAccountCommitments('user-a').commitments[0];
    attachReceipt('user-a', record.commitmentId, receipt);
    const second = readAccountCommitments('user-a').commitments[0];

    expect(second.status).toBe('partial');
    expect(second.receipt?.blocker).toBe('下班没有整块时间');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('对不存在的承诺提交回执 → 返回 null，不伪造', () => {
    const result = attachReceipt('user-a', 'cm-not-exist', {
      reportedAt: new Date().toISOString(),
      outcome: 'done',
      note: '',
      blocker: null,
    });
    expect(result.commitment).toBeNull();
    expect(result.result).toBeNull();
  });

  it('删除是真删：删掉最后一条后文件被移除，读回空档案', () => {
    const record = normalizeCommitment(valid, 'user-a');
    if (!record) throw new Error('setup failed');
    addCommitment('user-a', record);

    const result = removeCommitment('user-a', record.commitmentId);
    expect(result.reason).toBe('removed-and-unlinked');
    expect(readAccountCommitments('user-a').commitments).toHaveLength(0);
  });

  it('到期判定：七天后才算 due，逾期天数可计算', () => {
    const committedAt = '2026-09-01T00:00:00.000Z';
    const record = normalizeCommitment({ ...valid, committedAt, dueAt: dueAtFrom(committedAt) }, 'user-a');
    if (!record) throw new Error('setup failed');
    addCommitment('user-a', record);

    const before = dueSummary(readAccountCommitments('user-a').commitments, Date.parse('2026-09-05T00:00:00.000Z'));
    expect(before.due).toHaveLength(0);
    expect(before.upcoming).toHaveLength(1);

    const after = dueSummary(readAccountCommitments('user-a').commitments, Date.parse('2026-09-12T00:00:00.000Z'));
    expect(after.due).toHaveLength(1);
    expect(after.overdueDays).toBe(4);
  });

  it('认知账本只把「有真回执」的记成事实，其余保持 unknown', () => {
    const resolved = normalizeCommitment(valid, 'user-a');
    if (!resolved) throw new Error('setup failed');
    const pending = normalizeCommitment({ ...valid, runId: 'run-2', action: '另一件事' }, 'user-a');
    if (!pending) throw new Error('setup failed');

    const finished = { ...resolved, status: 'done' as const, receipt: { reportedAt: '2026-09-19T00:00:00.000Z', outcome: 'done' as const, note: '', blocker: null } };
    const ledger = ledgerFrom([finished, pending]);

    expect(ledger.resolvedCommitments).toHaveLength(1);
    expect(ledger.beliefs[0].actualOutcome).toBe('viable');
    // 未回收的那条只进 openThreads，不进 beliefs
    expect(ledger.beliefs).toHaveLength(1);
    expect(ledger.openThreads.length).toBeGreaterThan(0);
  });

  it('下一局建议只在有真回执时给出，没回执就闭嘴', () => {
    expect(constraintHintFrom(ledgerFrom([]))).toBeNull();

    const blocked = ledgerFrom([
      {
        ...(normalizeCommitment(valid, 'u') as NonNullable<ReturnType<typeof normalizeCommitment>>),
        status: 'partial',
        receipt: { reportedAt: '2026-09-19T00:00:00.000Z', outcome: 'partial', note: '', blocker: '下班没有整块时间' },
      },
    ]);
    const hint = constraintHintFrom(blocked);
    expect(hint).toContain('下班没有整块时间');
    expect(hint).toContain('可投入月数');
  });

  it('字段长度被钳制，客户端无法塞进超长内容', () => {
    const record = normalizeCommitment({ ...valid, action: 'x'.repeat(500), signal: 'y'.repeat(500) }, 'u');
    expect(record?.action.length).toBeLessThanOrEqual(80);
    expect(record?.signal.length).toBeLessThanOrEqual(80);
  });
});
