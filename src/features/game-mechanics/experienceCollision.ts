import type {
  CollisionFocus,
  ExperienceCollision,
} from '@/features/game-mechanics/domain';
import type {
  ExperienceCase,
  ExperienceFact,
  UserDifference,
} from '@/features/experience/domain';

/**
 * EXPERIENCE COLLISION：第三幕核心交互（§十二-§十四）。
 *
 * ## 不裁决，只指出分歧
 *
 * 两段真实知乎人生给出不同甚至相反的结果时，系统**不给标准答案**：
 * 让玩家判断「真正决定差异的条件是什么」。
 *
 * ## 玩家选择不是因果结论
 *
 * 玩家选了「时间」，系统只记录 `focusVariable = 'time'`。
 * **禁止**生成「时间就是导致两个人结果不同的原因」这类结论 ——
 * `collisionFocusOf` 的返回值就是编码这件事的类型。
 *
 * ## 没有差异就不强行生成
 *
 * 必须同时满足：primary case 存在、counterexample case 存在、
 * 至少有一项真实 `UserDifference` / condition difference。
 * 缺任何一条 → `null`。
 */

export interface CollisionContext {
  /** 主案例的显式指定（缺省时按 case id 稳定排序取第一个）。 */
  readonly primaryCaseId?: string;
  /** 反例的显式指定（缺省时按「与主案例分歧最大」确定性挑选）。 */
  readonly counterCaseId?: string;
}

/** 一个 case 引用到的全部事实 id（稳定去重）。 */
export function caseFactIds(item: ExperienceCase): readonly string[] {
  const ids = [
    ...item.conditions,
    ...item.actions,
    ...item.costs,
    ...item.outcomes,
    ...item.reflections,
  ].map((fact) => fact.id);
  return [...new Set(ids)].sort();
}

function quoteKey(facts: readonly ExperienceFact[]): string {
  return facts
    .map((fact) => fact.exactQuote.trim())
    .sort()
    .join('\u0001');
}

/** 两个 case 是否在某一层经验上真的不同。 */
function diverges(left: readonly ExperienceFact[], right: readonly ExperienceFact[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  return quoteKey(left) !== quoteKey(right);
}

/**
 * 一条「真实」的差异：`same` 不算（那说明两边一样，没有可观察的分歧）。
 */
function isRealDifference(difference: UserDifference): boolean {
  return difference.relation === 'different' || difference.relation === 'unknown';
}

/** 差异 → focus 候选（按变量归并，稳定排序）。 */
export function focusCandidatesFromDifferences(
  differences: readonly UserDifference[],
): readonly CollisionFocus[] {
  const seen = new Set<string>();
  const candidates: CollisionFocus[] = [];

  for (const difference of differences) {
    if (!isRealDifference(difference)) {
      continue;
    }
    const variable = difference.variable;
    if (seen.has(variable)) {
      continue;
    }
    seen.add(variable);
    candidates.push({
      id: `focus-${variable}`,
      label: variable,
      // `UserDifference` 没有 id：它本身就是「一个变量上的一条差异」，
      // 所以差异 id 用变量名（唯一且稳定，可被测试直接断言）。
      supportingDifferenceIds: [variable],
    });
  }

  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 从真实 case 与真实差异中找出一次 Collision（§十三）。
 *
 * ## 打分（确定性，越高越显著）
 *
 * ```text
 * outcome 不同       +3
 * action 不同        +2
 * reflection 不同    +2
 * ```
 *
 * 所有分会 0 → 说明两个 case 没有可观察的分歧 → 返回 `null`，
 * 退化为普通选择，**不硬造冲突**。
 */
export function findExperienceCollision(
  cases: readonly ExperienceCase[],
  differences: readonly UserDifference[],
  context: CollisionContext = {},
): ExperienceCollision | null {
  if (cases.length < 2) {
    return null;
  }

  const ordered = [...cases].sort((left, right) => left.id.localeCompare(right.id));
  const primary = context.primaryCaseId
    ? ordered.find((item) => item.id === context.primaryCaseId)
    : ordered[0];
  if (!primary) {
    return null;
  }

  const others = ordered.filter((item) => item.id !== primary.id);
  const explicitCounter = context.counterCaseId
    ? others.find((item) => item.id === context.counterCaseId)
    : undefined;

  const scoreOf = (candidate: ExperienceCase): number => {
    let score = 0;
    if (diverges(primary.outcomes, candidate.outcomes)) {
      score += 3;
    }
    if (diverges(primary.actions, candidate.actions)) {
      score += 2;
    }
    if (diverges(primary.reflections, candidate.reflections)) {
      score += 2;
    }
    return score;
  };

  let counter = explicitCounter;
  let bestScore = explicitCounter ? scoreOf(explicitCounter) : 0;
  if (!counter) {
    for (const candidate of others) {
      const score = scoreOf(candidate);
      if (score > bestScore || (score === bestScore && bestScore > 0 && !counter)) {
        counter = candidate;
        bestScore = score;
      }
    }
  }

  // 没有反例 case，或两段经历没有任何可观察分歧 → 不生成
  if (!counter || bestScore === 0) {
    return null;
  }

  const focusCandidates = focusCandidatesFromDifferences(differences);
  // 至少有一项真实 UserDifference / condition difference，否则不生成
  if (focusCandidates.length === 0) {
    return null;
  }

  return {
    id: `collision-${primary.id}-${counter.id}`,
    primaryCaseId: primary.id,
    counterCaseId: counter.id,
    primaryFactIds: caseFactIds(primary),
    counterFactIds: caseFactIds(counter),
    focusCandidates,
    supportingDifferenceIds: [...focusCandidates.flatMap((focus) => focus.supportingDifferenceIds)].sort(),
  };
}

/**
 * 玩家选了一个 focus 之后，系统**只记录变量名**。
 *
 * 返回 `null` 表示这个 focus 不属于这次 Collision（调用方必须丢弃它）。
 * **绝不在任何地方补一句因果解释** —— 这是 §十四 的落点。
 */
export function collisionFocusOf(
  collision: ExperienceCollision,
  focusId: string,
): string | null {
  const focus = collision.focusCandidates.find((candidate) => candidate.id === focusId);
  return focus ? focus.label : null;
}
