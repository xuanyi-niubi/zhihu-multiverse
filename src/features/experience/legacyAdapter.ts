import { clusterPaths, detectProblemType } from '@/features/decision-session/routes';
import type { PathCluster } from '@/features/decision-session/domain';
import type {
  ExperienceFact,
  ExperiencePath,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * legacy 适配层（Phase 8 / P0-E）。
 *
 * ## 存在的理由
 *
 * 旧 `routes.ts` 聚类是**无模型时的最后一条路**：它稳定、零依赖、
 * 且词表来自真实快照阅读。新 ExperiencePath 主路径上线后它不再是
 * 主路径，但**不能删** —— 模型挂了 / 配额烧完 / 离线兜底时，
 * 用户看到的不能是一张白屏。
 *
 * ## 它只做形状转换
 *
 * `PathCluster`（旧）→ `ExperiencePath`（新）：
 * 字段一一对应，不发明新内容、不改变聚类结果。
 * 片段 id 与 case id 的映射由调用方传入的索引完成。
 */

/** ExperienceFact → 旧聚类吃的 EvidenceFact 最小形状（只用到 quote/id）。 */
function toLegacyFact(fact: ExperienceFact) {
  return {
    id: fact.id,
    sourceId: fact.sourceId,
    sourceUrl: fact.sourceUrl,
    retrievedAt: '',
    quote: fact.exactQuote,
    factType: fact.type === 'reflection' ? ('opinion' as const) : fact.type,
    relevance: fact.relevance,
  };
}

/** 旧聚类的字符串 unknown → UnknownVariable（不编 whyItMatters）。 */
function unknownVariablesOf(cluster: PathCluster): readonly UnknownVariable[] {
  return cluster.unknowns.map((label, index) => ({
    id: `${cluster.id}-unknown-${index + 1}`,
    label,
    whyItMatters: '这条路径的证据还缺这一块，弄清它比急着选更重要。',
    origin: 'evidence-gap',
    priority: 2,
  }));
}

export interface LegacyExperiencePathsInput {
  readonly question: string;
  readonly facts: readonly ExperienceFact[];
  /** factId → caseId（由 buildExperienceCases 的结果反查）。 */
  readonly caseIdByFactId: ReadonlyMap<string, string>;
}

/**
 * 走旧聚类生成 ExperiencePath。
 *
 * 问题类型识别不了（如「今天天气不错」）→ 返回空数组 ——
 * 与旧纪律一致：兜底错配比空白更糟。
 */
export function legacyExperiencePaths(input: LegacyExperiencePathsInput): readonly ExperiencePath[] {
  const type = detectProblemType(input.question);
  if (type === null) {
    return [];
  }

  const legacyFacts = input.facts.map(toLegacyFact);
  const clustered = clusterPaths({ question: input.question, facts: legacyFacts, type });

  return clustered.clusters.map((cluster) => {
    const supportingCaseIds = [
      ...new Set(
        cluster.supportingFactIds
          .map((factId) => input.caseIdByFactId.get(factId))
          .filter((caseId): caseId is string => typeof caseId === 'string'),
      ),
    ];
    const opposingCaseIds = [
      ...new Set(
        cluster.opposingFactIds
          .map((factId) => input.caseIdByFactId.get(factId))
          .filter((caseId): caseId is string => typeof caseId === 'string'),
      ),
    ];

    return {
      id: `path-legacy-${cluster.id}`,
      label: cluster.label,
      summary: cluster.summary,
      supportingCaseIds,
      opposingCaseIds,
      supportingFactIds: cluster.supportingFactIds,
      opposingFactIds: cluster.opposingFactIds,
      observedConditions: cluster.conditions,
      observedActions: [],
      observedCosts: [],
      observedOutcomes: [],
      differencesFromUser: [],
      unknowns: unknownVariablesOf(cluster),
      origin: 'legacy-fallback' as const,
    } satisfies ExperiencePath;
  });
}
