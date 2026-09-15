'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { SessionPlayScreen } from '@/components/game/session/SessionPlayScreen';
import { toStatValue } from '@/core/brand';
import { createCheckRng, rollD20 } from '@/core/d20';
import { memoryEchoLine, memoryToPromptBlock } from '@/core/memory';
import { deriveArchetypes } from '@/core/memory';
import { fetchMemory, saveRun } from '@/core/memoryClient';
import {
  SESSION_ERROR_MESSAGE,
  actObjectiveAt,
  choiceViewsOf,
  displayActNumber,
  experienceSummariesOf,
  loadingPhaseOf,
  sessionEncounterViewOf,
  sessionEndgameViewOf,
  sessionPlaceholderView,
  sessionPlayViewOf,
  sessionUnknownLockOf,
  storyViewOf,
} from '@/components/game/session/viewModel';
import type { SessionPlayView } from '@/components/game/session/types';
import { cardDataFrom } from '@/components/game/ExperienceCardPanel';
import { fateQualityOf, resolveChoice } from '@/core/decision/choiceResolution';
import { applyEventToConstraints, drawEvent } from '@/core/run/events/eventSelector';
import {
  fetchMesh,
  loadConstraints,
  meshToTurnSnippets,
  saveConstraints,
} from '@/core/evidence/meshClient';
import { runBudgetFor } from '@/core/run/actRun';
import { advanceWorldWithChoiceTags, syncStats, type OutcomeKind } from '@/core/run/scenarioAdapter';
import { startWorld } from '@/core/run/runEngine';
import { advanceWorldModel, createWorldModel, type WorldModel } from '@/engine/worldModel';
import type { WorldState } from '@/core/run/worldState';
import type { ConstraintProfile, EvidenceMesh } from '@/types/evidence';
import type { RunMemory } from '@/core/memory';
import {
  EMPTY_INVENTORY,
  collectSanReduction,
  consumeActivatedRelics,
  equipRelic,
  ownRelic,
  resolveStatDeltas,
} from '@/core/relics';
import { getScene } from '@/data/scenes';
import { applyBeat, resolveBeats, viewForBeats } from '@/core/narrative';
import { DEFAULT_ORIGIN_ID, getOrigin, sanMultiplierFor, type OriginId } from '@/data/origins';
import {
  AI_DM_SCENARIO_ID,
  DEFAULT_SCENARIO_ID,
  RELIC_LIBRARY,
  getFallbackTurn,
  getScenario,
  type ScenarioChoice,
  type ScenarioOutcome,
  type ScenarioTurn,
} from '@/data/prebuiltScenarios';
import { fetchDmTurn, fetchProfile } from '@/core/dmClient';
import { unlockForTurn, worldContextForTurn, type PlaySessionView } from '@/features/game-world/dmContext';
import { realityQuestViewOf } from '@/features/game-world/questView';
import { experimentFromUnknown } from '@/features/decision-session/experiment';
import { cardTitlesFrom } from '@/features/game-world/cardTitles';
import type { WorldBlueprint } from '@/features/game-world/domain';
import type { ExperienceFact } from '@/features/experience/domain';

import type { DmSource } from '@/core/dm/generate';
import type { PlayerProfile } from '@/core/dm/profile';
import type { DmTurnInput, DmZhihuSnippet } from '@/core/dm/prompt';
import type { FateEdge, FateNode, FateNodeStatus } from '@/types/fate';
import type {
  CharacterOnStage,
  Mood,
  NarrativeBeat,
  SceneId,
  SpeakerId,
} from '@/types/narrative';
import type { RelicInventory, TargetStat } from '@/types/game';

/* -------------------------------------------------------------------------- */
/* 运行态                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 属性快照。
 *
 * 还留在状态里的唯一原因：隐藏状态推进（`syncStats`）与终局记忆写回仍要读它，
 * 而它们不能凭空捏造属性。新主链**不把它渲染出来** —— 属性不再是玩家可见的机制。
 */
interface RunStats {
  san: number;
  skill: number;
  bond: number;
}

/**
 * 阶段机：
 * story    → 播叙事节拍（对白 / 旁白 / 独白）
 * choices  → 节拍播完，展示抉择
 * checking → 结算动画（新主链只借它做一拍过场）
 * outcome  → 展示后果，等待「继续」
 * critical → SAN 归零（新主链不再由属性判死，页面会直接收束到终局）
 * ended    → 终局结算
 */
type Phase = 'story' | 'choices' | 'checking' | 'outcome' | 'critical' | 'ended';

type RunStatus = 'PLAYING' | 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED';

interface RunState {
  scenarioId: string;
  seed: string;
  originId: OriginId;
  turnIndex: number;
  stats: RunStats;
  inventory: RelicInventory;
  phase: Phase;
  status: RunStatus;

  /* 命运树 */
  nodes: FateNode[];
  edges: FateEdge[];
  prevNodeId: string;

  /* 叙事舞台 */
  beats: NarrativeBeat[];
  beatIndex: number;
  sceneId: SceneId;
  stage: CharacterOnStage[];
  speaker: SpeakerId | null;
  mood: Mood;
  dialogueText: string;

  /* 演出 */
  shakeKey: number;
  transition: { kind: 'glitch' | 'flash-white' | 'flash-red'; label: string; key: number } | null;
  hitKey: number;

  /* 结算 */
  outcomeTitle: string;
  outcomeDetail: string;
  pendingFeedback: string | null;
  pendingActivated: string[];

  /* AI DM */
  overrides: Record<number, ScenarioTurn>;
  dmLoading: boolean;
  /** 第一回合解析出的处境档案，后续回合回传服务端以保持冲突一致。 */
  profile: PlayerProfile | null;
  /** AI 读玩家原话后写的处境分析（自由文本，主路径）。 */
  profileAnalysis: string | null;

  /* 记忆 */
  prevChoiceText: string | null;
  /** 每幕结束时的 SAN 快照，用于终局画像推导。 */
  sanHistory: number[];
  /** 本局的 Session id 与世界蓝图（P0-G）。 */
  sessionId: string | null;
  worldBlueprint: WorldBlueprint | null;
  /** 是否已经插入过「记忆残响」。 */
  memoryEchoed: boolean;
  /** 上一局的持久化记忆，用于「前世遗念」与 AI 老友开场。 */
  memory: RunMemory | null;
  /** 当前是否已登录知乎账号。未登录时不产出任何记忆，也不装前世遗念。 */
  memoryAuthenticated: boolean;
  /**
   * 世界状态（因果引擎）：属性 + 五个隐藏状态 + flags。
   *
   * 属性由既有链路（遗物 / 出身倍率）推进，隐藏状态只由
   * `scenarioAdapter.advanceWorldWithChoiceTags` 推进（风险规则 + AI 标注的选项语义叠加）
 * —— 两套口径互不覆盖。
   */
  world: WorldState;
  /**
   * 世界模型（规范 §5）：叙事线索 / 关系图 / 派系 / 心理状态 / 现实锚点。
   *
   * 与 `world`（属性 + 隐藏状态）分开：`world` 管数值，模型管"世界里正在发生什么"。
   */
  model: WorldModel;
  /** 剧本总幕数（世界模型判断终幕需要）。 */
  totalActs: number;
  log: string[];
}

type RunAction =
  | { type: 'ADVANCE_BEAT' }
  | { type: 'CHOOSE'; choice: ScenarioChoice; turn: ScenarioTurn }
  | { type: 'RESOLVE_DICE' }
  | { type: 'ADVANCE_ACT' }
  | { type: 'GIVE_UP' }
  /**
   * 把这一局直接收束到终局（§十八 / §二十三）。
   *
   * 「现实信息不足」时玩家唯一的出口是「继续到终局」——不是重投骰、不是
   * 付资源、也不是猜一个答案。
   */
  | { type: 'END_SESSION' }
  | { type: 'LOAD_AI_TURN'; turn: ScenarioTurn; source: DmSource; turnIndex: number; profile: PlayerProfile | null }
  | { type: 'SET_PROFILE'; profile: PlayerProfile; analysis: string | null }
  | { type: 'MEMORY_ECHO'; line: string }
  | { type: 'LOAD_MEMORY'; memory: RunMemory | null; authenticated: boolean }
  | { type: 'LOAD_WORLD_BLUEPRINT'; blueprint: WorldBlueprint; sessionId: string }
  | { type: 'CLEAR_TRANSITION' };

function createSeed(): string {
  return `SEED-2026-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/* -------------------------------------------------------------------------- */
/* 叙事节拍解析（纯函数见 core/narrative.ts）                                  */
/* -------------------------------------------------------------------------- */

function createInitialState(scenarioId: string, seed: string, originId: OriginId): RunState {
  const scenario = getScenario(scenarioId);
  const firstTurn = scenario.turns[0];
  const isAiDm = scenario.id === AI_DM_SCENARIO_ID;
  const origin = getOrigin(originId);
  const stats = { ...origin.stats };
  const san = stats.san;

  // 出身自带的开局遗物
  let inventory = EMPTY_INVENTORY;
  if (origin.startingRelicId) {
    const relic = RELIC_LIBRARY[origin.startingRelicId];
    if (relic) {
      inventory = equipRelic(EMPTY_INVENTORY, ownRelic(relic, firstTurn.turnIndex)).inventory;
    }
  }

  // 前世遗念卡牌**不在这里装**。
  //
  // 记忆现在存在服务端（按知乎账号隔离），读取是异步的。开局不能为了等
  // 网络而卡住渲染，所以先以「无记忆」开局，记忆到位后由
  // `installLegacyRelic` 把卡补进遗物栏。这与 AI DM 的异步加载是同一套思路。
  //
  // 未登录时永远不会有这一步 —— 这正是「游客不获得记忆功能」的实现点。

  const beats = isAiDm ? [] : resolveBeats(firstTurn, san, null);
  const { view, beatIndex } = viewForBeats(beats, { sceneId: 'library', stage: [], san });

  return {
    scenarioId: scenario.id,
    seed,
    originId: origin.id,
    turnIndex: firstTurn.turnIndex,
    stats,
    inventory,
    phase: isAiDm ? 'story' : beats.length > 0 ? 'story' : 'choices',
    status: 'PLAYING',

    nodes: [{ id: 'start', label: '起点', turnIndex: 0, kind: 'root', status: 'visited' }],
    edges: [],
    prevNodeId: 'start',

    beats,
    beatIndex,
    sceneId: view.sceneId,
    stage: view.stage,
    speaker: view.speaker,
    mood: view.mood,
    dialogueText: isAiDm ? '正在连接 AI 地下城主，检索知乎站内讨论……' : view.text,

    shakeKey: 0,
    transition: view.transition,
    hitKey: 0,

    outcomeTitle: '',
    outcomeDetail: '',
    pendingFeedback: null,
    pendingActivated: [],

    overrides: {},
    dmLoading: isAiDm,
    profile: null,
    profileAnalysis: null,

    prevChoiceText: null,
    sanHistory: [san],
    // Session 世界蓝图（P0-G）：异步装载，开局为空 —— 与 memory 同一模式
    sessionId: null,
    worldBlueprint: null,
    memoryEchoed: false,
    memory: null,
    memoryAuthenticated: false,
    model: createWorldModel(seed),
    // v2 §14：AI 自由推演的幕数由张力预算决定（不同出身/属性 → 不同幕数）；
    // 预置剧本是人工精调的四幕，幕数由剧本自身决定。
    totalActs: isAiDm
      ? runBudgetFor({
          originId: origin.id,
          initialStats: { san: stats.san, skill: stats.skill, bond: stats.bond },
        })
      : scenario.turns.length,
    // 隐藏状态由种子派生：同一颗种子开局一致，挑战才可比
    world: startWorld(seed, { san: stats.san, skill: stats.skill, bond: stats.bond }),
    log: [`宇宙种子 ${seed} 已生成`, `出身流派：${origin.name}`],
  };
}

/** 把当前回合的分支挂到命运树上。 */
function withTurnChoices(state: RunState, turn: ScenarioTurn): RunState {
  const nodes = [...state.nodes];
  const edges = [...state.edges];

  turn.choices.forEach((choice) => {
    const nodeId = `n${turn.turnIndex}-${choice.id}`;
    if (nodes.some((node) => node.id === nodeId)) {
      return;
    }

    nodes.push({
      id: nodeId,
      label: choice.text.slice(0, 8),
      turnIndex: turn.turnIndex,
      kind: choice.check ? 'risk' : 'safe',
      status: 'available',
      badge: choice.check ? `D20 DC ${choice.check.difficulty}` : undefined,
    });

    edges.push({
      id: `e-${state.prevNodeId}-${nodeId}`,
      from: state.prevNodeId,
      to: nodeId,
      status: 'available',
    });
  });

  return { ...state, nodes, edges };
}

/** 进入新一幕：重建 beat 序列与舞台。 */
function enterTurn(state: RunState, turn: ScenarioTurn): RunState {
  const beats = resolveBeats(turn, state.stats.san, state.prevChoiceText);
  const { view, beatIndex } = viewForBeats(beats, {
    sceneId: state.sceneId,
    stage: state.stage,
    san: state.stats.san,
  });

  const next: RunState = {
    ...state,
    turnIndex: turn.turnIndex,
    beats,
    beatIndex,
    sceneId: view.sceneId,
    stage: view.stage,
    speaker: view.speaker,
    mood: view.mood,
    dialogueText: view.text,
    phase: beats.length > 0 ? 'story' : 'choices',
    shakeKey: view.shake ? state.shakeKey + 1 : state.shakeKey,
    transition: view.transition,
    outcomeTitle: '',
    outcomeDetail: '',
    pendingActivated: [],
    dmLoading: false,
  };

  return withTurnChoices(next, turn);
}

function applyDeltas(stats: RunStats, deltas: Partial<Record<TargetStat, number>>): RunStats {
  return {
    san: toStatValue(stats.san + (deltas.san ?? 0)),
    skill: toStatValue(stats.skill + (deltas.skill ?? 0)),
    bond: toStatValue(stats.bond + (deltas.bond ?? 0)),
  };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 把一次「选择 + 裁决」落进状态。
 *
 * 成败**不再来自骰子**：`resolveChoice` 用玩家条件裁决（`CHOOSE` 分支），
 * 骰面只决定遭遇品质。这里落地的是裁决结果本身 —— 属性、遗物、隐藏状态、
 * 结算摘要都走同一条路径。
 */
function resolveInto(
  state: RunState,
  turn: ScenarioTurn,
  choice: ScenarioChoice,
  resolution: {
    readonly isSuccess: boolean;
    /**
     * 这条选项是不是**风险选项**（带 `check`）。
     *
     * 它不再表示「掷过骰子」—— 骰子已经退出成败判定。这里只用它决定
     * 「要不要多给一拍过场」与「结算文案用裁决语言还是稳妥语言」。
     */
    readonly hasCheck: boolean;
  },
): RunState {
  const origin = getOrigin(state.originId);
  const { isSuccess, hasCheck } = resolution;

  const branch: ScenarioOutcome = isSuccess
    ? choice.onSuccess
    : (choice.onFail ?? choice.onSuccess);

  const sanReduction = collectSanReduction(state.inventory);
  const sanMultiplier = sanMultiplierFor(origin, Boolean(choice.peerPressure));
  const effective = resolveStatDeltas(branch.statDeltas, sanReduction, sanMultiplier);
  const stats = applyDeltas(state.stats, effective);

  let inventory = consumeActivatedRelics(state.inventory, state.pendingActivated);

  let droppedName: string | null = null;
  let droppedId: string | undefined;

  if (branch.relicId) {
    const relic = RELIC_LIBRARY[branch.relicId];
    if (relic) {
      const equipped = equipRelic(inventory, ownRelic(relic, turn.turnIndex));
      if (equipped.added) {
        inventory = equipped.inventory;
        droppedName = relic.name;
        droppedId = relic.id;
      }
    }
  }

  const nodeStatus: FateNodeStatus = choice.check
    ? isSuccess
      ? 'succeeded'
      : 'failed'
    : 'visited';

  const chosenNodeId = `n${turn.turnIndex}-${choice.id}`;

  const nodes = state.nodes.map<FateNode>((node) => {
    if (node.turnIndex !== turn.turnIndex) {
      return node;
    }
    if (node.id === chosenNodeId) {
      return { ...node, status: nodeStatus, relicId: droppedId ?? node.relicId };
    }
    return { ...node, status: 'locked' };
  });

  const edges = state.edges.map<FateEdge>((edge) => {
    if (edge.from !== state.prevNodeId) {
      return edge;
    }
    if (edge.to === chosenNodeId) {
      return { ...edge, status: isSuccess ? 'taken' : 'failed' };
    }
    return { ...edge, status: 'locked' };
  });

  const summary: string[] = [`SAN ${stats.san}`, `专业力 ${stats.skill}`, `羁绊 ${stats.bond}`];
  if (droppedName) {
    summary.push(`获得遗物「${droppedName}」`);
  }

  const sanDelta = effective.san ?? 0;
  const heavyHit = sanDelta <= -15;

  // 因果引擎：推进隐藏状态（风险/稳妥规则 + AI 标注的选项语义，二者叠加）
  const outcomeKind: OutcomeKind = choice.check ? (isSuccess ? 'success' : 'failure') : 'no-check';
  const world = syncStats(
    advanceWorldWithChoiceTags(state.world, choice, outcomeKind, branch, choice.tags),
    stats,
  );

  // 世界模型：线索 / 关系 / 心理 / 锚点一起推进（AI 只提供语义，规则决定后果）
  const model = advanceWorldModel(state.model, {
    act: turn.turnIndex,
    sanDelta: effective.san ?? 0,
    outcome: choice.check ? (isSuccess ? 'success' : 'failure') : 'none',
    ...(choice.tags ? { tags: choice.tags } : {}),
    finalAct: turn.turnIndex >= state.totalActs,
  });

  return {
    ...state,
    stats,
    inventory,
    world,
    model,
    phase: hasCheck ? 'checking' : stats.san <= 0 ? 'critical' : 'outcome',
    nodes,
    edges,
    prevNodeId: chosenNodeId,
    dialogueText: hasCheck ? state.dialogueText : branch.feedback,
    speaker: null,
    mood: heavyHit ? 'panic' : isSuccess ? 'hope' : 'tense',
    /*
      结算标题用**裁决语言**，不是检定语言。

      旧文案是「检定通过 / 检定失败」，读起来像掷骰子的结果；
      而现在的成败来自「你的条件 vs 这条路的需求」，
      所以改成「这条走得通 / 撞上了现实的边界」。
      稳妥选项本来就没有门槛，仍写「选择已生效」。
    */
    outcomeTitle: choice.check
      ? isSuccess
        ? '这条路走得通'
        : '撞上了现实的边界'
      : '选择已生效',
    outcomeDetail: summary.join(' · '),
    pendingFeedback: hasCheck ? branch.feedback : null,
    pendingActivated: [],
    sanHistory: [...state.sanHistory, stats.san],
    hitKey: sanDelta !== 0 ? state.hitKey + 1 : state.hitKey,
    shakeKey: heavyHit ? state.shakeKey + 1 : state.shakeKey,
    transition: heavyHit
      ? { kind: 'flash-red', label: '', key: state.shakeKey + 1 }
      : hasCheck && isSuccess
        ? { kind: 'flash-white', label: '', key: state.shakeKey + 1 }
        : state.transition,
    prevChoiceText: choice.text,
    log: [...state.log, `第 ${turn.turnIndex} 幕：${choice.text}`],
  };
}

/**
 * 玩家约束的**只读镜像**，供纯 reducer 读取。
 *
 * 为什么用模块级 ref 而不是传参：`runReducer` 是 React 的纯 reducer，
 * 签名被 `useReducer` 固定为 `(state, action)`。而 v3 §5.1 要求
 * 选项裁决必须用到玩家的现实条件 —— 那正是「随机不决定真相」的落点。
 *
 * 安全性：只在客户端组件的 effect 里同步写入，reducer 只读，
 * 因此「同一 state + 同一 action + 同一约束 ⇒ 同一结果」仍然成立。
 * 默认值刻意取「普通毕业生」的处境（与 `axis.DEFAULT_CONSTRAINTS` 一致），
 * 避免首帧读到 0 导致一切都被判 breached。
 */
const constraintsRef: { current: ConstraintProfile } = {
  current: { runwayMonths: 6, drawdown: 50, ally: 40 },
};

/**
 * reducer 写入的「事件已改变条件」结果，由组件在 effect 里取走。
 *
 * 为什么不直接在 reducer 里 setState：`runReducer` 是纯函数，
 * React 不允许它产生副作用。走一个单向的 ref 通道最小侵入 ——
 * reducer 只写，组件只读并清空，不存在双向耦合。
 */
const nextConstraintsRef: { current: ConstraintProfile | null } = { current: null };

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'ADVANCE_BEAT': {
      if (state.phase !== 'story') {
        return state;
      }

      const nextIndex = state.beatIndex + 1;
      const nextBeat = state.beats[nextIndex];

      if (!nextBeat) {
        return { ...state, phase: 'choices' };
      }

      const view = applyBeat(
        nextBeat,
        { sceneId: state.sceneId, stage: state.stage, san: state.stats.san },
        nextIndex + 1,
      );

      return {
        ...state,
        beatIndex: nextIndex,
        sceneId: view.sceneId,
        stage: view.stage,
        speaker: view.speaker,
        mood: view.mood,
        dialogueText: view.text,
        shakeKey: view.shake ? state.shakeKey + 1 : state.shakeKey,
        transition: view.transition ?? state.transition,
      };
    }

    case 'CHOOSE': {
      if (state.phase !== 'choices') {
        return state;
      }

      const { choice, turn } = action;
      let isSuccess = true;
      /**
       * 这条选项有没有门槛。
       *
       * 它只决定「结算时多不多给一拍过场」，**不参与成败判定** ——
       * 后面的 `resolveChoice` 才是唯一的裁决来源。
       */
      const hasCheck = Boolean(choice.check);

      if (choice.check) {
        const checkId = `${turn.turnIndex}:${choice.id}`;

        /**
         * ## v3 §5.1：这里不再掷骰子决定成败
         *
         * 旧实现用 `evaluateCheck`（D20 + 修正 ≥ DC）判 `isSuccess` ——
         * 于是**骰子决定了「你这条人生路能不能成功」**，与世界观直接冲突。
         *
         * 新实现分两件事：
         * 1. **现实裁决** `resolveChoice` —— 由纯函数判这条选项在你的条件下是否成立
         *    （需求来自选项语义，判定来自 `verdictForCaps`，与证据网格共用同一套判定）；
         * 2. **命运掷骰** —— 同一个确定性 PRNG 取出骰面，但只作为「遭遇品质」
         *    展示（贵人 / 机会 / 事故），**不参与 `isSuccess`**。
         *    `tests/verdictIsolation.test.ts` 把这条契约钉死。
         */
        const fateFace = rollD20(createCheckRng(state.seed, checkId, turn.turnIndex));
        const resolution = resolveChoice({
          choice,
          constraints: constraintsRef.current,
          fateFace,
        });

        isSuccess = resolution.isSuccess;

        /**
         * v3 §6：把这一幕的**遭遇**落到条件上。
         *
         * 顺序刻意如此：**先用当前条件判成败，再让遭遇改变条件**。
         * 这样「遭遇」影响的是接下来的几幕，而不是偷偷篡改本幕的裁决结果 ——
         * 如果反过来，就等于用事件影响真相，违反 §2.2 原则 D。
         *
         * 骰面（`fateFace`）在这里决定遭遇的**品质**（mishap…breakthrough），
         * 这正是 v3 §5.2 给 D20 的新职责。
         */
        const drawn = drawEvent({
          seed: state.seed,
          actIndex: turn.turnIndex,
          context: { constraints: constraintsRef.current },
          tone: fateQualityOf(fateFace),
        });
        if (drawn) {
          const nextConstraints = applyEventToConstraints(constraintsRef.current, drawn.applied);
          constraintsRef.current = nextConstraints;
          nextConstraintsRef.current = nextConstraints;
        }
      }

      return resolveInto(state, turn, choice, { isSuccess, hasCheck });
    }

    case 'RESOLVE_DICE': {
      if (state.phase !== 'checking') {
        return state;
      }

      return {
        ...state,
        phase: state.stats.san <= 0 ? 'critical' : 'outcome',
        dialogueText: state.pendingFeedback ?? state.dialogueText,
        pendingFeedback: null,
      };
    }

    case 'GIVE_UP': {
      if (state.phase !== 'critical') {
        return state;
      }

      return {
        ...state,
        phase: 'ended',
        status: 'OVER_SAN_DEPLETED',
        dialogueText: '心智归零。推演在现实的岔路口中断了。',
        outcomeTitle: '推演中断',
        outcomeDetail: '你在关键的一幕没能顶住，这一世到此为止。',
      };
    }

    case 'END_SESSION': {
      /**
       * 已经把玩家送回现实（终局屏），不再演下一幕。
       *
       * 三件事一起写，因为它们必须一致：
       *
       * 1. `phase: 'ended'` —— 屏幕切到终局；
       * 2. `status: 'OVER_SUCCESS'` —— 「现实信息不足」**不是**失败。
       *    若不动 status，写回记忆时会被记成 `OVER_SAN_DEPLETED`
       *    （「心智归零」）——那等于拿旧 RPG 的判死逻辑给新主链收尾；
       * 3. 一句诚实的收束文案，供记忆记录使用（终局屏自己不用它）。
       */
      if (state.phase === 'ended') {
        return state;
      }
      return {
        ...state,
        phase: 'ended',
        status: 'OVER_SUCCESS',
        outcomeTitle: '这一局到此为止',
        outcomeDetail: '剩下的问题只能回到现实中验证 —— 这不是失败。',
      };
    }

    case 'ADVANCE_ACT': {
      if (state.phase !== 'outcome') {
        return state;
      }

      const scenario = getScenario(state.scenarioId);

      if (state.scenarioId === AI_DM_SCENARIO_ID) {
        const nextIndex = state.turnIndex + 1;

        if (nextIndex > state.totalActs) {
          return {
            ...state,
            phase: 'ended',
            status: 'OVER_SUCCESS',
            dialogueText: '推演结束。系统正在根据你走过的岔路生成《专属避坑指南》……',
            outcomeTitle: '推演完成',
            outcomeDetail: `你走完了全部 ${state.totalActs} 幕。`,
            pendingActivated: [],
            dmLoading: false,
          };
        }

        return {
          ...state,
          phase: 'story',
          turnIndex: nextIndex,
          beats: [],
          beatIndex: 0,
          dialogueText: 'AI 地下城主正在检索知乎站内讨论……',
          outcomeTitle: '',
          outcomeDetail: '',
          pendingActivated: [],
          dmLoading: true,
        };
      }

      const nextTurn = scenario.turns[state.turnIndex];
      if (!nextTurn) {
        return {
          ...state,
          phase: 'ended',
          status: 'OVER_SUCCESS',
          dialogueText: '推演结束。系统正在根据你走过的岔路生成《专属避坑指南》……',
          outcomeTitle: '推演完成',
          outcomeDetail: `你走完了全部 ${state.totalActs} 幕。`,
          pendingActivated: [],
        };
      }

      return enterTurn(state, nextTurn);
    }

    case 'LOAD_AI_TURN': {
      const beats = resolveBeats(action.turn, state.stats.san, state.prevChoiceText);
      const { view, beatIndex } = viewForBeats(beats, {
        sceneId: state.sceneId,
        stage: state.stage,
        san: state.stats.san,
      });

      const next: RunState = {
        ...state,
        turnIndex: action.turnIndex,
        overrides: { ...state.overrides, [action.turnIndex]: action.turn },
        profile: action.profile ?? state.profile,
        beats,
        beatIndex,
        sceneId: view.sceneId,
        stage: view.stage,
        speaker: view.speaker,
        mood: view.mood,
        dialogueText: view.text,
        phase: beats.length > 0 ? 'story' : 'choices',
        transition: view.transition,
        dmLoading: false,
        outcomeTitle: '',
        outcomeDetail: '',
        pendingActivated: [],
      };

      return withTurnChoices(next, action.turn);
    }

    case 'MEMORY_ECHO': {
      // 只在第一幕开场还没推进时插队，避免打断正在播的节拍
      if (state.memoryEchoed || state.beats.length === 0 || state.beatIndex > 0) {
        return { ...state, memoryEchoed: true };
      }

      // 没有上一局记忆时只标记已处理，不插入空节拍
      if (action.line.trim().length === 0) {
        return { ...state, memoryEchoed: true };
      }

      const echoBeat: NarrativeBeat = {
        id: 'memory-echo',
        kind: 'system',
        mood: 'tense',
        text: action.line,
      };

      const beats = [...state.beats];
      beats.splice(Math.min(1, beats.length), 0, echoBeat);

      return { ...state, beats, memoryEchoed: true };
    }

    case 'SET_PROFILE':
      return { ...state, profile: action.profile, profileAnalysis: action.analysis };

    case 'LOAD_WORLD_BLUEPRINT': {
      /*
        Session 世界蓝图（P0-G）：像 memory 一样异步装载，不动初始状态签名。
        蓝图本身不直接驱动叙事 —— 它经过 `worldContextForTurn` 切成每幕上下文，
        由 `/api/dm` 注入模型；这里只是把它挂进运行时供读取。

        **`totalActs` 一并写入（P0-2）**：蓝图固定四幕，而 Session 模式原本
        沿用了 `runBudgetFor` 的 7～8 幕，于是第五幕之后一直重复
        `final-reflection`。把幕数绑到蓝图长度之后，
        「UI 计算 / Reducer 终局判断 / DM totalTurns」三处同源。
      */
      return {
        ...state,
        sessionId: action.sessionId,
        worldBlueprint: action.blueprint,
        totalActs: action.blueprint.acts.length,
      };
    }

    case 'LOAD_MEMORY':
      /*
        装载账号记忆。

        旧实现在这里把「前世遗念」卡补进遗物栏；遗物栏已随旧 RPG 屏一并删除，
        所以现在只保留记忆本身 —— 它仍然供 AI 以老友口吻开场
        （`memoryToPromptBlock` / `personaTags`）。
      */
      return {
        ...state,
        memory: action.memory,
        memoryAuthenticated: action.authenticated,
      };

    case 'CLEAR_TRANSITION':
      return { ...state, transition: null };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* 推演舱                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 从本局蓝图里取出这条选项引用的真实经验片段（P0-9）。
 *
 * **纯函数、无 I/O**：片段一直在 `worldBlueprint.experienceFacts` 里，
 * 选项只带 `sourceFactIds`，所以来源弹层不需要任何新接口。
 * 找不到就返回空数组 —— 不编造一段原文来填满弹层。
 */
function experienceFactsFor(
  choice: ScenarioChoice | null,
  blueprint: WorldBlueprint | null | undefined,
): readonly ExperienceFact[] {
  if (!choice || !blueprint) {
    return [];
  }
  const ids = choice.sourceFactIds ?? [];
  if (ids.length === 0) {
    return [];
  }
  const wanted = new Set(ids);
  return blueprint.experienceFacts.filter((fact) => wanted.has(fact.id));
}

/** 蓝图里已算好的「与你的差异」（P0-9 来源弹层第二块）。 */
function differencesFor(blueprint: WorldBlueprint | null | undefined) {
  if (!blueprint) {
    return [];
  }
  // 取全部路径上出现过的差异，去重后给弹层展示
  const seen = new Set<string>();
  const out: { variable: string; relation: 'same' | 'different' | 'unknown'; userValue?: string; experienceValue?: string }[] = [];
  for (const path of blueprint.paths) {
    for (const diff of path.differencesFromUser) {
      if (seen.has(diff.variable)) {
        continue;
      }
      seen.add(diff.variable);
      out.push({
        variable: diff.variable,
        relation: diff.relation,
        ...(diff.userValue ? { userValue: diff.userValue } : {}),
        ...(diff.experienceValue ? { experienceValue: diff.experienceValue } : {}),
      });
    }
  }
  return out;
}

/**
 * 第三幕反例分屏数据（报告 §20-§21）。
 *
 * 只取两条真实走法之间的差异，映射成「相同 / 不同 / 未知」三档。
 * 没有任何可对照的差异时返回 null —— 页面就不显示分屏，
 * 不为了「这一幕该有分屏」而凑一组不存在的数据。
 */
function counterFrameFor(blueprint: WorldBlueprint | null | undefined): {
  previousLabel: string;
  counterLabel: string;
  rows: readonly { kind: 'same' | 'different' | 'unknown'; text: string }[];
} | null {
  if (!blueprint || blueprint.paths.length < 1) {
    return null;
  }
  const paths = blueprint.paths;
  const previous = paths[0];
  const counter = paths.find((path) => path.opposingFactIds.length > 0) ?? paths[1];
  if (!counter || counter.id === previous.id) {
    return null;
  }

  const seen = new Set<string>();
  const rows: { kind: 'same' | 'different' | 'unknown'; text: string }[] = [];
  for (const path of [previous, counter]) {
    for (const diff of path.differencesFromUser) {
      if (seen.has(diff.variable) || rows.length >= 3) {
        continue;
      }
      seen.add(diff.variable);
      rows.push({
        kind: diff.relation,
        text:
          diff.relation === 'same'
            ? `${diff.variable}：和你一样`
            : diff.relation === 'unknown'
              ? `${diff.variable}：还不知道`
              : `${diff.variable}：他 ${diff.experienceValue ?? '—'} / 你 ${diff.userValue ?? '—'}`,
      });
    }
  }

  if (rows.length === 0) {
    return null;
  }

  return { previousLabel: previous.label, counterLabel: counter.label, rows };
}

function PlayScreen() {
  const params = useSearchParams();
  const scenarioId = params.get('scenario') ?? DEFAULT_SCENARIO_ID;
  const seedParam = params.get('seed');
  const goalParam = params.get('goal') ?? '';
  /** 黄金 Case id：带上它则证据走离线档案（零延迟、内容稳定）。 */
  const caseParam = params.get('case') ?? '';
  /**
   * Session 模式（P0-G）：`/play?session=<id>` —— 从已编译好的世界蓝图开局。
   *
   * 这是新主链的唯一入口：首页 → POST /api/sessions → 澄清 → prepare-world → 这里。
   * 没有 session 参数时不再有「旧路径」可退 —— 页面给一个要求会话链接的诚实兜底屏。
   */
  const sessionParam = params.get('session') ?? '';
  const originParam = params.get('origin') ?? DEFAULT_ORIGIN_ID;
  const seed = React.useMemo(() => seedParam ?? createSeed(), [seedParam]);
  const origin = React.useMemo(() => getOrigin(originParam), [originParam]);

  /**
   * Session 模式强制走 AI DM 剧本：蓝图的世界是由 AI 驱动的；
   * 预置剧本仍留给 case 兜底与无 API 演示。
   */
  const effectiveScenarioId = sessionParam ? AI_DM_SCENARIO_ID : scenarioId;

  const [state, dispatch] = React.useReducer(
    runReducer,
    { scenarioId: effectiveScenarioId, seed, originId: origin.id },
    (arg: { scenarioId: string; seed: string; originId: OriginId }) =>
      createInitialState(arg.scenarioId, arg.seed, arg.originId),
  );

  /** Session 视图（窄接口）：蓝图、问题与档案。加载失败时保持 null（诚实降级）。 */
  const [sessionView, setSessionView] = React.useState<PlaySessionView | null>(null);
  const [sessionLoadFailed, setSessionLoadFailed] = React.useState(false);
  /** 已使用过的经验解锁（P0-H）：同一解锁一局只出现一次。 */
  const [usedUnlockIds, setUsedUnlockIds] = React.useState<readonly string[]>([]);
  /**
   * 冲突分屏里玩家选过的「接下来重点观察的变量」（§十七）。
   *
   * 它**只是观察焦点**：不参与任何判定、不改变任何数值、不产生因果结论。
   * 放在页面状态里是因为它属于本局的过程记录，而不是屏幕的瞬时 UI 状态。
   */
  const [sessionFocusVariables, setSessionFocusVariables] = React.useState<readonly string[]>([]);

  /** Session 模式下的玩家目标：来自会话的问题，而不是 URL 参数。 */
  const effectiveGoal = sessionView?.question ?? goalParam;

  /**
   * 证据网格（方案 §5）：把「知乎」从角标装饰变成每一个数值的出处。
   *
   * Session 主链里它不再有自己的屏幕（证据来源改由世界蓝图承担），
   * 但仍作为 **AI 语料兜底** 存在：蓝图没给出本幕引用时，
   * `meshToTurnSnippets` 提供已核验的真实路径片段。
   */
  const [mesh, setMesh] = React.useState<EvidenceMesh | null>(null);
  /**
   * 「这条选择来自哪里」的来源弹层（P0-9）。
   *
   * 存的是**被点开的那条选项**，不是片段本身 —— 片段按 `sourceFactIds`
   * 从蓝图里现取，这样即使蓝图在过程中更新，弹层显示的也永远是最新事实。
   */
  const [sourceChoice, setSourceChoice] = React.useState<ScenarioChoice | null>(null);
  const [constraints, setConstraints] = React.useState<ConstraintProfile>(() => loadConstraints());

  const scenario = React.useMemo(() => getScenario(state.scenarioId), [state.scenarioId]);

  const currentTurn = React.useMemo(
    () =>
      state.overrides[state.turnIndex] ??
      scenario.turns.find((turn) => turn.turnIndex === state.turnIndex) ??
      scenario.turns[0],
    [scenario, state.turnIndex, state.overrides],
  );

  const scene = getScene(state.sceneId);

  /** 约束持久化：下次打开时停在原位（约束是玩家自己的条件，不是每局重填）。 */
  React.useEffect(() => {
    saveConstraints(constraints);
    /*
      同步给 reducer 的只读镜像。
      v3 §5.1 的选项裁决必须用到玩家的现实条件 —— 这就是「随机不决定真相」的落点：
      成败由「你的条件 vs 这条路的需求」决定，而不是由骰面决定。
    */
    constraintsRef.current = constraints;
  }, [constraints]);

  /**
   * 取走 reducer 写下的事件结果（v3 §6：遭遇改变了条件）。
   *
   * 触发条件用 `state.phase` 与 `state.turnIndex`：一次选择落地后，
   * reducer 可能已经用事件改变过条件，这里把它接回 React 状态，
   * 让后续裁决看到新条件。
   */
  React.useEffect(() => {
    const pending = nextConstraintsRef.current;
    if (!pending) {
      return;
    }
    nextConstraintsRef.current = null;
    setConstraints(pending);
  }, [state.phase, state.turnIndex]);

  /**
   * Session 模式（P0-G）：拉取会话视图，装载世界蓝图与档案。
   *
   * 与 memory 同一模式：开局先渲染，蓝图到位后 dispatch 进 reducer。
   * 拉不到（网络挂了 / 会话不属于你）→ sessionLoadFailed 落 true，
   * 界面如实说「加载不了这一局」，**不**悄悄退回旧路径装作没事。
   */
  React.useEffect(() => {
    if (!sessionParam) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionParam}`, { signal: controller.signal });
        if (!response.ok) {
          console.error(`[session] 会话加载失败：HTTP ${response.status}`);
          setSessionLoadFailed(true);
          return;
        }
        const payload = (await response.json()) as { data?: { id?: unknown; question?: unknown; userContext?: unknown; profile?: unknown; profileAnalysis?: unknown; worldBlueprint?: unknown; experiment?: unknown } };
        const data = payload?.data;
        const blueprint = data?.worldBlueprint as WorldBlueprint | undefined;
        if (!blueprint || typeof data?.id !== 'string' || typeof data?.question !== 'string') {
          console.error('[session] 会话响应缺少 worldBlueprint / id / question');
          setSessionLoadFailed(true);
          return;
        }
        /**
         * 现实实验（P1-2）：只在形状对得上时采纳。
         *
         * 会话里可能还没设计实验（`experiment: null`）—— 那时终局的
         * Reality Quest 会如实说「还没有实验」，并给回去设计的入口，
         * 而不是就地编一个七天计划。
         */
        const rawExperiment = data.experiment;
        const experiment =
          rawExperiment && typeof rawExperiment === 'object'
            ? (rawExperiment as PlaySessionView['experiment'])
            : null;
        const view: PlaySessionView = {
          id: data.id,
          question: data.question,
          profile: (data.profile as PlayerProfile | null) ?? null,
          profileAnalysis: typeof data.profileAnalysis === 'string' ? data.profileAnalysis : null,
          userContext:
            data.userContext && typeof data.userContext === 'object'
              ? (data.userContext as PlaySessionView['userContext'])
              : undefined,
          worldBlueprint: blueprint,
          experiment,
        };
        setSessionView(view);
        dispatch({ type: 'LOAD_WORLD_BLUEPRINT', blueprint, sessionId: view.id });
        if (view.profile) {
          dispatch({ type: 'SET_PROFILE', profile: view.profile, analysis: view.profileAnalysis });
        }
      } catch (error) {
        /*
          技术细节只进 console，不进 UI（§二十五）：玩家看到的是
          「这次世界没有成功生成。」与两个可点的出口。
        */
        console.error('[session] 世界蓝图加载失败', error);
        if (!controller.signal.aborted) {
          setSessionLoadFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [sessionParam]);

  /**
   * 证据网格 → AI 回合语料（v2 §1：知乎真正进入回合生成）。
   *
   * 只拉一次：网格是同一个目标下的稳定产物（有 `meshHash` 与 24h 服务端缓存），
   * 逐幕重拉只会浪费配额。
   *
   * 带 `case` 参数时走**离线档案**（v2 §15.1 的 DEMO 路径）：
   * `/api/mesh` 直接返回已人工核验的真实快照网格，零延迟、零配额、
   * 且内容不会因为一次搜索抖动而变化 —— 这正是黄金 Case 需要的行为。
   */
  React.useEffect(() => {
    if (state.scenarioId !== AI_DM_SCENARIO_ID || effectiveGoal.trim().length === 0) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      const result = await fetchMesh(
        { goal: effectiveGoal, ...(caseParam ? { caseId: caseParam } : {}) },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !result) {
        return;
      }
      setMesh(result.mesh);
    })();

    return () => controller.abort();
  }, [caseParam, effectiveGoal, state.scenarioId]);

  /* AI DM：当前回合尚无动态关卡时拉取 */
  const needsAiTurn =
    state.scenarioId === AI_DM_SCENARIO_ID &&
    state.phase === 'story' &&
    !state.overrides[state.turnIndex] &&
    // Session 模式必须等蓝图（或确认失败）才发请求
    (!sessionParam || sessionView !== null || sessionLoadFailed);

  /**
   * 证据网格 → AI 回合语料（v2 §1：知乎真正进入回合生成）。
   *
   * 只取有样本的路线，并按证据强度排序 —— 让模型先看到最有据的内容。
   * 没有网格时是空数组：不编造语料，AI 就照常凭处境档案生成。
   */
  const turnSnippets = React.useMemo(
    () => (mesh ? meshToTurnSnippets(mesh, { limit: 5 }) : []),
    [mesh],
  );

  /**
   * 本局的幕数（v2 §14 Phase 0 第 2 条：接线动态幕）。
   *
   * 两条路径刻意不同：
   * - **Session 个性化推演**：幕数**必须等于编译出的世界蓝图幕数**（固定四幕）。
   *   蓝图是「进入世界 → 体会代价 → 遇到反例 → 终局反思」这一段弧，
   *   它本来就只有四幕；如果让 AI 预算把它拉成 7～8 幕，
   *   **第五幕之后会一直重复 `final-reflection`** —— 体验拖沓且重复。
   * - **AI 自由推演兜底**：幕数由张力预算决定（`runBudgetFor`），
   *   因此不同的出身与属性会得到不同的幕数。
   *
   * 两者都用 `MAX_TURNS` 作为硬上限，口径只有一处。
   */
  const totalActCount = React.useMemo(() => {
    /**
     * Session 模式优先：蓝图有几幕就跑几幕。
     *
     * 这里读的是 `sessionView.worldBlueprint.acts.length`（与 reducer 写入的
     * `state.totalActs` 同源），保证「UI 计算 / Reducer 终局判断 / DM totalTurns」
     * 三处一致 —— 三处口径不同会让终局在真实幕数与预算幕数之间摇摆。
     */
    const blueprintActs = sessionView?.worldBlueprint?.acts.length ?? 0;
    if (blueprintActs > 0) {
      return blueprintActs;
    }

    const origin = getOrigin(state.originId);
    return runBudgetFor({
      originId: origin.id,
      initialStats: {
        san: origin.stats.san,
        skill: origin.stats.skill,
        bond: origin.stats.bond,
      },
      constraints,
    });
  }, [
    constraints,
    sessionView?.worldBlueprint,
    state.originId,
  ]);

  /**
   * 蓝图证据 → DM 语料（P0-11）。
   *
   * 本幕要引用的真实经验由世界蓝图编译好（`worldContextForTurn` 切出当前幕的
   * `sourceFacts`），它是权威来源；没有时调用处回落到证据网格片段
   * （网格的 `sourceFacts` 也是真人原文，只是没有幕次归属）。
   */
  const blueprintSnippets = React.useMemo((): readonly DmZhihuSnippet[] => {
    const blueprint = sessionView?.worldBlueprint;
    if (!blueprint) {
      return [];
    }
    const context = worldContextForTurn(blueprint, Math.max(0, state.turnIndex - 1));
    return (context?.sourceFacts ?? []).map((fact) => ({
      author: fact.author,
      quote: fact.quote,
      sourceUrl: fact.sourceUrl,
    }));
  }, [sessionView?.worldBlueprint, state.turnIndex]);

  /**
   * 终局「现实支线」的视图模型（P1-2）。
   *
   * 逻辑在 `game-world/questView.ts` 里（纯函数、可测）：回顾条目的
   * 出处纪律与「没有实验就不给承诺」都在那里钉住，页面只负责渲染。
   */
  const realityQuest = React.useMemo(
    () =>
      realityQuestViewOf({
        sessionId: sessionView?.id ?? '',
        blueprint: sessionView?.worldBlueprint ?? null,
        experiment: sessionView?.experiment ?? null,
        usedUnlockIds,
      }),
    [sessionView, usedUnlockIds],
  );


  const snapshotRef = React.useRef({ state, goalParam: effectiveGoal, totalTurns: totalActCount, turnSnippets, blueprintSnippets, sessionView, usedUnlockIds });
  snapshotRef.current = { state, goalParam: effectiveGoal, totalTurns: totalActCount, turnSnippets, blueprintSnippets, sessionView, usedUnlockIds };

  /**
   * 本局**真正用到**的经验卡（§13）：只列被某一幕或某个解锁引用过的经历，
   * 而不是把检索到的所有经历都摊给玩家看。
   */
  const sessionExperienceCards = React.useMemo(() => {
    const blueprint = sessionView?.worldBlueprint;
    if (!blueprint || !blueprint.experienceCases) {
      return [];
    }
    const usedFactIds = new Set<string>([
      ...blueprint.acts.flatMap((act) => act.experienceFactIds),
      ...blueprint.unlocks.flatMap((unlock) => unlock.sourceFactIds),
    ]);
    const differences = blueprint.paths.flatMap((path) => path.differencesFromUser);

    return blueprint.experienceCases
      .filter((experienceCase) =>
        [
          ...experienceCase.conditions,
          ...experienceCase.actions,
          ...experienceCase.costs,
          ...experienceCase.outcomes,
          ...experienceCase.reflections,
        ].some((fact) => usedFactIds.has(fact.id)),
      )
      .slice(0, 6)
      .map((experienceCase) => cardDataFrom(experienceCase, differences));
  }, [sessionView?.worldBlueprint]);

  /**
   * 经验卡的行动式抬头（§24）：直接复用解锁项已经拿到的 label，
   * 不新增模型调用；找不到对应解锁的卡不给标题。
   */
  const sessionCardTitles = React.useMemo(() => {
    const blueprint = sessionView?.worldBlueprint;
    if (!blueprint) {
      return {};
    }
    return cardTitlesFrom(blueprint.unlocks, blueprint.experienceCases ?? []);
  }, [sessionView?.worldBlueprint]);

  /**
   * 终局回顾用：这一局玩家做过的每个行动（方案 §22 的轻量回顾）。
   *
   * 从 `state.log` 里取「第 N 幕：<行动>」这几行并剥掉前缀 —— log 是本局
   * 行动的既有事实源，不为回顾再存一份平行数据。
   */
  const sessionSteps = React.useMemo(
    () =>
      state.log
        .map((line) => /^第 \d+ 幕：(.+)$/.exec(line)?.[1] ?? null)
        .filter((step): step is string => step !== null),
    [state.log],
  );

  /**
   * 终局回顾用：真实经验**替你 unlocks 出来的行动**里，你实际用过的那些
   * （方案 §14/§15：成长 = 你离开时多看见了几个可行动选项）。
   */
  const sessionCards = React.useMemo(() => {
    const blueprint = sessionView?.worldBlueprint;
    if (!blueprint) {
      return [];
    }
    const used = new Set(usedUnlockIds);
    return blueprint.unlocks.filter((unlock) => used.has(unlock.id)).map((unlock) => unlock.choice.text);
  }, [sessionView?.worldBlueprint, usedUnlockIds]);

  /**
   * 记忆是否已加载完成。
   *
   * 这个门闩是必需的：`MEMORY_ECHO` 与 AI DM 拉取在同一次渲染里都会触发，
   * 若不等待，AI 请求读到的 `state.memory` 还是 null ——
   * memoryBlock / personaTags 就是空的，AI 收不到「老友开场」的指令。
   */
  const memoryReady = state.memoryEchoed;

  React.useEffect(() => {
    if (!needsAiTurn || !memoryReady) {
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      const { state: current, goalParam: goal, totalTurns, turnSnippets, blueprintSnippets, sessionView: currentSession, usedUnlockIds: usedUnlocks } = snapshotRef.current;
      const turnIndex = current.turnIndex;

      // 第一步：读懂处境（仅在第一幕、且还没有档案时）
      // Session 模式（P0-G）：档案在建会话时已生成，**不再重复 fetchProfile**。
      let profile = current.profile ?? currentSession?.profile ?? null;

      if (!profile && currentSession?.profile) {
        profile = currentSession.profile;
        dispatch({
          type: 'SET_PROFILE',
          profile: currentSession.profile,
          analysis: currentSession.profileAnalysis,
        });
      }

      if (!profile) {
        const resolved = await fetchProfile(goal, { signal: controller.signal });

        if (controller.signal.aborted) {
          return;
        }

        if (resolved?.profile) {
          profile = resolved.profile;
          dispatch({
            type: 'SET_PROFILE',
            profile: resolved.profile,
            analysis: resolved.analysis,
          });
        }
      }

      const history = current.log
        .map((line) => /^第 (\d+) 幕：(.*)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ turnIndex: Number(match[1]), choiceText: match[2], outcome: '' }));

      // 前世记忆只在第一幕注入，避免模型把「这一世」和「上一世」混起来
      const memoryBlock = turnIndex === 1 ? memoryToPromptBlock(current.memory) : null;

      const input: DmTurnInput = {
        goal,
        ...(profile ? { profile } : {}),
        ...(current.profileAnalysis ? { profileAnalysis: current.profileAnalysis } : {}),
        seed: current.seed,
        turnIndex,
        totalTurns,
        stats: current.stats,
        inventory: current.inventory
          .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
          .map((slot) => ({
            name: slot.relic.name,
            kind: slot.relic.kind,
            remainingCharges: slot.remainingCharges,
          })),
        // v2 §1 第 1 条：知乎真正进入回合生成。
        // 片段不再硬编码为空，而是来自证据网格里**已核验的路径卡**
        // （meshToTurnSnippets 只取有样本的路线，并按证据强度排序）。
        // 没有网格时它就是空数组 —— 不编造语料。
        //
        // P0-11：Session 模式下改喂**世界蓝图本幕引用的真实经验**，
        // 网格片段只作为 legacy 兜底 —— 同时给两套，模型会把
        // 「演算出来的走法」和「真人原文」混着引用。
        zhihuSnippets: blueprintSnippets.length > 0 ? [...blueprintSnippets] : [...turnSnippets],
        history,
        personaTags: current.memory?.personalityTags ?? [],
        // 只有第二局及以后才有前世记忆；第一幕注入，让 AI 以老友口吻开场
        ...(memoryBlock ? { memoryBlock } : {}),
        // 世界蓝图上下文（P0-G）：本幕冲突与可引用的真实经验由 Session 编译
        ...(() => {
          const blueprint = currentSession?.worldBlueprint;
          if (!blueprint) return {};

          /**
           * **索引基准转换（P0-1 修复）**。
           *
           * Play 的 `state.turnIndex` 是 **1 基**（1 = 第一幕）；
           * 而 `worldContextForTurn` / `unlockForTurn` 的契约是 **0 基**
           * （0 = 第一幕，内部 `currentAct = turnIndex + 1`）。
           *
           * 直接把 1 基值传进去，会让每一幕都错开一位：
           * 游戏第一幕读到蓝图的「体会代价」幕，第二幕读到「遇到反例」幕，
           * 第三幕就已经走到终局反思 —— 而第四幕读不到任何东西。
           *
           * 转换只在**这一层**做：两个函数保持它们的 0 基契约不变，
           * 避免「到底谁负责换算」变成两处各写一半。
           */
          const blueprintTurnIndex = Math.max(0, turnIndex - 1);

          const unlock = unlockForTurn(blueprint, blueprintTurnIndex, usedUnlocks);
          return {
            worldContext: worldContextForTurn(blueprint, blueprintTurnIndex),
            ...(unlock ? { experienceUnlock: unlock } : {}),
          };
        })(),
      };

      // 无论成功失败都必须落地一回合，否则 dmLoading 会永远卡住
      try {
        const result = await fetchDmTurn(input, { signal: controller.signal });

        if (controller.signal.aborted) {
          return;
        }

        dispatch({
          type: 'LOAD_AI_TURN',
          turn: result?.turn ?? getFallbackTurn(turnIndex),
          source: result?.source ?? 'fallback',
          turnIndex,
          profile: result?.profile ?? null,
        });
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        dispatch({
          type: 'LOAD_AI_TURN',
          turn: getFallbackTurn(turnIndex),
          source: 'fallback',
          turnIndex,
          profile: null,
        });
      }
    };

    run();

    return () => controller.abort();
  }, [needsAiTurn, memoryReady, state.turnIndex]);

  /* 跨周期记忆：登录后从服务端拉取，有上一局记录时插入「记忆残响」 */
  React.useEffect(() => {
    if (state.memoryEchoed) {
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      const result = await fetchMemory({ signal: controller.signal });

      if (controller.signal.aborted) {
        return;
      }

      // 未登录：明确标记「已处理」，并如实记录未认证状态。
      // 这不插「记忆残响」，也不装前世遗念 —— 游客本就没有记忆。
      if (!result.authenticated) {
        dispatch({ type: 'LOAD_MEMORY', memory: null, authenticated: false });
        dispatch({ type: 'MEMORY_ECHO', line: '' });
        return;
      }

      dispatch({ type: 'LOAD_MEMORY', memory: result.memory, authenticated: true });

      if (result.memory) {
        dispatch({ type: 'MEMORY_ECHO', line: memoryEchoLine(result.memory) });
      } else {
        dispatch({ type: 'MEMORY_ECHO', line: '' });
      }
    };

    void load();

    return () => controller.abort();
  }, [state.memoryEchoed]);

  /* 终局写回记忆，供下一局触发「既视感开场」与「前世遗念」 */
  const memoryWrittenRef = React.useRef(false);
  React.useEffect(() => {
    if (state.phase !== 'ended' || memoryWrittenRef.current) {
      return;
    }

    memoryWrittenRef.current = true;

    const choices = state.log
      .map((line) => /^第 (\d+) 幕：(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[2]);

    const record = {
      goal: effectiveGoal,
      originId: state.originId,
      lastAct: Math.min(state.turnIndex, state.totalActs),
      status: (state.status === 'OVER_SUCCESS'
        ? 'OVER_SUCCESS'
        : 'OVER_SAN_DEPLETED') as 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED',
      causeOfDeath: state.outcomeDetail || state.outcomeTitle || '在关键的一幕没能顶住',
      // 基础记录先存，遗言留空 —— 遗言走「封存遗言」第二步（见下方 sealFinalWords）。
      // 早期实现把两者混在一起、只在终局那一刻写一次，导致玩家后写的遗言永远进不了记忆。
      finalWords: '',
      personalityTags: deriveArchetypes({
        choices,
        survived: state.status === 'OVER_SUCCESS',
        lastAct: Math.min(state.turnIndex, state.totalActs),
        totalActs: state.totalActs,
        sanHistory: state.sanHistory,
      }),
    };

    // 未登录时不提交 —— 服务端也会拒，但没必要发这个请求。
    // 结算页会据此显示「登录后可保留这份记忆」的引导。
    if (!state.memoryAuthenticated) {
      return;
    }

    void saveRun(record).then((result) => {
      /*
        落盘结果只进日志。

        旧的 EndgamePass 会据此显示「已存入你的宇宙 / 没能写入」，
        而那个结算屏已随旧 RPG 一起删除；新终局（SessionEndgame）不给判定、
        也不报存取状态，所以这里不再有对应的界面状态可写。
      */
      console.info(
        result.persisted
          ? `[memory] 本局已存入你的宇宙（累计第 ${result.totalRuns} 局）`
          : `[memory] 本局未能写入你的宇宙（${result.reason}）`,
      );
    });
  }, [
    effectiveGoal,
    state.log,
    state.memoryAuthenticated,
    state.originId,
    state.outcomeDetail,
    state.outcomeTitle,
    state.phase,
    state.sanHistory,
    state.status,
    state.totalActs,
    state.turnIndex,
  ]);

  const handleSelect = React.useCallback(
    (choice: ScenarioChoice) => {
      // 玩家真的选了经验解锁的选项（P0-H）→ 这一解锁本局不再重复出现
      if (choice.experienceUnlockId) {
        setUsedUnlockIds((previous) =>
          previous.includes(choice.experienceUnlockId!) ? previous : [...previous, choice.experienceUnlockId!],
        );
      }
      dispatch({ type: 'CHOOSE', choice, turn: currentTurn });
    },
    [currentTurn],
  );

  const isEnded = state.phase === 'ended';

  /**
   * 是否跑在**新主链**。
   *
   * 判据是 URL 上的 `?session=` —— 而不是「蓝图是否已到位」。
   *
   * 为什么必须这样：蓝图到位**之前**有两个状态需要新主链自己表达：
   *
   * ```text
   * 世界还在编译   → 语义 loading（§二十六）
   * 世界没生成出来 → 「这次世界没有成功生成。」+ 重试 / 返回修改问题（§二十五）
   * ```
   *
   * 旧写法用蓝图当判据，于是这两种状态都会「悄悄退回旧 RPG 整屏」——
   * 玩家会在加载失败时突然看到属性条、骰子和 Boss。那不是降级，是串台。
   */
  const isSessionMode = sessionParam.length > 0;

  /**
   * 新主链里 SAN 归零**不会**把玩家卡住。
   *
   * 旧机制下 SAN 归零会进入 critical 阶段，界面给一个「消耗 30 羁绊呼叫大 V」
   * 的救场面板 —— 新主链把属性与救场都撤出了主路径（§3/§17），救场面板
   * 也已随旧 RPG 一并删除。若只藏面板不处理状态，玩家会停在一个没有任何
   * 按钮的死界面上。
   *
   * 处理方式：新主链不展示属性，也就不该被属性判死 —— 直接把这一局收束到终局，
   * 「问题重写 + 现实支线」照常出现。
   * （`playWorldIndexing.test.ts` 把这两条源码契约钉死，本文件不派发 `RESCUE`，
   * 因此 `RunAction` 里也不再有它。）
   */
  React.useEffect(() => {
    if (isSessionMode && state.phase === 'critical') {
      dispatch({ type: 'END_SESSION' });
    }
  }, [isSessionMode, state.phase]);

  /**
   * 新主链的推演屏视图模型（Agent 03 §七）。
   *
   * 把 reducer 状态**翻译**成 `SessionPlayView` 的窄接口：屏幕组件不碰
   * reducer、不碰旧 UI，只负责渲染这一幕。翻译住在
   * `components/game/session/viewModel.ts`（纯函数、可测），
   * 页面只负责把状态喂进去 —— 这样 legacy 与新主链共用同一个 reducer
   * 与同一套动作，而「新主链该长什么样」这件事可以被测试钉死。
   *
   * 这里还负责两件以前没人管的事（§二十五 / §二十六）：
   *
   * ```text
   * 蓝图还没到   → 语义 loading，而不是退回旧 RPG 整屏
   * 蓝图没生成出来 → 统一失败态 + 两个出口
   * ```
   */
  const sessionPlayView: SessionPlayView | null = React.useMemo(() => {
    if (!isSessionMode) {
      return null;
    }

    /** 语义 loading（§二十六）：屏幕要知道「在等什么」才能说人话。 */
    const loadingPhase = loadingPhaseOf({
      waitingForSession: sessionView === null && !sessionLoadFailed,
      generatingScene: state.dmLoading,
      resolvingChoice: state.phase === 'checking',
      /**
       * 来源弹层的片段从蓝图里现取（无网络请求）；只有当 reducer 侧
       * 蓝图镜像还没落地时才真的在等。
       */
      loadingExperience: sourceChoice !== null && state.worldBlueprint === null,
    });

    /**
     * 蓝图未就绪：要么在编译，要么没生成出来。两者都必须在**没有**
     * story / choices 的树上渲染，否则失败时只能悄悄退回旧路径。
     */
    if (!sessionView?.worldBlueprint) {
      return sessionPlaceholderView({
        sessionId: sessionView?.id ?? sessionParam,
        loadingPhase,
        error: sessionLoadFailed ? SESSION_ERROR_MESSAGE : null,
      });
    }

    const blueprint = sessionView.worldBlueprint;
    /** UI 用 0 基幕下标；DM / reducer 用 1 基 turnIndex（§十三）。 */
    const blueprintIndex = Math.max(0, state.turnIndex - 1);
    const displayAct = displayActNumber(blueprintIndex);
    const objective = actObjectiveAt(blueprint, blueprintIndex);
    const actSpec = blueprint.acts[blueprintIndex] ?? blueprint.acts[blueprint.acts.length - 1];
    /*
     * 终局 Reality Pass 的最后一道接线：旧会话可能只有蓝图、尚未调用
     * design-experiment。实验仍然从同一个未知、问题框架、路径差异与用户
     * 原始约束确定性生成，不调用模型，也不替玩家下结论。
     */
    const endgameExperiment =
      sessionView.experiment ??
      (blueprint.keyUnknown
        ? experimentFromUnknown({
            unknown: blueprint.keyUnknown,
            frame: blueprint.problemFrame,
            differences: blueprint.paths.flatMap((path) => path.differencesFromUser),
            context: sessionView.userContext ?? {
              goal: sessionView.question,
              nonNegotiables: [],
              existingResources: [],
            },
          })
        : null);

    return sessionPlayViewOf({
      sessionId: sessionView.id,
      question: sessionView.question,
      blueprint,
      turnIndex: state.turnIndex,
      totalActs: state.totalActs,
      runtimePhase: state.phase,
      objective,
      story: storyViewOf({
        sceneId: state.sceneId,
        timeLabel: scene.timeLabel,
        speaker: state.speaker,
        stage: state.stage,
        title: currentTurn.title ?? '',
        text: state.dialogueText || (currentTurn.storyText ?? ''),
        // 本幕张力来自蓝图；没有就不显示一行编的
        tension: actSpec?.conflict ?? null,
      }),
      outcome:
        state.phase === 'outcome'
          ? { title: state.outcomeTitle ?? '', detail: state.outcomeDetail ?? '' }
          : null,
      // 普通选项只带 title / hint：check / DC / 骰面在 ViewModel 就被丢掉（§九）
      choices: choiceViewsOf({ choices: currentTurn.choices }),
      experiences: sessionExperienceCards,
      cardTitles: sessionCardTitles,
      // 本幕 Encounter（§十七 / §十八）：没有就是 null，不硬凑一个 Stage
      encounter: sessionEncounterViewOf({
        blueprint,
        act: displayAct,
        focusVariables: sessionFocusVariables,
      }),
      /*
        未知锁单独取：第三幕可以**同时**有反例与未知（composeEncounters
        就是这么发的）。塞进 encounter 会被反例吃掉，实测真实对局里
        未知因此从不出现。
      */
      unknownLock: sessionUnknownLockOf({ blueprint, act: displayAct }),
      counterFrame: counterFrameFor(blueprint),
      loading: state.dmLoading,
      loadingPhase,
      error: null,
      endgame: isEnded
        ? sessionEndgameViewOf({
            // 原问题**只**来自 DecisionSession，不允许被模型润色覆盖（§二十）
            originalQuestion: sessionView.question,
            keyUnknown: blueprint.keyUnknown?.label ?? null,
            experiment: endgameExperiment,
            steps: sessionSteps,
            unlockedActions: sessionCards,
            highlights: realityQuest?.seen ?? [],
            experiences: experienceSummariesOf(sessionExperienceCards, sessionCardTitles),
          })
        : null,
      source: {
        open: sourceChoice !== null,
        facts: experienceFactsFor(sourceChoice, state.worldBlueprint),
        differences: differencesFor(state.worldBlueprint),
      },
    });
  }, [
    currentTurn.choices,
    currentTurn.storyText,
    currentTurn.title,
    isEnded,
    isSessionMode,
    realityQuest,
    scene.timeLabel,
    sessionCards,
    sessionCardTitles,
    sessionExperienceCards,
    sessionFocusVariables,
    sessionLoadFailed,
    sessionParam,
    sessionSteps,
    sessionView,
    sourceChoice,
    state.dialogueText,
    state.dmLoading,
    state.outcomeDetail,
    state.outcomeTitle,
    state.phase,
    state.sceneId,
    state.speaker,
    state.stage,
    state.totalActs,
    state.turnIndex,
    state.worldBlueprint,
  ]);

  /**
   * 新主链走自己的屏（Agent 03 §三十）：只渲染
   * 幕 / 场景 / 叙事 / 选项 / 借来的经验 / 碰撞 / 未知 / 终局。
   *
   * 屏幕拿到的是**窄接口 + id 回调**：它看不见 stats、inventory、dice，也没有
   * 任何办法派发旧 action。
   *
   * 旧的整屏（GameHud / DiceModal / BossTerminal / FateTree / 遗物抽屉 /
   * 证据网格 / 现实轴 / 舞台 / 世界线折叠 / 终局判卷）已随旧 RPG 子系统一并删除。
   */
  if (isSessionMode && sessionPlayView) {
    const findChoice = (choiceId: string) =>
      currentTurn.choices.find((candidate) => candidate.id === choiceId) ?? null;

    return (
      <SessionPlayScreen
        view={sessionPlayView}
        onChoose={(choiceId) => {
          const choice = findChoice(choiceId);
          if (choice) {
            handleSelect(choice);
          }
        }}
        onAdvance={() =>
          dispatch({ type: state.phase === 'outcome' ? 'ADVANCE_ACT' : 'ADVANCE_BEAT' })
        }
        onResolveCheck={() => dispatch({ type: 'RESOLVE_DICE' })}
        onQuit={() => {
          window.location.href = '/';
        }}
        onRetry={() => {
          window.location.reload();
        }}
        onBackToQuestion={() => {
          window.location.href = sessionView ? `/session/${sessionView.id}` : '/';
        }}
        onOpenSource={(choiceId) => {
          const choice = findChoice(choiceId);
          if (choice) {
            setSourceChoice(choice);
          }
        }}
        onCloseSource={() => setSourceChoice(null)}
        onSelectCollisionFocus={(focusId) =>
          setSessionFocusVariables((previous) =>
            previous.includes(focusId) ? previous : [...previous, focusId],
          )
        }
        onContinueFromUnknown={() => dispatch({ type: 'END_SESSION' })}
      />
    );
  }

  /*
    Session 模式但视图还没就绪（蓝图正在编译 / 没生成出来）时，
    `sessionPlayView` 是 `sessionPlaceholderView(...)`，上面那一支会照常渲染
    它自己的 loading / 失败屏 —— 因此这里只剩**没有 `?session=`** 这一种情况。

    旧 RPG 整屏已经删除，`/play` 不再有第二条路可走。此时给一个诚实的兜底屏：
    说清「这一屏需要从会话进入」，并给出回首页的入口 —— 不留白屏。
  */
  return (
    <main
      id="main-content"
      className="sil-viewport relative flex flex-col items-center justify-center px-5 py-16 sm:px-8"
    >
      <div className="sil-panel w-full max-w-[520px] px-6 py-8 text-center">
        <p className="sil-label">Session Required</p>
        <h1 className="sil-title sil-title--act mt-4">这一屏需要一个会话</h1>
        <p className="sil-prose mt-4 text-[14px]">
          推演从你的问题开始 —— 先在首页写下一个真正困扰你的问题，
          系统会编译出这一局的世界，再把你送到这里。
        </p>
        <Link href="/" className="sil-btn mt-7 inline-flex">
          回首页开始一局
        </Link>
      </div>
    </main>
  );
}

function PlaySkeleton() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950">
      <p className="animate-flicker font-mono text-sm text-slate-500">正在加载推演舱…</p>
    </main>
  );
}

export default function PlayPage() {
  return (
    <React.Suspense fallback={<PlaySkeleton />}>
      <PlayScreen />
    </React.Suspense>
  );
}
