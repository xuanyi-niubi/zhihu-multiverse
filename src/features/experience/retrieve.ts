import type {
  RetrievedExperienceSource,
  SearchPlan,
  SearchPurpose,
} from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 经验检索执行层（Phase 4 / P0-C）。
 *
 * ## 分工
 *
 * `queryPlan.ts` 决定**搜什么**（纯函数，可测试）；
 * 本模块决定**怎么搜**（预算、并发、去重、封顶）。
 *
 * ## 三条纪律
 *
 * 1. **并发 ≤ 2**：知乎开放平台有速率限制，一次并发 4～6 个请求
 *    会触发 rate limit，反而比串行更慢；
 * 2. **失败不抛**：单条 query 失败只意味着这一路没收获，
 *    整个检索不能因此崩掉 —— 调用方据此诚实降级；
 * 3. **排序≠评分**：进入抽取层的来源按 权威 / 意图覆盖 / 赞同 /
 *    新鲜度 排序，但这些数字只决定**谁先进门**，
 *    不构成任何「真实性评分」。
 */

/** 进入抽取层的来源上限。多了 prompt 爆炸，少了世界失真。 */
export const MAX_EXPERIENCE_SOURCES = 12;
/** 并发上限：一次最多 2 条在途请求。 */
export const RETRIEVAL_CONCURRENCY = 2;

/** 一路检索的执行函数。返回空数组 = 这一路没找到，不抛错。 */
export type ExperienceSearch = (
  query: string,
  count?: number,
) => Promise<readonly KnowledgeSource[]>;

export interface RetrieveRun {
  readonly queryId: string;
  readonly query: string;
  readonly purpose: SearchPurpose;
  readonly sourceCount: number;
}

export interface RetrieveExperienceResult {
  readonly sources: readonly RetrievedExperienceSource[];
  readonly runs: readonly RetrieveRun[];
}

/** 两个来源是否指同一条内容（同 id 或同 URL 都算 —— URL 是内容的主键）。 */
function sameSource(left: KnowledgeSource, right: KnowledgeSource): boolean {
  return left.id === right.id || left.url === right.url;
}

/** 内部累加器：合并期可变，出口处再冻结成 readonly 契约。 */
interface Accumulator {
  readonly source: KnowledgeSource;
  readonly purposes: SearchPurpose[];
  readonly matchedQueryIds: string[];
}

/**
 * 执行一份检索计划。
 *
 * 即使 `search` 实现内部抛错（第三方假实现、网络库异常），
 * 本函数也**绝不抛**：那一路记为 0 条，其余照常。
 */
export async function retrieveExperienceSources(input: {
  readonly plan: SearchPlan;
  readonly search: ExperienceSearch;
}): Promise<RetrieveExperienceResult> {
  const runs: RetrieveRun[] = [];
  const merged: Accumulator[] = [];

  const queries = input.plan.queries;
  /** 按并发上限分批：每批内并行，批与批之间串行。 */
  for (let start = 0; start < queries.length; start += RETRIEVAL_CONCURRENCY) {
    const batch = queries.slice(start, start + RETRIEVAL_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (query) => {
        let found: readonly KnowledgeSource[] = [];
        try {
          found = await input.search(query.query);
        } catch {
          found = [];
        }
        return { query, found };
      }),
    );

    for (const { query, found } of results) {
      runs.push({
        queryId: query.id,
        query: query.query,
        purpose: query.purpose,
        sourceCount: found.length,
      });

      for (const source of found) {
        const existing = merged.find((item) => sameSource(item.source, source));
        if (existing) {
          // 同一条内容被多条 query 命中：合并意图，而不是重复收录
          if (!existing.purposes.includes(query.purpose)) {
            existing.purposes.push(query.purpose);
          }
          if (!existing.matchedQueryIds.includes(query.id)) {
            existing.matchedQueryIds.push(query.id);
          }
          continue;
        }
        merged.push({
          source,
          purposes: [query.purpose],
          matchedQueryIds: [query.id],
        });
      }
    }
  }

  const sources: readonly RetrievedExperienceSource[] = merged
    .sort(compareAccumulated)
    .slice(0, MAX_EXPERIENCE_SOURCES)
    .map((item) => ({
      source: item.source,
      purposes: [...item.purposes],
      matchedQueryIds: [...item.matchedQueryIds],
    }));

  return { sources, runs };
}

/**
 * 排序：意图覆盖多 → 权威高 → 赞同多 → 越新。
 *
 * **这些只决定进门顺序**。`null` 一律排后但不丢弃 ——
 * 缺数据不等于差数据。
 */
function compareAccumulated(left: Accumulator, right: Accumulator): number {
  if (right.purposes.length !== left.purposes.length) {
    return right.purposes.length - left.purposes.length;
  }
  const authorityGap = rank(right.source.authority) - rank(left.source.authority);
  if (authorityGap !== 0) {
    return authorityGap;
  }
  const upvoteGap = rank(right.source.upvotes) - rank(left.source.upvotes);
  if (upvoteGap !== 0) {
    return upvoteGap;
  }
  const freshnessGap = rank(right.source.editTime) - rank(left.source.editTime);
  if (freshnessGap !== 0) {
    return freshnessGap;
  }
  // 稳定兜底：同分按 id，保证同输入必得同输出
  return left.source.id.localeCompare(right.source.id);
}

function rank(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}
