import type {
  ActionOrigin,
  ActionSpace,
  ActionState,
  CollisionFocus,
  EncounterPlan,
  ExperienceCollision,
  PlayAction,
  UnknownLock,
} from '@/features/game-mechanics/domain';
import { getVisibleActions } from '@/features/game-mechanics/actionSpace';

/**
 * Gameplay ViewModel（§二十三）。
 *
 * 玩法线程只负责**提供数据**；React 不应该自己推断 source facts。
 * 所以这里把所有需要「解释」的东西（来源标签、原因、focus 候选）
 * 一次性算好，UI 只做渲染。
 *
 * 本文件不引入 React，也不碰任何视觉组件。
 */

/** 行动来源 → 给玩家看的来源标签。UI 直接显示，不做二次判断。 */
export const ACTION_SOURCE_LABELS: Readonly<Record<ActionOrigin, string>> = {
  scenario: '本来的处境',
  experience: '真实经验',
  counterexample: '反例经验',
};

export interface ActionView {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly state: ActionState;
  readonly sourceLabel?: string;
  readonly reason?: string;
}

export interface CollisionView {
  readonly primaryCaseId: string;
  readonly counterCaseId: string;
  readonly focusCandidates: readonly { readonly id: string; readonly label: string }[];
}

export interface UnknownView {
  readonly id: string;
  readonly label: string;
}

/**
 * 一条行动 → UI 视图。
 *
 * `sourceLabel` 对 `scenario` 行动**不出现**（本来就在的处境不需要解释
 * 「它从哪来」）；只有经验 / 反例带来的行动才标来源。
 */
export function actionViewOf(action: PlayAction): ActionView {
  const sourceLabel =
    action.origin === 'scenario' ? undefined : ACTION_SOURCE_LABELS[action.origin];

  return {
    id: action.id,
    label: action.label,
    ...(action.description !== undefined ? { description: action.description } : {}),
    state: action.state,
    ...(sourceLabel !== undefined ? { sourceLabel } : {}),
    ...(action.reason !== undefined ? { reason: action.reason } : {}),
  };
}

/**
 * 行动空间 → UI 视图列表。
 *
 * **`removed` 默认不展示**（§六）；保留审计请直接用 `getAuditActions`。
 */
export function actionViewsOf(space: ActionSpace): readonly ActionView[] {
  return getVisibleActions(space).map(actionViewOf);
}

/** 两段真实人生 → Collision 视图（focus 只给 id + label，**不给因果解释**）。 */
export function collisionViewOf(collision: ExperienceCollision): CollisionView {
  return {
    primaryCaseId: collision.primaryCaseId,
    counterCaseId: collision.counterCaseId,
    focusCandidates: collision.focusCandidates.map((focus: CollisionFocus) => ({
      id: focus.id,
      label: focus.label,
    })),
  };
}

/** 未知 → Unknown 视图（UI 据此显示 `REALITY REQUIRED`）。 */
export function unknownViewOf(lock: UnknownLock): UnknownView {
  return { id: lock.id, label: lock.label };
}

/** Encounter 计划 → Collision 视图；不是 collision 类型时返回 `null`。 */
export function collisionViewOfPlan(plan: EncounterPlan): CollisionView | null {
  if (plan.type !== 'experience-collision' || !plan.primaryCaseId || !plan.counterCaseId) {
    return null;
  }
  return {
    primaryCaseId: plan.primaryCaseId,
    counterCaseId: plan.counterCaseId,
    focusCandidates: (plan.focusCandidates ?? []).map((focus) => ({
      id: focus.id,
      label: focus.label,
    })),
  };
}

/** Encounter 计划 → Unknown 视图；不是 unknown-lock 类型时返回 `null`。 */
export function unknownViewOfPlan(plan: EncounterPlan): UnknownView | null {
  if (plan.type !== 'unknown-lock' || !plan.unknownId) {
    return null;
  }
  return { id: plan.unknownId, label: plan.unknownLabel ?? plan.unknownId };
}
