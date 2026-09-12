import { describe, expect, it } from 'vitest';

import { judgeMesh, verdictFor, criticalPointFor, verdictHeadline } from '@/core/decision/verdict';
import { DEFAULT_CONSTRAINTS, normalizeConstraints, AXES } from '@/core/decision/axis';

import type { ConstraintProfile, DecisionPath, PathCard } from '@/types/evidence';

/**
 * 机制裁决的契约测试（方案 §6）。
 *
 * 三条不变量必须被钉死，因为这层决定「玩家为什么会输」：
 * - I-A 纯函数（同输入同输出）
 * - I-B 失败必须具体（给出轴与超出量）
 * - I-C 无据不裁决（thin 证据 → unknown，绝不猜）
 */

function card(overrides: Partial<PathCard> = {}): PathCard {
  return {
    cardId: 'card-test',
    sourceId: 'src-test',
    author: '测试答主',
    authorUrlToken: null,
    sourceUrl: 'https://www.zhihu.com/answer/1',
    retrievedAt: '2025-01-01T00:00:00.000Z',
    authority: 'high',
    authorityRank: 3,
    upvotes: 100,
    title: '测试标题',
    quote: '测试引用内容足够长以通过校验',
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

const generous: ConstraintProfile = { runwayMonths: 24, drawdown: 100, ally: 100 };
const tight: ConstraintProfile = { runwayMonths: 3, drawdown: 20, ally: 0 };

describe('verdictFor', () => {
  it('I-A：同输入必得同输出（纯函数）', () => {
    const input = { path: path(), constraints: generous };
    const first = JSON.stringify(verdictFor(input));
    for (let i = 0; i < 20; i += 1) {
      expect(JSON.stringify(verdictFor(input))).toBe(first);
    }
  });

  it('硬轴越线时给出 breached 与具体超出量', () => {
    // 路线要求 runway ≥ 12（时间成本上沿），玩家只有 3
    const result = verdictFor({ path: path(), constraints: tight });
    expect(result.kind).toBe('breached');
    if (result.kind !== 'breached') return;
    expect(result.breachedAxis).toBe('runway');
    expect(result.overBy).toBe(9);
    expect(result.shortfallLabel).toContain('个月');
  });

  it('硬轴全部通过时给出 viable，并指出最紧的那条轴', () => {
    const result = verdictFor({ path: path(), constraints: generous });
    expect(result.kind).toBe('viable');
    if (result.kind !== 'viable') return;
    expect(result.bindingAxis).toBe('runway');
    expect(result.margin).toBe(12);
  });

  it('I-C：thin 证据路线返回 unknown，不得裁决', () => {
    const thin = path({ grade: 'thin', evidenceStrength: 0.1, sampleSize: 1 });
    const result = verdictFor({ path: thin, constraints: generous });
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') return;
    expect(result.reason).toContain('1 条');
  });

  it('I-C：证据强度低于阈值同样返回 unknown', () => {
    const weak = path({ grade: 'partial', evidenceStrength: 0.15 });
    expect(verdictFor({ path: weak, constraints: generous }).kind).toBe('unknown');
  });

  it('没有硬轴需求的路线一律可行', () => {
    const noCaps = path({
      costProfile: { timeCostMonths: null, moneyCost: 'unknown', irreversible: null, requiresAlly: null },
    });
    const result = verdictFor({ path: noCaps, constraints: tight });
    expect(result.kind).toBe('viable');
    if (result.kind !== 'viable') return;
    expect(result.bindingAxis).toBeNull();
  });

  it('缺项不被当成 0：moneyCost=unknown 不产生 drawdown 需求', () => {
    const onlyTime = path({
      costProfile: { timeCostMonths: { min: 2, max: 4 }, moneyCost: 'unknown', irreversible: null, requiresAlly: null },
    });
    // drawdown 只有 1，但因为没有资金需求，所以不该越线
    const result = verdictFor({ path: onlyTime, constraints: { runwayMonths: 12, drawdown: 1, ally: 0 } });
    expect(result.kind).toBe('viable');
  });

  it('软轴（退路/并肩）不判死，只降低余量判定', () => {
    const softOnly = path({
      costProfile: { timeCostMonths: { min: 1, max: 2 }, moneyCost: 'unknown', irreversible: true, requiresAlly: true },
    });
    const result = verdictFor({ path: softOnly, constraints: { runwayMonths: 12, drawdown: 10, ally: 0 } });
    expect(result.kind).toBe('viable');
  });

  it('verdictHeadline 不含恐吓措辞，且总是带路线名', () => {
    const breached = verdictFor({ path: path(), constraints: tight });
    const text = verdictHeadline(breached, '脱产转型');
    expect(text).toContain('脱产转型');
    expect(text).not.toContain('失败');
  });
});

describe('criticalPointFor', () => {
  it('越线时指出需要拨动的那一条轴与差额', () => {
    const point = criticalPointFor({ path: path(), constraints: tight });
    expect(point).not.toBeNull();
    if (!point) return;
    expect(point.axis).toBe('runway');
    expect(point.current).toBe(3);
    expect(point.required).toBe(12);
    expect(point.delta).toBe(9);
    expect(point.narrative).toContain('唯一的硬伤');
  });

  it('证据不足时不给临界点（没有可干预的对象）', () => {
    const thin = path({ grade: 'thin', evidenceStrength: 0.05, sampleSize: 0 });
    expect(criticalPointFor({ path: thin, constraints: tight })).toBeNull();
  });

  it('可行且余量充裕时不给临界点（不制造焦虑）', () => {
    expect(criticalPointFor({ path: path(), constraints: generous })).toBeNull();
  });

  it('可行但卡得很紧时给出提醒型临界点', () => {
    // runway 需求 12，给 13 → 余量 1，低于轴区间 15% 的阈值
    const point = criticalPointFor({ path: path(), constraints: { runwayMonths: 13, drawdown: 100, ally: 100 } });
    expect(point).not.toBeNull();
    if (!point) return;
    expect(point.verdict.kind).toBe('viable');
    expect(point.narrative).toContain('垫厚');
  });
});

describe('judgeMesh', () => {
  it('优先挑「越线里缺口最小」的那一条作为最该干预的点', () => {
    const easy = path({
      pathId: 'path-a',
      label: 'A 路线',
      costProfile: { timeCostMonths: { min: 4, max: 4 }, moneyCost: 'unknown', irreversible: null, requiresAlly: null },
    });
    const hard = path({
      pathId: 'path-b',
      label: 'B 路线',
      costProfile: { timeCostMonths: { min: 20, max: 20 }, moneyCost: 'unknown', irreversible: null, requiresAlly: null },
    });

    const judged = judgeMesh({ paths: [hard, easy], constraints: { runwayMonths: 3, drawdown: 50, ally: 50 } });
    expect(judged.verdicts).toHaveLength(2);
    expect(judged.critical?.pathId).toBe('path-a');
    expect(judged.critical?.delta).toBe(1);
  });

  it('没有任何越线时退回「勉强可行」的提醒', () => {
    const tightPath = path({
      costProfile: { timeCostMonths: { min: 11, max: 12 }, moneyCost: 'unknown', irreversible: null, requiresAlly: null },
    });
    const judged = judgeMesh({ paths: [tightPath], constraints: { runwayMonths: 13, drawdown: 50, ally: 50 } });
    expect(judged.critical?.verdict.kind).toBe('viable');
  });

  it('全是 thin 证据时不给任何临界点', () => {
    const thin = path({ grade: 'thin', evidenceStrength: 0.05, sampleSize: 0 });
    const judged = judgeMesh({ paths: [thin], constraints: tight });
    expect(judged.critical).toBeNull();
    expect(judged.verdicts[0].verdict.kind).toBe('unknown');
  });
});

describe('normalizeConstraints', () => {
  it('缺字段补默认值，不抛异常', () => {
    expect(normalizeConstraints(null)).toEqual(DEFAULT_CONSTRAINTS);
    expect(normalizeConstraints({})).toEqual(DEFAULT_CONSTRAINTS);
  });

  it('越界值钳进轴区间，NaN 退回下限', () => {
    const result = normalizeConstraints({ runwayMonths: 999, drawdown: -50, ally: NaN });
    expect(result.runwayMonths).toBe(24);
    expect(result.drawdown).toBe(0);
    expect(result.ally).toBe(0);
  });

  it('四条轴都有 hint，且区间合法', () => {
    for (const axis of AXES) {
      expect(axis.hint.length).toBeGreaterThan(0);
      expect(axis.max).toBeGreaterThan(axis.min);
    }
  });
});
