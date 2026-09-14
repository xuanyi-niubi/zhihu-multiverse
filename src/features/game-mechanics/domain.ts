import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  UnknownVariable,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Action Space Lite + Encounter 的领域契约（§五 / §九 / §十二 / §十五 / §十七 / §十八）。
 *
 * ## 它要解决的问题
 *
 * 一个玩家的成长，长期被写成「数值 +3」。但这不解决任何现实问题：
 * 玩家看完一条真实经历之后，真正发生的变化应该是
 *
 * ```text
 * 多看见一条路
 * 少一条不再可行的路
 * 发现一条必须回到现实验证的路
 * ```
 *
 * 于是本局唯一需要建模的核心状态是 **Action Space**：
 * 玩家现在知道自己可以怎么做。「真实经验」不再是一张卡片，
 * 而是改变这个空间的输入。
 *
 * ## 只放类型，不放逻辑
 *
 * 契约先被钉死，机制才谈得上可测试、可复现。所有规则都在各自的
 * 纯函数模块里（`actionSpace` / `pathReveal` / `costGate` /
 * `experienceCollision` / `unknownLock` / `encounterComposer` / `view`）。
 *
 * ## 全局禁止（写进类型里）
 *
 * 不恢复 Boss / D20 / SAN / SKILL / BOND / 数值 Relic —— 所以这里
 * 没有任何 hp / energy / level / sanity 之类的字段，一个也没有。
 */

/* -------------------------------------------------------------------------- */
/* 1. Action                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 一条行动的四种状态。
 *
 * ```text
 * available  本来就能做
 * unlocked   因为读过别人的真实经验，现在才看见
 * locked     还在，但暂时做不了（必须带 reason）
 * removed    这条路已经被真实代价关掉（默认不展示，但保留审计）
 * ```
 */
export type ActionState =
  | 'available'
  | 'unlocked'
  | 'locked'
  | 'removed';

/** 一条行动从哪来。 */
export type ActionOrigin =
  /** 情境本身给出的（用户原来就想到的做法）。 */
  | 'scenario'
  /** 真实经验解锁的（别人真的这么做过）。 */
  | 'experience'
  /** 反例带来的（别人这么做过，但结果不同）。 */
  | 'counterexample';

/**
 * 一个可执行的行动。
 *
 * `sourceFactIds` 是可追溯性的落点：凡是由真实经验造成的状态变化，
 * 都必须能点回原文。空的 `sourceFactIds` 只允许出现在 `scenario` 行动上。
 */
export interface PlayAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;

  readonly state: ActionState;
  readonly origin: ActionOrigin;

  readonly sourceFactIds: readonly string[];
  /** 为什么它不在可做状态（`locked` / `removed` 必须有）。 */
  readonly reason?: string;
}

/**
 * 行动空间：本局唯一的核心状态。
 *
 * 它是**扁平列表**而不是按状态分列 —— 一条行动同一时刻只处于一种状态，
 * 用 `state` 表达比用四个数组表达更难写出自相矛盾的状态。
 * `restoreState` 记录「被锁住之前它是什么状态」，供 `restoreAction` 精确还原。
 */
export interface ActionSpace {
  readonly actions: readonly PlayAction[];

  /** `locked` / `removed` 的行动被还原时回到哪个状态（审计与可逆性的落点）。 */
  readonly restoreState?: Readonly<Record<string, ActionState>>;
  /** 被锁住 / 移除之前的原始原因（还原时用于判断是否有可还原原因）。 */
  readonly restoreReason?: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* 2. COST GATE                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 容易解释的代价类型（§十）。
 *
 * **只允许这五种**。刻意不做复杂 NLP 因果引擎：如果一条 `cost` 事实
 * 无法安全映射到其中一种，就**不生成 gate** —— 宁可少一个机制，
 * 也不要一个解释不通的机制。
 */
export type CostCategory =
  /** 时间：这件事占掉了你的时间。 */
  | 'time'
  /** 钱：这件事花掉了你的钱。 */
  | 'money'
  /** 排他承诺：答应了就不能再答应别的。 */
  | 'exclusive-commitment'
  /** 责任负荷：你身上多了一份必须承担的责任。 */
  | 'responsibility-load'
  /** 时间表冲突：两件事在同一段时间上撞了。 */
  | 'schedule-conflict';

/**
 * 代价闸门：真实代价关闭了一条（或几条）行动。
 *
 * 这是 Action Space 的一次 **transition**，不独立占一个大 Stage（§十七）。
 * `reason` 与 `sourceFactId` 都是必填 —— 任何 lock / remove 都必须说得清
 * 「因为哪条真实代价」以及「用人话怎么讲」。
 */
export interface CostGate {
  readonly id: string;
  readonly sourceFactId: string;
  readonly targetActionIds: readonly string[];
  readonly effect: 'lock' | 'remove';
  readonly reason: string;

  /** 归类结果：只可能是 §十 那五种之一。 */
  readonly category: CostCategory;
}

/* -------------------------------------------------------------------------- */
/* 3. EXPERIENCE COLLISION                                                     */
/* -------------------------------------------------------------------------- */

/** 玩家可以选「接下来重点观察哪个变量」。 */
export interface CollisionFocus {
  readonly id: string;
  readonly label: string;
  readonly supportingDifferenceIds: readonly string[];
}

/**
 * 两段真实人生给出不同结果（第三幕核心交互，§十二）。
 *
 * 它**只指出分歧**，不裁决谁对。玩家选一个 focus 之后系统只记录
 * 「他在看哪个变量」，绝不写「这就是两个人结果不同的原因」（§十四）。
 */
export interface ExperienceCollision {
  readonly id: string;
  readonly primaryCaseId: string;
  readonly counterCaseId: string;

  readonly primaryFactIds: readonly string[];
  readonly counterFactIds: readonly string[];

  readonly focusCandidates: readonly CollisionFocus[];
  /** 这条 Collision 依据的真实差异（玩家选的 focus 必须落在这里面）。 */
  readonly supportingDifferenceIds: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 4. UNKNOWN LOCK                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 一条行动 / 世界线因为**现实未知**而暂时锁住（§十五-§十六）。
 *
 * 它不是 error。它表示：这里 AI 已经没有可靠现实信息继续判断，
 * 必须由玩家回到现实去验证。UI 上会显示 `REALITY REQUIRED`。
 */
export interface UnknownLock {
  readonly id: string;
  readonly label: string;
  readonly relatedActionIds: readonly string[];
  readonly realityRequired: true;
}

/* -------------------------------------------------------------------------- */
/* 5. Encounter                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 最终只有三种 Encounter（§十七）。
 *
 * COST GATE 刻意**不在**这里 —— 它是 Action Space 的一次转移，
 * 不是一次玩家观看的 Encounter。
 */
export type EncounterType =
  /** 真实经验 → 多看见一条路。 */
  | 'path-reveal'
  /** 两段真实人生给出不同结果 → 让玩家找差异。 */
  | 'experience-collision'
  /** AI 已经没有可靠现实信息 → 现实必需。 */
  | 'unknown-lock';

/**
 * 一条 Encounter 计划（§十八）。
 *
 * 它只是**调度层**：引用真实 fact / case，具体怎么画交给视觉线程。
 * 可选字段都是「给 ViewModel 消费的具体内容」，不是新的判断。
 */
export interface EncounterPlan {
  readonly id: string;
  readonly type: EncounterType;
  readonly act: 1 | 2 | 3;

  readonly sourceFactIds: readonly string[];
  readonly sourceCaseIds: readonly string[];

  /** `path-reveal`：复用现有 `ExperienceChoiceUnlock` 的 id（§七）。 */
  readonly unlockId?: string;
  /** `experience-collision`：两个真实 case 与可观察变量。 */
  readonly primaryCaseId?: string;
  readonly counterCaseId?: string;
  readonly focusCandidates?: readonly CollisionFocus[];
  /** `unknown-lock`：来自 `WorldBlueprint.keyUnknown`。 */
  readonly unknownId?: string;
  readonly unknownLabel?: string;
}

/* -------------------------------------------------------------------------- */
/* 6. Composer 输入                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 与 `ExperienceChoiceUnlock` 结构兼容的最小解锁来源（避免循环 import）。
 *
 * Composer **只消费**它，不再做第二套 AI synthesis（§七）。
 */
export interface ExperienceUnlockInput {
  readonly id: string;
  readonly label: string;
  readonly sourceFactIds: readonly string[];
  readonly choice: { readonly text: string; readonly hint: string };
  readonly availableFromAct: number;
}

/**
 * Composer 的输入（§十九）。
 *
 * 它是**纯数据**：facts / cases / differences / unlocks / keyUnknown
 * 全部来自已落地的 Experience Engine 与 WorldBlueprint 编译结果。
 * `frame` / `paths` 是可选的补充（旧调用方只传上面五个时同样成立）。
 */
export interface EncounterComposerInput {
  readonly facts: readonly ExperienceFact[];
  readonly cases: readonly ExperienceCase[];
  readonly differences: readonly UserDifference[];
  readonly unlocks: readonly ExperienceUnlockInput[];
  readonly keyUnknown: UnknownVariable | null;

  /** 可选：本局情境（用于 action-space 的 scenario 行动与更强排序）。 */
  readonly frame?: { readonly unknowns: readonly UnknownVariable[] };
  /** 可选：本局走法（用于补齐差异）。 */
  readonly paths?: readonly ExperiencePath[];
}
