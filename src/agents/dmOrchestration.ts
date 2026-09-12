import { toPerformanceProfile, orchestrateTurn } from '@/agents/orchestrator';
import { isStrongRelic } from '@/agents/difficultyAdapter';
import { composeTurn } from '@/agents/turnComposer';

import type { ProviderRouter } from '@/agents/providerRouter';
import type { PlayerBrief, WorldBrief } from '@/agents/types';
import { RELIC_LIBRARY } from '@/data/prebuiltScenarios';

/** 名字 → 叙事钩子。DM 输入只有遗物名，所以按名字建索引。 */
const RELIC_HOOKS: ReadonlyMap<string, string> = new Map(
  Object.values(RELIC_LIBRARY)
    .filter((relic): relic is typeof relic & { narrativeHook: string } => typeof relic.narrativeHook === 'string')
    .map((relic) => [relic.name, relic.narrativeHook]),
);

import type { DmTurnInput } from '@/core/dm/prompt';
import type { ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * 把编排器接进 DM 管线（W1b 的接线层）。
 *
 * 三条纪律：
 * 1. **无 provider → 完全不动**：返回文本层原本的回合，保证"没配 key 时零回归"；
 * 2. **只有模型真的产出了情节才替换结构**（`source === 'model'`）；本地兜底情节
 *    不参与替换 —— 否则等于用短模板覆盖掉写好的剧本正文；
 * 3. **结构换了、正文不换**：storyText 与知乎引用仍来自既有生成管线。
 */

/** 由属性推出定性状态词（隐藏状态在客户端，服务端只有属性可用）。 */
export function signalsFromStats(stats: { readonly san: number; readonly skill: number; readonly bond: number }): string[] {
  const signals: string[] = [];
  if (stats.san < 30) {
    signals.push('精神状态接近临界');
  } else if (stats.san < 50) {
    signals.push('有点撑不住');
  }
  if (stats.bond < 25) {
    signals.push('身边没人能商量');
  }
  if (stats.skill > 60) {
    signals.push('手上有点真本事');
  }
  return signals;
}

export function toWorldBrief(input: DmTurnInput): WorldBrief {
  return {
    act: input.turnIndex,
    totalActs: input.totalTurns,
    sceneName: '推演舱',
    timeLabel: '此刻',
    stats: { san: input.stats.san, skill: input.stats.skill, bond: input.stats.bond },
    signals: signalsFromStats(input.stats),
    // 叙事钩子随遗物一起注入 prompt（最终版 §6：遗物不止加数值，也在剧情里有回响）
    relics: input.inventory.map((relic) => {
      // DM 输入里只有名字（没有 id），所以按名字索引叙事钩子
      const hook = RELIC_HOOKS.get(relic.name);
      return hook ? { name: relic.name, hook } : { name: relic.name };
    }),
  };
}

export function toPlayerBrief(input: DmTurnInput): PlayerBrief {
  return {
    originName: '推演者',
    goal: input.goal,
    archetypes: input.personaTags,
    legacyWords: input.profileAnalysis ?? null,
    totalRuns: input.history.length > 0 ? 1 : 0,
  };
}

/** 把 inventory 快照换算成"强力遗物"件数（动态难度的输入之一）。 */
export function strongRelicCount(input: DmTurnInput): number {
  return input.inventory.filter((relic) => isStrongRelic({ kind: 'active' })).length;
}

export interface DirectedTurnResult {
  readonly turn: ScenarioTurn;
  /** 情节来源：model 表示结构由 AI 现场决定。 */
  readonly plotSource: 'model' | 'fallback' | 'off';
  readonly plotProvider: string | null;
  readonly issue: string | null;
  readonly timings: readonly { readonly stage: string; readonly ms: number }[];
}

export interface WirePlotInput {
  readonly turn: ScenarioTurn;
  readonly dmInput: DmTurnInput;
  readonly router: ProviderRouter | null;
  readonly now?: () => number;
}

export async function withDirectedPlot(input: WirePlotInput): Promise<DirectedTurnResult> {
  // 没有可用 provider：一个字都不改（这是"无 key 零回归"的保证）
  if (!input.router || input.router.providers.length === 0) {
    return { turn: input.turn, plotSource: 'off', plotProvider: null, issue: null, timings: [] };
  }

  const knowledge = input.dmInput.zhihuSnippets.slice(0, 3).map((snippet, index) => ({
    id: `snip-${input.dmInput.turnIndex}-${index + 1}`,
    title: snippet.author ?? '知乎片段',
    quote: snippet.quote ?? '',
  }));

  const output = await orchestrateTurn({
    intent: { kind: 'action' },
    world: toWorldBrief(input.dmInput),
    player: toPlayerBrief(input.dmInput),
    memories: [],
    knowledge: knowledge.filter((item) => item.quote.length > 0),
    profile: toPerformanceProfile({
      act: input.dmInput.turnIndex,
      totalActs: input.dmInput.totalTurns,
      outcomes: input.dmInput.history.map((entry) =>
        entry.outcome === 'success' || entry.outcome === 'failure' ? entry.outcome : 'none',
      ),
      equippedRelicCount: input.dmInput.inventory.length,
      strongRelicCount: strongRelicCount(input.dmInput),
      san: input.dmInput.stats.san,
      seed: input.dmInput.seed,
    }),
    router: input.router,
    ...(input.now ? { now: input.now } : {}),
  });

  if (output.source !== 'model') {
    return {
      turn: input.turn,
      plotSource: 'fallback',
      plotProvider: output.provider,
      issue: output.issue,
      timings: output.timings,
    };
  }

  return {
    turn: composeTurn({
      baseTurn: input.turn,
      brief: output.brief,
      act: input.dmInput.turnIndex,
      useBrief: true,
    }),
    plotSource: 'model',
    plotProvider: output.provider,
    issue: output.issue,
    timings: output.timings,
  };
}
