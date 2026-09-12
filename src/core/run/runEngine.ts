import { D20_RULE_SET, deriveBaseModifier, evaluateCheck } from '@/core/d20';
import { toDifficulty, toModifier, toSeed, toStatValue, toTurnIndex } from '@/core/brand';
import { hashValue, stableHash } from '@/core/run/deterministic';
import {
  compileEventPlan,
  ghostLinesForChoice,
  beatForTemplate,
  choiceRng,
  planHash,
  selectTemplateForAct,
  type EventPlan,
  type GhostLine,
} from '@/core/run/scenarioCompiler';
import { applyEffect, createInitialWorld, isRunOver, type WorldState } from '@/core/run/worldState';
import { SCENARIO_REVISION, SCENE_TEMPLATES, type SceneTemplate } from '@/data/sceneTemplates';
import { EMPTY_INVENTORY } from '@/core/relics';

import { parseRunManifest, type RunManifest } from '@/features/run/contracts';

/**
 * 运行引擎（P1）：把 Manifest + 选择序列解析成**完整可复现的轨迹**。
 *
 * 这个模块是 P1 退出门槛（「同一 Manifest 重放 100 次，事件计划、骰面和状态完全一致」）
 * 的执行体，也是 P2 终端 Boss 与挑战快照的落点：Boss 的 DC 来自这里的 `WorldState`，
 * 而不是模型。
 *
 * 刻意保持纯函数：给定 `(manifest, choices)`，输出逐字节一致。
 */

export interface CreateManifestInput {
  readonly seed: string;
  readonly scenarioId: string;
  readonly scenarioRevision?: string;
  readonly challengeId?: string;
  readonly sourceIds?: readonly string[];
  readonly templates?: readonly SceneTemplate[];
}

/** 来源集合哈希：只吃 id 列表，排序后再哈希，因此与传入顺序无关。 */
export function sourceSetHash(sourceIds: readonly string[] = []): string {
  return stableHash(`sources::${[...sourceIds].sort().join(',')}`);
}

/** 由种子派生的稳定 runId：同一颗种子重放得到同一个 id，便于对账。 */
export function runIdFor(seed: string, scenarioId: string, revision: string): string {
  return `run-${stableHash(`${seed}::${scenarioId}::${revision}`).slice(0, 12)}`;
}

export interface CreatedRun {
  readonly manifest: RunManifest;
  readonly plan: EventPlan;
}

/** 创建 Manifest 与配套的事件计划（两者必须**同时**产出，避免各算一遍漂移）。 */
export function createRun(input: CreateManifestInput): CreatedRun {
  const scenarioRevision = input.scenarioRevision ?? SCENARIO_REVISION;
  const plan = compileEventPlan({
    seed: input.seed,
    scenarioRevision,
    templates: input.templates,
  });

  const manifest: RunManifest = {
    version: 3,
    runId: runIdFor(input.seed, input.scenarioId, scenarioRevision),
    seed: input.seed,
    scenarioId: input.scenarioId,
    scenarioRevision,
    eventPlanHash: planHash(plan),
    sourceSetHash: sourceSetHash(input.sourceIds),
    ...(input.challengeId ? { challengeId: input.challengeId } : {}),
  };

  return { manifest, plan };
}

/** 校验「链接里的 Manifest」与「本地重算的计划」是否一致 —— 不一致说明被改过。 */
export function verifyManifest(raw: unknown, templates: readonly SceneTemplate[] = SCENE_TEMPLATES):
  | { readonly ok: true; readonly manifest: RunManifest; readonly plan: EventPlan }
  | { readonly ok: false; readonly reason: string } {
  const parsed = parseRunManifest(raw);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const plan = compileEventPlan({
    seed: parsed.manifest.seed,
    scenarioRevision: parsed.manifest.scenarioRevision,
    templates,
  });

  if (planHash(plan) !== parsed.manifest.eventPlanHash) {
    return { ok: false, reason: 'event-plan-hash-mismatch' };
  }

  return { ok: true, manifest: parsed.manifest, plan };
}

export type TurnOutcome = 'success' | 'failure' | 'no-check';

export interface TurnResolution {
  readonly act: number;
  readonly templateId: string;
  readonly templateTitle: string;
  /** 该幕的旁白（已按隐藏状态选过变体）。 */
  readonly beat: string;
  readonly choiceId: string;
  readonly choiceText: string;
  /** 没有检定时为 null。 */
  readonly dice: number | null;
  readonly dc: number | null;
  readonly outcome: TurnOutcome;
  /** 该幕未走的分支（命运树的幽灵线）。 */
  readonly ghostLines: readonly GhostLine[];
  readonly stateAfter: WorldState;
}

export interface RunReplay {
  readonly manifest: RunManifest;
  readonly resolutions: readonly TurnResolution[];
  readonly finalState: WorldState;
  /** 全轨迹哈希：重放一致性可以直接比这一个值。 */
  readonly trajectoryHash: string;
}

/** 从初始属性出发建立世界状态（属性由出身决定，隐藏状态由种子派生）。 */
export function startWorld(seed: string, stats: { san: number; skill: number; bond: number }): WorldState {
  return createInitialWorld(seed, stats);
}

/**
 * 重放一局。
 *
 * @param choices 每一幕选择的 `choiceId`（例如 `['a','b','a','a']`）。
 *                少于四幕时提前结束 —— 这正是「中途 SAN 归零 / 放弃」的表达。
 */
export function replayRun(input: {
  readonly manifest: RunManifest;
  readonly choices: readonly string[];
  readonly initialStats: { readonly san: number; readonly skill: number; readonly bond: number };
  readonly templates?: readonly SceneTemplate[];
}): RunReplay {
  const templates = input.templates ?? SCENE_TEMPLATES;
  const plan = compileEventPlan({
    seed: input.manifest.seed,
    scenarioRevision: input.manifest.scenarioRevision,
    templates,
  });

  let state = startWorld(input.manifest.seed, input.initialStats);
  const resolutions: TurnResolution[] = [];

  for (let index = 0; index < input.choices.length; index += 1) {
    const act = (index + 1) as 1 | 2 | 3 | 4;
    if (act > 4) {
      break;
    }

    const template = selectTemplateForAct(plan, act, state.flags, templates);
    if (!template) {
      break;
    }

    const choiceId = input.choices[index];
    const choice = template.choices.find((item) => item.id === choiceId);
    if (!choice) {
      break;
    }

    let outcome: TurnOutcome = 'no-check';
    let dice: number | null = null;
    let dc: number | null = null;

    if (choice.check) {
      const result = evaluateCheck(
        {
          checkId: `${template.id}:${choice.id}`,
          turnIndex: toTurnIndex(act),
          seed: toSeed(input.manifest.seed),
          targetStat: choice.check.targetStat,
          difficulty: toDifficulty(choice.check.difficulty),
          stats: {
            san: toStatValue(state.stats.san),
            skill: toStatValue(state.stats.skill),
            bond: toStatValue(state.stats.bond),
          },
          inventory: EMPTY_INVENTORY,
          ruleSet: D20_RULE_SET,
          baseModifier: deriveBaseModifier(state.stats[choice.check.targetStat]),
          temporaryModifier: toModifier(0),
          activatedRelicIds: [],
        },
        choiceRng({
          seed: input.manifest.seed,
          scenarioRevision: input.manifest.scenarioRevision,
          act,
          templateId: template.id,
          choiceId: choice.id,
        }),
      );

      dice = result.rawRoll;
      dc = result.difficulty;
      outcome = result.outcome;
    }

    const effect = outcome === 'failure' ? choice.effects.onFail : choice.effects.onSuccess;
    state = effect ? applyEffect(state, effect) : state;

    resolutions.push({
      act,
      templateId: template.id,
      templateTitle: template.title,
      beat: beatForTemplate(template, state.hidden),
      choiceId: choice.id,
      choiceText: choice.text,
      dice,
      dc,
      outcome,
      ghostLines: ghostLinesForChoice(template, choice.id),
      stateAfter: state,
    });

    if (isRunOver(state).over) {
      break;
    }
  }

  return {
    manifest: input.manifest,
    resolutions,
    finalState: state,
    trajectoryHash: hashValue({
      runId: input.manifest.runId,
      eventPlanHash: input.manifest.eventPlanHash,
      // 只哈希「决策 + 结果 + 状态」，不哈希旁白文案：
      // 文案属于表现层，改一个字不该让挑战判定为「不是同一局」。
      steps: resolutions.map((item) => ({
        act: item.act,
        templateId: item.templateId,
        choiceId: item.choiceId,
        dice: item.dice,
        outcome: item.outcome,
        state: item.stateAfter,
      })),
    }),
  };
}
