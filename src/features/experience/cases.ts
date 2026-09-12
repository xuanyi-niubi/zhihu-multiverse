import type { ExperienceCase, ExperienceFact } from '@/features/experience/domain';

/**
 * 经历聚合（Phase 7 / P0-E）。
 *
 * ## 为什么单个片段不够
 *
 * 「一条片段 = 一条事实」回答不了「这个人当时是什么条件、做了什么、
 * 代价是什么、最后怎样」。把**同一条来源**的片段按类型归位，
 * 才构成一段可对照的经历 —— 这才是游戏世界该消费的基本单位。
 *
 * ## 只 group / sort，绝不生成
 *
 * Case 里出现的每个片段都必须是**原样**的输入片段：
 * 不写 summary（那是路径合成层的事）、不补写缺失的类型桶、
 * 不把不同来源的片段拼成一个人 —— 拼出来的「人」不存在。
 */

/** Case 准入规则：至少「有行动」，或「有条件且有结果」。 */
function qualifiesForCase(facts: readonly ExperienceFact[]): boolean {
  const types = new Set(facts.map((fact) => fact.type));
  if (types.has('action')) {
    return true;
  }
  return types.has('condition') && types.has('outcome');
}

/** 桶内排序：相关性高的在前；同分按 id，保证确定。 */
function byRelevance(left: ExperienceFact, right: ExperienceFact): number {
  if (right.relevance !== left.relevance) {
    return right.relevance - left.relevance;
  }
  return left.id.localeCompare(right.id);
}

/**
 * 按来源聚合片段成经历。
 *
 * 不满足准入规则的来源**不生成 Case**，但其片段仍然留在输入里
 * （调用方可以继续用它们做检索展示）—— 丢的是「升级」，不是片段本身。
 */
export function buildExperienceCases(
  facts: readonly ExperienceFact[],
): readonly ExperienceCase[] {
  const bySource = new Map<string, ExperienceFact[]>();
  for (const fact of facts) {
    const bucket = bySource.get(fact.sourceId);
    if (bucket) {
      bucket.push(fact);
    } else {
      bySource.set(fact.sourceId, [fact]);
    }
  }

  const cases: ExperienceCase[] = [];
  for (const [sourceId, grouped] of bySource) {
    if (!qualifiesForCase(grouped)) {
      continue;
    }
    const sorted = [...grouped].sort(byRelevance);
    const first = sorted[0]!;
    cases.push({
      id: `case:${sourceId}`,
      sourceId,
      sourceUrl: first.sourceUrl,
      author: first.author,
      conditions: sorted.filter((fact) => fact.type === 'condition'),
      actions: sorted.filter((fact) => fact.type === 'action'),
      costs: sorted.filter((fact) => fact.type === 'cost'),
      outcomes: sorted.filter((fact) => fact.type === 'outcome'),
      reflections: sorted.filter((fact) => fact.type === 'reflection'),
    });
  }

  // 稳定顺序：id 排序，保证同输入必得同输出
  return cases.sort((left, right) => left.id.localeCompare(right.id));
}
