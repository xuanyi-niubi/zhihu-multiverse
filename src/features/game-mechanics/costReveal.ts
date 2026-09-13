import type {
  ActionOption,
  ActionSpace,
  CostRevealEffect,
  CostRevealPayload,
} from '@/features/game-mechanics/domain';
import { lockAction, removeAction } from '@/features/game-mechanics/actionSpace';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * COST REVEAL（§9-§10 / §25 / §57 / §77）。
 *
 * ## 选择不是免费按钮
 *
 * 一个行动不只是「继续故事」，而是真正关闭某些后续机会。
 * 但关闭的理由必须是**真实代价**：
 *
 * ```text
 * 必须来自 ExperienceFact.type === 'cost'，或用户已知事实
 * ```
 *
 * AI 禁止凭空增加「你因此失去朋友」「老师对你失望」。
 *
 * ## 不做隐藏惩罚
 *
 * 被关闭的行动必须带一句人话解释（§47），而且**不扣任何数值**。
 */

export interface CostRevealCandidate {
  readonly effect: CostRevealEffect;
  readonly affectedActionIds: readonly string[];
  readonly explanation: string;
  readonly sourceFactIds: readonly string[];
  readonly sourceCaseIds: readonly string[];
}

/** 真实代价片段（稳定排序）。 */
export function costFacts(facts: readonly ExperienceFact[]): readonly ExperienceFact[] {
  return facts
    .filter((fact) => fact.type === 'cost')
    .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id));
}

/**
 * 代价 → 要关闭的行动。
 *
 * 两个必要条件缺一不可：
 * 1. 存在真实 `cost` 事实（否则不生成，§60）；
 * 2. 至少一条行动会被关闭（否则只是文案，不是机制，§57）。
 *
 * `affectedActionIds` 必须由调用方从真实的行动空间里给出 ——
 * 这个模块**不发明**「代价影响了哪条路」。
 */
export function costRevealCandidate(input: {
  readonly facts: readonly ExperienceFact[];
  readonly affectedActionIds: readonly string[];
  readonly effect?: CostRevealEffect;
}): CostRevealCandidate | null {
  const costs = costFacts(input.facts);
  if (costs.length === 0) {
    return null;
  }

  const affected = [...new Set(input.affectedActionIds)].sort();
  if (affected.length === 0) {
    return null;
  }

  const primary = costs[0]!;
  const sourceCaseIds = [...new Set(costs.map((cost) => `case:${cost.sourceId}`))].sort();

  return {
    effect: input.effect ?? 'remove',
    affectedActionIds: affected,
    explanation: `这条路上的时间已经花掉了：${primary.exactQuote}`,
    sourceFactIds: costs.map((cost) => cost.id),
    sourceCaseIds,
  };
}

/** 把代价候选落进行动空间（effect: remove / lock）。 */
export function applyCostReveal(space: ActionSpace, candidate: CostRevealCandidate): ActionSpace {
  let next = space;
  for (const actionId of candidate.affectedActionIds) {
    next =
      candidate.effect === 'lock'
        ? lockAction(next, actionId, 'opportunity_cost', candidate.explanation)
        : removeAction(next, actionId, candidate.explanation);
  }
  return next;
}

/** 从行动空间里挑出一条**可以被关闭**的用户行动（确定性）。 */
export function closableUserActions(space: ActionSpace): readonly ActionOption[] {
  return [...space.available]
    .filter((action) => action.source === 'user' && action.requirements.length === 0)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** 便捷：代价候选 → Encounter payload。 */
export function costRevealPayload(candidate: CostRevealCandidate): CostRevealPayload {
  return {
    kind: 'cost_reveal',
    effect: candidate.effect,
    affectedActionIds: candidate.affectedActionIds,
    explanation: candidate.explanation,
  };
}
