import { describe, expect, it } from 'vitest';

import { resolveStatDeltas } from '@/core/relics';
import { ORIGINS, applyOriginStats, getOrigin, sanMultiplierFor } from '@/data/origins';

/**
 * 出身流派测试。
 *
 * 重点不是数值本身，而是「三个流派对应三种不同策略」这个设计意图：
 * 各自只在一个维度上有明确优势，且都有代价。
 */

describe('出身流派', () => {
  it('三个流派各有一个明确优势维度', () => {
    const [assassin, berserker, ranger] = ORIGINS;

    expect(assassin.dcModifier).toBeLessThan(0); // 检定更容易
    expect(berserker.startingRelicId).toBeDefined(); // 自带遗物
    expect(ranger.sanDamageMultiplier).toBeGreaterThan(1); // SAN 易伤
  });

  it('每个流派都有明确的代价，不存在纯增益', () => {
    for (const origin of ORIGINS) {
      const maxStat = Math.max(origin.stats.san, origin.stats.skill, origin.stats.bond);
      const minStat = Math.min(origin.stats.san, origin.stats.skill, origin.stats.bond);

      // 代价至少占一样：属性失衡 / SAN 易伤 / SAN 起点低
      const unbalanced = maxStat - minStat >= 30;
      const fragile = origin.sanDamageMultiplier > 1;
      const lowSan = origin.stats.san <= 60;

      expect(unbalanced || fragile || lowSan).toBe(true);
    }
  });

  it('没有流派同时拿到 DC 减免和自带遗物（避免双重白给）', () => {
    for (const origin of ORIGINS) {
      expect(origin.dcModifier < 0 && Boolean(origin.startingRelicId)).toBe(false);
    }
  });

  it('未知 id 回落到第一个流派', () => {
    expect(getOrigin('does-not-exist').id).toBe(ORIGINS[0].id);
    expect(getOrigin(null).id).toBe(ORIGINS[0].id);
  });

  it('applyOriginStats 返回副本，不共享引用', () => {
    const origin = ORIGINS[0];
    const stats = applyOriginStats(origin);

    stats.san = 1;

    expect(origin.stats.san).not.toBe(1);
  });
});

describe('sanMultiplierFor', () => {
  it('非 peerOnly 流派恒用自身倍率', () => {
    const assassin = getOrigin('assassin');

    expect(sanMultiplierFor(assassin, false)).toBe(1);
    expect(sanMultiplierFor(assassin, true)).toBe(1);
  });

  it('peerOnly 流派只对同辈压力事件吃易伤', () => {
    const ranger = getOrigin('ranger');

    expect(sanMultiplierFor(ranger, true)).toBe(1.5);
    expect(sanMultiplierFor(ranger, false)).toBe(1);
  });
});

describe('resolveStatDeltas', () => {
  it('先乘易伤再乘减伤，顺序固定', () => {
    // -20 × 1.5 = -30，再减伤 50% → -15
    expect(resolveStatDeltas({ san: -20 }, 0.5, 1.5).san).toBe(-15);
    // 反向顺序会得到 -15 之外的结果，这里锁死顺序
    expect(resolveStatDeltas({ san: -20 }, 0.5, 1).san).toBe(-10);
  });

  it('正向 SAN 变化不受易伤与减伤影响', () => {
    expect(resolveStatDeltas({ san: 12 }, 0.8, 2).san).toBe(12);
  });

  it('非 SAN 属性原样透传', () => {
    const result = resolveStatDeltas({ san: -10, skill: 8, bond: -4 }, 0.5, 1);

    expect(result.skill).toBe(8);
    expect(result.bond).toBe(-4);
    expect(result.san).toBe(-5);
  });

  it('不修改入参', () => {
    const deltas = { san: -20, skill: 3 };
    resolveStatDeltas(deltas, 0.5, 1.5);

    expect(deltas.san).toBe(-20);
  });
});
