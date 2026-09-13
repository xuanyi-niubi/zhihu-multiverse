import { describe, expect, it } from 'vitest';

import type {
  ActionOption,
  ActionSpace,
  EncounterPlan,
  EncounterType,
  SessionMechanicsState,
} from '@/features/game-mechanics/domain';

/**
 * Action Space System 领域契约（玩法线程 §17-§25 / §61）。
 *
 * 这些断言把「成长 = 多看见行动，不是数值变高」写死成形状：
 * 状态里不允许出现经验值 / 资源点 / 技能树。
 */

const ENCOUNTER_TYPES: readonly EncounterType[] = [
  'path_unlock',
  'condition_shift',
  'experience_conflict',
  'cost_reveal',
  'unknown_lock',
];

function emptyState(): SessionMechanicsState {
  return {
    activeEncounterId: null,
    availableActionIds: [],
    unlockedActionIds: [],
    removedActionIds: [],
    lockedActionIds: [],
    adoptedConditionKeys: [],
    focusVariables: [],
    unknownLocks: [],
  };
}

describe('EncounterType：仅五种', () => {
  it('恰好五种，不扩展', () => {
    expect(new Set(ENCOUNTER_TYPES).size).toBe(5);
  });
});

describe('ActionSpace：行动而非数值', () => {
  it('只有 available / locked / unlocked / removed 四个列表', () => {
    const space: ActionSpace = { available: [], locked: [], unlocked: [], removed: [] };
    expect(Object.keys(space).sort()).toEqual(['available', 'locked', 'removed', 'unlocked']);
  });
});

describe('SessionMechanicsState：最小状态，不携带任何数值成长', () => {
  it('字段集合被钉死', () => {
    expect(Object.keys(emptyState()).sort()).toEqual([
      'activeEncounterId',
      'adoptedConditionKeys',
      'availableActionIds',
      'focusVariables',
      'lockedActionIds',
      'removedActionIds',
      'unknownLocks',
      'unlockedActionIds',
    ]);
  });

  it('没有经验值 / 资源点 / 卡组 / 技能树', () => {
    const state = emptyState() as unknown as Record<string, unknown>;
    for (const forbidden of ['experience', 'points', 'deck', 'skillTree', 'level']) {
      expect(forbidden in state).toBe(false);
    }
  });
});

describe('EncounterPlan：调度层而非结论层', () => {
  it('必须引用真实来源，且 act 只有 1-3', () => {
    const option: ActionOption = {
      id: 'a1',
      label: '先做小样',
      source: 'experience',
      sourceFactIds: ['fact:1'],
      requirements: [],
    };
    const plan: EncounterPlan = {
      id: 'enc-1',
      type: 'path_unlock',
      act: 2,
      sourceFactIds: option.sourceFactIds,
      sourceCaseIds: [],
      payload: {
        kind: 'path_unlock',
        unlockId: 'u1',
        label: '先做小样',
        choiceText: '按「先做小样」先试一小步',
        hint: '来自一条真实经验',
      },
    };
    expect(plan.sourceFactIds.length).toBeGreaterThan(0);
    expect([1, 2, 3]).toContain(plan.act);
  });
});
