import type { ConditionShiftChange } from '@/features/game-mechanics/domain';
import type { UserDifference } from '@/features/experience/domain';

/**
 * CONDITION SHIFT（§5-§6 / §23-§24 / §65 / §78）。
 *
 * ## 这是反事实实验，不是现实预测
 *
 * 玩家可以「借用」另一个人的一个现实条件，看世界线会发生什么变化。
 * 但它只能来自**已知的 `UserDifference`**：
 *
 * ```text
 * 经验中的人：有固定队友
 * 你：没有固定队友
 * → 允许问「如果我也有一个固定队友呢？」
 * ```
 *
 * AI **禁止**临时编造「假设你家支持你」「假设你有 20 万存款」——
 * 数据里没有的，就不允许出现。
 *
 * ## 只影响当前世界
 *
 * 每一条借用条件都写死 `hypothetical: true`；它永远不能写回
 * `userContext`，也不能被后续模型当成用户真实事实。
 */

/** 哪些差异是「可借用的」：关系为 different 且样本值已知。 */
export function meaningfulDifferences(
  differences: readonly UserDifference[],
): readonly UserDifference[] {
  return differences.filter(
    (difference) =>
      difference.relation === 'different' &&
      difference.experienceValue !== undefined &&
      difference.experienceValue.trim().length > 0,
  );
}

/**
 * 差异 → 可借用的条件（§6 / §55）。
 *
 * 没有真实 UserDifference 时返回空数组 —— 不得凭空生成条件。
 */
export function conditionShiftOptionsFromDifferences(
  differences: readonly UserDifference[],
): readonly ConditionShiftChange[] {
  const seen = new Set<string>();
  const changes: ConditionShiftChange[] = [];

  for (const difference of meaningfulDifferences(differences)) {
    if (seen.has(difference.variable)) {
      continue;
    }
    seen.add(difference.variable);
    const experienceValue = difference.experienceValue!;
    changes.push({
      variable: difference.variable,
      hypothetical: true,
      ...(difference.userValue !== undefined ? { userValue: difference.userValue } : {}),
      experienceValue,
      description: `如果「${difference.variable}」变成「${experienceValue}」，会发生什么？`,
    });
  }

  return changes.sort((left, right) => left.variable.localeCompare(right.variable));
}

/**
 * 从一组差异里取出被借用的那些（供校验层核对来源）。
 */
export function adoptedDifferences(
  differences: readonly UserDifference[],
  conditionKeys: readonly string[],
): readonly UserDifference[] {
  const wanted = new Set(conditionKeys);
  return differences.filter((difference) => wanted.has(difference.variable));
}
