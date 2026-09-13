import { describe, expect, it } from 'vitest';

import {
  applyEncounterPlan,
  focusOn,
  initialSessionMechanics,
} from '@/features/game-mechanics/sessionMechanics';
import type { ActionOption, EncounterPlan } from '@/features/game-mechanics/domain';

/**
 * Session Mechanics（§22 / §26 / §67-§70）。
 *
 * 每个真正重要的选择都必须至少导致下面之一变化：
 * 新增 / 移除 / 锁定 / 解锁 Action，或 Focus Variable / Unknown 改变。
 */

function action(id: string, overrides: Partial<ActionOption> = {}): ActionOption {
  return { id, label: `行动 ${id}`, source: 'user', sourceFactIds: [], requirements: [], ...overrides };
}

function pathUnlockPlan(): EncounterPlan {
  return {
    id: 'enc-path',
    type: 'path_unlock',
    act: 2,
    sourceFactIds: ['fact:act'],
    sourceCaseIds: [],
    payload: {
      kind: 'path_unlock',
      unlockId: 'unlock-1',
      label: '先做 Demo',
      choiceText: '按「先做 Demo」先试一小步',
      hint: '来自真实经验',
    },
  };
}

describe('PATH UNLOCK：新增行动（§26）', () => {
  it('解锁后 available / unlocked 同步变化', () => {
    const mechanics = initialSessionMechanics([action('action-报名')]);
    const next = applyEncounterPlan(mechanics, pathUnlockPlan());
    expect(next.space.available.map((item) => item.id)).toEqual(['action-报名', 'action-unlock-1']);
    expect(next.state.unlockedActionIds).toEqual(['action-unlock-1']);
    expect(next.state.availableActionIds).toContain('action-unlock-1');
  });
});

describe('COST REVEAL：移除行动（§25 / §26）', () => {
  it('行动从可用变为 removed', () => {
    const mechanics = initialSessionMechanics([action('action-补课'), action('action-比赛')]);
    const next = applyEncounterPlan(mechanics, {
      id: 'enc-cost',
      type: 'cost_reveal',
      act: 2,
      sourceFactIds: ['fact:cost'],
      sourceCaseIds: [],
      payload: {
        kind: 'cost_reveal',
        effect: 'remove',
        affectedActionIds: ['action-补课'],
        explanation: '你把今晚的时间投进了比赛。',
      },
    });
    expect(next.space.available.map((item) => item.id)).toEqual(['action-比赛']);
    expect(next.state.removedActionIds).toEqual(['action-补课']);
  });
});

describe('CONDITION SHIFT：借用条件改变可用性（§23-§24 / §26）', () => {
  it('被条件锁住的行动在借用后可用，且 adoptedConditionKeys 记录', () => {
    const mechanics = initialSessionMechanics([
      action('action-组队', { requirements: [{ key: '固定队友', description: '一个固定队友' }] }),
    ]);
    expect(mechanics.state.availableActionIds).toEqual([]);

    const next = applyEncounterPlan(mechanics, {
      id: 'enc-cond',
      type: 'condition_shift',
      act: 1,
      sourceFactIds: [],
      sourceCaseIds: [],
      requiredDifferenceKeys: ['固定队友'],
      payload: {
        kind: 'condition_shift',
        changes: [
          {
            variable: '固定队友',
            hypothetical: true,
            experienceValue: '有固定队友',
            description: '如果「固定队友」变成「有固定队友」，会发生什么？',
          },
        ],
      },
    });
    expect(next.state.adoptedConditionKeys).toEqual(['固定队友']);
    expect(next.state.availableActionIds).toEqual(['action-组队']);
  });
});

describe('UNKNOWN LOCK：锁住行动（§26 / §58）', () => {
  it('锁定并记录 unknownLocks', () => {
    const mechanics = initialSessionMechanics([action('action-比赛')]);
    const next = applyEncounterPlan(mechanics, {
      id: 'enc-unknown',
      type: 'unknown_lock',
      act: 3,
      sourceFactIds: [],
      sourceCaseIds: [],
      unknownId: 'unknown-hours',
      payload: {
        kind: 'unknown_lock',
        unknownId: 'unknown-hours',
        unknownLabel: '每周能否稳定投入 8 小时',
        affectsActionIds: ['action-比赛'],
        explanation: '这条世界线还不能确认。',
      },
    });
    expect(next.state.lockedActionIds).toEqual(['action-比赛']);
    expect(next.state.availableActionIds).toEqual([]);
    expect(next.state.unknownLocks).toEqual(['unknown-hours']);
  });
});

describe('EXPERIENCE CONFLICT：只改观察焦点，不写因果（§50 / §26）', () => {
  it('plan 本身不动行动空间；focusOn 只记录 focusVariable', () => {
    const mechanics = initialSessionMechanics([action('action-a')]);
    const afterPlan = applyEncounterPlan(mechanics, {
      id: 'enc-conflict',
      type: 'experience_conflict',
      act: 3,
      sourceFactIds: ['fact:o1', 'fact:o2'],
      sourceCaseIds: ['case:a', 'case:b'],
      payload: {
        kind: 'experience_conflict',
        caseIds: ['case:a', 'case:b'],
        supportingFactIds: ['fact:o1', 'fact:o2'],
        candidateFocusVariables: ['队友', '时间'],
      },
    });
    expect(afterPlan.state.availableActionIds).toEqual(['action-a']);

    const focused = focusOn(afterPlan, '队友');
    expect(focused.state.focusVariables).toEqual(['队友']);
    // 记录的是「观察变量」，不是「队友就是原因」
    expect(Object.keys(focused.state)).not.toContain('causalConclusion');
  });
});

describe('核心状态不携带数值成长（§22）', () => {
  it('字段固定且不含经验 / 资源 / 技能', () => {
    const { state } = initialSessionMechanics([action('a')]);
    expect(Object.keys(state).sort()).toEqual([
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
});
