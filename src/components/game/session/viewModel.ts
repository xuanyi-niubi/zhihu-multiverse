import type { ActionSpace, PlayAction } from '@/features/game-mechanics/domain';
import type { RealityExperiment } from '@/features/decision-session/domain';
import type { ExperienceCase } from '@/features/experience/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';
import type { ExperienceCardData } from '@/components/game/ExperienceCardPanel';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';
import type { CharacterOnStage, SceneId, SpeakerId } from '@/types/narrative';

import type {
  SessionActHeading,
  SessionActObjective,
  SessionChoiceView,
  SessionEndgameView,
  SessionEncounterView,
  SessionExperienceView,
  SessionLoadingPhase,
  SessionPhase,
  SessionPlayView,
  SessionRealityPassView,
  SessionSourceView,
  SessionStoryView,
} from '@/components/game/session/types';
import { SESSION_ERROR_MESSAGE } from '@/components/game/session/types';

/** 统一失败态文案：从契约文件转出，保证只有一处定义（§二十五）。 */
export { SESSION_ERROR_MESSAGE };

/**
 * Session 主链的 ViewModel（Agent 03 §七 / §十三 / §十四）。
 *
 * ## 为什么要有这一层
 *
 * ```text
 * legacy/current runtime state + WorldBlueprint + Gameplay View
 *   → Session UI View
 * ```
 *
 * React 组件只负责渲染。所有「这一段该怎么读」的判断都住在这里，
 * 因为**纯函数才能被测试钉死**：
 *
 * - 幕号只有一个 `+1` 落点（§十三：禁止散落多个 +1 / -1）；
 * - 普通选项不带 check / DC / 骰面（§九）；
 * - 解锁选项必须有来源、锁定选项必须有原因（§十 / §十一）；
 * - 冲突只给焦点、不给结论（§十七）；未知不给答案（§十八）；
 * - 终局用原问题、Reality Pass 用真实 timebox（§二十 / §二十二）。
 *
 * 这个文件**不引入 React**，也不 import 任何视觉组件。
 */

/* -------------------------------------------------------------------------- */
/* 1. 幕号：全仓唯一的 +1 落点（§十三）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 显示用幕号（1 基）。
 *
 * UI 的 `actIndex` 是 **0 基**，与 `WorldBlueprint.acts[]` 同基、与 DM 协议同基；
 * 只有要显示给人看时才 +1。**这是全仓唯一的 +1 落点** ——
 * 任何地方再写一次 `actIndex + 1` 都是 bug。
 */
export function displayActNumber(actIndex: number): number {
  const normalized = Math.floor(Number.isFinite(actIndex) ? actIndex : 0);
  return Math.max(0, normalized) + 1;
}

/**
 * DM / reducer 的 **1 基** `turnIndex` → UI 的 **0 基** `actIndex`。
 *
 * 这是唯一的 -1 落点。`turnIndex <= 0` 时钳到 0（第一幕），
 * 绝不产出 `Act 0`（Agent 06 §十二 的验收项）。
 */
export function actIndexFromTurn(turnIndex: number): number {
  const normalized = Math.floor(Number.isFinite(turnIndex) ? turnIndex : 1);
  return Math.max(0, normalized - 1);
}

/** 三幕固定 UI 文案（§十二）。内部事实源仍然是 blueprint objective。 */
export const ACT_HEADINGS: Readonly<Record<SessionActObjective, SessionActHeading>> = {
  'enter-world': { number: '01', roman: 'ACT I', label: '走进去' },
  'experience-cost': { number: '02', roman: 'ACT II', label: '代价出现' },
  'meet-counterexample': { number: '03', roman: 'ACT III', label: '另一个答案' },
};

export function actHeadingOf(objective: SessionActObjective): SessionActHeading {
  return ACT_HEADINGS[objective] ?? ACT_HEADINGS['enter-world'];
}

/**
 * 蓝图里取某一幕的目标；越界钳到最后一幕（反例幕），与 DM 同口径。
 *
 * 入参刻意只要「一组带 objective 的幕」：这个 helper 只关心目标，
 * 不需要 titleHint / conflict / primaryPathIds，因此也不必伪装成完整蓝图。
 */
export function actObjectiveAt(
  blueprint: { readonly acts: readonly { readonly objective: SessionActObjective }[] },
  actIndex: number,
): SessionActObjective {
  const acts = blueprint.acts;
  if (acts.length === 0) {
    return 'meet-counterexample';
  }
  const clamped = Math.min(Math.max(actIndex, 0), acts.length - 1);
  return acts[clamped]?.objective ?? 'meet-counterexample';
}

/* -------------------------------------------------------------------------- */
/* 2. 阶段 / Loading（§二十五 / §二十六）                                        */
/* -------------------------------------------------------------------------- */

/** reducer 的内部阶段 → 屏幕的四种阶段（§六）。 */
export function sessionPhaseOf(runtimePhase: string): SessionPhase {
  switch (runtimePhase) {
    case 'choices':
      return 'choice';
    case 'outcome':
      return 'reflection';
    case 'ended':
      return 'ended';
    case 'critical':
      // 新主链不展示属性，也就不该被属性判死：页面会立刻把它收束到终局，
      // 这一帧按「正在看到结果」渲染，不额外造一个死界面。
      return 'reflection';
    default:
      return 'story';
  }
}

/** 语义 loading（§二十六）。`null` = 没有在等任何东西。 */
export function loadingPhaseOf(input: {
  readonly waitingForSession: boolean;
  readonly generatingScene: boolean;
  readonly resolvingChoice: boolean;
  readonly loadingExperience: boolean;
}): SessionLoadingPhase {
  if (input.waitingForSession) {
    return 'loading-session';
  }
  if (input.generatingScene) {
    return 'generating-scene';
  }
  if (input.resolvingChoice) {
    return 'resolving-choice';
  }
  if (input.loadingExperience) {
    return 'loading-experience';
  }
  return null;
}

/**
 * 语义 loading 的**人话**（§二十六）。
 *
 * 每一句都只在说「现在在等什么」，没有一个假进度条、没有一个百分比。
 * 视觉怎么呈现由 Agent 04 决定。
 */
export const SESSION_LOADING_COPY: Readonly<Record<NonNullable<SessionLoadingPhase>, string>> = {
  'loading-session': '正在打开这一局…',
  'generating-scene': '这一局正在继续往下长…',
  'resolving-choice': '这一刻的结果不由你决定…',
  'loading-experience': '正在读取别人真实走过的路…',
};

export function loadingCopyOf(phase: SessionLoadingPhase): string {
  return phase ? SESSION_LOADING_COPY[phase] : '';
}

/* -------------------------------------------------------------------------- */
/* 3. Story（§十四）                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 轻量分段：按换行与句读切句。
 *
 * **不改事实**：切完之后拼回去就是原文（只是丢了空白）。它服务于
 * 「一句一句错位淡入」，而不是把 DM 的一段叙事强行拆成
 * scene / dialogue / tension 三块。
 */
export function phrasesOf(text: string): readonly string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function storyViewOf(input: {
  readonly sceneId: SceneId;
  readonly timeLabel: string;
  readonly speaker: SpeakerId | null;
  readonly stage: readonly CharacterOnStage[];
  readonly title: string;
  readonly text: string;
  readonly tension: string | null;
}): SessionStoryView {
  const tension = input.tension?.trim() ?? '';
  return {
    scene: { sceneId: input.sceneId, timeLabel: input.timeLabel },
    speaker: input.speaker,
    stage: input.stage,
    title: input.title,
    text: input.text,
    phrases: phrasesOf(input.text),
    tension: tension.length > 0 ? tension : null,
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Choice（§九 / §十 / §十一）                                                */
/* -------------------------------------------------------------------------- */

/** 锁定但没有给出原因时的兜底说明。绝不静默 `disabled`（§十一）。 */
const LOCKED_FALLBACK_REASON = '这条路暂时关闭：支撑它的现实条件还没有满足。';

/** 解锁选项的来源标签（§十）。 */
export const UNLOCKED_SOURCE_LABEL = '来自真实经历';

/** 解锁项在 Action Space 里的行动 id 口径（与 `pathReveal` 一致）。 */
export function actionIdForChoice(choice: Pick<ScenarioChoice, 'id' | 'experienceUnlockId'>): string {
  return choice.experienceUnlockId ? `action-${choice.experienceUnlockId}` : `action-${choice.id}`;
}

function actionById(actionSpace: ActionSpace | null | undefined): ReadonlyMap<string, PlayAction> {
  const map = new Map<string, PlayAction>();
  for (const action of actionSpace?.actions ?? []) {
    map.set(action.id, action);
  }
  return map;
}

/**
 * 选项 → 视图（§八）。
 *
 * 三条纪律：
 *
 * 1. **普通选项只给 title / description** —— `check` / DC / 骰面 / 属性
 *    不进这个函数（§九）；
 * 2. **解锁选项必须带来源**（§十）；
 * 3. **锁定选项必须带原因**（§十一），而且 `state` 是 `locked`，
 *    意味着它点了也不会派发选择。
 */
export function choiceViewsOf(input: {
  readonly choices: readonly ScenarioChoice[];
  readonly actionSpace?: ActionSpace | null;
}): readonly SessionChoiceView[] {
  const byId = actionById(input.actionSpace);

  return input.choices.map((choice) => {
    const action = byId.get(actionIdForChoice(choice));
    const locked = action?.state === 'locked' || action?.state === 'removed';

    if (locked) {
      const reason = action?.reason?.trim() ?? '';
      return {
        id: choice.id,
        title: choice.text,
        ...(choice.hint ? { description: choice.hint } : {}),
        state: 'locked' as const,
        lockedReason: reason.length > 0 ? reason : LOCKED_FALLBACK_REASON,
      };
    }

    const unlocked = Boolean(choice.experienceUnlockId) || action?.state === 'unlocked';
    if (unlocked) {
      return {
        id: choice.id,
        title: choice.text,
        ...(choice.hint ? { description: choice.hint } : {}),
        state: 'unlocked' as const,
        sourceLabel: UNLOCKED_SOURCE_LABEL,
        ...(choice.experienceUnlockId ? { experienceId: choice.experienceUnlockId } : {}),
        ...(choice.sourceFactIds && choice.sourceFactIds.length > 0
          ? { sourceFactIds: [...choice.sourceFactIds] }
          : {}),
      };
    }

    return {
      id: choice.id,
      title: choice.text,
      ...(choice.hint ? { description: choice.hint } : {}),
      state: 'available' as const,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* 5. Encounter（§十七 / §十八）                                                 */
/* -------------------------------------------------------------------------- */

/** 未知幕的固定文案（§十八）：没有足够现实信息，就如实说。 */
export const UNKNOWN_STAGE_COPY = '这里没有足够的现实信息继续推演。';

/** 未知幕只提供这一个出口（§十八：不猜答案、不重投骰、不付资源解锁）。 */
export const UNKNOWN_CONTINUE_LABEL = '继续到终局';

function caseQuotes(item: ExperienceCase | undefined, limit = 2): readonly string[] {
  if (!item) {
    return [];
  }
  return [...item.outcomes, ...item.actions, ...item.costs, ...item.reflections]
    .map((fact) => fact.exactQuote.trim())
    .filter((quote) => quote.length > 0)
    .slice(0, limit);
}

function caseById(
  blueprint: Pick<WorldBlueprint, 'experienceCases'>,
  id: string | undefined,
): ExperienceCase | undefined {
  if (!id) {
    return undefined;
  }
  return (blueprint.experienceCases ?? []).find((item) => item.id === id);
}

/**
 * 本幕 Encounter → 视图（§十七 / §十八）。
 *
 * 只认两种需要「占一块 Stage」的机制：
 *
 * ```text
 * experience-collision  两条真实走法并列，玩家选接下来观察什么
 * unknown-lock          现实信息不足，只能继续到终局
 * ```
 *
 * `path-reveal` 不在这里 —— 它的表现是「选项里多出一条」（§十），
 * 不是一个独立 Stage。没有 Encounter 时返回 `null`，页面什么都不显示。
 */
export function sessionEncounterViewOf(input: {
  readonly blueprint: Pick<WorldBlueprint, 'acts' | 'experienceCases' | 'encounters'>;
  /** 1 基幕号（`plan.act` 的口径）。 */
  readonly act: number;
  readonly actionSpace?: ActionSpace | null;
  readonly focusVariables: readonly string[];
}): SessionEncounterView | null {
  const plan = (input.blueprint.encounters ?? []).find((item) => item.act === input.act);
  if (!plan) {
    return null;
  }

  if (plan.type === 'experience-collision') {
    const primary = caseById(input.blueprint, plan.primaryCaseId);
    const counter = caseById(input.blueprint, plan.counterCaseId);
    const focuses = (plan.focusCandidates ?? []).map((focus) => ({
      id: focus.id,
      label: focus.label,
    }));
    const active =
      focuses.find(
        (focus) =>
          input.focusVariables.includes(focus.id) || input.focusVariables.includes(focus.label),
      ) ?? null;

    return {
      type: 'experience-collision',
      collision: {
        primary: {
          id: plan.primaryCaseId ?? 'primary',
          label: primary?.author ?? plan.primaryCaseId ?? '第一位',
          quotes: caseQuotes(primary),
        },
        counter: {
          id: plan.counterCaseId ?? 'counter',
          label: counter?.author ?? plan.counterCaseId ?? '另一位',
          quotes: caseQuotes(counter),
        },
        focuses,
        activeFocusId: active?.id ?? null,
      },
    };
  }

  if (plan.type === 'unknown-lock') {
    const locked = (input.actionSpace?.actions ?? []).filter((action) => action.state === 'locked');
    return {
      type: 'unknown-lock',
      unknown: {
        unknownLabel: plan.unknownLabel?.trim() || plan.unknownId || '',
        explanation: UNKNOWN_STAGE_COPY,
        blockedActions: locked.map((action) => action.label),
      },
    };
  }

  // path-reveal 由选项本身承载（§十），不占 Stage。
  return null;
}

/* -------------------------------------------------------------------------- */
/* 6. Endgame（§十九 - §二十二）                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reality Pass（§二十二）。
 *
 * **不写死「未来 7 天」**：时间盒只能来自 `experiment.timebox`。
 * 主界面只展示 timebox + action + 1~2 个信号，其余折叠。
 */
export function realityPassViewOf(
  experiment: RealityExperiment | null,
): SessionRealityPassView | null {
  if (!experiment) {
    return null;
  }
  return {
    timebox: experiment.timebox,
    action: experiment.action,
    artifact: experiment.artifact,
    successSignal: experiment.successSignal,
    stopSignal: experiment.stopSignal,
  };
}

/**
 * 终局视图（§十九）。
 *
 * 结构顺序就是这里的字段顺序，两条最容易被做错的纪律：
 *
 * 1. **原问题只能来自 DecisionSession**（§二十）：入参就是
 *    `session.question`，这里不做任何「润色」「补全」；
 * 2. **新问题只能来自 `keyUnknown`**（§二十一）：没有就诚实地是 `null`，
 *    绝不用模型的话覆盖，也不凭空加数字。
 */
export function sessionEndgameViewOf(input: {
  readonly originalQuestion: string;
  readonly keyUnknown: string | null;
  readonly experiment: RealityExperiment | null;
  readonly steps: readonly string[];
  readonly unlockedActions: readonly string[];
  readonly highlights: readonly string[];
  readonly experiences: readonly SessionExperienceView[];
}): SessionEndgameView {
  const keyUnknown = input.keyUnknown?.trim() ?? '';
  return {
    originalQuestion: input.originalQuestion,
    rewrittenQuestion: keyUnknown.length > 0 ? keyUnknown : null,
    steps: [...input.steps],
    unlockedActions: [...input.unlockedActions],
    highlights: [...input.highlights],
    experiences: [...input.experiences],
    realityPass: realityPassViewOf(input.experiment),
  };
}

/* -------------------------------------------------------------------------- */
/* 7. 整屏（§六）                                                                */
/* -------------------------------------------------------------------------- */

/** 经验卡最小视图（§十五 / §十六）。数据映射仍由非视觉层的 `cardDataFrom` 产出。 */
export function experienceViewOf(input: {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly summary: string;
}): SessionExperienceView {
  return {
    id: input.id,
    title: input.title,
    author: input.author,
    sourceUrl: input.sourceUrl,
    summary: input.summary,
  };
}

/**
 * 卡片 → Dock / 终局回顾用的一行摘要。
 *
 * 摘要只用**原文逐字片段**（`exactQuote`），不做概括：
 * 概括就是把别人的经历变成我们的说法。
 */
export function experienceSummariesOf(
  cards: readonly ExperienceCardData[],
  titles: Readonly<Record<string, string>> = {},
): readonly SessionExperienceView[] {
  return cards.map((card) => {
    const firstFact =
      card.outcomes[0] ?? card.actions[0] ?? card.conditions[0] ?? card.reflections[0] ?? null;
    return experienceViewOf({
      id: card.id,
      title: titles[card.id] ?? '一个人的一段经历',
      author: card.author,
      sourceUrl: card.sourceUrl,
      summary: firstFact?.exactQuote.trim() ?? '',
    });
  });
}

const EMPTY_STORY: SessionStoryView = {
  scene: { sceneId: 'campus', timeLabel: '' },
  speaker: null,
  stage: [],
  title: '',
  text: '',
  phrases: [],
  tension: null,
};

const EMPTY_SOURCE: SessionSourceView = { open: false, facts: [], differences: [] };

/**
 * 整屏视图（§六 / §七）。
 *
 * 输入刻意是「已经算好的窄数据」而不是整个 `RunState`：
 * 页面负责把 reducer 状态翻译成这些字段，屏幕组件负责渲染。
 */
export function sessionPlayViewOf(input: {
  readonly sessionId: string;
  readonly question: string;
  readonly blueprint: WorldBlueprint;
  /** reducer 的 1 基幕号。 */
  readonly turnIndex: number;
  readonly totalActs: number;
  readonly runtimePhase: string;
  readonly objective: SessionActObjective;
  readonly story: SessionStoryView;
  readonly outcome: { readonly title: string; readonly detail: string } | null;
  readonly choices: readonly SessionChoiceView[];
  readonly experiences: readonly ExperienceCardData[];
  readonly cardTitles: Readonly<Record<string, string>>;
  readonly encounter: SessionEncounterView | null;
  readonly counterFrame: SessionPlayView['counterFrame'];
  readonly loading: boolean;
  readonly loadingPhase: SessionLoadingPhase;
  readonly error: string | null;
  readonly endgame: SessionEndgameView | null;
  readonly source: SessionSourceView;
}): SessionPlayView {
  const actIndex = actIndexFromTurn(input.turnIndex);
  return {
    sessionId: input.sessionId,
    question: input.question,
    act: {
      index: actIndex,
      display: displayActNumber(actIndex),
      total: input.totalActs,
      objective: input.objective,
      heading: actHeadingOf(input.objective),
      subtitle: input.blueprint.acts[actIndex]?.titleHint ?? '',
    },
    story: input.story,
    outcome: input.outcome,
    phase: sessionPhaseOf(input.runtimePhase),
    choices: input.choices,
    experiences: input.experiences,
    cardTitles: input.cardTitles,
    encounter: input.encounter,
    counterFrame: input.counterFrame,
    loading: input.loading,
    loadingPhase: input.loadingPhase,
    error: input.error,
    endgame: input.endgame,
    source: input.source,
  };
}

/**
 * 占位屏（§二十五 / §二十六）。
 *
 * 「正在编译世界」与「这次世界没有成功生成」都发生在蓝图到位**之前**，
 * 所以它们必须能在一棵还没有 choices / story 的树上渲染 ——
 * 否则失败时页面只能悄悄退回旧 RPG 路径，那正是这一版要终结的行为。
 */
export function sessionPlaceholderView(input: {
  readonly sessionId: string;
  readonly loadingPhase: SessionLoadingPhase;
  readonly error: string | null;
}): SessionPlayView {
  return {
    sessionId: input.sessionId,
    question: '',
    act: {
      index: 0,
      display: displayActNumber(0),
      total: 3,
      objective: 'enter-world',
      heading: ACT_HEADINGS['enter-world'],
      subtitle: '',
    },
    story: EMPTY_STORY,
    outcome: null,
    phase: 'story',
    choices: [],
    experiences: [],
    cardTitles: {},
    encounter: null,
    counterFrame: null,
    loading: input.error === null,
    loadingPhase: input.loadingPhase,
    error: input.error ?? null,
    endgame: null,
    source: EMPTY_SOURCE,
  };
}

/** 载入失败时的统一文案（§二十五）——技术细节只进 console。 */
export function sessionErrorMessage(): string {
  return SESSION_ERROR_MESSAGE;
}
