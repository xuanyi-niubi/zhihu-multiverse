import { describe, expect, it } from 'vitest';

import { toDifficulty, toModifier, toSeed, toStatValue, toTurnIndex } from '@/core/brand';
import { D20_RULE_SET, createCheckRng, deriveBaseModifier, evaluateCheck } from '@/core/d20';
import { EMPTY_INVENTORY } from '@/core/relics';

import type { D20CheckRequest } from '@/types/game';

/**
 * D20 检定引擎的规范不变量测试。
 *
 * 对应 `types/game.ts` 验收清单里的：
 *   I-04 天然 1 必败 / 天然 20 必成
 *   I-05 其余骰面按 total >= DC 判定
 *   I-06 修正钳制
 *   I-10 同种子确定性
 */

function makeRequest(overrides: Partial<D20CheckRequest> = {}): D20CheckRequest {
  return {
    checkId: 'test-check',
    turnIndex: toTurnIndex(1),
    seed: toSeed('SEED-2026-TEST'),
    targetStat: 'skill',
    difficulty: toDifficulty(13),
    stats: { san: toStatValue(100), skill: toStatValue(15), bond: toStatValue(10) },
    inventory: EMPTY_INVENTORY,
    ruleSet: D20_RULE_SET,
    baseModifier: toModifier(0),
    temporaryModifier: toModifier(0),
    activatedRelicIds: [],
    ...overrides,
  };
}

/** rng 返回固定值，用于精确控制骰面：0 → 1，0.999… → 20，0.5 → 11。 */
const rollOf = (value: number) => () => value;

describe('天然骰面优先级（I-04）', () => {
  it('天然 1 必定失败，即使总值远超 DC', () => {
    const result = evaluateCheck(
      makeRequest({ difficulty: toDifficulty(1), baseModifier: toModifier(20) }),
      rollOf(0),
    );

    expect(result.rawRoll).toBe(1);
    expect(result.critical).toBe('critical-failure');
    expect(result.outcome).toBe('failure');
  });

  it('天然 20 必定成功，即使总值远低于 DC', () => {
    const result = evaluateCheck(
      makeRequest({ difficulty: toDifficulty(30), baseModifier: toModifier(-20) }),
      rollOf(0.999999),
    );

    expect(result.rawRoll).toBe(20);
    expect(result.critical).toBe('critical-success');
    expect(result.outcome).toBe('success');
  });
});

describe('普通判定（I-05）', () => {
  it('total >= DC 时成功', () => {
    // 骰面 11 + 修正 0 = 11 >= 11
    const result = evaluateCheck(makeRequest({ difficulty: toDifficulty(11) }), rollOf(0.5));

    expect(result.rawRoll).toBe(11);
    expect(result.critical).toBe('none');
    expect(result.outcome).toBe('success');
  });

  it('total < DC 时失败', () => {
    const result = evaluateCheck(makeRequest({ difficulty: toDifficulty(12) }), rollOf(0.5));

    expect(result.total).toBe(11);
    expect(result.outcome).toBe('failure');
  });
});

describe('修正与边界（I-06）', () => {
  it('deriveBaseModifier 把 0..100 映射到 -5..+5', () => {
    expect(deriveBaseModifier(100)).toBe(5);
    expect(deriveBaseModifier(50)).toBe(0);
    expect(deriveBaseModifier(0)).toBe(-5);
  });

  it('总修正被钳制在 -60..60', () => {
    const result = evaluateCheck(
      makeRequest({ baseModifier: toModifier(20), temporaryModifier: toModifier(20) }),
      rollOf(0.5),
    );

    expect(result.modifiers.totalModifier).toBe(40);
    expect(Math.abs(result.modifiers.totalModifier)).toBeLessThanOrEqual(60);
  });
});

describe('确定性（I-10）', () => {
  it('相同 seed + checkId + 回合得到相同骰面', () => {
    const a = evaluateCheck(makeRequest(), createCheckRng('SEED-A', '1:b', 1));
    const b = evaluateCheck(makeRequest(), createCheckRng('SEED-A', '1:b', 1));

    expect(a.rawRoll).toBe(b.rawRoll);
    expect(a.total).toBe(b.total);
    expect(a.outcome).toBe(b.outcome);
  });

  it('不同 checkId 得到不同随机序列', () => {
    const rolls = new Set<number>();

    for (let index = 0; index < 40; index += 1) {
      rolls.add(
        evaluateCheck(makeRequest({ checkId: `check-${index}` }), createCheckRng('SEED-A', `check-${index}`, 1))
          .rawRoll,
      );
    }

    // 40 次抽样几乎不可能只落在一个骰面上
    expect(rolls.size).toBeGreaterThan(1);
  });
});

describe('检定无副作用（I-11）', () => {
  it('evaluateCheck 不修改传入的 inventory', () => {
    const request = makeRequest();
    const before = JSON.stringify(request.inventory);

    evaluateCheck(request, rollOf(0.5));

    expect(JSON.stringify(request.inventory)).toBe(before);
  });
});
