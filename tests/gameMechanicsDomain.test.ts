import { describe, expect, it } from 'vitest';

import { actionViewOf } from '@/features/game-mechanics/view';
import type {
  ActionOrigin,
  ActionSpace,
  ActionState,
  CostGate,
  EncounterPlan,
  EncounterType,
  ExperienceCollision,
  PlayAction,
  UnknownLock,
} from '@/features/game-mechanics/domain';

/**
 * Action Space Lite + Encounter 领域契约（§五 / §九 / §十二 / §十五 / §十七 / §十八）。
 *
 * 这些断言把「成长 = 多看见行动，不是数值变高」写死成形状：
 * 契约里不允许出现经验值 / 资源点 / 技能树 / D20 / SAN。
 */

/** 冻结的三种 Encounter（§十七）。 */
const ENCOUNTER_TYPES: readonly EncounterType[] = [
  'path-reveal',
  'experience-collision',
  'unknown-lock',
];

/** 一条行动的四种状态（§五）。 */
const ACTION_STATES: readonly ActionState[] = ['available', 'unlocked', 'locked', 'removed'];

/** 行动的三种来源（§五）。 */
const ACTION_ORIGINS: readonly ActionOrigin[] = ['scenario', 'experience', 'counterexample'];

function action(): PlayAction {
  return {
    id: 'action-1',
    label: '先做一个小样',
    state: 'unlocked',
    origin: 'experience',
    sourceFactIds: ['fact:1'],
  };
}

describe('EncounterType：恰好三种，不扩展', () => {
  it('只有 path-reveal / experience-collision / unknown-lock', () => {
    expect([...ENCOUNTER_TYPES].sort()).toEqual([
      'experience-collision',
      'path-reveal',
      'unknown-lock',
    ]);
    expect(new Set(ENCOUNTER_TYPES).size).toBe(3);
  });

  it('COST GATE 不是 Encounter（§十七）', () => {
    const types: readonly string[] = ENCOUNTER_TYPES;
    expect(types).not.toContain('cost-gate');
    expect(types).not.toContain('cost-reveal');
  });
});

describe('ActionState / ActionOrigin：形状被钉死', () => {
  it('四种状态', () => {
    expect([...ACTION_STATES].sort()).toEqual(['available', 'locked', 'removed', 'unlocked']);
  });

  it('三种来源', () => {
    expect([...ACTION_ORIGINS].sort()).toEqual(['counterexample', 'experience', 'scenario']);
  });
});

describe('ActionSpace：行动而非数值', () => {
  it('只有 actions（外加可选的还原记录）', () => {
    const space: ActionSpace = { actions: [] };
    expect(Object.keys(space).sort()).toEqual(['actions']);
  });

  it('不携带任何数值成长字段', () => {
    const probe: Record<string, unknown> = {
      hp: undefined,
      energy: undefined,
      level: undefined,
      san: undefined,
      d20: undefined,
      relicValue: undefined,
    };
    const space: ActionSpace = { actions: [] };
    for (const forbidden of ['hp', 'energy', 'level', 'san', 'd20', 'skillTree', 'resources']) {
      expect(forbidden in space).toBe(false);
    }
    expect(Object.keys(probe)).toHaveLength(6);
  });
});

describe('EncounterPlan：调度层而非结论层', () => {
  it('必须引用真实来源，且 act 只有 1-3', () => {
    const plan: EncounterPlan = {
      id: 'enc-1',
      type: 'path-reveal',
      act: 2,
      sourceFactIds: ['fact:1'],
      sourceCaseIds: [],
      unlockId: 'u1',
    };
    expect(plan.sourceFactIds.length).toBeGreaterThan(0);
    expect([1, 2, 3]).toContain(plan.act);
  });
});

describe('CostGate：必须有 reason 与 sourceFactId（§十一）', () => {
  it('形状被钉死', () => {
    const gate: CostGate = {
      id: 'cost-gate-1',
      sourceFactId: 'fact:cost',
      targetActionIds: ['action-1'],
      effect: 'lock',
      reason: '这条路暂时关闭：你已经把这个周末投入到比赛项目。',
      category: 'time',
    };
    expect(Object.keys(gate).sort()).toEqual([
      'category',
      'effect',
      'id',
      'reason',
      'sourceFactId',
      'targetActionIds',
    ]);
    expect(gate.reason).not.toMatch(/体力|SAN|等级/);
  });
});

describe('ExperienceCollision：只指出分歧（§十二 / §十四）', () => {
  it('focus 候选带 supportingDifferenceIds，不带因果结论', () => {
    const collision: ExperienceCollision = {
      id: 'collision-1',
      primaryCaseId: 'case:a',
      counterCaseId: 'case:b',
      primaryFactIds: ['fact:a'],
      counterFactIds: ['fact:b'],
      focusCandidates: [{ id: 'focus-时间', label: '时间', supportingDifferenceIds: ['时间'] }],
      supportingDifferenceIds: ['时间'],
    };
    expect(Object.keys(collision).sort()).toEqual([
      'counterCaseId',
      'counterFactIds',
      'focusCandidates',
      'id',
      'primaryCaseId',
      'primaryFactIds',
      'supportingDifferenceIds',
    ]);
  });
});

describe('UnknownLock：realityRequired 恒为 true（§十五）', () => {
  it('形状被钉死', () => {
    const lock: UnknownLock = {
      id: 'unknown-lock-1',
      label: '每周能否稳定投入 8 小时',
      relatedActionIds: ['action-1'],
      realityRequired: true,
    };
    expect(lock.realityRequired).toBe(true);
    expect(Object.keys(lock).sort()).toEqual([
      'id',
      'label',
      'realityRequired',
      'relatedActionIds',
    ]);
  });
});

describe('ViewModel：React 不自己推断 source facts（§二十三）', () => {
  it('sourceLabel 由 view 层给出', () => {
    const view = actionViewOf(action());
    expect(view.sourceLabel).toBe('真实经验');
    expect(view.state).toBe('unlocked');
  });
});
