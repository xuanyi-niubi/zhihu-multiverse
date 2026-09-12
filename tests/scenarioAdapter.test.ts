import { describe, expect, it } from 'vitest';

import { advanceWorldWithChoice, hiddenDeltaFor, outcomeEffect, syncStats } from '@/core/run/scenarioAdapter';
import { createInitialWorld } from '@/core/run/worldState';

/**
 * 适配器把「既有剧本的结果」翻译成隐藏状态变化。
 *
 * 关键性质：
 * - **确定性**：同样的输入永远同样的隐藏增量（没有随机、没有时间依赖）。
 * - **可解释**：风险选项记身体账、失败额外记同辈账、专业力增长换导师信任 —— 每条规则都能讲出来。
 * - **不越权**：属性（san/skill/bond）不由这里推进，避免和既有的遗物/出身倍率口径打架。
 */

const SAFE = { id: 'a', text: '先稳住' } as const;
const RISKY = { id: 'b', text: '正面硬刚', check: { targetStat: 'skill' as const, difficulty: 14 } } as const;
const BASE = { san: 60, skill: 50, bond: 40 };

describe('hiddenDeltaFor（规则）', () => {
  it('风险选项无论如何都记身体账', () => {
    expect(hiddenDeltaFor(RISKY, 'success').bodyAlarm).toBe(12);
    expect(hiddenDeltaFor(RISKY, 'failure').bodyAlarm).toBe(16);
    expect(hiddenDeltaFor(RISKY, 'failure').peerPressure).toBe(8);
  });

  it('稳妥选项让身体缓一口气（负向）', () => {
    const delta = hiddenDeltaFor(SAFE, 'no-check');

    expect(delta.bodyAlarm).toBe(-6);
    expect(delta.runway).toBe(-4);
  });

  it('专业力增长 → 导师更信任；羁绊增长 → 人情债下降', () => {
    const delta = hiddenDeltaFor(RISKY, 'success', { statDeltas: { skill: 12, bond: 8 } });

    expect(delta.mentorTrust).toBe(5);
    expect(delta.socialDebt).toBe(-6);
  });

  it('羁绊受损 → 信任下降且欠下人情', () => {
    const delta = hiddenDeltaFor(SAFE, 'no-check', { statDeltas: { bond: -10 } });

    expect(delta.mentorTrust).toBe(-4);
    expect(delta.socialDebt).toBe(4);
  });

  it('心智掉得狠 → 同辈噪声更容易钻进来', () => {
    expect(hiddenDeltaFor(SAFE, 'no-check', { statDeltas: { san: -12 } }).peerPressure).toBe(6);
    expect(hiddenDeltaFor(SAFE, 'no-check', { statDeltas: { san: -4 } }).peerPressure).toBeUndefined();
  });

  it('同输入同输出（可复盘）', () => {
    expect(JSON.stringify(hiddenDeltaFor(RISKY, 'failure', { statDeltas: { san: -20 } }))).toBe(
      JSON.stringify(hiddenDeltaFor(RISKY, 'failure', { statDeltas: { san: -20 } })),
    );
  });
});

describe('outcomeEffect', () => {
  it('只带隐藏增量与路径 flag，**不带属性**（属性有唯一事实源）', () => {
    const effect = outcomeEffect(RISKY, 'success', { statDeltas: { skill: 10, san: -6 } });

    expect(effect.stats).toBeUndefined();
    expect(effect.flags).toEqual(['path-risky']);
    expect(effect.hidden?.bodyAlarm).toBe(12);
  });

  it('稳妥路径打 path-safe', () => {
    expect(outcomeEffect(SAFE, 'no-check').flags).toEqual(['path-safe']);
  });
});

describe('advanceWorldWithChoice', () => {
  it('不修改入参，返回新状态', () => {
    const before = createInitialWorld('SEED-ADAPTER', BASE);
    const snapshot = JSON.stringify(before);

    const after = advanceWorldWithChoice(before, RISKY, 'failure', { statDeltas: { san: -18 } });

    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
  });

  it('属性保持不变（由既有链路推进），只动隐藏状态与 flags', () => {
    const before = createInitialWorld('SEED-ADAPTER', BASE);
    const after = advanceWorldWithChoice(before, RISKY, 'success', { statDeltas: { skill: 20, san: -5 } });

    expect(after.stats).toEqual(before.stats);
    expect(after.hidden.bodyAlarm).toBe(Math.min(100, before.hidden.bodyAlarm + 12));
    expect(after.flags).toContain('path-risky');
  });

  it('syncStats 用权威属性覆盖世界状态里的那一份', () => {
    const before = createInitialWorld('SEED-ADAPTER', BASE);
    const synced = syncStats(before, { san: 33, skill: 77, bond: 11 });

    expect(synced.stats).toEqual({ san: 33, skill: 77, bond: 11 });
    expect(synced.hidden).toEqual(before.hidden);
  });

  it('连续推进仍逐字节可复现', () => {
    const run = () => {
      let world = createInitialWorld('SEED-CHAIN', BASE);
      world = advanceWorldWithChoice(world, RISKY, 'success', { statDeltas: { skill: 8 } });
      world = advanceWorldWithChoice(world, SAFE, 'no-check', { statDeltas: { bond: 4 } });
      world = advanceWorldWithChoice(world, RISKY, 'failure', { statDeltas: { san: -22 } });
      return world;
    };

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
