import { describe, expect, it } from 'vitest';

import {
  MAX_TURNS,
  MIN_TURNS,
  actPressureLabel,
  advanceRunAct,
  bandFor,
  clampTotalTurns,
  clampTurnIndex,
  createRunActState,
  crisisNow,
  runBudgetFor,
} from '@/core/run/actRun';

import { ACT_HARD_CAP } from '@/core/run/actEngine';

/**
 * 动态幕接线与幕数口径统一的契约测试（v2 §14 Phase 0）。
 *
 * 这一层要钉死两件事：
 * 1. **口径只有一处**：所有入口都用 `MAX_TURNS`，不再各有各的 4；
 * 2. **动态幕是真的**：预算耗尽即终局，且结果有界、可复现。
 */

describe('幕数口径', () => {
  it('MAX_TURNS 与 actEngine 的硬上限是同一个值', () => {
    expect(MAX_TURNS).toBe(ACT_HARD_CAP);
  });

  it('clampTurnIndex 钳进 1..MAX_TURNS，非法值退回 1', () => {
    expect(clampTurnIndex(0)).toBe(MIN_TURNS);
    expect(clampTurnIndex(3)).toBe(3);
    expect(clampTurnIndex(99)).toBe(MAX_TURNS);
    expect(clampTurnIndex('abc')).toBe(MIN_TURNS);
    expect(clampTurnIndex(null)).toBe(MIN_TURNS);
    expect(clampTurnIndex(2.6)).toBe(3);
  });

  it('clampTotalTurns 允许到上限，缺省给 fallback', () => {
    expect(clampTotalTurns(undefined, 4)).toBe(4);
    expect(clampTotalTurns(6)).toBe(6);
    expect(clampTotalTurns(6)).toBeLessThanOrEqual(MAX_TURNS);
  });

  it('上限确实大于 4：AI 动态关卡能报到第 5 幕以上', () => {
    expect(MAX_TURNS).toBeGreaterThan(4);
    expect(clampTurnIndex(6)).toBe(6);
  });
});

describe('runBudgetFor', () => {
  const healthy = { san: 80, skill: 60, bond: 50 };

  it('有界：幕数落在 1..MAX_TURNS 之间', () => {
    for (const originId of ['assassin', 'survivor', undefined]) {
      const budget = runBudgetFor({ originId, initialStats: healthy });
      expect(budget).toBeGreaterThanOrEqual(MIN_TURNS);
      expect(budget).toBeLessThanOrEqual(MAX_TURNS);
    }
  });

  it('确定性：同输入必得同一预算', () => {
    const input = { originId: 'survivor', initialStats: healthy };
    expect(runBudgetFor(input)).toBe(runBudgetFor(input));
  });

  it('属性见底时立刻收束（不硬撑到上限）', () => {
    const collapsed = runBudgetFor({ initialStats: { san: 0, skill: 60, bond: 50 } });
    expect(collapsed).toBe(MIN_TURNS);
  });

  it('出身影响余量：余量多的一局能推更多幕', () => {
    const generous = runBudgetFor({ originId: 'assassin', initialStats: healthy });
    const tight = runBudgetFor({ originId: 'survivor', initialStats: healthy });
    expect(generous).toBeGreaterThanOrEqual(tight);
  });

  it('预置剧本的长度（4 幕）在动态预算范围内是可达的', () => {
    // 预置剧本是人工精调的四幕，动态预算不能比它更短，否则会截断内容
    expect(runBudgetFor({ initialStats: healthy })).toBeGreaterThanOrEqual(4);
  });
});

describe('advanceRunAct / bandFor / crisisNow', () => {
  it('失败比成功消耗更多张力（可解释）', () => {
    const base = createRunActState('assassin');
    const success = advanceRunAct(base, { outcome: 'success' });
    const failure = advanceRunAct(base, { outcome: 'failure' });
    expect(failure.act.tensionBudget).toBeLessThan(success.act.tensionBudget);
  });

  it('高风险与心智暴扣额外消耗，并肩则省张力', () => {
    const base = createRunActState('assassin');
    const risky = advanceRunAct(base, { outcome: 'none', risky: true });
    const allied = advanceRunAct(base, { outcome: 'none', allied: true });
    const normal = advanceRunAct(base, { outcome: 'none' });
    expect(risky.act.tensionBudget).toBeLessThan(normal.act.tensionBudget);
    expect(allied.act.tensionBudget).toBeGreaterThan(normal.act.tensionBudget);
  });

  it('每推进一幕，幕号 +1', () => {
    const base = createRunActState();
    expect(advanceRunAct(base, { outcome: 'none' }).act.actIndex).toBe(base.act.actIndex + 1);
  });

  it('难度带由状态决定，且有界（11..20 附近）', () => {
    const fresh = createRunActState();
    const strained = advanceRunAct(
      { act: { actIndex: 5, tensionBudget: 8, turnsSinceLastCrisis: 2 }, lastEvent: null },
      { outcome: 'failure' },
    );
    const easy = bandFor(fresh, { san: 90, skill: 90, bond: 90 }, 0);
    const hard = bandFor(strained, { san: 20, skill: 20, bond: 20 }, 3);
    expect(easy.center).toBeLessThan(hard.center);
    expect(hard.center).toBeLessThanOrEqual(20);
    expect(hard.reasons.length).toBeGreaterThan(0);
  });

  it('危机幕由「连续三幕无危机」触发，而不是固定第 N 幕', () => {
    expect(crisisNow({ act: { actIndex: 1, tensionBudget: 80, turnsSinceLastCrisis: 0 }, lastEvent: null })).toBe(false);
    expect(crisisNow({ act: { actIndex: 4, tensionBudget: 40, turnsSinceLastCrisis: 3 }, lastEvent: null })).toBe(true);
  });

  it('余量提示是定性的，不含数字', () => {
    const text = actPressureLabel(createRunActState());
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\d/);
  });
});
