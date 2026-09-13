import type {
  ActionOption,
  ActionSpace,
  EncounterPlan,
  EncounterView,
} from '@/features/game-mechanics/domain';

/**
 * UI ViewModel（§40 / §71-§72）。
 *
 * 玩法线程只负责**提供数据**：具体怎么画（动画 / CSS / SVG / 组件）
 * 交给视觉线程。这里不引入任何 React，也不碰视觉组件。
 */

export interface ActionSpaceItemView {
  readonly id: string;
  readonly label: string;
  readonly source: ActionOption['source'];
  readonly description?: string;
}

export interface LockedActionView {
  readonly id: string;
  readonly label: string;
  readonly reason: 'missing_condition' | 'unknown_variable' | 'opportunity_cost';
  readonly explanation: string;
}

export interface RemovedActionView {
  readonly id: string;
  readonly label: string;
  readonly explanation: string;
}

export interface ActionSpaceView {
  readonly available: readonly ActionSpaceItemView[];
  readonly unlocked: readonly ActionSpaceItemView[];
  readonly locked: readonly LockedActionView[];
  readonly removed: readonly RemovedActionView[];
}

function itemView(action: ActionOption): ActionSpaceItemView {
  return {
    id: action.id,
    label: action.label,
    source: action.source,
    ...(action.description !== undefined ? { description: action.description } : {}),
  };
}

export function actionSpaceViewOf(space: ActionSpace): ActionSpaceView {
  return {
    available: space.available.map(itemView),
    unlocked: space.unlocked.map((unlocked) => itemView(unlocked.action)),
    locked: space.locked.map((locked) => ({
      id: locked.action.id,
      label: locked.action.label,
      reason: locked.reason,
      explanation: locked.explanation,
    })),
    removed: space.removed.map((removed) => ({
      id: removed.action.id,
      label: removed.action.label,
      explanation: removed.explanation,
    })),
  };
}

/** Encounter → 前端最小 ViewModel。 */
export function encounterViewOf(plan: EncounterPlan): EncounterView {
  const relatedExperienceIds = [...plan.sourceFactIds];

  switch (plan.payload.kind) {
    case 'path_unlock':
      return {
        type: plan.type,
        title: '真实经验解锁了一条新行动',
        description: plan.payload.choiceText,
        relatedExperienceIds,
      };

    case 'condition_shift':
      return {
        type: plan.type,
        title: '借用另一个人的条件试试',
        description: '这是游戏中的反事实实验，不是现实预测。',
        options: plan.payload.changes.map((change) => ({
          id: change.variable,
          label: change.variable,
        })),
        relatedExperienceIds,
      };

    case 'experience_conflict':
      return {
        type: plan.type,
        title: '两个人的经验互相矛盾',
        description: '这里没有标准答案 —— 你更想继续观察哪一个变量？',
        options: plan.payload.candidateFocusVariables.map((variable) => ({
          id: variable,
          label: variable,
        })),
        relatedExperienceIds,
      };

    case 'cost_reveal':
      return {
        type: plan.type,
        title: '有些路已经被代价关闭',
        description: plan.payload.explanation,
        relatedExperienceIds,
      };

    case 'unknown_lock':
      return {
        type: plan.type,
        title: '这条世界线还不能确认',
        description: plan.payload.explanation,
        unknown: plan.payload.unknownLabel,
        relatedExperienceIds,
      };
  }
}
