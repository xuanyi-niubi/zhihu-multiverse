import { describe, expect, it } from 'vitest';

import {
  conditionShiftOptionsFromDifferences,
  meaningfulDifferences,
} from '@/features/game-mechanics/conditionShift';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { UserDifference } from '@/features/experience/domain';

/**
 * CONDITION SHIFT（§6 / §55 / §78）。
 *
 * 两条硬约束：
 * 1. 只能从已知 UserDifference 创建；
 * 2. 借用条件必须 `hypothetical: true`，永不污染 userContext。
 */

function difference(overrides: Partial<UserDifference> = {}): UserDifference {
  return {
    variable: '固定队友',
    userValue: '没有',
    experienceValue: '有一个稳定队友',
    relation: 'different',
    evidenceFactIds: ['fact:1'],
    ...overrides,
  };
}

describe('meaningfulDifferences', () => {
  it('只认 different 且样本值已知', () => {
    const differences = [
      difference(),
      difference({ variable: '时间', relation: 'same' }),
      difference({ variable: '预算', relation: 'unknown' }),
      difference({ variable: '基础', experienceValue: undefined }),
    ];
    expect(meaningfulDifferences(differences).map((item) => item.variable)).toEqual(['固定队友']);
  });
});

describe('conditionShiftOptionsFromDifferences', () => {
  it('没有真实 UserDifference → 不生成条件', () => {
    expect(conditionShiftOptionsFromDifferences([])).toEqual([]);
    expect(conditionShiftOptionsFromDifferences([difference({ relation: 'same' })])).toEqual([]);
  });

  it('每条借用条件都写死 hypothetical: true', () => {
    const options = conditionShiftOptionsFromDifferences([difference()]);
    expect(options).toHaveLength(1);
    expect(options[0]!.hypothetical).toBe(true);
    expect(options[0]!.variable).toBe('固定队友');
    expect(options[0]!.experienceValue).toBe('有一个稳定队友');
  });

  it('同变量去重且稳定排序', () => {
    const options = conditionShiftOptionsFromDifferences([
      difference({ variable: '队友' }),
      difference({ variable: '队友' }),
      difference({ variable: '时间', experienceValue: '每周 12 小时' }),
    ]);
    expect(options.map((item) => item.variable)).toEqual(['队友', '时间']);
  });
});

describe('validateEncounterPlan：condition_shift 只能借已记录的差异', () => {
  const payload = {
    kind: 'condition_shift' as const,
    changes: [
      {
        variable: '队友',
        hypothetical: true as const,
        experienceValue: '有一个稳定队友',
        description: '如果「队友」变成「有一个稳定队友」，会发生什么？',
      },
    ],
  };

  it('来源差异存在 → 无 issue', () => {
    const issues = validateEncounterPlan(
      {
        id: 'e1',
        type: 'condition_shift',
        act: 1,
        sourceFactIds: ['fact:1'],
        sourceCaseIds: [],
        requiredDifferenceKeys: ['队友'],
        payload,
      },
      { facts: [], cases: [], differences: [difference({ variable: '队友' })], unknownIds: [] },
    );
    expect(issues).toEqual([]);
  });

  it('凭空借条件 → 报错', () => {
    const issues = validateEncounterPlan(
      {
        id: 'e1',
        type: 'condition_shift',
        act: 1,
        sourceFactIds: [],
        sourceCaseIds: [],
        payload,
      },
      { facts: [], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues.join(' ')).toContain('未记录的差异');
  });
});
