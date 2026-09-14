import type {
  ExperienceUnlockInput,
  PlayAction,
} from '@/features/game-mechanics/domain';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * PATH REVEAL：真实经验让玩家**多看见一条路**（§七）。
 *
 * ## 唯一准入
 *
 * 只消费现有的 `ExperienceChoiceUnlock` —— **不再做第二套 AI synthesis**。
 * 并且只有 `ExperienceFact.type === 'action'` 才允许变成一条行动：
 * condition / cost / outcome / reflection 一律不能。否则
 * 「按『家里能支持两年』的路子先试一小步」这种荒谬文案就会出现在选项里，
 * 而且把一个条件伪装成了一种方法。
 *
 * ## 没有 action fact 就没有 reveal
 *
 * 返回 `null`，调用方据此放弃。**一局没有 path reveal 是允许的**
 * —— 那说明我们没找到「别人具体做了什么」，编一个反而是错的。
 */

/** 从经验解锁里出来的行动，来源恒为 `experience`。 */
export const PATH_REVEAL_ORIGIN = 'experience' as const;

/** 从片段里截第一小句做短标签（≤12 字）。 */
export function shortActionLabel(quote: string): string {
  const head = quote.split(/[。；;，,！!？?]/)[0] ?? quote;
  const trimmed = head.trim();
  return [...(trimmed.length > 0 ? trimmed : quote.trim())].slice(0, 12).join('');
}

/** 是否是**真实行动**事实 —— PATH REVEAL 的唯一合法来源。 */
export function isActionFact(fact: ExperienceFact): boolean {
  return fact.type === 'action';
}

/** 从事实里取出所有行动片段（稳定顺序：相关性高在前，同分按 id）。 */
export function actionFacts(facts: readonly ExperienceFact[]): readonly ExperienceFact[] {
  return facts
    .filter(isActionFact)
    .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id));
}

/** 行动片段 → 行动（兜底路径；仍然只认 `action`）。 */
export function actionFromFact(fact: ExperienceFact): PlayAction | null {
  if (!isActionFact(fact)) {
    return null;
  }
  return {
    id: `action-${fact.id}`,
    label: shortActionLabel(fact.exactQuote),
    description: fact.exactQuote,
    state: 'unlocked',
    origin: PATH_REVEAL_ORIGIN,
    sourceFactIds: [fact.id],
  };
}

/**
 * 经验解锁 → 行动。
 *
 * 四条校验缺一不可：
 *
 * ```text
 * unlock.sourceFactIds 非空
 * 每个关键事实都能找到
 * 至少一个 source fact type === 'action'
 * ```
 *
 * 任一不满足 → `null`。
 */
export function actionFromExperienceUnlock(
  unlock: ExperienceUnlockInput,
  facts: readonly ExperienceFact[],
): PlayAction | null {
  if (unlock.sourceFactIds.length === 0) {
    return null;
  }

  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const resolved: ExperienceFact[] = [];
  for (const factId of unlock.sourceFactIds) {
    const fact = byId.get(factId);
    // 引用了不存在的事实 → 不可追溯，直接放弃
    if (!fact) {
      return null;
    }
    resolved.push(fact);
  }

  const actions = resolved.filter(isActionFact);
  if (actions.length === 0) {
    return null;
  }

  const primary = [...actions].sort(
    (left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id),
  )[0]!;

  const label = unlock.label.trim().length > 0 ? unlock.label.trim() : shortActionLabel(primary.exactQuote);
  return {
    id: `action-${unlock.id}`,
    label,
    description: primary.exactQuote,
    state: 'unlocked',
    origin: PATH_REVEAL_ORIGIN,
    sourceFactIds: [...unlock.sourceFactIds],
  };
}

/**
 * 一组解锁 → 一组行动。
 *
 * **去重的口径是「同一条真实行动」**（来源 fact 相同），而不是「同一个
 * unlock id」—— 两条 unlock 引用同一条真实经历时，只应该多看见一条路。
 * 没有任何合法解锁时返回空数组 —— 不为了凑数编行动。
 */
export function actionsFromExperienceUnlocks(
  unlocks: readonly ExperienceUnlockInput[],
  facts: readonly ExperienceFact[],
): readonly PlayAction[] {
  const actions: PlayAction[] = [];
  const seen = new Set<string>();
  const ordered = [...unlocks].sort(
    (left, right) => left.availableFromAct - right.availableFromAct || left.id.localeCompare(right.id),
  );

  for (const unlock of ordered) {
    const action = actionFromExperienceUnlock(unlock, facts);
    if (!action) {
      continue;
    }
    const key = action.sourceFactIds.join('\u0001');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    actions.push(action);
  }
  return actions;
}
