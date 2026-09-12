import { describe, expect, it } from 'vitest';

import {
  ACT_HARD_CAP,
  TENSION_MAX,
  actSummary,
  consumeTension,
  createActState,
  crisisDue,
  shouldEndRun,
  tensionBand,
} from '@/core/run/actEngine';

/**
 * 动态幕系统（最终版 §5，P0 第一刀）的验收。
 *
 * 要解决的原话是：「回合数硬编码为 4，难度带按 turnIndex 而非玩家状态决定」。
 * 所以这里必须证明三件事：
 * ① 同一起点、不同选择 → 幕数与难度带**真的不同**；
 * ② 全程确定性（同输入同输出，可复盘）；
 * ③ 有界（不会无限拖，也不会难度爆炸）。
 */

const HEALTHY = { san: 70, skill: 60, bond: 50 };
const WEAK = { san: 25, skill: 30, bond: 20 };

describe('张力预算驱动幕数（不再硬编码 4）', () => {
  it('出身决定初始预算，未知出身给默认值', () => {
    expect(createActState('assassin').tensionBudget).toBe(88);
    expect(createActState('survivor').tensionBudget).toBe(76);
    expect(createActState('nobody').tensionBudget).toBe(84);
    expect(createActState().actIndex).toBe(1);
  });

  it('每一幕都要花时间，成功反而省（走通了松一口气）', () => {
    const base = createActState();
    const success = consumeTension(base, { outcome: 'success' });
    const failure = consumeTension(base, { outcome: 'failure' });

    expect(success.tensionBudget).toBeLessThan(base.tensionBudget);
    expect(failure.tensionBudget).toBeLessThan(success.tensionBudget);
  });

  it('高风险/重创烧得更快，有人并肩省着花', () => {
    const base = createActState();
    const plain = consumeTension(base, { outcome: 'none' });
    const risky = consumeTension(base, { outcome: 'none', risky: true });
    const hurt = consumeTension(base, { outcome: 'none', sanDelta: -15 });
    const allied = consumeTension(base, { outcome: 'none', allied: true });

    expect(risky.tensionBudget).toBeLessThan(plain.tensionBudget);
    expect(hurt.tensionBudget).toBeLessThan(plain.tensionBudget);
    expect(allied.tensionBudget).toBeGreaterThan(plain.tensionBudget);
  });

  it('**不同玩法得到不同幕数**：稳扎稳打能拖更久，一路豪赌早收场', () => {
    let steady = createActState();
    let gambler = createActState();

    for (let act = 0; act < 12; act += 1) {
      if (!shouldEndRun(steady, HEALTHY)) {
        steady = consumeTension(steady, { outcome: 'success', allied: true });
      }
      if (!shouldEndRun(gambler, HEALTHY)) {
        gambler = consumeTension(gambler, { outcome: 'failure', risky: true, sanDelta: -18 });
      }
    }

    expect(gambler.actIndex).toBeLessThan(steady.actIndex);
    expect(steady.actIndex).toBeGreaterThan(4); // 比旧的固定 4 幕更长
  });

  it('同一串选择必得同一幕数（可复盘）', () => {
    const run = () => {
      let state = createActState('assassin');
      for (const outcome of ['success', 'failure', 'success'] as const) {
        state = consumeTension(state, { outcome, risky: outcome === 'failure' });
      }
      return state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('预算被钳制在 0..上限之间，不会越攒越多', () => {
    let state = createActState();
    for (let index = 0; index < 20; index += 1) {
      state = consumeTension(state, { outcome: 'success', allied: true });
    }
    expect(state.tensionBudget).toBeLessThanOrEqual(TENSION_MAX);
    expect(state.tensionBudget).toBeGreaterThanOrEqual(0);
  });
});

describe('终局条件（不再是 turnIndex===4）', () => {
  it('预算耗尽即终局', () => {
    expect(shouldEndRun({ actIndex: 3, tensionBudget: 0, turnsSinceLastCrisis: 1 }, HEALTHY)).toBe(true);
  });

  it('三属性任一见底即终局', () => {
    expect(shouldEndRun(createActState(), { ...HEALTHY, san: 0 })).toBe(true);
    expect(shouldEndRun(createActState(), { ...HEALTHY, skill: 0 })).toBe(true);
    expect(shouldEndRun(createActState(), { ...HEALTHY, bond: 0 })).toBe(true);
  });

  it('幕数有硬上限（演示节奏可控）', () => {
    expect(shouldEndRun({ actIndex: ACT_HARD_CAP + 1, tensionBudget: 90, turnsSinceLastCrisis: 0 }, HEALTHY)).toBe(true);
  });

  it('状态健康且预算充足时继续', () => {
    expect(shouldEndRun(createActState(), HEALTHY)).toBe(false);
  });

  it('连续三幕没危机就该插一个（而不是固定第 N 幕）', () => {
    expect(crisisDue({ actIndex: 4, tensionBudget: 60, turnsSinceLastCrisis: 3 })).toBe(true);
    expect(crisisDue({ actIndex: 2, tensionBudget: 60, turnsSinceLastCrisis: 1 })).toBe(false);
  });
});

describe('难度带由状态决定（不再查回合号）', () => {
  it('同样"第 2 幕"，不同状态得到不同难度带', () => {
    const low = tensionBand(createActState(), HEALTHY, 0);
    const high = tensionBand({ actIndex: 2, tensionBudget: 12, turnsSinceLastCrisis: 0 }, WEAK, 3);

    expect(high.center).toBeGreaterThan(low.center);
    expect(high.band).not.toBe(low.band);
  });

  it('张力充裕时反而更宽松（还有余地）', () => {
    const rich = tensionBand({ actIndex: 1, tensionBudget: 84, turnsSinceLastCrisis: 0 }, HEALTHY);
    const tight = tensionBand({ actIndex: 1, tensionBudget: 30, turnsSinceLastCrisis: 0 }, HEALTHY);
    expect(tight.center).toBeGreaterThan(rich.center);
  });

  it('难度带被钳在 11..20 内（不会爆表）', () => {
    const extreme = tensionBand({ actIndex: 6, tensionBudget: 0, turnsSinceLastCrisis: 0 }, { san: 5, skill: 5, bond: 5 }, 9);
    expect(extreme.center).toBeLessThanOrEqual(20);
    expect(extreme.center).toBeGreaterThanOrEqual(11);

    const easy = tensionBand({ actIndex: 1, tensionBudget: 100, turnsSinceLastCrisis: 0 }, { san: 90, skill: 90, bond: 90 }, 0);
    expect(easy.center).toBeGreaterThanOrEqual(11);
  });

  it('给得出可解释的理由', () => {
    const band = tensionBand({ actIndex: 3, tensionBudget: 20, turnsSinceLastCrisis: 0 }, WEAK, 3);
    expect(band.reasons.length).toBeGreaterThan(0);
    expect(band.reasons.join()).toContain('张力');
  });

  it('出口文案不含数字', () => {
    for (const budget of [90, 40, 10]) {
      expect(/\d/.test(actSummary({ actIndex: 2, tensionBudget: budget, turnsSinceLastCrisis: 0 }))).toBe(false);
    }
  });
});
