/**
 * Action Space System 的领域契约（玩法线程 §17-§25 / §40）。
 *
 * ## 它要解决的问题
 *
 * 三幕玩法如果长期固定成「看故事 → 看经验卡 → 解锁一个选项 → 看反例」，
 * 玩第二局就能猜到套路。正确的方向不是恢复 D20 / SAN / Boss / 属性，
 * 而是换一个核心状态：
 *
 * ```text
 * 传统 RPG 成长 = 数值变高
 * 知乎平行宇宙成长 = 多看见真实可行动的路径
 * ```
 *
 * 于是「玩家现在知道自己可以怎么做」成为唯一需要建模的东西：
 * Action Space。真实经验解锁原本不存在的行动，真实代价关闭一些行动，
 * 未解的现实变量暂时锁住一条世界线。
 *
 * ## 只放 types
 *
 * 这个文件刻意不包含任何逻辑（规则在各自的模块里），
 * 因为契约先被钉死，机制才谈得上可测试、可复现。
 */

/** 五种 Encounter，仅此五种（§3 / §13）。 */
export type EncounterType =
  | 'path_unlock'
  | 'condition_shift'
  | 'experience_conflict'
  | 'cost_reveal'
  | 'unknown_lock';

/* -------------------------------------------------------------------------- */
/* 1. Action Space                                                             */
/* -------------------------------------------------------------------------- */

/** 一个行动从哪来：用户原生的 / 真实经验解锁的 / 反例带来的。 */
export type ActionSource = 'user' | 'experience' | 'counterexample';

/** 一个行动成立需要满足的条件（用条件 key 表达，不用数值）。 */
export interface ActionRequirement {
  readonly key: string;
  readonly description?: string;
}

/**
 * 一个可执行的行动选项。
 *
 * `sourceFactIds` 是可追溯性的落点：经验解锁的行动必须能点回原文。
 */
export interface ActionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;

  readonly source: ActionSource;
  readonly sourceFactIds: readonly string[];

  readonly requirements: readonly ActionRequirement[];
}

/** 一条行动为什么不可用。 */
export type LockReason = 'missing_condition' | 'unknown_variable' | 'opportunity_cost';

/** 被锁住的行动。`explanation` 必须是人话 —— 不做隐藏惩罚（§47）。 */
export interface LockedAction {
  readonly action: ActionOption;
  readonly reason: LockReason;
  readonly conditionKey?: string;
  readonly unknownId?: string;
  readonly explanation: string;
}

/** 被真实经验解锁出来的行动。 */
export interface UnlockedAction {
  readonly action: ActionOption;
  readonly unlockedBy: 'experience';
  readonly sourceFactIds: readonly string[];
  readonly encounterId?: string;
}

/** 被代价关闭的行动。 */
export interface RemovedAction {
  readonly action: ActionOption;
  readonly reason: 'opportunity_cost';
  readonly explanation: string;
}

/**
 * 行动空间：本局唯一的核心状态（§19）。
 *
 * 玩家进入时只有 `available`（原本想到的做法）；真实经验出现后
 * `unlocked` 里多出行动；代价出现后 `removed` / `locked` 增加。
 */
export interface ActionSpace {
  readonly available: readonly ActionOption[];
  readonly locked: readonly LockedAction[];
  readonly unlocked: readonly UnlockedAction[];
  readonly removed: readonly RemovedAction[];
}

/* -------------------------------------------------------------------------- */
/* 2. Encounter payload                                                        */
/* -------------------------------------------------------------------------- */

/** PATH UNLOCK：真实行动 → 原本不存在的选择（§4 / §35）。 */
export interface PathUnlockPayload {
  readonly kind: 'path_unlock';
  /** 复用现有 `ExperienceChoiceUnlock` 的 id。 */
  readonly unlockId: string;
  readonly label: string;
  readonly choiceText: string;
  readonly hint: string;
}

/**
 * CONDITION SHIFT 的一条借用条件（§5-§6 / §23-§24）。
 *
 * `hypothetical: true` 是硬约束：借用条件只存在于当前游戏世界，
 * 永远不能写回 `userContext`，也不能被后续模型当成用户真实事实。
 */
export interface ConditionShiftChange {
  readonly variable: string;
  readonly hypothetical: true;
  readonly userValue?: string;
  readonly experienceValue?: string;
  readonly description: string;
}

export interface ConditionShiftPayload {
  readonly kind: 'condition_shift';
  readonly changes: readonly ConditionShiftChange[];
}

/** EXPERIENCE CONFLICT：两段真实人生给出不同经验（§7-§8）。 */
export interface ExperienceConflictPayload {
  readonly kind: 'experience_conflict';
  readonly caseIds: readonly string[];
  readonly supportingFactIds: readonly string[];
  /** 玩家可以选择的「接下来重点观察哪个变量」，**不是结论**（§50）。 */
  readonly candidateFocusVariables: readonly string[];
}

/** COST REVEAL 的效果：关闭一条行动，但不扣数值（§9 / §25）。 */
export type CostRevealEffect = 'lock' | 'remove';

export interface CostRevealPayload {
  readonly kind: 'cost_reveal';
  readonly effect: CostRevealEffect;
  readonly affectedActionIds: readonly string[];
  readonly explanation: string;
}

/** UNKNOWN LOCK：一条 Action / Worldline 因现实未知而暂时锁住（§11-§12）。 */
export interface UnknownLockPayload {
  readonly kind: 'unknown_lock';
  readonly unknownId: string;
  readonly unknownLabel: string;
  readonly affectsActionIds: readonly string[];
  readonly explanation: string;
}

export type EncounterPayload =
  | PathUnlockPayload
  | ConditionShiftPayload
  | ExperienceConflictPayload
  | CostRevealPayload
  | UnknownLockPayload;

/* -------------------------------------------------------------------------- */
/* 3. Encounter Plan                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 一条 Encounter 计划（§18）。
 *
 * Encounter 只是**调度层**：它引用真实 fact / case / difference / unknown，
 * 具体怎么画交给视觉线程（§39-§40）。
 */
export interface EncounterPlan {
  readonly id: string;
  readonly type: EncounterType;
  readonly act: 1 | 2 | 3;

  readonly sourceFactIds: readonly string[];
  readonly sourceCaseIds: readonly string[];

  readonly requiredDifferenceKeys?: readonly string[];
  readonly unknownId?: string;

  readonly payload: EncounterPayload;
}

/* -------------------------------------------------------------------------- */
/* 4. Session mechanics state                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 游戏状态只增加最小字段（§22）。
 *
 * 刻意**不增加**经验值 / 资源点 / 卡组 / 技能树 —— 这套系统的成长
 * 是「多看见一条路」，不是数值变高。
 */
export interface SessionMechanicsState {
  readonly activeEncounterId: string | null;

  readonly availableActionIds: readonly string[];
  readonly unlockedActionIds: readonly string[];
  readonly removedActionIds: readonly string[];
  readonly lockedActionIds: readonly string[];

  readonly adoptedConditionKeys: readonly string[];
  readonly focusVariables: readonly string[];
  readonly unknownLocks: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 5. UI 最小接口（§40）                                                        */
/* -------------------------------------------------------------------------- */

export interface EncounterOptionView {
  readonly id: string;
  readonly label: string;
}

/**
 * 给视觉线程消费的最小 ViewModel。
 *
 * 本线程只负责产出这个结构；动画 / CSS / SVG 由视觉线程决定。
 */
export interface EncounterView {
  readonly type: EncounterType;
  readonly title: string;
  readonly description?: string;

  readonly options?: readonly EncounterOptionView[];
  readonly relatedExperienceIds: readonly string[];

  readonly unknown?: string;
}
