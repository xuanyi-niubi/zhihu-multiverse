'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Portrait } from '@/components/characters/Portrait';
import { DialogueBox } from '@/components/DialogueBox';
import { BossTerminal, BossVerdictPanel, verdictLines } from '@/components/BossTerminal';
import { RealityChecklist } from '@/components/RealityChecklist';
import { buildRealityChecklist } from '@/features/run/realityChecklist';
import { HiddenSignalStrip } from '@/components/HiddenSignalStrip';
import { WorldlineFold } from '@/components/WorldlineFold';
import { Drawer } from '@/components/Drawer';
import { DiceModal, type DiceResultView } from '@/components/DiceModal';
import { DamageFloat, type FloatItem } from '@/components/effects/DamageFloat';
import { SceneTransition, type TransitionKind } from '@/components/effects/SceneTransition';
import { EndgamePass } from '@/components/EndgamePass';
import { EndgameReport } from '@/components/EndgameReport';
import { FateTree } from '@/components/FateTree';
import { GameHud } from '@/components/GameHud';
import { InventoryBar } from '@/components/InventoryBar';
import { SceneStage } from '@/components/scenes/SceneStage';
import { SourceBadge } from '@/components/SourceBadge';
import { NeuralLoader } from '@/components/effects/NeuralLoader';
import { toDifficulty, toModifier, toSeed, toStatValue, toTurnIndex } from '@/core/brand';
import { createCheckRng, rollD20 } from '@/core/d20';
import { memoryEchoLine, memoryToPromptBlock } from '@/core/memory';
import { deriveArchetypes, legacyRelicFrom } from '@/core/memory';
import { fetchMemory, saveRun, sealFinalWords } from '@/core/memoryClient';
import { AxisSlider } from '@/components/AxisSlider';
import { EvidenceMeshView } from '@/components/EvidenceMeshView';
import { CriticalPointCard } from '@/components/CriticalPointCard';
import { ClarityRadar } from '@/components/ClarityRadar';
import { EngineStatusBar } from '@/components/EngineStatusBar';
import { AxisHUD } from '@/components/AxisHUD';
import { EventCard } from '@/components/EventCard';
import { WorldlineRail, worldlineStateOf } from '@/components/worldline/Worldline';
import { CommitPicker, type CommitCandidate } from '@/components/CommitPicker';
import { axisCapsFor } from '@/core/decision/axis';
import { clarityOf } from '@/core/decision/clarity';
import { judgeMesh } from '@/core/decision/verdict';
import { fateQualityOf, resolveChoice } from '@/core/decision/choiceResolution';
import { applyEventToConstraints, drawEvent } from '@/core/run/events/eventSelector';
import {
  createCommitment,
  fetchCommitments,
  fetchHealth,
  fetchMesh,
  loadConstraints,
  meshToTurnSnippets,
  removeCommitmentById,
  sandwichLocally,
  saveConstraints,
  type HealthView,
} from '@/core/evidence/meshClient';
import { submitBossAnswer, type BossVerdictView } from '@/core/bossClient';
import { runIdFor } from '@/core/run/runEngine';
import { createRunActState, runBudgetFor, actPressureLabel } from '@/core/run/actRun';
import { SCENARIO_REVISION } from '@/data/sceneTemplates';
import { BOSS_ANSWER_MAX, BOSS_ANSWER_MIN } from '@/features/run/contracts';
import { getVerifiedSource } from '@/data/knowledgeSources';
import { advanceWorldWithChoiceTags, syncStats, type OutcomeKind } from '@/core/run/scenarioAdapter';
import { ghostLinesFrom, type GhostLine } from '@/core/run/scenarioCompiler';
import { startWorld } from '@/core/run/runEngine';
import { advanceWorldModel, createWorldModel, worldModelBrief, type WorldModel } from '@/engine/worldModel';
import { mentalDifficultyOffset } from '@/engine/mentalState';
import { isCollapsed } from '@/engine/realityAnchor';
import type { WorldState } from '@/core/run/worldState';
import type { ConstraintProfile, EvidenceMesh } from '@/types/evidence';
import type { RunMemory } from '@/core/memory';import {
  EMPTY_INVENTORY,
  collectSanReduction,
  consumeActivatedRelics,
  equipRelic,
  ownRelic,
  resolveStatDeltas,
} from '@/core/relics';
import { expressionFromSan, getCharacter } from '@/data/characters';
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
import { fetchDmTurn, fetchProfile, fetchRunReport } from '@/core/dmClient';
import { unlockForTurn, worldContextForTurn, type PlaySessionView } from '@/features/game-world/dmContext';
import type { WorldBlueprint } from '@/features/game-world/domain';

import type { DmSource } from '@/core/dm/generate';
import type { PlayerProfile } from '@/core/dm/profile';
import type { DmTurnInput } from '@/core/dm/prompt';
import type { FateEdge, FateNode, FateNodeStatus, FateTreeGraph } from '@/types/fate';
import type {
  ActCard,
  CharacterOnStage,
  Mood,
  NarrativeBeat,
  SceneId,
  SpeakerId,
  StageSlot,
} from '@/types/narrative';
import type { RelicInventory, TargetStat } from '@/types/game';

/* -------------------------------------------------------------------------- */
/* 运行态                                                                      */
/* -------------------------------------------------------------------------- */

interface RunStats {
  san: number;
  skill: number;
  bond: number;
}

/**
 * 阶段机：
 * story    → 播叙事节拍（对白 / 旁白 / 独白）
 * choices  → 节拍播完，展示抉择
 * checking → D20 骰子翻滚
 * outcome  → 展示后果，等待「继续」
 * critical → SAN 归零，救场窗口
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
  transition: { kind: TransitionKind; label: string; key: number } | null;
  floats: FloatItem[];
  hitKey: number;

  /* 结算 */
  outcomeTitle: string;
  outcomeDetail: string;
  lastCheck: DiceResultView | null;
  pendingFeedback: string | null;
  pendingActivated: string[];

  /* AI DM */
  overrides: Record<number, ScenarioTurn>;
  dmSource: DmSource | null;
  dmLoading: boolean;
  /** 第一回合解析出的处境档案，后续回合回传服务端以保持冲突一致。 */
  profile: PlayerProfile | null;
  /** AI 读玩家原话后写的处境分析（自由文本，主路径）。 */
  profileAnalysis: string | null;

  /* 记忆 */
  prevChoiceText: string | null;
  /** 每幕结束时的 SAN 快照，用于看山心情日记。 */
  sanHistory: number[];
  /** 本局的 Session id 与世界蓝图（P0-G）。无 session 的旧路径两者为 null。 */
  sessionId: string | null;
  worldBlueprint: WorldBlueprint | null;
  /** 是否已经插入过「记忆残响」。 */
  memoryEchoed: boolean;
  /** 上一局的持久化记忆，用于「前世遗念」与 AI 老友开场。 */
  memory: RunMemory | null;
  /** 当前是否已登录知乎账号。未登录时不产出任何记忆，也不装前世遗念。 */
  memoryAuthenticated: boolean;
  /** 本局是否已成功存入账号记忆。 */
  runSaved: boolean;
  /** 存入后的累计局数，用于结算页文案。 */
  savedTotalRuns: number;
  /**
   * 本局写入失败的原因（null = 没失败）。
   *
   * 有值就说明**没能落盘**，结算页必须如实说明，不得宣称「已存入你的宇宙」。
   */
  saveFailureReason: string | null;
  /** 遗言封存状态（终局第二步，与基础记录保存分开）。 */
  sealState: 'idle' | 'sealing' | 'sealed' | 'failed';
  /**
   * 世界状态（因果引擎）：属性 + 五个隐藏状态 + flags。
   *
   * 属性由既有链路（遗物 / 出身倍率）推进，隐藏状态只由
   * `scenarioAdapter.advanceWorldWithChoiceTags` 推进（风险规则 + AI 标注的选项语义叠加）
 * —— 两套口径互不覆盖。
   */
  world: WorldState;
  /** 最近一次选择的世界线折叠（走过的一条 + 未走的幽灵线），换幕时清空。 */
  fold: { readonly act: number; readonly chosenId: string; readonly chosenText: string; readonly ghosts: readonly GhostLine[] } | null;
  /**
   * 第四幕终端 Boss 的判卷结果（来自服务端）。
   *
   * 终局要明确展示「基础属性 + 遗物 + 思路评分 + 骰面 vs DC」，
   * 所以这里保留完整分解，而不是只留一个胜负。
   */
  boss: BossVerdictView | null;
  /**
   * 世界模型（规范 §5）：叙事线索 / 关系图 / 派系 / 心理状态 / 现实锚点。
   *
   * 与 `world`（属性 + 隐藏状态）分开：`world` 管数值，模型管"世界里正在发生什么"。
   */
  model: WorldModel;
  /** 剧本总幕数（世界模型判断终幕需要）。 */
  totalActs: number;
  /** 玩家在终局写下的反思短评，成为下一局的「前世遗念」。 */
  finalWords: string;
  log: string[];
}

type RunAction =
  | { type: 'ADVANCE_BEAT' }
  | { type: 'CHOOSE'; choice: ScenarioChoice; turn: ScenarioTurn }
  | { type: 'RESOLVE_DICE' }
  | { type: 'ADVANCE_ACT' }
  | { type: 'USE_RELIC'; relicId: string }
  | { type: 'RESCUE' }
  | { type: 'GIVE_UP' }
  | { type: 'LOAD_AI_TURN'; turn: ScenarioTurn; source: DmSource; turnIndex: number; profile: PlayerProfile | null }
  | { type: 'SET_PROFILE'; profile: PlayerProfile; analysis: string | null }
  | { type: 'MEMORY_ECHO'; line: string }
  | { type: 'LOAD_MEMORY'; memory: RunMemory | null; authenticated: boolean }
  | { type: 'LOAD_WORLD_BLUEPRINT'; blueprint: WorldBlueprint; sessionId: string }
  | { type: 'SET_RUN_SAVED'; totalRuns: number }
  | { type: 'SET_RUN_SAVE_FAILED'; reason: string }
  | { type: 'SET_SEAL_STATE'; state: 'idle' | 'sealing' | 'sealed' | 'failed' }
  | { type: 'RESOLVE_BOSS'; turn: ScenarioTurn; choice: ScenarioChoice; verdict: BossVerdictView }
  | { type: 'SET_FINAL_WORDS'; words: string }
  | { type: 'CLEAR_FLOATS' }
  | { type: 'CLEAR_TRANSITION' }
  | { type: 'RESTART'; seed: string };

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
    floats: [],
    hitKey: 0,

    outcomeTitle: '',
    outcomeDetail: '',
    lastCheck: null,
    pendingFeedback: null,
    pendingActivated: [],

    overrides: {},
    dmSource: null,
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
    runSaved: false,
    savedTotalRuns: 0,
    saveFailureReason: null,
    sealState: 'idle',
    boss: null,
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
    fold: null,
    finalWords: '',
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
    // 换幕即收束上一幕的折叠视图
    fold: null,
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
    lastCheck: null,
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

function buildFloats(
  deltas: Partial<Record<TargetStat, number>>,
  key: string,
): FloatItem[] {
  const items: FloatItem[] = [];

  (['san', 'skill', 'bond'] as const).forEach((stat) => {
    const value = deltas[stat] ?? 0;
    if (value === 0) {
      return;
    }
    items.push({ id: `${key}-${stat}`, stat, value });
  });

  return items;
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 把一次「选择 + 裁决」落进状态。
 *
 * 为什么抽成函数：第四幕终端 Boss 的裁决来自服务端（`/api/boss/evaluate`），
 * 骰面不是前端掷的；但它必须与普通选项走**完全相同的落地路径** —— 节点状态、
 * 遗物掉落、SAN 曲线、隐藏状态推进、结算口径都不该出现第二套实现。
 */
function resolveInto(
  state: RunState,
  turn: ScenarioTurn,
  choice: ScenarioChoice,
  resolution: {
    readonly isSuccess: boolean;
    readonly dice: DiceResultView | null;
    /** 额外写进结算摘要的行（Boss 用来展示四维与思路修正）。 */
    readonly extraSummary?: readonly string[];
    /** 终局判卷结果：会改变现实锚点（规范点名要求 Boss 影响锚点）。 */
    readonly bossOutcome?: 'success' | 'failure';
  },
): RunState {
  const origin = getOrigin(state.originId);
  const { isSuccess, dice } = resolution;

  const branch: ScenarioOutcome = isSuccess
    ? choice.onSuccess
    : (choice.onFail ?? choice.onSuccess);

  const sanReduction = collectSanReduction(state.inventory);
  const sanMultiplier = sanMultiplierFor(origin, Boolean(choice.peerPressure));
  const effective = resolveStatDeltas(branch.statDeltas, sanReduction, sanMultiplier);
  const stats = applyDeltas(state.stats, effective);

  let inventory = dice
    ? consumeActivatedRelics(state.inventory, state.pendingActivated)
    : state.inventory;

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

  const summary: string[] = [...(resolution.extraSummary ?? [])];
  if (dice) {
    summary.push(
      `D20 ${dice.rawRoll} ${dice.baseModifier + dice.relicModifier >= 0 ? '+' : '−'}修正 → ${dice.total} vs DC ${dice.difficulty}`,
    );
  }
  summary.push(`SAN ${stats.san}`, `专业力 ${stats.skill}`, `羁绊 ${stats.bond}`);
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

  // 世界线折叠：走过的一条 + 未走的幽灵线（只给标签，不泄露结果）
  // 世界模型：线索 / 关系 / 心理 / 锚点一起推进（AI 只提供语义，规则决定后果）
  const model = advanceWorldModel(state.model, {
    act: turn.turnIndex,
    sanDelta: effective.san ?? 0,
    outcome: choice.check ? (isSuccess ? 'success' : 'failure') : 'none',
    ...(choice.tags ? { tags: choice.tags } : {}),
    ...(resolution.bossOutcome ? { bossOutcome: resolution.bossOutcome } : {}),
    finalAct: turn.turnIndex >= state.totalActs,
  });

  const fold = {
    act: turn.turnIndex,
    chosenId: choice.id,
    chosenText: choice.text,
    ghosts: ghostLinesFrom(turn.choices, choice.id),
  };

  return {
    ...state,
    stats,
    inventory,
    world,
    fold,
    phase: dice ? 'checking' : stats.san <= 0 ? 'critical' : 'outcome',
    nodes,
    edges,
    prevNodeId: chosenNodeId,
    dialogueText: dice ? state.dialogueText : branch.feedback,
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
    lastCheck: dice,
    pendingFeedback: dice ? branch.feedback : null,
    pendingActivated: [],
    floats: buildFloats(effective, `${turn.turnIndex}-${choice.id}`),
    sanHistory: [...state.sanHistory, stats.san],
    hitKey: sanDelta !== 0 ? state.hitKey + 1 : state.hitKey,
    shakeKey: heavyHit ? state.shakeKey + 1 : state.shakeKey,
    transition: heavyHit
      ? { kind: 'flash-red', label: '', key: state.shakeKey + 1 }
      : dice && isSuccess
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
      let dice: DiceResultView | null = null;

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

        const breach =
          resolution.verdict.kind === 'breached'
            ? {
                label: resolution.verdict.shortfallLabel,
                shortfall: resolution.verdict.overBy,
              }
            : null;

        dice = {
          rawRoll: fateFace,
          // 这三个字段是 Boss 判卷路径的语义，选项路径不再用它们表达成败；
          // 保留是为了让 DiceModal 的既有布局不出现 undefined。
          total: fateFace,
          difficulty: choice.check.difficulty,
          outcome: isSuccess ? 'success' : 'failure',
          critical: fateFace === 1 ? 'critical-failure' : fateFace === 20 ? 'critical-success' : 'none',
          baseModifier: 0,
          relicModifier: 0,
          targetStat: choice.check.targetStat,
          ...(resolution.fate
            ? { fate: { quality: resolution.fate.quality, label: resolution.fate.label } }
            : {}),
          verdict: {
            kind: resolution.verdict.kind,
            headline:
              resolution.verdict.kind === 'viable'
                ? '这条路在你的条件下成立'
                : resolution.verdict.kind === 'breached'
                  ? '你的条件还没到这条路的门槛'
                  : '证据不足，这一局不给结论',
            breach,
          },
        };
      }

      return resolveInto(state, turn, choice, { isSuccess, dice });
    }

    /**
     * 第四幕终端判卷落地。
     *
     * 与 CHOOSE 的唯一区别是**裁决来源**：骰面与胜负来自服务端判卷
     * （`POST /api/boss/evaluate`），而不是前端现掷 ——
     * 于是同一份方案在任何设备上都得到同一结局，「AI 判卷」也可复现。
     */
    case 'RESOLVE_BOSS': {
      if (state.phase !== 'choices') {
        return state;
      }

      const { turn, choice, verdict } = action;
      const dice: DiceResultView = {
        rawRoll: verdict.dice,
        total: verdict.total,
        difficulty: verdict.dc,
        outcome: verdict.outcome,
        critical: verdict.critical,
        baseModifier: verdict.baseModifier,
        relicModifier: verdict.relicModifier,
        targetStat: 'skill',
      };

      const next = resolveInto(state, turn, choice, {
        isSuccess: verdict.outcome === 'success',
        dice,
        extraSummary: verdictLines(verdict),
        bossOutcome: verdict.outcome,
      });

      return { ...next, boss: verdict };
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
        lastCheck: null,
      };
    }

    case 'RESCUE': {
      if (state.stats.bond < 30 || state.phase === 'ended') {
        return state;
      }

      return {
        ...state,
        stats: { ...state.stats, san: 20, bond: toStatValue(state.stats.bond - 30) },
        status: 'PLAYING',
        phase: 'outcome',
        speaker: 'kanshan',
        mood: 'hope',
        dialogueText: '「大 V 我把人叫来了。你先喘口气，剩下的我们慢慢来。」',
        outcomeTitle: '刘看山呼叫救场',
        outcomeDetail: '消耗 30 羁绊，知乎大 V 金句拍马赶到，强行锁血到 SAN 20。',
        hitKey: state.hitKey + 1,
        log: [...state.log, '消耗 30 羁绊，呼叫知乎大 V 救场'],
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
            lastCheck: null,
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
          lastCheck: null,
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
          lastCheck: null,
          pendingActivated: [],
        };
      }

      return enterTurn(state, nextTurn);
    }

    case 'USE_RELIC': {
      if (state.phase !== 'choices' && state.phase !== 'story') {
        return state;
      }

      const owned = state.inventory.find((slot) => slot?.relic.id === action.relicId);

      if (!owned || owned.relic.kind !== 'active' || owned.isConsumed) {
        return state;
      }

      if (state.pendingActivated.includes(action.relicId)) {
        return state;
      }

      return {
        ...state,
        pendingActivated: [...state.pendingActivated, action.relicId],
        log: [...state.log, `激活遗物：${owned.relic.name}`],
      };
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
        dmSource: action.source,
        dmLoading: false,
        outcomeTitle: '',
        outcomeDetail: '',
        lastCheck: null,
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

    case 'LOAD_MEMORY': {
      // 装载账号记忆，并把「前世遗念」卡补进遗物栏。
      //
      // 之所以在这里装卡而不是开局时装：记忆来自服务端、是异步的。
      // 只有已登录且上一局留过遗言时才会有卡 —— 未登录永远走到 else 分支。
      const next = {
        ...state,
        memory: action.memory,
        memoryAuthenticated: action.authenticated,
      };

      if (!action.memory) {
        return next;
      }

      const legacyBase = RELIC_LIBRARY['relic-legacy-note'];
      if (!legacyBase) {
        return next;
      }

      const legacy = legacyRelicFrom(action.memory, legacyBase);
      if (!legacy) {
        return next;
      }

      const equipped = equipRelic(state.inventory, ownRelic(legacy, state.turnIndex));
      if (!equipped.added) {
        return next;
      }

      return {
        ...next,
        inventory: equipped.inventory,
        log: [...state.log, `前世遗念「${legacy.name}」已装入遗物栏`],
      };
    }

    case 'SET_FINAL_WORDS':
      return { ...state, finalWords: action.words.slice(0, 60) };

    case 'SET_RUN_SAVED':
      return {
        ...state,
        runSaved: true,
        saveFailureReason: null,
        savedTotalRuns: action.totalRuns,
        log: [...state.log, `本局已存入你的宇宙（累计第 ${action.totalRuns} 局）`],
      };

    case 'SET_RUN_SAVE_FAILED':
      // 写失败就**不能**标记 saved：结算页会据此换成「没能写入」的说明。
      return {
        ...state,
        runSaved: false,
        saveFailureReason: action.reason,
        log: [...state.log, `本局未能写入你的宇宙（${action.reason}）`],
      };

    case 'SET_SEAL_STATE':
      return { ...state, sealState: action.state };

    case 'CLEAR_FLOATS':
      return { ...state, floats: [] };

    case 'CLEAR_TRANSITION':
      return { ...state, transition: null };

    case 'RESTART':
      return createInitialState(state.scenarioId, action.seed, state.originId);

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* 子组件                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 风险选项的门槛档位（替代旧的「D20 检定 · 属性 DC n」）。
 *
 * 为什么不显示精确 DC：`check.difficulty` 现在换算的是**承压需求**，
 * 不再是某个属性的检定难度；把原始数字摆出来会让人以为
 * 「掷高一点就能过」。档位给出同样的「这条更难」信号，但不撒谎。
 */
function riskBandLabel(difficulty: number): string {
  if (difficulty <= 14) return '门槛一般';
  if (difficulty <= 20) return '门槛较高';
  return '门槛很高';
}

function ChoiceCard({
  choice,
  onSelect,
}: {
  readonly choice: ScenarioChoice;
  readonly onSelect: (choice: ScenarioChoice) => void;
}) {
  const isRisk = Boolean(choice.check);
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const frameRef = React.useRef<number | null>(null);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const node = ref.current;
    if (!node || frameRef.current !== null) {
      return;
    }

    const { clientX, clientY } = event;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const rect = node.getBoundingClientRect();
      node.style.setProperty('--mx', `${clientX - rect.left}px`);
      node.style.setProperty('--my', `${clientY - rect.top}px`);
    });
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onPointerMove={handlePointerMove}
      onClick={() => onSelect(choice)}
      className={[
        'gmv-choice group w-full rounded-2xl border p-3.5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 sm:p-4',
        isRisk
          ? 'border-relic-gold/30 bg-relic-gold/[0.05] hover:border-relic-gold/70 hover:shadow-relic'
          : 'border-white/10 bg-white/[0.03] hover:border-zhihu-500/60 hover:shadow-glow',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {choice.experienceUnlockId ? (
          <span
            className="chip-gold"
            title="这个选项来自你在上一幕获得的一条真实知乎经验"
          >
            经验解锁
          </span>
        ) : null}
        {isRisk && choice.check ? (
          /*
            风险选项的标签。

            旧文案是「D20 检定 · 专业力 DC 13」—— 它承诺了一次骰子检定，
            但成败现在由**你的条件与这条路的需求**裁决（骰子只决定遭遇），
            而且 `check.difficulty` 换算的是承压需求、不是那条属性。
            两处都不再成立，所以改成**不给伪精确数字的门槛档位**：
            玩家仍然知道「这条更难」，但不会再以为掷骰子能过关。
          */
          <span className="chip-gold">
            风险选项 · {riskBandLabel(choice.check.difficulty)}
          </span>
        ) : (
          <span className="chip-zhihu">稳妥 · 无门槛</span>
        )}
      </div>

      <p className="mt-2 text-sm font-semibold text-white sm:text-[15px]">{choice.text}</p>
      <p className="mt-1 text-xs text-slate-400">{choice.hint}</p>

      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* 明确标注这是剧本文案：我们还没有真实聚合数据，不能让它看起来像社区统计 */}
          <span className="shrink-0 rounded border border-white/12 px-1 py-px font-mono text-[9px] tracking-wider text-slate-500">
            剧本模拟
          </span>
          <span className="truncate text-[11px] text-slate-500">{choice.ghostEchoStat}</span>
        </span>
        <span
          className={[
            'shrink-0 text-[11px] font-semibold transition-transform duration-200 group-hover:translate-x-0.5',
            isRisk ? 'text-amber-300' : 'text-zhihu-400',
          ].join(' ')}
        >
          选择
        </span>
      </div>
    </button>
  );
}

const STAT_LABEL: Record<TargetStat, string> = {
  san: 'SAN 心智',
  skill: '专业力',
  bond: '羁绊',
};

function PortraitLayer({
  stage,
  speaker,
}: {
  readonly stage: readonly CharacterOnStage[];
  readonly speaker: SpeakerId | null;
}) {
  const positions: Record<StageSlot, string> = {
    left: 'left-[2%] sm:left-[6%]',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-[2%] sm:right-[6%]',
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[74%]">
      {stage.map((member) => {
        const character = getCharacter(member.speaker);

        return (
          <div
            key={member.speaker}
            className={[
              // 窄屏把立绘缩到 0.82，优先保证 HUD 与对话框完整
              'absolute bottom-0 h-full w-[46%] max-w-[320px] origin-bottom scale-[0.82] animate-portrait-in sm:w-[34%] sm:scale-100',
              positions[member.slot],
            ].join(' ')}
          >
            <Portrait
              character={character}
              expression={member.expression}
              speaking={speaker === member.speaker}
            />
          </div>
        );
      })}
    </div>
  );
}

function ActTitleOverlay({ act }: { readonly act: ActCard | null }) {
  if (!act) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 flex flex-col items-center px-6 text-center">
      <p className="font-mono text-[11px] tracking-[0.4em] text-zhihu-400">
        ACT {String(act.act).padStart(2, '0')}
      </p>
      <p className="gmv-act-title mt-2 text-2xl font-bold text-white sm:text-4xl">{act.title}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 推演舱                                                                      */
/* -------------------------------------------------------------------------- */

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
   * 这是新主链的入口：首页 → POST /api/sessions → 澄清 → prepare-world → 这里。
   * 没有 session 参数时走旧路径（goal / case / scenario），行为零变化。
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

  /** Session 模式下的玩家目标：来自会话的问题，而不是 URL 参数。 */
  const effectiveGoal = sessionView?.question ?? goalParam;

  const [fateOpen, setFateOpen] = React.useState(false);
  const [inventoryOpen, setInventoryOpen] = React.useState(false);
  const [report, setReport] = React.useState<string | null>(null);
  const [reportSource, setReportSource] = React.useState<'model' | 'fallback' | null>(null);
  const [reportLoading, setReportLoading] = React.useState(false);
  const reportRequestedRef = React.useRef(false);
  const [loadingPhase, setLoadingPhase] = React.useState<'profile' | 'turn'>('turn');

  /**
   * 证据网格（方案 §5）：AI 自由推演时，把「知乎」从角标装饰变成
   * 每一个数值的出处。约束滑杆与临界点都长在这份网格上。
   */
  const [meshOpen, setMeshOpen] = React.useState(false);
  const [mesh, setMesh] = React.useState<EvidenceMesh | null>(null);
  const [constraints, setConstraints] = React.useState<ConstraintProfile>(() => loadConstraints());
  const [exploredPathIds, setExploredPathIds] = React.useState<readonly string[]>([]);
  /** 运行模式（v2 §11）：由服务端真实能力决定，界面不自己拼条件。 */
  const [health, setHealth] = React.useState<HealthView | null>(null);

  /** 已认下的承诺：候选 id → 到期时间。未登录时服务端不落盘，这里为空。 */
  const [committedMap, setCommittedMap] = React.useState<Record<string, string>>({});
  const [committingId, setCommittingId] = React.useState<string | null>(null);

  const scenario = React.useMemo(() => getScenario(state.scenarioId), [state.scenarioId]);

  const currentTurn = React.useMemo(
    () =>
      state.overrides[state.turnIndex] ??
      scenario.turns.find((turn) => turn.turnIndex === state.turnIndex) ??
      scenario.turns[0],
    [scenario, state.turnIndex, state.overrides],
  );

  const scene = getScene(state.sceneId);
  const currentBeat = state.beats[state.beatIndex] ?? null;
  const isActBeat = currentBeat?.id.startsWith('act-') ?? false;

  /** 约束持久化：下次打开滑杆停在原位（约束是玩家自己的条件，不是每局重填）。 */
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
   * 让 AxisHUD 与后续裁决都看到新条件。
   */
  React.useEffect(() => {
    const pending = nextConstraintsRef.current;
    if (!pending) {
      return;
    }
    nextConstraintsRef.current = null;
    setConstraints(pending);
  }, [state.phase, state.turnIndex]);

  /** 本幕的命运事件（v3 §6）：纯函数计算，因此不需要存进 state。 */
  const currentEvent = React.useMemo(
    () =>
      drawEvent({
        seed: state.seed,
        actIndex: state.turnIndex,
        context: { constraints },
        tone: fateQualityOf(
          rollD20(createCheckRng(state.seed, `event:${state.turnIndex}`, state.turnIndex)),
        ),
      }),
    [constraints, state.seed, state.turnIndex],
  );

  /** 运行模式：只拿在线/离线结论，不拿密钥。 */
  React.useEffect(() => {
    const controller = new AbortController();
    void fetchHealth({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setHealth(result);
      }
    });
    return () => controller.abort();
  }, []);

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
          setSessionLoadFailed(true);
          return;
        }
        const payload = (await response.json()) as { data?: { id?: unknown; question?: unknown; profile?: unknown; profileAnalysis?: unknown; worldBlueprint?: unknown } };
        const data = payload?.data;
        const blueprint = data?.worldBlueprint as WorldBlueprint | undefined;
        if (!blueprint || typeof data?.id !== 'string' || typeof data?.question !== 'string') {
          setSessionLoadFailed(true);
          return;
        }
        const view: PlaySessionView = {
          id: data.id,
          question: data.question,
          profile: (data.profile as PlayerProfile | null) ?? null,
          profileAnalysis: typeof data.profileAnalysis === 'string' ? data.profileAnalysis : null,
          worldBlueprint: blueprint,
        };
        setSessionView(view);
        dispatch({ type: 'LOAD_WORLD_BLUEPRINT', blueprint, sessionId: view.id });
        if (view.profile) {
          dispatch({ type: 'SET_PROFILE', profile: view.profile, analysis: view.profileAnalysis });
        }
      } catch {
        if (!controller.signal.aborted) {
          setSessionLoadFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [sessionParam]);

  /**
   * AI 自由推演时拉一次证据网格。
   *
   * 只拉一次：网格是同一个目标下的稳定产物（有 `meshHash` 与 24h 服务端缓存），
   * 逐幕重拉只会浪费配额。预置剧本不拉 —— 那是零延迟演示路线，不该引入等待。
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

  /** 各轴的最紧需求：来自所有路线的代价画像，画成滑杆上的需求刻度线。 */
  const axisRequirements = React.useMemo(() => {
    if (!mesh) {
      return {};
    }
    const out: Partial<Record<'runway' | 'drawdown' | 'reversibility' | 'ally', number>> = {};
    for (const path of mesh.paths) {
      if (path.sampleSize === 0) {
        continue;
      }
      for (const cap of axisCapsFor(path)) {
        const current = out[cap.axis];
        if (current === undefined || cap.requirement > current) {
          out[cap.axis] = cap.requirement;
        }
      }
    }
    return out;
  }, [mesh]);

  /** 当前约束下的裁决与临界点（纯函数，零请求）。 */
  const judgment = React.useMemo(
    () => (mesh ? judgeMesh({ paths: mesh.paths, constraints }) : null),
    [mesh, constraints],
  );

  /** 双牌对比也在本地算 —— 拖动滑杆时不需要任何网络往返。 */
  const sandwich = React.useMemo(
    () => (mesh ? sandwichLocally(mesh, constraints) : null),
    [mesh, constraints],
  );

  /**
   * 四维结算（方案 §9）：赢 ≠ 走完四幕。
   * 只有拿到网格时才算 —— 没有证据的局不该给「证据覆盖」打分。
   */
  const clarity = React.useMemo(
    () =>
      mesh
        ? clarityOf({
            paths: mesh.paths,
            constraints,
            exploredPathIds,
          })
        : null,
    [mesh, constraints, exploredPathIds],
  );

  /**
   * 认下一条承诺（方案 §7.2）。
   *
   * 未登录时服务端返回 saved=false 且不落盘 —— 界面照常反馈「已认下」，
   * 但会在契约区如实标注「不会被记住」。不用弹窗拦人（沿用产品的
   * 「用损失感驱动登录，不用门槛拦人」取向）。
   */
  const handleCommit = React.useCallback(
    async (candidate: CommitCandidate) => {
      setCommittingId(candidate.id);
      try {
        const result = await createCommitment({
          // 用清单条目 id 当承诺 id：撤销时能精确指回同一条
          commitmentId: candidate.id,
          runId: runIdFor(seed, state.scenarioId, SCENARIO_REVISION),
          action: candidate.action,
          timeBox: candidate.timeBox,
          signal: candidate.signal,
          verifyHint: candidate.verifyHint ?? '能用自己的话说清做到了什么',
          pathId: candidate.pathId ?? null,
        });
        setCommittedMap((current) => ({
          ...current,
          [candidate.id]: result.dueAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
        }));
      } finally {
        setCommittingId(null);
      }
    },
    [seed, state.scenarioId],
  );

  const handleUncommit = React.useCallback(async (candidateId: string) => {
    setCommittingId(candidateId);
    try {
      // 撤销必须真删：否则承诺会变成甩不掉的负担。
      // 提交时用的 id 就是清单条目 id，服务端以其为 commitmentId。
      await removeCommitmentById(candidateId);
      setCommittedMap((current) => {
        const next = { ...current };
        delete next[candidateId];
        return next;
      });
    } finally {
      setCommittingId(null);
    }
  }, []);

  /**
   * 本回合的知乎来源。
   *
   * 优先用 `npm run sync:zhihu`（官方 key）落盘的真实来源 —— 带真实答主、
   * 赞同数与抓取时间，角标显示「知乎高赞 N」；没有真数据时退回剧本文案，
   * 角标显示「剧本模拟引用」且**不显示任何数字**。
   */
  const currentTurnSource = React.useMemo(() => {
    const verified = getVerifiedSource(`${scenario.id}:t${currentTurn.turnIndex}`);
    if (verified) {
      return {
        author: verified.author,
        quote: verified.quote,
        sourceUrl: verified.url,
        upvotes: verified.upvotes ?? undefined,
        status: 'verified' as const,
        retrievedAt: verified.retrievedAt,
      };
    }
    return currentTurn.zhihuBullet;
  }, [currentTurn, scenario.id]);

  /* AI DM：当前回合尚无动态关卡时拉取 */
  const needsAiTurn =
    state.scenarioId === AI_DM_SCENARIO_ID &&
    state.phase === 'story' &&
    !state.overrides[state.turnIndex] &&
    // Session 模式必须等蓝图（或确认失败）才发请求 —— 失败时按旧路径降级
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
   * 三条路径刻意不同（P0-2 新增了第一条）：
   * - **Session 个性化推演**：幕数**必须等于编译出的世界蓝图幕数**（固定 4 幕）。
   *   蓝图是「进入世界 → 体会代价 → 遇到反例 → 终局反思」这一段弧，
   *   它本来就只有四幕；如果让 AI 预算把它拉成 7～8 幕，
   *   **第五幕之后会一直重复 `final-reflection`** —— 体验拖沓且重复。
   * - **预置剧本**：幕数由剧本本身决定（人工精调的四幕，每幕都有手写内容），
   *   动态幕不该截断它；
   * - **AI 自由推演（legacy `/play?goal=`）**：幕数由张力预算决定
   *   （`runBudgetFor`），因此不同的出身与属性会得到不同的幕数。
   *
   * 三者都用 `MAX_TURNS` 作为硬上限，口径只有一处。
   */
  const totalActCount = React.useMemo(() => {
    /**
     * Session 模式优先：蓝图有几幕就跑几幕。
     *
     * 这里读的是 `sessionView.worldBlueprint.acts.length`（与 reducer 写入的
     * `state.totalActs` 同源），保证「UI 计算 / Reducer 终局判断 / DM totalTurns」
     * 三处一致 —— 三处口径不同会让终局在第 4 幕与第 8 幕之间摇摆。
     */
    const blueprintActs = sessionView?.worldBlueprint?.acts.length ?? 0;
    if (blueprintActs > 0) {
      return blueprintActs;
    }

    if (state.scenarioId !== AI_DM_SCENARIO_ID) {
      return scenario.turns.length;
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
    scenario.turns.length,
    sessionView?.worldBlueprint,
    state.originId,
    state.scenarioId,
  ]);

  /** 本局开局的幕状态：用于展示余量与危机判定（纯函数，可复现）。 */
  const runAct = React.useMemo(
    () => createRunActState(getOrigin(state.originId).id),
    [state.originId],
  );

  const snapshotRef = React.useRef({ state, goalParam: effectiveGoal, totalTurns: totalActCount, turnSnippets, sessionView, usedUnlockIds });
  snapshotRef.current = { state, goalParam: effectiveGoal, totalTurns: totalActCount, turnSnippets, sessionView, usedUnlockIds };

  /**
   * 记忆是否已加载完成。
   *
   * 这个门闩是必需的：`MEMORY_ECHO` 与 AI DM 拉取在同一次渲染里都会触发，
   * 若不等待，AI 请求读到的 `state.memory` 还是 null —— 结果就是
   * 「前世遗念」卡牌装上了（开局时同步读取），但 memoryBlock / personaTags
   * 却是空的，AI 收不到「老友开场」的指令。
   */
  const memoryReady = state.memoryEchoed;

  React.useEffect(() => {
    if (!needsAiTurn || !memoryReady) {
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      const { state: current, goalParam: goal, totalTurns, turnSnippets, sessionView: currentSession, usedUnlockIds: usedUnlocks } = snapshotRef.current;
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
        setLoadingPhase('profile');
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

      // 第二步：带着处境档案生成这一幕
      setLoadingPhase('turn');

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
        zhihuSnippets: [...turnSnippets],
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

  /* 飘字自动清理 */
  React.useEffect(() => {
    if (state.floats.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => dispatch({ type: 'CLEAR_FLOATS' }), 1500);
    return () => window.clearTimeout(timer);
  }, [state.floats]);

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
      if (result.persisted) {
        dispatch({ type: 'SET_RUN_SAVED', totalRuns: result.totalRuns });
        return;
      }
      // 没落盘就如实说 ── 宁可告诉玩家「这局没记住」，也不能谎报成功。
      dispatch({ type: 'SET_RUN_SAVE_FAILED', reason: result.reason });
    });
  }, [
    effectiveGoal,
    scenario.turns.length,
    state.log,
    state.memoryAuthenticated,
    state.originId,
    state.outcomeDetail,
    state.outcomeTitle,
    state.phase,
    state.sanHistory,
    state.status,
    state.turnIndex,
  ]);

  /* 终局第二步：封存遗言 —— 玩家点按钮才写，且只有真落盘才显示「已封存」 */
  const handleSealFinalWords = React.useCallback(() => {
    if (!state.memoryAuthenticated || state.sealState === 'sealing') {
      return;
    }
    if (state.finalWords.trim().length === 0) {
      return;
    }

    dispatch({ type: 'SET_SEAL_STATE', state: 'sealing' });

    void sealFinalWords(state.finalWords).then((result) => {
      dispatch({ type: 'SET_SEAL_STATE', state: result.persisted ? 'sealed' : 'failed' });
    });
  }, [state.finalWords, state.memoryAuthenticated, state.sealState]);

  /* 终局：请求《专属避坑指南》 */
  React.useEffect(() => {
    if (state.phase !== 'ended' || reportRequestedRef.current) {
      return;
    }

    reportRequestedRef.current = true;
    setReportLoading(true);

    const choices = state.log
      .map((line) => /^第 (\d+) 幕：(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ act: Number(match[1]), text: match[2] }));

    const payload = {
      goal: effectiveGoal,
      profile: state.profile,
      analysis: state.profileAnalysis,
      originName: getOrigin(state.originId).name,
      success: state.status === 'OVER_SUCCESS',
      survivedActs: Math.min(state.turnIndex, state.totalActs),
      totalActs: state.totalActs,
      stats: state.stats,
      choices,
      relics: state.inventory
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
        .map((slot) => slot.relic.name),
      sanHistory: state.sanHistory,
    };

    fetchRunReport(payload)
      .then((result) => {
        if (result) {
          setReport(result.text);
          setReportSource(result.source);
        }
      })
      .finally(() => setReportLoading(false));
  }, [
    effectiveGoal,
    scenario.turns.length,
    state.inventory,
    state.log,
    state.originId,
    state.phase,
    state.profile,
    state.sanHistory,
    state.stats,
    state.status,
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

  const handleSelectNode = React.useCallback(
    (nodeId: string) => {
      const choice = currentTurn.choices.find(
        (candidate) => nodeId === `n${currentTurn.turnIndex}-${candidate.id}`,
      );

      if (choice) {
        setFateOpen(false);
        handleSelect(choice);
      }
    },
    [currentTurn, handleSelect],
  );

  const graph: FateTreeGraph = React.useMemo(
    () => ({ nodes: state.nodes, edges: state.edges }),
    [state.nodes, state.edges],
  );

  /** 本局走过的选择文案（按幕顺序），清单与画像共用同一份口径。 */
  const runChoiceTexts = React.useMemo(
    () =>
      state.log
        .map((line) => /^第 (\d+) 幕：(.*)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[2]),
    [state.log],
  );

  /**
   * 清单可用的来源池。
   *
   * 已认证来源（官方 key 同步落盘）标 `verified`；其余是剧本文案，
   * 只能进 `scripted` —— 清单构建器据此决定能不能标「站内来源」。
   */
  const checklistSources = React.useMemo(
    () =>
      scenario.turns
        .map((turn) => {
          const bullet = turn.zhihuBullet;
          if (!bullet) {
            return null;
          }
          const id = `${scenario.id}:t${turn.turnIndex}`;
          const verified = getVerifiedSource(id);
          if (verified) {
            return {
              id,
              quote: verified.quote,
              status: 'verified' as const,
              url: verified.url,
              author: verified.author,
              upvotes: verified.upvotes,
              retrievedAt: verified.retrievedAt,
            };
          }
          return { id, quote: bullet.quote, status: 'scripted' as const };
        })
        .filter((source): source is NonNullable<typeof source> => source !== null),
    [scenario],
  );

  const checklist = React.useMemo(
    () =>
      buildRealityChecklist({
        goal: effectiveGoal,
        choices: runChoiceTexts,
        outcome: state.status === 'OVER_SUCCESS' ? 'success' : 'failure',
        bossIssues: state.boss?.issues ?? [],
        sources: checklistSources,
      }),
    [checklistSources, effectiveGoal, runChoiceTexts, state.boss?.issues, state.status],
  );

  const relicSummaries = React.useMemo(
    () =>
      state.inventory
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
        .map((slot) => ({ name: slot.relic.name, kind: slot.relic.kind })),
    [state.inventory],
  );

  const equippedCount = relicSummaries.length;
  const saltPoints = state.stats.skill * 2 + state.stats.bond;
  const sanCritical = state.phase === 'critical' || (state.stats.san < 30 && state.phase !== 'ended');
  const rescueAvailable = state.phase !== 'ended' && state.stats.bond >= 30 && sanCritical;
  const isEnded = state.phase === 'ended';

  /** 第四幕 = 终局 Boss：隐藏普通选项，改用终端。 */
  const isFinalAct = currentTurn.turnIndex >= state.totalActs;

  /**
   * 终端 Boss 的提交状态。
   *
   * 判卷由服务端完成（规则引擎裁决），所以失败也要如实告知并可重试，
   * 绝不因为一次网络抖动把玩家的终局吞掉。
   */
  const [bossSubmitting, setBossSubmitting] = React.useState(false);
  const [bossError, setBossError] = React.useState<string | null>(null);

  const runId = React.useMemo(
    () => runIdFor(state.seed, state.scenarioId, SCENARIO_REVISION),
    [state.scenarioId, state.seed],
  );

  const handleBossSubmit = React.useCallback(
    (answer: string) => {
      if (bossSubmitting || state.phase !== 'choices') {
        return;
      }

      // 终端结局走「风险选项」的结算分支（有 check 的那个；没有就取第一个）
      const choice = currentTurn.choices.find((item) => item.check) ?? currentTurn.choices[0];
      if (!choice) {
        return;
      }

      setBossSubmitting(true);
      setBossError(null);

      // 本局给出的知乎片段：已认证来源优先，否则用剧本文案（角标会标「剧本模拟」）
      const verifiedSources = currentTurn.zhihuBullet
        ? [
            {
              id: `${scenario.id}:t${currentTurn.turnIndex}`,
              quote: currentTurn.zhihuBullet.quote,
            },
          ]
        : [];

      void submitBossAnswer({
        runId,
        seed: state.seed,
        scenarioRevision: SCENARIO_REVISION,
        turnIndex: currentTurn.turnIndex,
        answer,
        world: state.world,
        sources: verifiedSources,
      }).then((result) => {
        setBossSubmitting(false);

        if (!result.ok) {
          setBossError(result.reason);
          return;
        }

        dispatch({ type: 'RESOLVE_BOSS', turn: currentTurn, choice, verdict: result.verdict });
      });
    },
    [bossSubmitting, currentTurn, runId, scenario.id, state.phase, state.seed, state.world],
  );

  /** 放弃提交：按稳妥选项结算（不走判卷，也不假装玩家写了方案）。 */
  const handleBossSkip = React.useCallback(() => {
    if (bossSubmitting || state.phase !== 'choices') {
      return;
    }
    const choice = currentTurn.choices.find((item) => !item.check) ?? currentTurn.choices[0];
    if (choice) {
      dispatch({ type: 'CHOOSE', choice, turn: currentTurn });
    }
  }, [bossSubmitting, currentTurn, state.phase]);

  /**
   * 本局的决策画像。
   *
   * 注意不能用 state.memory.personalityTags —— 那是**上一局**留下的，
   * 拿它显示在本次结算页上会把「前世」和「今生」混起来。
   * 这里用本局的 log 与 SAN 曲线实时推导，口径与写回记忆时完全一致。
   */
  const currentArchetypes = React.useMemo(() => {
    if (!isEnded) {
      return [];
    }

    const choices = state.log
      .map((line) => /^第 (\d+) 幕：(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[2]);

    return deriveArchetypes({
      choices,
      survived: state.status === 'OVER_SUCCESS',
      lastAct: Math.min(state.turnIndex, state.totalActs),
      totalActs: state.totalActs,
      sanHistory: state.sanHistory,
    });
  }, [isEnded, scenario.turns.length, state.log, state.sanHistory, state.status, state.turnIndex]);

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-ink-950">
      <GameHud
        stats={state.stats}
        turnIndex={state.turnIndex}
        totalTurns={state.totalActs}
        seed={state.seed}
        sceneName={scene.name}
        timeLabel={scene.timeLabel}
        dmSource={state.dmSource}
        equippedCount={equippedCount}
        pendingCount={state.pendingActivated.length}
        hitKey={state.hitKey}
        onOpenFate={() => setFateOpen(true)}
        onOpenInventory={() => setInventoryOpen(true)}
        {...(mesh ? { onOpenEvidence: () => setMeshOpen(true) } : {})}
        onQuit={() => {
          window.location.href = '/';
        }}
      />

      {/*
        v3 §11 布局的第一层：Worldline Rail。
        它是玩家对「我走到哪了、这条线还站得住吗」的第一眼答案，
        因此放在 HUD 正下方、舞台之上。
      */}
      {!isEnded ? (
        <div className="px-3 pt-1 sm:px-5">
          <div className="mx-auto w-full max-w-[920px] rounded-2xl border border-white/10 bg-ink-900/60 px-3.5 py-2">
            <WorldlineRail
              totalActs={state.totalActs}
              currentAct={state.turnIndex}
              state={worldlineStateOf(
                judgment?.critical ? judgment.critical.verdict : { kind: 'unknown' },
              )}
              unstableFrom={judgment?.critical?.verdict.kind === 'breached' ? state.turnIndex : null}
            />
          </div>
        </div>
      ) : null}

      {/* 隐藏信号条：只给定性告警，不露后台数值 */}
      {!isEnded ? (
        <div className="px-3 pt-1.5 sm:px-5">
          <HiddenSignalStrip
            world={state.world}
            extra={[...worldModelBrief(state.model).mental, ...worldModelBrief(state.model).anchor]}
            className="mx-auto w-full max-w-[920px]"
          />
        </div>
      ) : null}

      {/*
        舞台只占一个有上下限的视口切片，后续内容交给页面自然滚动。

        这里不能再用 `flex-1 + min-h-[200px]` 配合根节点 `overflow-hidden`：
        矮窗口下 HUD、世界线与舞台会先吃光高度，而不允许收缩的对话框会被
        直接裁出视口。页面滚动比嵌套滚动更容易发现，也保证任意数量的选项可达。
      */}
      <div
        key={`shake-${state.shakeKey}`}
        className={[
          'relative',
          isEnded
            ? 'h-[clamp(120px,22vh,240px)] shrink-0'
            : 'h-[clamp(180px,30vh,320px)] shrink-0',
          state.shakeKey > 0 ? 'animate-[glitch_0.32s_steps(2,end)]' : '',
        ].join(' ')}
      >
        <SceneStage sceneId={state.sceneId} />
        <PortraitLayer stage={state.stage} speaker={state.speaker} />
        {isActBeat && currentTurn.act ? <ActTitleOverlay act={currentTurn.act} /> : null}
        <DamageFloat items={state.floats} />

        {sanCritical ? (
          <div aria-hidden="true" className="alert-vignette animate-alert-pulse" />
        ) : null}
      </div>

      {/* 对话框 / 抉择 / 结算：使用页面唯一滚动轴，避免内容被裁或出现双滚动区。 */}
      <div className="relative z-20 flex flex-col">
        {isEnded ? (
          <div className="px-3 pb-5 sm:px-5">
            <div className="mx-auto w-full max-w-[920px]">
              <EndgamePass
                seed={state.seed}
                scenarioTitle={scenario.title}
                stats={state.stats}
                survivedTurns={Math.min(state.turnIndex, state.totalActs)}
                totalTurns={state.totalActs}
                saltPoints={saltPoints}
                relics={relicSummaries}
                success={state.status === 'OVER_SUCCESS'}
                sanHistory={state.sanHistory}
                archetypes={currentArchetypes}
                finalWords={state.finalWords}
                onFinalWordsChange={(words) => dispatch({ type: 'SET_FINAL_WORDS', words })}
                onSealFinalWords={handleSealFinalWords}
                sealState={state.sealState}
                memoryStatus={
                  !state.memoryAuthenticated
                    ? 'guest'
                    : state.runSaved
                      ? 'saved'
                      : state.saveFailureReason
                        ? 'failed'
                        : 'pending'
                }
                saveFailureReason={state.saveFailureReason}
                scenarioId={state.scenarioId}
                savedTotalRuns={state.savedTotalRuns}
                onRestart={() => {
                  reportRequestedRef.current = false;
                  setReport(null);
                  setReportSource(null);
                  dispatch({ type: 'RESTART', seed: createSeed() });
                }}
              />

              <EndgameReport text={report} loading={reportLoading} source={reportSource} />

              {/* 终局要交代清楚「为什么是这个结局」：判卷分解 + 可执行的下一步 */}
              {state.boss ? <BossVerdictPanel verdict={state.boss} className="mt-4" /> : null}

              <RealityChecklist
                items={checklist.items}
                hash={checklist.hash}
                className="mt-4"
              />

              {/*
                四维结算（方案 §9）：结算的不是「走了几幕」，而是
                「你对这个决定的理解深度」。没有证据网格时不显示 ——
                没有证据的局不该给「证据覆盖」打分。
              */}
              {clarity ? <ClarityRadar score={clarity} className="mt-4" /> : null}

              {/*
                赛博契约（方案 §7.2）：把建议变成可回收的承诺。
                勾下之后七天后回来问结果，结果会回灌下一局的约束建议。
              */}
              <CommitPicker
                className="mt-4"
                authenticated={state.memory !== null}
                committed={committedMap}
                pendingId={committingId}
                candidates={checklist.items.map((item) => ({
                  id: item.id,
                  action: item.action,
                  timeBox: item.timeBox,
                  signal: item.verifySignal,
                  pathId: judgment?.critical?.pathId ?? null,
                }))}
                onSubmit={handleCommit}
                onRemove={handleUncommit}
              />
            </div>
          </div>
        ) : state.dmLoading ? (
          <div className="px-3 pb-4 sm:px-5">
            <div className="mx-auto w-full max-w-[920px]">
              <NeuralLoader phase={loadingPhase} />
            </div>
          </div>
        ) : (
          <div>
            <DialogueBox
              speakerId={state.speaker}
              text={state.dialogueText}
              mood={state.mood}
              danger={state.phase === 'checking' || state.mood === 'panic'}
              unstable={state.stats.san < 30 && state.phase !== 'outcome'}
              canAdvance={state.phase === 'story' || state.phase === 'outcome'}
              onAdvance={() =>
                dispatch({ type: state.phase === 'outcome' ? 'ADVANCE_ACT' : 'ADVANCE_BEAT' })
              }
              hint={state.phase === 'outcome' ? '继续下一幕' : '点击继续'}
              source={<SourceBadge source={currentTurnSource} />}
            >
            {state.phase === 'choices' ? (
              isFinalAct ? (
                /* 第四幕：隐藏普通选项，改用终端 —— 结局取决于玩家自己写下的方案 */
                <BossTerminal
                  question={`${currentTurn.title}：${currentTurn.storyText ?? ''}`.slice(0, 160)}
                  minLength={BOSS_ANSWER_MIN}
                  maxLength={BOSS_ANSWER_MAX}
                  submitting={bossSubmitting}
                  error={bossError}
                  onSubmit={handleBossSubmit}
                  onSkip={handleBossSkip}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {currentTurn.choices.map((choice) => (
                    <ChoiceCard key={choice.id} choice={choice} onSelect={handleSelect} />
                  ))}
                </div>
              )
            ) : null}

            {state.phase === 'outcome' ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] text-slate-400">
                  <span
                    className={
                      state.lastCheck?.outcome === 'failure' ? 'text-rose-300' : 'text-amber-300'
                    }
                  >
                    {state.outcomeTitle}
                  </span>
                  {state.lastCheck?.critical === 'critical-success' ? ' · 天然 20' : ''}
                  {state.lastCheck?.critical === 'critical-failure' ? ' · 天然 1' : ''}
                  <span className="mx-2 text-slate-600">|</span>
                  {state.outcomeDetail}
                </p>

                {/* 判卷分解：把「为什么是这个结局」摊开，避免黑箱判卷感 */}
                {state.boss ? <BossVerdictPanel verdict={state.boss} className="w-full" /> : null}

                <button
                  type="button"
                  onClick={() => dispatch({ type: 'ADVANCE_ACT' })}
                  className="btn-primary"
                >
                  继续下一幕
                  <span aria-hidden="true">▼</span>
                </button>
              </div>
            ) : null}

            {state.phase === 'critical' ? (
              <div className="rounded-2xl border border-relic-danger/45 bg-relic-danger/[0.07] p-4">
                <p className="font-mono text-[11px] tracking-widest text-rose-400">SAN CRITICAL</p>
                <h3 className="mt-1 text-lg font-black text-rose-300">心智即将归零</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  再撑不住就真的结束了。刘看山还能帮你喊一次人——消耗 30 点羁绊，强行锁血到 SAN 20。
                </p>

                <div className="mt-3.5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'RESCUE' })}
                    disabled={state.stats.bond < 30}
                    className="arcade-btn bg-relic-danger text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    消耗 30 羁绊呼叫救场
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'GIVE_UP' })}
                    className="btn-ghost"
                  >
                    接受暴毙
                  </button>
                </div>
              </div>
            ) : null}
            </DialogueBox>

            {/* 世界线折叠：选择生效后短暂展示「走过的一条 + 未走的幽灵线」 */}
            {state.fold && (state.phase === 'outcome' || state.phase === 'checking' || state.phase === 'critical') ? (
              <div className="px-3 pb-3 sm:px-5">
                <WorldlineFold
                  act={state.fold.act}
                  chosen={{ id: state.fold.chosenId, text: state.fold.chosenText }}
                  ghosts={state.fold.ghosts}
                  className="mx-auto w-full max-w-[920px]"
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* 抽屉：命途 / 遗物 */}
      <Drawer
        open={fateOpen}
        title="命途"
        subtitle="你走过的每一个岔路，都在这张图上"
        onClose={() => setFateOpen(false)}
      >
        <FateTree
          graph={graph}
          totalTurns={state.totalActs}
          onSelectNode={state.phase === 'choices' ? handleSelectNode : undefined}
        />
      </Drawer>

      <Drawer
        open={inventoryOpen}
        title="知乎遗物"
        subtitle="三个槽位，装得下的比你想象中少"
        onClose={() => setInventoryOpen(false)}
      >
        <InventoryBar
          inventory={state.inventory}
          onUseRelic={(relicId) => dispatch({ type: 'USE_RELIC', relicId })}
          disabled={state.phase !== 'choices' && state.phase !== 'story'}
        />

        {rescueAvailable ? (
          <button
            type="button"
            onClick={() => {
              setInventoryOpen(false);
              dispatch({ type: 'RESCUE' });
            }}
            className="mt-4 w-full rounded-xl border border-relic-danger/55 bg-relic-danger/12 px-3 py-2.5 text-xs font-bold text-rose-200 transition-colors duration-150 hover:bg-relic-danger/22"
          >
            消耗 30 羁绊 · 呼叫知乎大 V 救场
          </button>
        ) : null}
      </Drawer>

      {/*
        证据网格抽屉：AI 自由推演时，这里能看到「每一个数值的出处」。
        方案 §5 的落点 —— 知乎不再是终局清单里的装饰，而是当前这一幕的依据。
      */}
      <Drawer
        open={meshOpen}
        title="证据网格"
        subtitle="这些数值不是 AI 写的，是真人经历算出来的"
        onClose={() => setMeshOpen(false)}
      >
        {mesh ? (
          <div className="flex flex-col gap-4">
            {/* 运行模式：路演时只用这三个灯证明「不是现场粘 Key」 */}
            <EngineStatusBar health={health} compact />

            {/*
              v3 §6：本幕的命运遭遇。
              放在四轴上方是有意的 —— 玩家先看到「我遇到了什么」，
              再看到「因此我的条件变成了什么」。
            */}
            <EventCard drawn={currentEvent} />

            {/* 常驻四轴（v2 §5.3 / §16）：让玩家 30 秒内看懂自己被什么约束着 */}
            <AxisHUD
              constraints={constraints}
              requirements={axisRequirements}
              pressureLabel={actPressureLabel(runAct)}
            />

            <EvidenceMeshView
              mesh={mesh}
              constraints={constraints}
              onTraceCard={() => {
                // 展开过前人经历 = 玩家真的看过证据，进入四维结算的「证据覆盖」
              }}
              onPickPath={(pathId) => {
                setExploredPathIds((current) =>
                  current.includes(pathId) ? current : [...current, pathId],
                );
              }}
            />

            <section className="panel p-3.5">
              <h3 className="text-sm font-semibold text-slate-200">你的条件</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                这些不是难度旋钮，是你真实的处境。拖动它们，上面的裁决会立刻重算 —— 不需要联网。
              </p>
              <div className="mt-3">
                <AxisSlider
                  constraints={constraints}
                  onChange={setConstraints}
                  requirements={axisRequirements}
                />
              </div>
            </section>

            {judgment?.critical ? (
              <CriticalPointCard
                point={judgment.critical}
                pathLabel={
                  mesh.paths.find((path) => path.pathId === judgment.critical?.pathId)?.label ?? '这条路'
                }
              />
            ) : null}

            {/*
              双牌对比入口：对比是「决策场景」，放到独立页面，
              让玩家注意力落在「哪条路翻转了」而不是叙事上。
              这里给出一句摘要，让玩家知道值得点进去。
            */}
            <section className="panel p-3.5">
              <h3 className="text-sm font-semibold text-slate-200">换个条件会怎样</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {sandwich && sandwich.divergentPathIds.length > 0
                  ? `在你的条件宽裕 / 紧张两组设定下，${sandwich.divergentPathIds.length} 条路线的结论会翻转。`
                  : '当前两组设定下结论一致 —— 说明你的约束还没卡到这些路的边界上。'}
              </p>
              <Link
                href={`/compare?goal=${encodeURIComponent(effectiveGoal)}`}
                className="btn-primary mt-3 inline-flex text-xs"
              >
                去双牌对比
              </Link>
            </section>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-500">
            正在检索站内经历。如果一直没有出现，说明这次没有拿到可归档的样本 ——
            证据网格只在有真实内容时给结论，不会编。
          </p>
        )}
      </Drawer>

      {/* 演出层 */}
      <DiceModal
        open={state.phase === 'checking' && state.lastCheck !== null}
        result={state.lastCheck}
        onConfirm={() => dispatch({ type: 'RESOLVE_DICE' })}
      />

      <SceneTransition
        kind={state.transition?.kind ?? null}
        label={state.transition?.label}
        triggerKey={state.transition?.key ?? 0}
        onDone={() => dispatch({ type: 'CLEAR_TRANSITION' })}
      />

      {state.phase === 'ended' ? (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-30 -translate-x-1/2">
          <Link
            href="/"
            className="pointer-events-auto rounded-full border border-white/12 bg-ink-900/85 px-4 py-2 text-[11px] text-slate-300 backdrop-blur transition-colors duration-150 hover:border-zhihu-500/50 hover:text-white"
          >
            返回命运发令台
          </Link>
        </div>
      ) : null}
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
