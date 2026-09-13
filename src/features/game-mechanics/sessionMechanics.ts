import {
  applyConditionShift,
  buildInitialActionSpace,
  lockAction,
  removeAction,
  unlockAction,
} from '@/features/game-mechanics/actionSpace';
import type {
  ActionOption,
  ActionSpace,
  EncounterPlan,
  SessionMechanicsState,
} from '@/features/game-mechanics/domain';
import { releaseUnknownLock } from '@/features/game-mechanics/unknownLock';

/**
 * Play State 集成（§22 / §26 / §67-§70）。
 *
 * ## 只新增最小状态
 *
 * `SessionMechanicsState` 刻意**不增加**经验值 / 资源点 / 卡组 / 技能树。
 * 它是纯数据 + 纯函数，可以被现有 Play 状态机以最小侵入接入，
 * 而不重写任何 reducer、不影响 Legacy 行为。
 *
 * ## 每个重要选择都必须改变行动空间（§26）
 *
 * `applyEncounterPlan` 的每个分支都至少导致下面之一变化：
 * 新增 / 移除 / 锁定 / 解锁 Action，或 Focus Variable / Unknown 改变。
 * 否则这个 Choice 只是假互动。
 */

export interface SessionMechanics {
  readonly space: ActionSpace;
  readonly state: SessionMechanicsState;
}

const EMPTY_STATE: SessionMechanicsState = {
  activeEncounterId: null,
  availableActionIds: [],
  unlockedActionIds: [],
  removedActionIds: [],
  lockedActionIds: [],
  adoptedConditionKeys: [],
  focusVariables: [],
  unknownLocks: [],
};

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

/** 行动空间是 ids 的唯一真相来源；其余状态字段由它派生。 */
function sync(space: ActionSpace, state: SessionMechanicsState): SessionMechanicsState {
  return {
    ...state,
    availableActionIds: space.available.map((action) => action.id),
    unlockedActionIds: space.unlocked.map((unlocked) => unlocked.action.id),
    removedActionIds: space.removed.map((removed) => removed.action.id),
    lockedActionIds: space.locked.map((locked) => locked.action.id),
  };
}

export function initialSessionMechanics(
  actions: readonly ActionOption[],
  satisfiedConditionKeys: readonly string[] = [],
): SessionMechanics {
  const space = buildInitialActionSpace(actions, satisfiedConditionKeys);
  return {
    space,
    state: sync(space, {
      ...EMPTY_STATE,
      adoptedConditionKeys: uniqueSorted(satisfiedConditionKeys),
    }),
  };
}

/**
 * 把一条 Encounter 落进行动空间。
 *
 * 调用方（Play 状态机）只需要在「当前幕有 Encounter」时调用它，
 * 不需要理解各机制的内部规则。
 */
export function applyEncounterPlan(mechanics: SessionMechanics, plan: EncounterPlan): SessionMechanics {
  const { space, state } = mechanics;

  switch (plan.payload.kind) {
    case 'path_unlock': {
      const action: ActionOption = {
        id: `action-${plan.payload.unlockId}`,
        label: plan.payload.label,
        description: plan.payload.choiceText,
        source: 'experience',
        sourceFactIds: [...plan.sourceFactIds],
        requirements: [],
      };
      const nextSpace = unlockAction(space, action, {
        sourceFactIds: plan.sourceFactIds,
        encounterId: plan.id,
      });
      return { space: nextSpace, state: sync(nextSpace, { ...state, activeEncounterId: plan.id }) };
    }

    case 'condition_shift': {
      const keys = uniqueSorted([
        ...state.adoptedConditionKeys,
        ...plan.payload.changes.map((change) => change.variable),
      ]);
      const nextSpace = applyConditionShift(space, keys);
      return {
        space: nextSpace,
        state: sync(nextSpace, { ...state, activeEncounterId: plan.id, adoptedConditionKeys: keys }),
      };
    }

    case 'cost_reveal': {
      let nextSpace = space;
      for (const actionId of plan.payload.affectedActionIds) {
        nextSpace =
          plan.payload.effect === 'lock'
            ? lockAction(nextSpace, actionId, 'opportunity_cost', plan.payload.explanation)
            : removeAction(nextSpace, actionId, plan.payload.explanation);
      }
      return { space: nextSpace, state: sync(nextSpace, { ...state, activeEncounterId: plan.id }) };
    }

    case 'unknown_lock': {
      let nextSpace = space;
      for (const actionId of plan.payload.affectsActionIds) {
        nextSpace = lockAction(nextSpace, actionId, 'unknown_variable', plan.payload.explanation, {
          unknownId: plan.payload.unknownId,
        });
      }
      return {
        space: nextSpace,
        state: sync(nextSpace, {
          ...state,
          activeEncounterId: plan.id,
          unknownLocks: uniqueSorted([...state.unknownLocks, plan.payload.unknownId]),
        }),
      };
    }

    case 'experience_conflict':
      // 冲突不改变行动空间本身，它改变玩家接下来重点观察什么。
      return { space, state: { ...state, activeEncounterId: plan.id } };
  }
}

/**
 * 玩家在 EXPERIENCE CONFLICT 里选了一个变量。
 *
 * 只写 `focusVariable`，**不写因果结论**（§50）。
 */
export function focusOn(mechanics: SessionMechanics, variable: string): SessionMechanics {
  if (variable.trim().length === 0) {
    return mechanics;
  }
  return {
    space: mechanics.space,
    state: {
      ...mechanics.state,
      focusVariables: uniqueSorted([...mechanics.state.focusVariables, variable]),
    },
  };
}

/**
 * 现实回填：某个未知被验证后，相关锁定解除（§58）。
 */
export function resolveUnknown(mechanics: SessionMechanics, unknownId: string): SessionMechanics {
  const nextSpace = releaseUnknownLock(mechanics.space, unknownId);
  return {
    space: nextSpace,
    state: sync(nextSpace, {
      ...mechanics.state,
      unknownLocks: mechanics.state.unknownLocks.filter((id) => id !== unknownId),
    }),
  };
}
