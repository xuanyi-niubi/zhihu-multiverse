import { describe, expect, it } from 'vitest';

import {
  CLARITY_BLIND,
  STRESS_BREAKDOWN,
  STRESS_HARD,
  applyMentalEvent,
  canSeeDifficulty,
  createMentalState,
  mentalDifficultyOffset,
  mentalSignals,
} from '@/engine/mentalState';
import {
  ANCHOR_WARNING,
  anchorEventFor,
  anchorPercent,
  anchorSignals,
  applyAnchorEvent,
  createAnchor,
  isAnomalous,
  isCollapsed,
} from '@/engine/realityAnchor';
import {
  advanceThreads,
  advanceWorldModel,
  createWorldModel,
  factionStanding,
  relationshipDeltaFor,
  standingLabel,
  worldModelBrief,
} from '@/engine/worldModel';

/**
 * W2 验收：世界模型 / 心理状态 / 现实锚点。
 *
 * 三条规范原文要求必须成立：
 * ① `stress > 70 → DC +2`、`> 90 → +5`、失败触发创伤；
 * ② `clarity < 30 → 看不到 DC`；
 * ③ `锚点 < 30% → 异常信号`、`= 0% → 坍缩`，且 **Boss 判卷影响锚点**。
 *
 * 另加一条产品红线：这些出口给玩家/模型的**只能是说法，不能是数字**。
 */

const EVENT = { act: 2, sanDelta: -12, outcome: 'failure' as const, risky: true, allied: false };

describe('心理状态（压力真的改 DC）', () => {
  it('开局值在合理区间且同种子一致', () => {
    const a = createMentalState('SEED-W2');
    const b = createMentalState('SEED-W2');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.stress).toBeGreaterThanOrEqual(10);
    expect(a.stress).toBeLessThanOrEqual(20);
    expect(a.clarity).toBeGreaterThan(50);
  });

  it('难度偏移严格按规范的阈值：>70 → +2，>90 → +5', () => {
    const base = createMentalState('SEED-W2');
    expect(mentalDifficultyOffset({ ...base, stress: STRESS_HARD })).toBe(0);
    expect(mentalDifficultyOffset({ ...base, stress: STRESS_HARD + 1 })).toBe(2);
    expect(mentalDifficultyOffset({ ...base, stress: STRESS_BREAKDOWN + 1 })).toBe(5);
  });

  it('清晰度低于 30 时玩家看不到检定难度', () => {
    const base = createMentalState('SEED-W2');
    expect(canSeeDifficulty({ ...base, clarity: CLARITY_BLIND })).toBe(true);
    expect(canSeeDifficulty({ ...base, clarity: CLARITY_BLIND - 1 })).toBe(false);
  });

  it('心智消耗与失败都会加压；有人并肩会缓解', () => {
    const base = createMentalState('SEED-W2');
    const hit = applyMentalEvent(base, EVENT);
    expect(hit.stress).toBeGreaterThan(base.stress);

    const failure = applyMentalEvent(base, { ...EVENT, sanDelta: 0, risky: false });
    const success = applyMentalEvent(base, { ...EVENT, sanDelta: 0, outcome: 'success', risky: false });
    expect(failure.stress).toBeGreaterThan(success.stress);

    const allied = applyMentalEvent(base, { ...EVENT, sanDelta: 0, outcome: 'success', risky: false, allied: true });
    expect(allied.stress).toBeLessThan(success.stress);
  });

  it('崩溃边缘 + 失败 → 记一次创伤，且清晰度留下永久痕迹', () => {
    const base = { ...createMentalState('SEED-W2'), stress: STRESS_BREAKDOWN };
    const after = applyMentalEvent(base, { ...EVENT, sanDelta: 0 });

    expect(after.breakdown).toBe(true);
    expect(after.traumas.length).toBe(1);
    expect(after.clarity).toBeLessThan(base.clarity);
  });

  it('同一创伤不会重复记录（幂等）', () => {
    const base = { ...createMentalState('SEED-W2'), stress: STRESS_BREAKDOWN };
    const once = applyMentalEvent(base, { ...EVENT, sanDelta: 0 });
    const twice = applyMentalEvent(once, { ...EVENT, sanDelta: 0 });
    expect(twice.traumas.length).toBe(1);
  });

  it('出口文案不含数字', () => {
    const base = { ...createMentalState('SEED-W2'), stress: 95, clarity: 10 };
    for (const line of mentalSignals(base)) {
      expect(/\d/.test(line)).toBe(false);
    }
  });
});

describe('现实锚点（Boss 判卷终于有游戏性后果）', () => {
  it('开局不是满值，且同种子一致', () => {
    const a = createAnchor('SEED-W2');
    expect(JSON.stringify(a)).toBe(JSON.stringify(createAnchor('SEED-W2')));
    expect(a.value).toBeLessThan(1);
    expect(a.value).toBeGreaterThan(0.7);
  });

  it('豪赌与暗路拉低锚点，扎实一步与结盟拉高', () => {
    const base = createAnchor('SEED-W2');
    expect(applyAnchorEvent(base, 'risky-gamble', 2).value).toBeLessThan(base.value);
    expect(applyAnchorEvent(base, 'dark-choice', 2).value).toBeLessThan(base.value);
    expect(applyAnchorEvent(base, 'grounded-action', 2).value).toBeGreaterThan(base.value);
    expect(applyAnchorEvent(base, 'ally-support', 2).value).toBeGreaterThan(base.value);
  });

  it('**Boss 判卷影响锚点**：通过上浮、未通过明显下压', () => {
    const base = createAnchor('SEED-W2');
    expect(applyAnchorEvent(base, 'boss-success', 4).value).toBeGreaterThan(base.value);
    expect(applyAnchorEvent(base, 'boss-failure', 4).value).toBeLessThan(base.value);
    expect(base.value - applyAnchorEvent(base, 'boss-failure', 4).value).toBeGreaterThan(
      base.value - applyAnchorEvent(base, 'risky-gamble', 2).value,
    );
  });

  it('低于 30% 才有异常信号，且确定性', () => {
    const healthy = { ...createAnchor('SEED-W2'), value: 0.8 };
    expect(isAnomalous(healthy)).toBe(false);
    expect(applyAnchorEvent(healthy, 'grounded-action', 2).anomalies).toEqual([]);

    const thin = { ...createAnchor('SEED-W2'), value: 0.2 };
    const first = applyAnchorEvent(thin, 'grounded-action', 3);
    const second = applyAnchorEvent(thin, 'grounded-action', 3);
    expect(isAnomalous(first)).toBe(true);
    expect(first.anomalies.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('归零即坍缩，且百分比只用于内部/调试', () => {
    const collapsed = { ...createAnchor('SEED-W2'), value: 0 };
    expect(isCollapsed(collapsed)).toBe(true);
    expect(anchorPercent({ ...collapsed, value: 0.42 })).toBe(42);
    expect(anchorSignals(collapsed).join()).toContain('撑不住');
  });

  it('锚点事件由引擎按语义推导（AI 不参与）', () => {
    expect(anchorEventFor({ risky: true, outcome: 'failure' })).toBe('risky-gamble');
    expect(anchorEventFor({ dark: true, outcome: 'success' })).toBe('dark-choice');
    expect(anchorEventFor({ allied: true, outcome: 'success' })).toBe('ally-support');
    expect(anchorEventFor({ outcome: 'success' })).toBe('grounded-action');
  });
});

describe('世界模型（线索 / 关系 / 派系）', () => {
  it('开局关系图有名字与初始好感，同种子一致', () => {
    const model = createWorldModel('SEED-W2');
    expect(JSON.stringify(model)).toBe(JSON.stringify(createWorldModel('SEED-W2')));
    expect(model.relationships.map((r) => r.name)).toEqual(['导师', '同辈', '家里']);
    expect(model.threads).toEqual([]);
  });

  it('线索按幕次开线、被推进、在终幕收束', () => {
    const act1 = advanceThreads([], { act: 1, outcome: 'success' });
    expect(act1.length).toBe(1);
    expect(act1[0].state).toBe('advanced');

    const act2 = advanceThreads(act1, { act: 2, outcome: 'success' });
    expect(act2.length).toBe(2);
    expect(act2[0].state).toBe('closed'); // 第二幕时第一幕的线索收束

    const final = advanceThreads(act2, { act: 4, outcome: 'success', finalAct: true });
    expect(final.every((thread) => thread.state === 'closed')).toBe(true);
  });

  it('换幕即收束上一幕的线索', () => {
    const act1 = advanceThreads([], { act: 1, outcome: 'success' });
    const act2 = advanceThreads(act1, { act: 2, outcome: 'success' });

    expect(act2.find((thread) => thread.openedAt === 1)?.state).toBe('closed');
    expect(act2.find((thread) => thread.openedAt === 2)?.state).toBe('advanced');
  });

  it('同一幕重复推进不会重复开线（幂等）', () => {
    const once = advanceThreads([], { act: 1, outcome: 'success' });
    const twice = advanceThreads(once, { act: 1, outcome: 'failure' });
    expect(twice.length).toBe(1);
  });

  it('关系变化量由语义决定', () => {
    expect(relationshipDeltaFor({ social: 'ally' }, 'success')).toBeGreaterThan(0);
    expect(relationshipDeltaFor({ social: 'antagonize' }, 'failure')).toBeLessThan(0);
    expect(relationshipDeltaFor({ moral: 'good' }, 'success')).toBe(4);
    expect(relationshipDeltaFor({ moral: 'dark' }, 'success')).toBe(-5);
    expect(relationshipDeltaFor(undefined, 'none')).toBe(0);
  });

  it('单点推进：revision 递增且完全确定', () => {
    const model = createWorldModel('SEED-W2');
    const event = { act: 2, sanDelta: -14, outcome: 'failure' as const, tags: { efficiency: 'risky' as const } };
    const a = advanceWorldModel(model, event);
    const b = advanceWorldModel(model, event);

    expect(a.revision).toBe(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.anchor.value).toBeLessThan(model.anchor.value);
    expect(a.mental.stress).toBeGreaterThan(model.mental.stress);
  });

  it('结盟把关系推高、树敌把它压低，并向定性标签收敛', () => {
    const model = createWorldModel('SEED-W2');
    const allied = advanceWorldModel(model, { act: 1, sanDelta: 0, outcome: 'success', tags: { social: 'ally' } });
    const hostile = advanceWorldModel(model, { act: 1, sanDelta: 0, outcome: 'failure', tags: { social: 'antagonize' } });

    expect(allied.relationships.find((r) => r.id === 'rel-peer')?.value).toBeGreaterThan(
      model.relationships.find((r) => r.id === 'rel-peer')!.value,
    );
    expect(hostile.relationships.find((r) => r.id === 'rel-peer')?.value).toBeLessThan(
      model.relationships.find((r) => r.id === 'rel-peer')!.value,
    );
    expect(standingLabel(80)).toContain('托');
    expect(standingLabel(-80)).toContain('不想');
  });

  it('派系立场由关系聚合', () => {
    const model = createWorldModel('SEED-W2');
    const warm = { ...model, relationships: model.relationships.map((r) => ({ ...r, value: 70 })) };
    const cold = { ...model, relationships: model.relationships.map((r) => ({ ...r, value: -70 })) };
    expect(factionStanding(warm).label).toContain('有人');
    expect(factionStanding(cold).label).toContain('树敌');
  });

  it('**给玩家与模型的简报里没有数字**', () => {
    let model = createWorldModel('SEED-W2');
    for (const act of [1, 2, 3, 4]) {
      model = advanceWorldModel(model, { act, sanDelta: -12, outcome: 'failure', tags: { efficiency: 'risky', moral: 'dark' } });
    }
    const brief = worldModelBrief(model);
    const text = JSON.stringify(brief);

    expect(/\d/.test(brief.mental.join())).toBe(false);
    expect(/\d/.test(brief.anchor.join())).toBe(false);
    expect(/\d/.test(brief.faction)).toBe(false);
    // 结构里就不该出现 value / percent 这类字段
    expect(text).not.toContain('value');
    expect(text).not.toContain('percent');
  });

  it('锚点归零时简报会说这个世界撑不住了', () => {
    const collapsed = { ...createWorldModel('SEED-W2'), anchor: { value: 0, anomalies: [] } };
    expect(worldModelBrief(collapsed).anchor.join()).toContain('撑不住');
  });
});
