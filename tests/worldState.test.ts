import { describe, expect, it } from 'vitest';

import {
  HIDDEN_KEYS,
  alertingSignals,
  applyEffect,
  applyEffects,
  clampUnit,
  createInitialWorld,
  hiddenSignals,
  isRunOver,
} from '@/core/run/worldState';

/**
 * 世界状态：纯迁移 + 隐藏状态对外只给定性信号。
 *
 * 这一层的正确性直接决定 P1 退出门槛的另一半（「状态完全一致」），
 * 以及「玩家看不到后台数值」这条产品约定。
 */

const BASE = { san: 60, skill: 50, bond: 40 };

describe('createInitialWorld', () => {
  it('同种子开出同一局（含隐藏状态）', () => {
    expect(createInitialWorld('SEED-A', BASE)).toEqual(createInitialWorld('SEED-A', BASE));
  });

  it('不同种子的隐藏状态不同（不是常数）', () => {
    const a = createInitialWorld('SEED-A', BASE).hidden;
    const b = createInitialWorld('SEED-B', BASE).hidden;

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('开局隐藏值落在设计区间内（留出下行空间）', () => {
    for (let index = 0; index < 50; index += 1) {
      const { hidden } = createInitialWorld(`SEED-${index}`, BASE);

      expect(hidden.bodyAlarm).toBeLessThanOrEqual(25);
      expect(hidden.peerPressure).toBeLessThanOrEqual(25);
      expect(hidden.runway).toBeGreaterThanOrEqual(45);
      expect(hidden.mentorTrust).toBeGreaterThanOrEqual(40);
      for (const key of HIDDEN_KEYS) {
        expect(hidden[key]).toBeGreaterThanOrEqual(0);
        expect(hidden[key]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('属性被钳制且携带的 flags 为空', () => {
    const world = createInitialWorld('SEED-C', { san: 200, skill: -20, bond: 50 });

    expect(world.stats).toEqual({ san: 100, skill: 0, bond: 50 });
    expect(world.flags).toEqual([]);
  });
});

describe('applyEffect（纯迁移）', () => {
  it('不修改入参', () => {
    const before = createInitialWorld('SEED-P', BASE);
    const snapshot = JSON.stringify(before);

    applyEffect(before, { stats: { san: -30 }, hidden: { bodyAlarm: 20 }, flags: ['x'] });

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('属性与隐藏状态都钳制到 0..100', () => {
    const world = { ...createInitialWorld('SEED-P', BASE), stats: { san: 95, skill: 5, bond: 50 } };

    const up = applyEffect(world, { stats: { san: 40 } });
    expect(up.stats.san).toBe(100);

    const down = applyEffect(world, { stats: { skill: -40 } });
    expect(down.stats.skill).toBe(0);
  });

  it('隐藏状态同样钳制', () => {
    const world = createInitialWorld('SEED-P', BASE);

    const high = applyEffect(world, { hidden: { bodyAlarm: 500 } });
    expect(high.hidden.bodyAlarm).toBe(100);

    const low = applyEffect(world, { hidden: { runway: -500 } });
    expect(low.hidden.runway).toBe(0);
  });

  it('非法数值不污染状态（NaN / 缺字段）', () => {
    const world = createInitialWorld('SEED-P', BASE);
    const next = applyEffect(world, { stats: { san: Number.NaN }, hidden: { runway: Number.NaN } });

    expect(next.stats.san).toBe(world.stats.san);
    expect(next.hidden.runway).toBe(world.hidden.runway);
  });

  it('flags 去重且保持加入顺序', () => {
    const world = createInitialWorld('SEED-P', BASE);
    const once = applyEffect(world, { flags: ['a', 'b'] });
    const twice = applyEffect(once, { flags: ['b', 'c', ''] });

    expect(twice.flags).toEqual(['a', 'b', 'c']);
  });

  it('applyEffects 按顺序累积，等价于逐个应用', () => {
    const world = createInitialWorld('SEED-P', BASE);
    const effects = [{ stats: { san: -10 } }, { stats: { skill: 5 }, flags: ['z'] }];

    expect(applyEffects(world, effects)).toEqual(
      applyEffect(applyEffect(world, effects[0]), effects[1]),
    );
  });
});

describe('隐藏状态对外只有定性信号', () => {
  it('信号映射覆盖全部五个键', () => {
    const signals = hiddenSignals(createInitialWorld('SEED-S', BASE));

    expect(Object.keys(signals).sort()).toEqual([...HIDDEN_KEYS].sort());
    for (const key of HIDDEN_KEYS) {
      expect(['calm', 'watch', 'alert', 'critical']).toContain(signals[key]);
    }
  });

  it('alertingSignals 只返回需要提醒的那几条，且方向正确', () => {
    const world = {
      ...createInitialWorld('SEED-S', BASE),
      // mentorTrust 60 → 原始档位 alert → 反转后 watch（信任尚可，不报警）
      hidden: { bodyAlarm: 80, peerPressure: 10, runway: 65, mentorTrust: 60, socialDebt: 60 },
    };

    const alerting = alertingSignals(world);
    // 高 bodyAlarm / 高 socialDebt 是坏事；runway 高是好事，不该报
    expect(alerting.map((item) => item.key)).toEqual(['bodyAlarm', 'socialDebt']);
    expect(alerting.every((item) => item.level === 'alert' || item.level === 'critical')).toBe(true);
  });

  it('「越高越好」的两个键极性相反：时间紧 / 信任低才报警', () => {
    const signals = hiddenSignals({
      ...createInitialWorld('SEED-S', BASE),
      hidden: { bodyAlarm: 0, peerPressure: 0, runway: 5, mentorTrust: 5, socialDebt: 0 },
    });

    expect(signals.runway).toBe('critical');
    expect(signals.mentorTrust).toBe('critical');

    const comfortable = hiddenSignals({
      ...createInitialWorld('SEED-S', BASE),
      hidden: { bodyAlarm: 0, peerPressure: 0, runway: 90, mentorTrust: 90, socialDebt: 0 },
    });

    expect(comfortable.runway).toBe('calm');
    expect(comfortable.mentorTrust).toBe('calm');
  });
});

describe('结算判定', () => {
  it('SAN > 0 未结束', () => {
    expect(isRunOver(createInitialWorld('SEED-O', BASE)).over).toBe(false);
  });

  it('SAN 归零即中断', () => {
    const world = applyEffect(createInitialWorld('SEED-O', { san: 5, skill: 50, bond: 50 }), {
      stats: { san: -5 },
    });

    expect(isRunOver(world)).toEqual({ over: true, reason: 'san-depleted' });
  });
});

describe('clampUnit', () => {
  it('四舍五入并钳制，非法输入归零', () => {
    expect(clampUnit(49.6)).toBe(50);
    expect(clampUnit(-1)).toBe(0);
    expect(clampUnit(101)).toBe(100);
    expect(clampUnit(Number.NaN)).toBe(0);
  });
});
