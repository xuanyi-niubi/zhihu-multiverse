import type {
  ActionOption,
  PathUnlockPayload,
} from '@/features/game-mechanics/domain';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * PATH UNLOCK（§4 / §35 / §54 / §76）。
 *
 * ## 唯一准入
 *
 * **只有 `ExperienceFact.type === 'action'` 才能解锁行动。**
 * condition / cost / outcome / reflection 一律不能 —— 否则
 * 「按『家里能支持两年』的路子先试一小步」这种荒谬文案就会出现在选项里，
 * 而且会把一个条件伪装成一种方法。
 *
 * ## 复用现有 Experience Unlock
 *
 * `UnlockSource` 是 `ExperienceChoiceUnlock` 的结构镜像：Encounter 只是
 * 调度层，真正生成解锁的仍是 `compileWorldBlueprint.unlocksOf`。
 */

/** 与 `ExperienceChoiceUnlock` 结构兼容的最小来源（避免循环 import）。 */
export interface UnlockSource {
  readonly id: string;
  readonly label: string;
  readonly sourceFactIds: readonly string[];
  readonly choice: { readonly text: string; readonly hint: string };
  readonly availableFromAct: number;
}

/** 是否是**真实行动**事实 —— PATH UNLOCK 的唯一合法来源。 */
export function isActionFact(fact: ExperienceFact): boolean {
  return fact.type === 'action';
}

/** 从事实里取出所有行动片段（稳定顺序：相关性高在前，同分按 id）。 */
export function actionFacts(facts: readonly ExperienceFact[]): readonly ExperienceFact[] {
  return facts
    .filter(isActionFact)
    .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id));
}

/** 从片段里截第一小句做短标签（≤12 字）。 */
function shortLabel(quote: string): string {
  const head = quote.split(/[。；;，,！!？?]/)[0] ?? quote;
  return [...head].slice(0, 12).join('');
}

/**
 * 行动片段 → 行动选项。
 *
 * 只有行动片段能走通；其它类型返回 null，调用方必须据此放弃。
 */
export function actionOptionFromFact(fact: ExperienceFact): ActionOption | null {
  if (!isActionFact(fact)) {
    return null;
  }
  const label = shortLabel(fact.exactQuote);
  return {
    id: `action-${fact.id}`,
    label,
    description: fact.exactQuote,
    source: 'experience',
    sourceFactIds: [fact.id],
    requirements: [],
  };
}

/** 把行动片段批量转成行动选项（供 Composer 兜底用，仍然只认 action）。 */
export function pathUnlockActionsFromFacts(
  facts: readonly ExperienceFact[],
  limit = 3,
): readonly ActionOption[] {
  const actions: ActionOption[] = [];
  for (const fact of actionFacts(facts)) {
    const option = actionOptionFromFact(fact);
    if (option) {
      actions.push(option);
    }
    if (actions.length >= limit) {
      break;
    }
  }
  return actions;
}

/** 复用型解锁 → Encounter payload。 */
export function pathUnlockPayloadFromUnlock(unlock: UnlockSource): PathUnlockPayload {
  return {
    kind: 'path_unlock',
    unlockId: unlock.id,
    label: unlock.label,
    choiceText: unlock.choice.text,
    hint: unlock.choice.hint,
  };
}

/** 行动片段 → Encounter payload（没有现成 unlock 时的兜底）。 */
export function pathUnlockPayloadFromFact(fact: ExperienceFact): PathUnlockPayload | null {
  if (!isActionFact(fact)) {
    return null;
  }
  const label = shortLabel(fact.exactQuote);
  return {
    kind: 'path_unlock',
    unlockId: `unlock-${fact.id}`,
    label,
    choiceText: `按「${label}」的路子先试一小步`,
    hint: '这个选项来自一条真实经验 —— 你可以选择不参考它。',
  };
}
