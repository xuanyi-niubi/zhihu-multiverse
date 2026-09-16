import type {
  ProblemFrame,
  QualificationTrack,
  RetrievedExperienceSource,
  SearchPlan,
  SearchPurpose,
  SearchQuery,
  SimilaritySummary,
  SimilarityTier,
  SourceQualification,
  TransitionIntent,
} from '@/features/experience/domain';
import { qualifyExperienceSource } from '@/features/experience/qualification';
import { harvestOriginTerms } from '@/features/experience/originTerms';
import { isSearchBudgetExhausted } from '@/core/usage/searchBudget';
import { buildSameTargetQuery, buildSearchPlan, searchRequestBudget } from '@/features/experience/queryPlan';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

export const MAX_EXPERIENCE_SOURCES = 12;
/**
 * 并发批大小。
 *
 * 2026-09-16：每局检索预算放宽到 10 条之后，并发从 2 提到 5 ——
 * 10 条只需两批，**编译页的等待预算原地守住**（最坏约两批 × 6 秒）。
 * 实测：16 次真实检索在并发 4 下耗时 4.1 秒。
 */
export const RETRIEVAL_CONCURRENCY = 5;

export type ExperienceSearch = (
  query: string,
  count?: number,
) => Promise<readonly KnowledgeSource[]>;

export interface RetrieveRun {
  readonly queryId: string;
  readonly query: string;
  readonly purpose: SearchPurpose;
  readonly sourceCount: number;
  /**
   * `budget` = **我们自己停下了**（当日额度用尽），不是上游失败、也不是没有结果。
   * 三者必须可区分，否则页面会把"今天不查了"说成"没人讨论"。
   */
  readonly status: 'ok' | 'empty' | 'failed' | 'budget';
}

export interface RetrieveExperienceResult {
  readonly sources: readonly RetrievedExperienceSource[];
  readonly runs: readonly RetrieveRun[];
  readonly rawSourceCount: number;
  readonly rejectedCount: number;
  readonly similarity: SimilaritySummary | null;
  /**
   * 本局**放宽词从哪来**的诚实记录。
   *
   * 为什么要有：线上出现过"模型扩展一个词都没产出、只剩检索学到的词兜底"
   * 的情况，而这件事在结果里完全看不见 —— 页面只会说"没有找到完整同路经历"，
   * 让人误以为是语料没有，而不是**扩展这一步失败了**。
   */
  readonly expansion?: ExpansionTrace;
}

export interface ExpansionTrace {
  /** 模型给的相邻起点词数量（family + domain）。 */
  readonly modelTerms: number;
  /** 从第一轮真实返回里学到的起点词数量。 */
  readonly harvestedTerms: number;
  /** 是否真的调用过模型扩展。 */
  readonly modelCalled: boolean;
}

function sameSource(left: KnowledgeSource, right: KnowledgeSource): boolean {
  return left.id === right.id || left.url === right.url;
}

interface Accumulator {
  readonly source: KnowledgeSource;
  readonly purposes: SearchPurpose[];
  readonly matchedQueryIds: string[];
}

interface QualifiedAccumulator extends Accumulator {
  readonly qualification: SourceQualification;
}

const TRACK_CAP: Readonly<Record<QualificationTrack, number>> = {
  similar: 3,
  adjacent: 2,
  alternative: 2,
  counter: 2,
};

/**
 * 补位依据：某条轨道还有名额时，还能拿**什么查询目的**捞到的人来补。
 *
 * 相邻路径没有专门的查询目的（它由等级判定得出），所以不参与补位。
 */
const TRACK_BACKFILL_PURPOSES: Readonly<Record<QualificationTrack, readonly SearchPurpose[]>> = {
  similar: ['similar-person'],
  alternative: ['alternative'],
  counter: ['counterexample', 'failure'],
  adjacent: [],
};

/** 能坐相似轨的等级 —— 补位时同样要求，不能拿相邻路径去填相似轨。 */
const SIMILAR_SEAT_TIERS: readonly SimilarityTier[] = [
  'exact',
  'same-family',
  'same-domain',
  'same-target',
];

/**
 * 补位顺序：**反例优先于替代**。
 *
 * 一条「转行之后后悔、收入腰斩」的经历同时会被替代查询与反例查询捞到。
 * 它显然属于反例叙事；如果让替代轨先补位，反例轨就永远补不上，
 * 而「主动去找失败与后悔」正是这个产品最不可替代的地方。
 */
const BACKFILL_ORDER: readonly QualificationTrack[] = ['similar', 'counter', 'alternative', 'adjacent'];

const TIER_ORDER: readonly SimilarityTier[] = [
  'exact',
  'same-family',
  'same-domain',
  'same-target',
  'adjacent-target',
  'unrelated',
];

function tierRank(tier: SimilarityTier): number {
  return TIER_ORDER.indexOf(tier);
}

function authorKey(source: KnowledgeSource): string {
  const author = source.author.trim().toLowerCase();
  return author && author !== '匿名用户' ? author : source.id;
}

function compareLegacy(left: Accumulator, right: Accumulator): number {
  if (right.purposes.length !== left.purposes.length) return right.purposes.length - left.purposes.length;
  const authorityGap = rank(right.source.authority) - rank(left.source.authority);
  if (authorityGap !== 0) return authorityGap;
  const upvoteGap = rank(right.source.upvotes) - rank(left.source.upvotes);
  if (upvoteGap !== 0) return upvoteGap;
  const freshnessGap = rank(right.source.editTime) - rank(left.source.editTime);
  if (freshnessGap !== 0) return freshnessGap;
  return left.source.id.localeCompare(right.source.id);
}

function compareQualified(left: QualifiedAccumulator, right: QualifiedAccumulator): number {
  const tierGap = tierRank(left.qualification.similarityTier) - tierRank(right.qualification.similarityTier);
  if (tierGap !== 0) return tierGap;
  if (right.qualification.rankScore !== left.qualification.rankScore) {
    return right.qualification.rankScore - left.qualification.rankScore;
  }
  /**
   * 同等级、同内部分时，用**官方相关性分**决胜。
   *
   * 这是接口本来就返回、我们以前丢掉的字段（`RankingScore`）——
   * 读它不增加任何一次调用。缺失时按 0 处理，旧数据排序完全不变。
   */
  const officialGap = officialScoreOf(right.source) - officialScoreOf(left.source);
  if (officialGap !== 0) return officialGap;
  return compareLegacy(left, right);
}

/** 官方相关性分；缺失当 0（不猜、也不让旧数据受影响）。 */
function officialScoreOf(source: KnowledgeSource): number {
  const value = source.rankingScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function similaritySummary(items: readonly QualifiedAccumulator[]): SimilaritySummary {
  const tiers = items.map((item) => item.qualification.similarityTier);
  const bestAvailableTier = TIER_ORDER.find((tier) => tier !== 'unrelated' && tiers.includes(tier)) ?? null;
  return {
    exactCount: tiers.filter((tier) => tier === 'exact').length,
    bestAvailableTier,
    widened: bestAvailableTier !== null && bestAvailableTier !== 'exact',
  };
}

function selectBalanced(items: readonly QualifiedAccumulator[]): readonly QualifiedAccumulator[] {
  const selected: QualifiedAccumulator[] = [];
  const seenAuthors = new Set<string>();
  const order: readonly QualificationTrack[] = ['similar', 'alternative', 'counter', 'adjacent'];

  /** 收一个人；如果他是为别的轨道补位来的，就按那条轨道记（展示层才不会串位）。 */
  const take = (item: QualifiedAccumulator, track: QualificationTrack): boolean => {
    const author = authorKey(item.source);
    if (seenAuthors.has(author)) return false;
    seenAuthors.add(author);
    selected.push(
      item.qualification.assignedTrack === track
        ? item
        : { ...item, qualification: { ...item.qualification, assignedTrack: track } },
    );
    return true;
  };

  // 第一轮：每条轨道按自己的名额收人（`items` 已按等级排好序，等级高的先坐）
  for (const track of order) {
    let count = 0;
    for (const item of items) {
      if (count >= TRACK_CAP[track]) break;
      if (item.qualification.assignedTrack !== track) continue;
      if (take(item, track)) count += 1;
    }
  }

  /**
   * 第二轮：补位（P1）。
   *
   * 一条真实经历可能同时像「相似」和「反例」：它被判进相似轨之后，
   * 反例轨就空着 —— 而「主动找反例」是这个产品最不该缺席的视角。
   * 旧实现下，这种来源会被相似轨的 3 个名额挤掉，用户看不到任何反例。
   *
   * 只补「查询目的确实对得上」的人（反例查询 / 失败查询 / 替代查询捞到的），
   * 相似轨仍然只收够强的等级。找不到就不补，绝不编。
   */
  for (const track of BACKFILL_ORDER) {
    const purposes = TRACK_BACKFILL_PURPOSES[track];
    if (purposes.length === 0) continue;
    /**
     * 反例轨按**反例强度**挑人：补进来的必须是读起来像失败/退出/后悔的那条，
     * 而不是因为排序碰巧空出来的顺利故事（否则反例轨名不副实，比空着更糟）。
     */
    const pool =
      track === 'counter'
        ? [...items].sort(
            (left, right) => right.qualification.counterStrength - left.qualification.counterStrength,
          )
        : items;
    let count = selected.filter((item) => item.qualification.assignedTrack === track).length;
    for (const item of pool) {
      if (count >= TRACK_CAP[track]) break;
      if (item.qualification.assignedTrack === track) continue;
      if (!item.purposes.some((purpose) => purposes.includes(purpose))) continue;
      if (track === 'similar' && !SIMILAR_SEAT_TIERS.includes(item.qualification.similarityTier)) continue;
      if (take(item, track)) count += 1;
    }
  }

  return selected.slice(0, MAX_EXPERIENCE_SOURCES);
}

export async function retrieveExperienceSources(input: {
  readonly plan: SearchPlan;
  readonly search: ExperienceSearch;
  /** 有 frame 才启用人物资格审查；省略时保留旧调用兼容行为。 */
  readonly frame?: ProblemFrame;
  /** 已解析的开放式相似概念；主要供缓存复用与确定性测试使用。 */
  readonly intent?: TransitionIntent;
  /** 仅在精确亲历不足两人时调用一次。 */
  readonly expandIntent?: (frame: ProblemFrame) => Promise<TransitionIntent>;
}): Promise<RetrieveExperienceResult> {
  const runs: RetrieveRun[] = [];
  const merged: Accumulator[] = [];
  let modelCalled = false;
  let expansionTrace: ExpansionTrace | undefined;
  let intent = input.frame
    ? input.intent ?? buildTransitionIntent(input.frame)
    : undefined;

  const mergeResults = async (queries: SearchPlan['queries']): Promise<void> => {
    for (let start = 0; start < queries.length; start += RETRIEVAL_CONCURRENCY) {
      const batch = queries.slice(start, start + RETRIEVAL_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (query) => {
          try {
            const found = await input.search(query.query);
            return {
              query,
              found,
              status: (found.length > 0 ? 'ok' : 'empty') as RetrieveRun['status'],
            };
          } catch (error) {
            /**
             * **区分"上游失败"与"我们自己停下"**：
             * 额度用尽是我们主动停的，必须记成 `budget` ——
             * 若混进 `failed`，页面就会说"上游请求失败"，而事实是"今天不查了"。
             */
            return {
              query,
              found: [] as readonly KnowledgeSource[],
              status: (isSearchBudgetExhausted(error) ? 'budget' : 'failed') as RetrieveRun['status'],
            };
          }
        }),
      );

      for (const { query, found, status } of results) {
        runs.push({
          queryId: query.id,
          query: query.query,
          purpose: query.purpose,
          sourceCount: found.length,
          status,
        });

        for (const source of found) {
          const existing = merged.find((item) => sameSource(item.source, source));
          if (existing) {
            if (!existing.purposes.includes(query.purpose)) existing.purposes.push(query.purpose);
            if (!existing.matchedQueryIds.includes(query.id)) existing.matchedQueryIds.push(query.id);
            continue;
          }
          merged.push({ source, purposes: [query.purpose], matchedQueryIds: [query.id] });
        }
      }
    }
  };

  /**
   * 「够好了，不用再花钱」的等级：exact / 同族 / 同域。
   *
   * 刻意**不含** `same-target`：如果手上只有「其他背景进入同一目标」，
   * 那正是该再花一次扩展去够「相似起点 / 同类背景」的时候 ——
   * 产品优先级是「先找得准，找不到才找类似」，不是「有人就行」。
   * 相邻路径（`adjacent-target`）是弱证据，同样不算够好。
   */
  const GOOD_ENOUGH_TIERS: readonly SimilarityTier[] = ['exact', 'same-family', 'same-domain'];

  const goodEnoughCount = (): number =>
    merged.filter((item) => {
      const qualification = qualifyExperienceSource({
        source: item.source,
        frame: input.frame!,
        purposes: item.purposes,
        intent,
      });
      return qualification.eligibleAsCase && GOOD_ENOUGH_TIERS.includes(qualification.similarityTier);
    }).length;

  /** 每局检索预算（默认 8；`APP_MAX_SEARCH_REQUESTS` 可调，硬上限 12）。 */
  const budget = searchRequestBudget();

  /** 总请求数永远不超过预算（配额纪律）。 */
  const runWithinBudget = async (list: readonly SearchQuery[]): Promise<void> => {
    const room = Math.max(0, budget - runs.length);
    if (room === 0 || list.length === 0) return;
    await mergeResults(list.slice(0, room));
  };

  const notYetRun = (list: readonly SearchQuery[]): readonly SearchQuery[] => {
    const seenQueries = new Set(runs.map((run) => run.query.replace(/\s+/g, '')));
    return list.filter((query) => !seenQueries.has(query.query.replace(/\s+/g, '')));
  };

  const queries = input.plan.queries;

  if (input.frame && queries.length > 0) {
    /**
     * 三层阶梯，只有「上一层不足」才走下一层：
     *
     * 1. 精确起点 + 精确目标（找得准）；
     * 2. 还没拿到「完全同路 / 相似起点 / 同类背景」时放宽：
     *    a. 先跑**零模型成本**的「丢起点保目标」（其他背景进入同一目标）；
     *    b. 再从这一轮**真实返回**里学起点词并重建放宽查询；有模型时同时
     *       调一次语义扩展，两者合并（真词优先、模型词退到第二层）；
     * 3. 补齐替代与反例两条强制视角。
     */
    const exactQuery = queries.find((query) => query.id === 'q-similar-exact') ?? queries[0]!;
    await runWithinBudget([exactQuery]);

    if (goodEnoughCount() < 2) {
      /** a. 丢起点保目标（计划里通常已有；调用方给了更小的计划就现场补一条）。 */
      const plannedTarget = queries.find((query) => query.id === 'q-similar-target');
      const targetQuery =
        plannedTarget ?? buildSameTargetQuery({ frame: input.frame, ...(intent ? { intent } : {}) });
      if (targetQuery) await runWithinBudget([targetQuery]);

      /** b. 有模型就扩展一次；同时从这一轮**真实返回**里学起点词，重建查询面。 */
      let nextIntent: TransitionIntent = intent ?? buildTransitionIntent(input.frame);
      if (input.expandIntent) {
        modelCalled = true;
        nextIntent = await input.expandIntent(input.frame);
      }
      intent = nextIntent;

      /**
       * 学到的词**只进查询**（`extraOriginTerms`），**不进 `intent`**。
       *
       * 这是刻意的：等级判定用的是"用户原话 + 已校验的模型词"，
       * 而检索学到的词只是"这批人从哪儿来"的语料证据 —— 若把它塞进
       * `origin.family`，任何共现的身份词（徽章写着"会计"）都会被冒领成
       * "相似起点"。**查询可以放宽，等级声明不能冒领。**
       */
      const harvested = harvestOriginTerms({
        sources: merged.map((item) => item.source),
        target: intent.target.exact[0] ?? null,
        origin: intent.origin.exact[0] ?? null,
        limit: 3,
      });
      expansionTrace = {
        modelTerms: intent.origin.family.length + intent.origin.domain.length,
        harvestedTerms: harvested.length,
        modelCalled,
      };
      const rebuilt = buildSearchPlan({
        frame: input.frame,
        intent,
        extraOriginTerms: harvested,
        maxRequests: budget,
      }).queries;
      await runWithinBudget(notYetRun(rebuilt.length > 0 ? rebuilt : queries));
    } else {
      await runWithinBudget(notYetRun(queries));
    }
  } else {
    await mergeResults(queries);
  }

  if (!input.frame) {
    const sources = merged.sort(compareLegacy).slice(0, MAX_EXPERIENCE_SOURCES).map((item) => ({
      source: item.source,
      purposes: [...item.purposes],
      matchedQueryIds: [...item.matchedQueryIds],
    }));
    return {
      sources,
      runs,
      rawSourceCount: merged.length,
      rejectedCount: 0,
      similarity: null,
      ...(expansionTrace ? { expansion: expansionTrace } : {}),
    };
  }

  const qualified: QualifiedAccumulator[] = merged.map((item) => ({
    ...item,
    qualification: qualifyExperienceSource({
      source: item.source,
      frame: input.frame!,
      purposes: item.purposes,
      intent,
    }),
  }));
  const eligible = qualified.filter((item) => item.qualification.eligibleAsCase).sort(compareQualified);
  const selected = selectBalanced(eligible);
  const sources: readonly RetrievedExperienceSource[] = selected.map((item) => ({
    source: item.source,
    purposes: [...item.purposes],
    matchedQueryIds: [...item.matchedQueryIds],
    qualification: item.qualification,
  }));

  return {
    sources,
    runs,
    rawSourceCount: merged.length,
    rejectedCount: merged.length - selected.length,
    similarity: similaritySummary(selected),
    ...(expansionTrace ? { expansion: expansionTrace } : {}),
  };
}

function rank(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}
