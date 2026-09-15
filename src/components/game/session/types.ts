import type { RealityExperiment } from '@/features/decision-session/domain';
import type { ExperienceFact } from '@/features/experience/domain';
import type { EndgameAnswer } from '@/features/game-world/endgameAnswer';
import type { ExperienceCardData } from '@/components/game/ExperienceCardPanel';
import { AI_UNAVAILABLE } from '@/features/run/errorCopy';
import type { CharacterOnStage, SceneId, SpeakerId } from '@/types/narrative';

/**
 * Session 主链的 **UI 契约**（Agent 03 §六 / §八 / §十七 / §十八 / §十九 / §二十六）。
 *
 * ## 为什么这一层单独存在
 *
 * 旧的 `play/page.tsx` 把「新主链逻辑 + 旧 RPG UI + legacy runtime」写在一棵树上：
 * 一个屏幕能看到 Boss、骰子、命途树、遗物、属性条、证据网格。新主链只想要
 * 四样东西 —— **幕 / 场景 / 选项 / 借来的经验**。
 *
 * 拆分的关键不是把 JSX 剪开，而是**先钉死接口**：
 *
 * ```text
 * reducer 状态 + WorldBlueprint
 *   →（viewModel.ts，纯函数）
 *   → SessionPlayView                 ← 本文件
 *   → React 组件（只渲染，不碰 reducer、不碰旧 UI）
 * ```
 *
 * ## 三条纪律
 *
 * 1. **窄**：组件拿到的不是 `RunState`，而是几个只读视图。想在新屏里用
 *    旧状态（SAN / 骰面 / 遗物）必须先在类型上写一行 —— 类型系统成了护栏。
 * 2. **不编事实**：所有文案要么来自真实数据（题目 / 引文 / 蓝图），要么是
 *    固定的 UI 文案（ACT I 走进去）。这里没有「大概怎么样」的字段。
 * 3. **只放类型**：任何判断都住在 `viewModel.ts`，因为只有纯函数才可被测试钉死。
 */

/* -------------------------------------------------------------------------- */
/* 1. 幕                                                                        */
/* -------------------------------------------------------------------------- */

/** 三幕目标，与 `WorldActSpec.objective` 同口径（不含终局：终局不是第四幕）。 */
export type SessionActObjective = 'enter-world' | 'experience-cost' | 'meet-counterexample';

/** 三幕固定文案（§十二）：内部事实源仍然是 blueprint，文案只是它的皮。 */
export interface SessionActHeading {
  /** `01` / `02` / `03`。 */
  readonly number: string;
  /** `ACT I` / `ACT II` / `ACT III`。 */
  readonly roman: string;
  /** `走进去` / `代价出现` / `另一个答案`。 */
  readonly label: string;
}

/* -------------------------------------------------------------------------- */
/* 2. Loading / Error（§二十五 / §二十六）                                       */
/* -------------------------------------------------------------------------- */

/**
 * 语义化 loading（§二十六）。
 *
 * 刻意不是 `loading: boolean`：屏幕需要知道「在等什么」才能说人话
 * （「正在编译你的世界」≠「正在结算这一次选择」）。
 * 视觉怎么画由 Agent 04 决定。
 */
export type SessionLoadingPhase =
  | 'loading-session'
  | 'generating-scene'
  | 'resolving-choice'
  | 'loading-experience'
  | null;

/**
 * 统一的失败态文案（§二十五 / 05_AGENT §9）。
 *
 * 技术性错误只走 `console.error`，屏幕上永远是这一句 ——
 * 玩家不应该看到 stack，也不应该看到 provider 的名字。
 *
 * 文案从 `features/run/errorCopy` 取单一事实源：主链的「AI 暂时不可用」
 * 与这里的失败态必须是同一句，否则同一个故障会出现两种说法。
 */
export const SESSION_ERROR_MESSAGE = AI_UNAVAILABLE.title;

/* -------------------------------------------------------------------------- */
/* 3. Story（§十四）                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 叙事舞台。
 *
 * DM 现在只返回一段 `narrative`，所以这里**不强行拆结构**：`text` 是事实，
 * `phrases` 只是它的句读切分（ViewModel 做的轻量 parser），
 * 既不新增字段，也不改动原文一个字。
 */
export interface SessionStoryView {
  readonly scene: {
    readonly sceneId: SceneId;
    readonly timeLabel: string;
  };
  readonly speaker: SpeakerId | null;
  readonly stage: readonly CharacterOnStage[];
  readonly title: string;
  readonly text: string;
  /** 句读分段：每句一个 `<span>`，用于错位淡入（§十二）。 */
  readonly phrases: readonly string[];
  /** 本幕张力（来自 blueprint 的 `conflict`）；没有就不显示。 */
  readonly tension: string | null;
}

/* -------------------------------------------------------------------------- */
/* 4. Choice（§八 / §九 / §十 / §十一）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 一条选项的三种状态。
 *
 * ```text
 * available  本来就能做
 * unlocked   因为读过别人的真实经历，现在才看见（必须带 source）
 * locked     还在，但暂时做不了（必须带 reason）
 * ```
 */
export type SessionChoiceState = 'available' | 'unlocked' | 'locked';

/**
 * 选项视图（§八）。**普通选项只展示 title / description** ——
 * 底下的 `check` / DC / 骰面 / 属性一律不进入这个类型，
 * 所以「不小心把 DC 显示出来」在类型层就不可能发生（§九）。
 */
export interface SessionChoiceView {
  readonly id: string;
  readonly title: string;
  readonly description?: string;

  readonly state: SessionChoiceState;

  /** `state === 'unlocked'` 时必填：来自真实经历（§十）。 */
  readonly sourceLabel?: string;
  /** `state === 'locked'` 时必填：为什么现在做不了（§十一）。 */
  readonly lockedReason?: string;

  /**
   * 解锁这条选项的那段真实经历（可点回原文）。
   *
   * 注意：它是 `ExperienceChoiceUnlock.id`，不是 ExperienceCase.id ——
   * 弹层按它引用的 `sourceFactIds` 现取原文，所以蓝图更新后弹层也永远最新。
   */
  readonly experienceId?: string;
  readonly sourceFactIds?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 5. Experience（§十五 / §十六）                                                */
/* -------------------------------------------------------------------------- */

/** 经验卡的最小视图。数据映射仍由非视觉层的 `cardDataFrom` 产出（§十六）。 */
export interface SessionExperienceView {
  readonly id: string;
  /** 卡抬头（例如「先验证，再下注」）；没有就退回中性兜底。 */
  readonly title: string;
  readonly author: string;
  readonly sourceUrl: string;
  /** 被引用到的那几句话（用于 Dock 里的一行摘要）。 */
  readonly summary: string;
}

/* -------------------------------------------------------------------------- */
/* 6. Encounter（§十七 / §十八）                                                 */
/* -------------------------------------------------------------------------- */

/** 冲突分屏（§十七）：两条真实走法并列，只比相同 / 不同 / 未知。 */
export interface SessionCollisionView {
  readonly primary: {
    readonly id: string;
    readonly label: string;
    readonly quotes: readonly string[];
  };
  readonly counter: {
    readonly id: string;
    readonly label: string;
    readonly quotes: readonly string[];
  };
  /**
   * 玩家可以选「接下来重点观察哪个变量」。
   *
   * 它是**观察焦点**，不是结论（§十七）：点它只写 `focusVariable`，
   * 既不打分，也不给出因果。
   */
  readonly focuses: readonly { readonly id: string; readonly label: string }[];
  readonly activeFocusId: string | null;
}

/** 未知锁（§十八）：现实信息不足，不给答案、不重投、不付费解锁。 */
export interface SessionUnknownView {
  readonly unknownLabel: string;
  readonly explanation: string;
  /** 因为现实未知而暂时做不了的行动（只读展示）。 */
  readonly blockedActions: readonly string[];
}

/**
 * 本幕的 Encounter。
 *
 * `null` 表示本幕没有 Encounter —— **允许为空**（§五十九：证据不足时
 * 允许 0 个，绝不强行填满）。为此页面不显示任何分屏 / 锁面板。
 */
export type SessionEncounterView =
  | { readonly type: 'experience-collision'; readonly collision: SessionCollisionView }
  | { readonly type: 'unknown-lock'; readonly unknown: SessionUnknownView };

/* -------------------------------------------------------------------------- */
/* 7. Endgame（§十九 - §二十二）                                                  */
/* -------------------------------------------------------------------------- */

/** Reality Pass（§二十二）：只展示 timebox + action + 1~2 个信号，其余折叠。 */
export interface SessionRealityPassView {
  /** 真实的 `experiment.timebox` —— **不写死「未来 7 天」**。 */
  readonly timebox: string;
  readonly action: string;
  /** 会留下什么（默认折叠）。 */
  readonly artifact: string;
  readonly successSignal: string;
  readonly stopSignal: string;
}

/**
 * 终局视图（§十九）。顺序就是字段顺序：
 *
 * ```text
 * 1. 原问题          originalQuestion
 * 2. 现在真正值得验证的问题  rewrittenQuestion
 * 3. 本局多看见的行动     unlockedActions
 * 4. 真实经验回顾       experiences
 * 5. Reality Pass    realityPass
 * ```
 */
export interface SessionEndgameView {
  /**
   * 玩家开始时问的那句话（§二十）。
   *
   * 直接来自 DecisionSession，**不允许模型润色后覆盖** ——
   * 这条纪律在 viewModel 里由「只读 session.question」保证。
   */
  readonly originalQuestion: string;
  /**
   * 现在真正值得验证的问题（§二十一）。
   *
   * 优先取 blueprint 的 `keyUnknown`；没有就如实为 null，
   * 页面显示「这一局没有收敛出一个未知」，而不是编一个问题。
   */
  readonly rewrittenQuestion: string | null;
  /** 本局你做过的行动（按顺序）。 */
  readonly steps: readonly string[];
  /** 真实经验替你解锁、而你真的用过的行动（§十四 / §十五）。 */
  readonly unlockedActions: readonly string[];
  /** 有出处的回顾条目。 */
  readonly highlights: readonly string[];
  /** 真实经验回顾（§十九 第 4 项）。 */
  readonly experiences: readonly SessionExperienceView[];
  /**
   * 凝练出来的终局答案（P1-2 加强）。
   *
   * 由**本局真实发生过的事**编译：你问的原句、你补的硬条件、你走过的路、
   * 你采用过的真实经验、他们的逐字片段与代价、仍不知道的那一项、以及
   * 要验证的一件事。纯函数产出（`game-world/endgameAnswer.ts`），零模型。
   * 旧会话没有这一层时为 null，页面按「只有现实支线」降级。
   */
  readonly answer: EndgameAnswer | null;
  /** 带回现实的票；没有实验时为 null（不编一个七天计划）。 */
  readonly realityPass: SessionRealityPassView | null;
}

/* -------------------------------------------------------------------------- */
/* 8. Source modal（§二十三）                                                    */
/* -------------------------------------------------------------------------- */

export interface SessionDifferenceView {
  readonly variable: string;
  readonly relation: 'same' | 'different' | 'unknown';
  readonly userValue?: string;
  readonly experienceValue?: string;
}

export interface SessionSourceView {
  readonly open: boolean;
  readonly facts: readonly ExperienceFact[];
  readonly differences: readonly SessionDifferenceView[];
}

/* -------------------------------------------------------------------------- */
/* 9. 整屏视图（§六 / §七）                                                       */
/* -------------------------------------------------------------------------- */

/** 屏幕阶段（§六）。reducer 的内部阶段被折叠成这四种。 */
export type SessionPhase = 'story' | 'choice' | 'reflection' | 'ended';

export interface SessionPlayView {
  readonly sessionId: string;
  /** 用户的原始问题（终局第 1 项的事实源）。 */
  readonly question: string;

  readonly act: {
    /** 0 基幕下标 —— 与 `blueprint.acts[]` 同基，与 DM 协议同基。 */
    readonly index: number;
    /** 显示用幕号（1 基）。**全仓唯一的 +1 落点**（§十三）。 */
    readonly display: number;
    readonly total: number;
    readonly objective: SessionActObjective;
    readonly heading: SessionActHeading;
    /** 蓝图给出的本幕副标题。 */
    readonly subtitle: string;
  };

  readonly story: SessionStoryView;
  /** 上一次选择的结果（`phase === 'reflection'` 时有值）。 */
  readonly outcome: { readonly title: string; readonly detail: string } | null;
  readonly phase: SessionPhase;
  readonly choices: readonly SessionChoiceView[];
  /**
   * 本局**真正用到**的经验卡（§十五）。
   *
   * 刻意仍然用 `ExperienceCardData`：那是既有的数据映射产物
   * （`cardDataFrom`，纯函数、非视觉层）。拆一张平行结构只会让
   * 「卡片显示什么」出现两个事实源。
   */
  readonly experiences: readonly ExperienceCardData[];
  /** 每张卡的抬头（§二十四），键是 `card.id`。 */
  readonly cardTitles: Readonly<Record<string, string>>;

  readonly encounter: SessionEncounterView | null;

  /**
   * 本幕的 **UNKNOWN LOCK**（§十八），与 `encounter` 分开取。
   *
   * 为什么不能塞进 `encounter`：第三幕**可以同时**有反例（COLLISION）和
   * 未知（UNKNOWN LOCK）—— 反例是这一幕的交互，未知是这一幕的收尾。
   * 一个字段只能装一个，于是未知会被吃掉；真实对局里正是如此
   * （`composeEncounters` 会给第三幕同时发 collision 与 unknown-lock）。
   *
   * 分工：
   * ```text
   * encounter    一幕中间那一块 Stage（反例分屏；没有反例时才是未知）
   * unknownLock  一幕结束时的诚实收尾：「推演到此为止，其余回到现实验证」
   * ```
   */
  readonly unknownLock: SessionUnknownView | null;

  /** 第三幕反例分屏（§二十 / §二十一 的叙事转场）。 */
  readonly counterFrame: {
    readonly previousLabel: string;
    readonly counterLabel: string;
    readonly rows: readonly { readonly kind: 'same' | 'different' | 'unknown'; readonly text: string }[];
  } | null;

  readonly loading: boolean;
  readonly loadingPhase: SessionLoadingPhase;
  /** 非空即进入统一失败态（§二十五）。技术细节只进 console。 */
  readonly error: string | null;

  readonly endgame: SessionEndgameView | null;
  readonly source: SessionSourceView;
}

/**
 * 屏幕 props（§六）。
 *
 * 这里**没有** `RunState`、没有 stats、没有 inventory —— 新主链的整棵树
 * 只能从这些字段里长出来。`?` 的两个回调是可选能力（没有对应
 * Encounter 时页面不传，组件也就不渲染那块）。
 */
export interface SessionPlayScreenProps {
  readonly view: SessionPlayView;

  readonly onChoose: (choiceId: string) => void;
  readonly onAdvance: () => void;
  readonly onResolveCheck: () => void;
  readonly onQuit: () => void;
  /** 失败态的「重试」。 */
  readonly onRetry?: () => void;
  /** 失败态的「返回修改问题」。 */
  readonly onBackToQuestion?: () => void;

  readonly onOpenSource: (choiceId: string) => void;
  readonly onCloseSource: () => void;

  /** 冲突分屏：只更新 focusVariable（§十七）。 */
  readonly onSelectCollisionFocus?: (focusId: string) => void;
  /** 未知锁：继续到终局（§十八）。 */
  readonly onContinueFromUnknown?: () => void;
}
