import { adaptDifficulty, type DifficultyAdjustment, type PerformanceProfile } from '@/agents/difficultyAdapter';
import { recallMemories } from '@/agents/memoryCurator';
import { directPlot } from '@/agents/plotDirector';
import { directStyle } from '@/agents/styleStylist';

import type { ProviderRouter } from '@/agents/providerRouter';
import type {
  AgentOutput,
  NarrativeContext,
  PlayerBrief,
  StructuredMemory,
  StyleDirective,
  UserIntent,
  WorldBrief,
} from '@/agents/types';

/**
 * Orchestrator（规范 §3.2.1 / §4.2）。
 *
 * 职责边界刻意收得很窄：**它自己不调用 LLM**，只做三件事——
 * 1. 组装叙事上下文（世界模型 + 玩家画像 + MAG 记忆 + 知乎素材 + 风格 + 难度）；
 * 2. 把活派给对应的 specialist（当前是 Plot Director；NPC/World 后续波次接上）；
 * 3. 合并结果并带上可观测信息（provider、耗时、降级原因）。
 *
 * 这样"多 Agent"不是靠堆架构图，而是每个角色都有独立的输入契约与失败模式。
 */

export interface OrchestrateInput {
  readonly intent: UserIntent;
  readonly world: WorldBrief;
  readonly player: PlayerBrief;
  /** 账号维度的长期记忆（跨局）。 */
  readonly memories: readonly StructuredMemory[];
  /** 本局可引用的知乎素材。 */
  readonly knowledge: readonly { readonly id: string; readonly title: string; readonly quote: string }[];
  /** 动态难度的输入画像。 */
  readonly profile: PerformanceProfile;
  readonly router: ProviderRouter | null;
  readonly allowedThreadIds?: readonly string[];
  readonly now?: () => number;
}

export interface OrchestrateResult extends AgentOutput {
  readonly adjustment: DifficultyAdjustment;
  readonly style: StyleDirective;
  readonly context: NarrativeContext;
}

/** 组装上下文（纯函数：便于对同一局做复现测试）。 */
export function buildNarrativeContext(input: OrchestrateInput): NarrativeContext {
  const adjustment = adaptDifficulty(input.profile);
  const style = directStyle(input.world, input.world.act);
  const memories = recallMemories(input.memories, {
    act: input.world.act,
    goalText: input.player.goal,
    limit: 5,
  });

  return {
    intent: input.intent,
    world: input.world,
    player: input.player,
    memories,
    knowledge: input.knowledge,
    difficultyOffset: adjustment.offset,
    style,
  };
}

export async function orchestrateTurn(input: OrchestrateInput): Promise<OrchestrateResult> {
  const adjustment = adaptDifficulty(input.profile);
  const context = buildNarrativeContext(input);
  const style = directStyle(input.world, input.world.act);

  const output = await directPlot({
    context,
    adjustment,
    router: input.router,
    allowedThreadIds: input.allowedThreadIds ?? [],
    ...(input.now ? { now: input.now } : {}),
  });

  return { ...output, adjustment, style, context };
}

/**
 * 玩家意图分类。
 *
 * 现在只有选项式玩法（玩家不自由输入），所以 classification 是显式传入的；
 * 一旦接入自然语言输入，这里就是第一层路由（规范 §4.3 的 UserIntent 分类）。
 */
export function classifyIntent(utterance: string | null | undefined): UserIntent {
  if (typeof utterance !== 'string' || utterance.trim().length === 0) {
    return { kind: 'action' };
  }
  const text = utterance.trim();
  if (/^(说|问|聊|告诉|回答|对话)/.test(text)) {
    return { kind: 'dialogue', utterance: text };
  }
  if (/^(看|找|查|翻|观察|探索)/.test(text)) {
    return { kind: 'explore', utterance: text };
  }
  return { kind: 'action', utterance: text };
}

/** 把引擎侧画像转成 Orchestrator 需要的形状（避免上层直接依赖引擎内部类型）。 */
export function toPerformanceProfile(input: {
  readonly act: number;
  readonly totalActs: number;
  readonly outcomes: readonly ('success' | 'failure' | 'none')[];
  readonly equippedRelicCount: number;
  readonly strongRelicCount: number;
  readonly san: number;
  readonly seed: string;
  readonly realityAnchor?: number;
}): PerformanceProfile {
  return {
    act: input.act,
    totalActs: input.totalActs,
    outcomes: input.outcomes,
    equippedRelicCount: input.equippedRelicCount,
    strongRelicCount: input.strongRelicCount,
    san: input.san,
    seed: input.seed,
    realityAnchor: input.realityAnchor ?? 1,
  };
}
