import { extractProfile, type PlayerProfile } from '@/core/dm/profile';
import { answerValuesFor, clarificationNeedsFor } from '@/features/experience/clarification';
import { buildProblemFrame } from '@/features/experience/frame';
import { buildExperienceCases } from '@/features/experience/cases';
import { extractExperienceFacts } from '@/features/experience/extract';
import { legacyExperiencePaths } from '@/features/experience/legacyAdapter';
import { buildSearchPlan } from '@/features/experience/queryPlan';
import { qualifyExperienceSource } from '@/features/experience/qualification';
import { retrieveExperienceSources, type ExperienceSearch } from '@/features/experience/retrieve';
import { similaritySummaryCopy } from '@/features/experience/similarityCopy';
import { expandTransitionIntent } from '@/features/experience/transitionIntent';
import { synthesizeExperiencePaths } from '@/features/experience/pathSynthesis';
import { compileWorldBlueprint } from '@/features/game-world/compileWorld';
import { caseSources, matchDemoCase } from '@/data/demoCases';
import { contextFrom, clarifyQuestions, experimentFor } from '@/features/decision-session/clarify';
import { experimentFromUnknown } from '@/features/decision-session/experiment';
import { factTypeOf, relevanceOf, toEvidenceFacts } from '@/features/decision-session/facts';
import { clusterPaths, detectProblemType } from '@/features/decision-session/routes';
import { newSessionId } from '@/features/decision-session/store';
import { validateExtractedFact } from '@/features/experience/validate';

import type { ProviderRouter } from '@/agents/providerRouter';
import type {
  DecisionSession,
  PathCluster,
  RealityExperiment,
  RetrievalRun,
  UserContext,
} from '@/features/decision-session/domain';
import type { DecisionSessionRepository } from '@/features/decision-session/store';
import type { ExperienceFact, ProblemFrame } from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 决策会话用例（重构方案 §3.1 的五步闭环）。
 *
 * ```text
 * 一个真实困惑
 *   → 澄清我的目标与约束
 *   → 看见 2～3 条真实路径及其分歧
 *   → 找到当前最大的未知
 *   → 认领一个 7 天内可验证的小实验
 * ```
 *
 * ## 全部是纯函数 + 一个仓储依赖
 *
 * 每个 use case 只做**一个业务动作**（方案 §6.3），不读模块全局变量、
 * 不直接碰文件系统。因此它们可以在测试里用内存仓储跑完整条链路。
 */

/** 检索结果：文案必须与事实一致（方案 §5.3）。 */
export interface RetrievedEvidence {
  readonly sources: readonly KnowledgeSource[];
  readonly retrievalRun: RetrievalRun;
}

/**
 * 检索这个问题的真实来源。
 *
 * ## 三档 provenance，文案必须诚实
 *
 * | 情况 | provenance | 界面文案 |
 * |---|---|---|
 * | 命中人工核验过的黄金案例 | `curated` | 「演示案例的来源快照」 |
 * | 有知乎 key，实时检索成功 | `live` | 「知乎实时检索」+ 检索时间 |
 * | 都没有 | `offline` | 「当前没有可核对的来源」**并且不给路径** |
 *
 * ⚠️ 关键纪律（方案 §5.3）：**用快照时绝不能写「没有站内样本」**。
 * 旧版本同一面板上同时写「落盘快照 · 12 条样本」和「本次没有可用的站内样本」，
 * 那在用户眼里就是产品错误（方案 §1.2 实测）。
 */
export async function retrieveFor(input: {
  readonly question: string;
  /** 实时检索能力；由调用方注入，便于测试与降级。 */
  readonly liveSearch?: (query: string) => Promise<readonly KnowledgeSource[]>;
}): Promise<RetrievedEvidence> {
  const now = new Date().toISOString();
  const matched = matchDemoCase(input.question);

  if (matched) {
    const sources = caseSources(matched.caseId);
    return {
      sources,
      retrievalRun: {
        queries: [input.question],
        provenance: 'curated',
        retrievedAt: now,
        sourceCount: sources.length,
        factCount: 0,
        filteredCount: 0,
        unsupportedSynthesisCount: 0,
        notes: [`问题与已人工核验的黄金案例「${matched.title}」相关，使用该案例的来源快照。`],
      },
    };
  }

  if (input.liveSearch) {
    try {
      const sources = await input.liveSearch(input.question);
      if (sources.length > 0) {
        return {
          sources,
          retrievalRun: {
            queries: [input.question],
            provenance: 'live',
            retrievedAt: now,
            sourceCount: sources.length,
            factCount: 0,
            filteredCount: 0,
            unsupportedSynthesisCount: 0,
            notes: ['本次使用知乎实时检索。'],
          },
        };
      }
    } catch {
      // 落到底下的 offline，不抛
    }
  }

  return {
    sources: [],
    retrievalRun: {
      queries: [input.question],
      provenance: 'offline',
      retrievedAt: now,
      sourceCount: 0,
      factCount: 0,
      filteredCount: 0,
      unsupportedSynthesisCount: 0,
      notes: [
        '当前无法取得可核对的知乎来源，因此本次不生成任何路径 —— 我们不补齐漂亮答案。',
      ],
    },
  };
}

/**
 * 构建路径（方案 §5.3 的降级规则）。
 *
 * > 少于两条高相关事实：不生成三条路径，直接说证据不足并引导补充问题。
 */
export interface PathsResult {
  readonly clusters: readonly PathCluster[];
  readonly insufficientRoutes: readonly string[];
  readonly problemType: ReturnType<typeof detectProblemType>;
  readonly factual: boolean;
  readonly reason: string | null;
  /**
   * 本次实际采用的事实。
   *
   * **刻意从这里返回而不是让调用方再算一遍**：初版在 `buildPaths` 与
   * `createSession` 里各调用一次 `toEvidenceFacts`，于是可能出现
   * 「路径基于 A 组事实、展示基于 B 组事实」的错配 ——
   * 而这类错配正是本方案要消灭的东西。
   */
  readonly facts: readonly import('@/features/decision-session/domain').EvidenceFact[];
  readonly filteredCount: number;
}

export function buildPaths(input: {
  readonly question: string;
  readonly sources: readonly KnowledgeSource[];
}): PathsResult {
  const type = detectProblemType(input.question);

  if (type === null) {
    return {
      clusters: [],
      insufficientRoutes: [],
      problemType: null,
      factual: false,
      reason: '这个问题不属于本版覆盖的四类选择（比赛与项目 / 升学与就业 / 第一份实习或工作 / 转专业与转行）。你可以换一种说法，或者补充一句具体处境。',
      facts: [],
      filteredCount: 0,
    };
  }

  const { facts, filteredCount } = toEvidenceFacts({
    sources: input.sources,
    question: input.question,
    idPrefix: type,
    minRelevance: 0.25,
  });

  if (facts.length < 2) {
    return {
      clusters: [],
      insufficientRoutes: [],
      problemType: type,
      factual: false,
      reason: `我们只找到 ${facts.length} 条与这个问题直接相关的可核对经历，少于两条时不足以归纳路径 —— 我们不会在这种情况下补一个看起来完整的答案。`,
      facts,
      filteredCount,
    };
  }

  const result = clusterPaths({ question: input.question, facts, type });
  return {
    clusters: result.clusters,
    insufficientRoutes: result.insufficientRoutes,
    problemType: type,
    factual: result.clusters.length > 0,
    reason:
      result.clusters.length === 0
        ? '找到了相关经历，但它们的走法差异还不够明显，无法归纳出可区分的路径。'
        : null,
    facts,
    filteredCount,
  };
}

/* -------------------------------------------------------------------------- */
/* 会话用例                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateSessionInput {
  readonly ownerId: string;
  readonly question: string;
  /**
   * 处境档案（Phase 2）。
   *
   * 由调用方决定走哪条管线：有模型配置就 `generateProfile()`
   * （模型解析 + 失败回退），否则 `extractProfile()`（确定性规则）。
   * 省略时本函数自己走 `extractProfile()` —— 与 `/api/profile` 纪律一致，
   * **不新造第二套画像**。
   */
  readonly profile?: PlayerProfile;
  /** 模型写的自由文本分析；没有就 null。 */
  readonly profileAnalysis?: string | null;
  /** 把实时检索推迟到 `prepare-world`（P0-5）。默认 false，保持旧行为。 */
  readonly deferRetrieval?: boolean;
  /**
   * 上一次会话里**实验观测到**的事实（P1-3）。
   *
   * 它们会被写成 `origin: 'experiment-observed'` 的硬条件 ——
   * 与「用户自己说的时间」同属可信证据，但来源可区分：
   * 自我估计可以被现实推翻，观测到的不会。
   */
  readonly observedClaims?: readonly string[];
  readonly liveSearch?: (query: string) => Promise<readonly KnowledgeSource[]>;
}

/**
 * 第一步 + 第三步：建会话并直接给出路径（首页只输入一次问题）。
 *
 * Phase 2 之后多一步：**先框定问题，再检索**。顺序很重要 ——
 * 框定决定「该去找哪一类经历」，检索层（Phase 4）会消费它生成的 `SearchPlan`。
 */
export async function createSession(input: CreateSessionInput): Promise<DecisionSession> {
  const question = input.question.trim();

  /**
   * 档案复用纪律：调用方给的优先，没给就用确定性规则自己算。
   * **绝不在两个地方各生成一份** —— 那会出现「界面看到的档案」
   * 与「框定用的档案」不一致。
   */
  const profile = input.profile ?? extractProfile(question);
  const profileAnalysis = input.profileAnalysis ?? null;
  const framed = buildProblemFrame({ question, profile, analysis: profileAnalysis });

  /**
   * 现实记忆回灌（P1-3）。
   *
   * 上一次会话里**实验观测到**的事实，在这里变成硬条件：
   * `origin: 'experiment-observed'`（不是 parser-synthesis），
   * 因此它可以参与判断，而解析推断不行。
   *
   * 最典型的一条：「你说每周能挤出 8 小时，但七天记录的中位数是 3 小时」——
   * 下一次会话该按 3 小时算，而不是继续相信那个自我估计。
   * 没有观测记忆时这一步是恒等变换（既有会话行为零变化）。
   */
  const problemFrame: ProblemFrame = input.observedClaims?.length
    ? {
        ...framed,
        constraints: [
          ...framed.constraints,
          ...input.observedClaims.map((claim, index) => ({
            id: `observed-${index}`,
            text: `上一局真实观测到：${claim}`,
            origin: 'experiment-observed' as const,
            hard: true,
          })),
        ],
      }
    : framed;

  /**
   * 动态澄清（Phase 3）：需要问什么、还是什么都不用问。
   *
   * 长度为 0 时不进 `clarifying` 而是直接 `comparing` —— 用户已经说清了
   * 这个选择所需的全部信息，再问一遍就是浪费他的耐心。
   */
  const clarificationNeeds = clarificationNeedsFor(problemFrame);

  /**
   * 推迟检索（P0-5）。
   *
   * ## 为什么需要它
   *
   * 新主链在一次推演里会检索**两遍**：
   *
   * ```text
   * POST /api/sessions  → 旧 retrieveFor()          （1 次）
   * prepare-world       → multi-intent retrieval    （3 次）
   * ```
   *
   * 既浪费知乎配额，也让职责混乱：创建会话的职责是
   * 「确定这是谁、他在问什么、还缺什么信息」；检索的职责是
   * 「按 SearchPlan 去找相似 / 替代 / 反例经历」—— 而后者
   * **必须等澄清答完**才定得准，因为用户的回答会改变检索意图。
   *
   * ## 兼容
   *
   * 默认 `false`：旧 Session、黄金案例、既有测试仍可在创建时预加载路径。
   * 只有新主链（`/api/sessions`）显式传 `true`。
   */
  const deferred = input.deferRetrieval === true;
  const now = new Date().toISOString();

  if (deferred) {
    return {
      id: newSessionId(),
      ownerId: input.ownerId,
      status: clarificationNeeds.length > 0 ? 'clarifying' : 'comparing',
      question,
      userContext: { goal: question, nonNegotiables: [], existingResources: [] },
      problemFrame,
      profile,
      profileAnalysis,
      clarificationNeeds,
      /**
       * 检索留空，但**如实标注它被推迟了** —— 不是「检索了但没结果」。
       *
       * 这两种状态在界面上必须能区分：前者是「还没做」，
       * 后者是「做了但没有可用样本」。混为一谈会让人以为
       * 证据真的不存在，而实际上我们还没去找。
       */
      retrievalRun: {
        provenance: 'deferred',
        queries: [],
        retrievedAt: now,
        sourceCount: 0,
        factCount: 0,
        filteredCount: 0,
        unsupportedSynthesisCount: 0,
        factual: false,
        notes: ['检索推迟到生成世界时进行：先确定还缺什么，再按意图去找经历。'],
        reason: '检索推迟到生成世界时进行：先确定还缺什么，再按意图去找经历。',
      } as RetrievalRun,
      evidenceFacts: [],
      pathClusters: [],
      experienceFacts: [],
      experienceCases: [],
      experiencePaths: [],
      worldBlueprint: null,
      selectedUnknown: null,
      experiment: null,
      followUp: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const retrieved = await retrieveFor({
    question,
    ...(input.liveSearch ? { liveSearch: input.liveSearch } : {}),
  });
  const paths = buildPaths({ question, sources: retrieved.sources });

  // 事实**只算一次**，路径与展示共用同一组（避免两者基于不同数据）
  const retrievalRun: RetrievalRun = {
    ...retrieved.retrievalRun,
    factCount: paths.facts.length,
    filteredCount: retrieved.retrievalRun.filteredCount + paths.filteredCount,
  };

  return {
    id: newSessionId(),
    ownerId: input.ownerId,
    /**
     * 建会话后总是进入 `clarifying`：即使问题很好，
     * 也先问三件事再给结论 —— 这是方案的第二步，不是可跳过的装饰。
     */
    status: clarificationNeeds.length > 0 ? 'clarifying' : 'comparing',
    question,
    userContext: { goal: question, nonNegotiables: [], existingResources: [] },
    problemFrame,
    profile,
    profileAnalysis,
    clarificationNeeds,
    retrievalRun,
    evidenceFacts: paths.facts,
    pathClusters: paths.clusters,
    // 经验引擎产物（P0-C~F）：prepare-world 时填充；建会话时为空
    experienceFacts: [],
    experienceCases: [],
    experiencePaths: [],
    worldBlueprint: null,
    selectedUnknown: null,
    experiment: null,
    followUp: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 第二步：记录澄清回答。 */
export function applyClarify(
  session: DecisionSession,
  answers: Readonly<Record<string, string | undefined>>,
): DecisionSession {
  const questions = clarifyQuestions(detectProblemType(session.question));
  const userContext = contextFrom({
    goal: session.question,
    answers,
    questions,
  });
  return touch(session, { userContext, status: 'comparing' });
}

/**
 * 动态澄清的答复落地（Phase 3）。
 *
 * 与旧 `applyClarify` 的分工：旧的按**固定问题集合**（time/verify/loss）
 * 解析答复；这个按 `session.clarificationNeeds` 的 `missingVariable` 分派，
 * 因此以后加新问题不需要改这里。
 *
 * 落地三件事：
 * 1. 更新 `userContext`（旧组件仍在读它）；
 * 2. 把用户**明确回答的**内容补进 `problemFrame`，标记 `user-explicit` + `hard`；
 * 3. 清空 `clarificationNeeds` 并转 `comparing`（问过就不再问）。
 */
export function applyDynamicClarification(
  session: DecisionSession,
  answers: Readonly<Record<string, string | undefined>>,
): DecisionSession {
  const values = answerValuesFor(session.clarificationNeeds, answers);

  const time = findAnswered(values, 'availableTime');
  const resource = findAnswered(values, 'existingResources');
  const nonNegotiable = findAnswered(values, 'nonNegotiables');

  const userContext: UserContext = {
    ...session.userContext,
    ...(time ? { availableTime: time } : {}),
    ...(resource ? { existingResources: [resource] } : {}),
    ...(nonNegotiable ? { nonNegotiables: [nonNegotiable] } : {}),
  };

  const problemFrame = session.problemFrame
    ? appendAnsweredStatements(session.problemFrame, values)
    : null;

  return touch(session, {
    userContext,
    problemFrame,
    clarificationNeeds: [],
    status: 'comparing',
  });
}

/** 取某个变量上用户给出的值（没答就是 undefined）。 */
function findAnswered(
  values: readonly { readonly variable: string; readonly value: string }[],
  variable: string,
): string | undefined {
  return values.find((item) => item.variable === variable)?.value;
}

/**
 * 把用户亲口回答的内容补进 frame。
 *
 * **这是「升级为硬条件」的唯一入口**：只有走完这条路径的陈述才能拿到
 * `user-explicit` + `hard: true`；解析器推断出来的东西永远拿不到。
 */
function appendAnsweredStatements(
  frame: ProblemFrame,
  values: readonly { readonly variable: string; readonly value: string; readonly text: string }[],
): ProblemFrame {
  const constraints = [...frame.constraints];
  const resources = [...frame.resources];
  const existing = new Set([...constraints, ...resources].map((item) => item.text));

  for (const item of values) {
    if (existing.has(item.value)) {
      continue;
    }
    const statement = {
      id: `answered-${item.variable}`,
      text: item.value,
      origin: 'user-explicit' as const,
      hard: true,
    };
    if (item.variable === 'existingResources') {
      resources.push(statement);
    } else {
      constraints.push(statement);
    }
    existing.add(item.value);
  }

  return { ...frame, constraints, resources };
}

/** 第四步：选中「最想先弄清的那个未知」。 */
export function selectUnknown(session: DecisionSession, unknown: string): DecisionSession {
  return touch(session, { selectedUnknown: unknown, status: 'choosing_unknown' });
}

/* -------------------------------------------------------------------------- */
/* 经验引擎：prepare-world（Phase 8-10 / P0-C~F）                               */
/* -------------------------------------------------------------------------- */

export interface PrepareExperienceSessionDeps {
  /**
   * 经验检索能力（多意图）。缺省时**不发起任何网络请求**，
   * 改从会话已有的 legacy 证据（黄金案例 / 上一次检索）桥接 ——
   * 这让无 key 的演示与离线兜底同样能拿到世界蓝图。
   */
  readonly search?: ExperienceSearch;
  /** 模型路由；null / 缺省 = 无模型（fallback 提取 + legacy 聚类）。 */
  readonly router?: ProviderRouter | null;
}

/**
 * 把 legacy 证据（`EvidenceFact`）桥接成经验片段。
 *
 * 桥接是**有纪律的**：仍然走 `validateExtractedFact`（verified + 逐字），
 * 只不过「原文」就是 legacy 事实里的 verbatim quote —— 零模型、零检索时
 * 黄金案例的快照证据依然能编译出世界蓝图。
 */
function experienceFactsFromLegacy(session: DecisionSession): readonly ExperienceFact[] {
  const frame = session.problemFrame;
  if (!frame) {
    return [];
  }
  const question = frame.rawQuestion;
  return (session.evidenceFacts ?? []).flatMap((fact) => {
    const source = {
      id: fact.sourceId,
      author: fact.author ?? '匿名用户',
      quote: fact.quote,
      upvotes: null,
      url: fact.sourceUrl,
      retrievedAt: fact.retrievedAt,
      status: 'verified' as const,
      editTime: null,
      authority: null,
    };
    const qualification = qualifyExperienceSource({
      source,
      frame,
      purposes: [],
    });
    if (!qualification.eligibleAsCase) {
      return [];
    }
    const type = fact.factType === 'opinion' ? ('reflection' as const) : fact.factType;
    return [
      validateExtractedFact({
        source,
        exactQuote: fact.quote,
        type,
        id: `fact:${fact.sourceId}:${fact.id}`,
        relevance: relevanceOf(question, fact.quote),
        qualification,
      }),
    ].filter((item): item is ExperienceFact => item !== null);
  });
}

/**
 * 为「检索被推迟」的会话补做 legacy 检索（P0-5）。
 *
 * ## 为什么必须有这一步
 *
 * `/api/sessions` 现在传 `deferRetrieval: true`，创建时不再预加载
 * `evidenceFacts` / `pathClusters`。而无 key 的场景（本地演示、
 * 访客没填自己的知乎凭证）走的是 `experienceFactsFromLegacy()` 兜底 ——
 * 它读的正是这两个字段。不补做的话兜底会静默失效：
 * 空事实 → 空经历 → 空路径 → **零经验解锁**（实测复现过）。
 *
 * ## 它做的是同一件事，只是换了时间
 *
 * 与 `createSession()` 的非推迟分支**完全同一套调用**
 * （`retrieveFor` + `buildPaths`），所以数据不会因为搬家而变样：
 * 黄金案例仍然给出 curated 快照与问题专属路径。
 * 区别只是它发生在用户答完澄清之后 —— 那时检索意图才定得准。
 */
async function hydrateLegacyEvidence(session: DecisionSession): Promise<DecisionSession> {
  const retrieved = await retrieveFor({ question: session.question });
  const paths = buildPaths({ question: session.question, sources: retrieved.sources });
  const now = new Date().toISOString();

  return {
    ...session,
    retrievalRun: {
      ...retrieved.retrievalRun,
      factCount: paths.facts.length,
      filteredCount: retrieved.retrievalRun.filteredCount + paths.filteredCount,
    },
    evidenceFacts: paths.facts,
    pathClusters: paths.clusters,
    updatedAt: now,
  };
}

/**
 * prepare-world：把一个已澄清的会话编译成可进入的世界。
 *
 * ```text
 * SearchPlan → 多意图检索 → 逐字片段 → 经历 → 动态路径 → WorldBlueprint
 * ```
 *
 * 与 createSession 的分工：create 只框定问题与澄清（轻），
 * 检索与合成的重活全部在这一步 —— 用户回答完澄清之后才发生。
 */
export async function prepareExperienceSession(
  session: DecisionSession,
  deps: PrepareExperienceSessionDeps = {},
): Promise<DecisionSession> {
  const frame = session.problemFrame;
  if (!frame) {
    return session;
  }

  let facts: readonly ExperienceFact[];
  /**
   * 实时检索运行记录：**有检索就要如实写进会话**。
   *
   * 旧实现只在「无检索能力」那条分支更新它，于是走了实时检索的会话
   * 依然显示「检索还没开始 / 0 条来源」—— 与事实相反，而这正是
   * 这个产品最不该出错的地方（来源状态文案必须与事实一致）。
   */
  let liveRun: RetrievalRun | null = null;
  if (deps.search) {
    const plan = buildSearchPlan({ frame });
    const retrieved = await retrieveExperienceSources({
      plan,
      search: deps.search,
      frame,
      ...(deps.router
        ? { expandIntent: (targetFrame: ProblemFrame) => expandTransitionIntent(targetFrame, { router: deps.router! }) }
        : {}),
    });
    /**
     * 直接把 `retrieved.sources` 交给提取层（P0-6）。
     *
     * 每条来源自带 `purposes` —— 检索阶段知道它是作为相似经历、替代走法
     * 还是反例被找来的。早先这里把全部意图合成一个并集再传下去，
     * 结果每条片段都声称自己同时服务所有意图，反例幕就没法优先挑真正的反例。
     */
    // 逐字切句可确定性完成，避免一次非必要的深模型等待。
    const extracted = await extractExperienceFacts({
      sources: retrieved.sources,
      question: frame.rawQuestion,
      router: null,
    });
    facts = extracted.facts;
    const tracks = new Set(
      retrieved.sources.flatMap((item) =>
        item.qualification ? [item.qualification.assignedTrack] : [],
      ),
    );
    const hasFullCoverage =
      tracks.has('similar') && tracks.has('alternative') && tracks.has('counter');
    const onlyAdjacent = !tracks.has('similar') && tracks.has('adjacent');
    const anyFailed = retrieved.runs.some((run) => run.status === 'failed');
    /** 当日检索额度用尽（我们自己停下）—— 与"上游失败"和"没人讨论"都不同。 */
    const anyBudgetBlocked = retrieved.runs.some((run) => run.status === 'budget');
    const failureKind =
      retrieved.sources.length > 0
        ? 'none'
        : anyBudgetBlocked
          ? 'search-budget'
          : anyFailed
            ? 'upstream-error'
            : retrieved.rawSourceCount > 0
              ? 'no-qualified-person'
              : 'no-result';
    const outcome =
      retrieved.sources.length === 0
        ? 'evidence-gap'
        : hasFullCoverage
          ? 'full'
          : onlyAdjacent
            ? 'adjacent'
            : 'limited';
    liveRun = {
      queries: retrieved.runs.map((run) => run.query),
      provenance: 'live',
      retrievedAt: new Date().toISOString(),
      sourceCount: retrieved.sources.length,
      rawSourceCount: retrieved.rawSourceCount,
      qualifiedSourceCount: retrieved.sources.length,
      uniqueAuthorCount: new Set(retrieved.sources.map((item) => item.source.author)).size,
      rejectedCount: retrieved.rejectedCount,
      outcome,
      failureKind,
      factCount: facts.length,
      filteredCount: retrieved.rejectedCount,
      unsupportedSynthesisCount: 0,
      factual: retrieved.sources.length > 0,
      notes: [
        ...(retrieved.similarity ? [similaritySummaryCopy(retrieved.similarity)] : []),
        ...(retrieved.expansion
          ? [
              retrieved.expansion.modelTerms > 0
                ? `语义扩展：模型给了 ${retrieved.expansion.modelTerms} 个相邻起点词，另有 ${retrieved.expansion.harvestedTerms} 个从真实返回里学到。`
                : retrieved.expansion.modelCalled
                  ? `语义扩展没有产出可用词（模型可能失败或输出被过滤）；本局只用检索学到的 ${retrieved.expansion.harvestedTerms} 个词放宽 —— 这是“扩展失效”，不是“语料没有”。`
                  : `本局没有调用模型扩展，只用检索学到的 ${retrieved.expansion.harvestedTerms} 个词放宽。`,
            ]
          : []),
        retrieved.sources.length > 0
          ? `从 ${retrieved.rawSourceCount} 条候选中筛出 ${retrieved.sources.length} 位可核验亲历者，得到 ${facts.length} 条逐字片段。`
          : failureKind === 'search-budget'
            ? '今天的知乎检索额度已用完（为保护上游配额主动停下）；这既不是“没有人讨论”，也不是“没有合格的人”。'
            : failureKind === 'upstream-error'
              ? '知乎检索暂时不可用；这不是“没有人讨论”，而是上游请求失败。'
              : failureKind === 'no-qualified-person'
                ? `搜到 ${retrieved.rawSourceCount} 条候选，但没有一条通过亲历者资格审查。`
                : '这次检索没有返回候选来源。',
        ...((extracted.proposed ?? 0) > 0
          ? [
              `模型提议 ${extracted.proposed} 条片段，${extracted.accepted ?? 0} 条通过逐字校验${
                (extracted.accepted ?? 0) === 0 ? '（它在改写原文，被全部丢掉）' : ''
              }。`,
            ]
          : ['片段由确定性规则从原文切出（未使用模型）。']),
      ],
      reason: null,
    } as RetrievalRun;
  } else {
    /**
     * 无检索能力：从 legacy 证据桥接（黄金案例 / 上一次实时检索的产物）。
     *
     * **P0-5 的关键一环**：检索被推迟到这一步之后，创建会话时
     * `session.evidenceFacts` 是空的。如果这里直接桥接，桥出来的
     * 就是「空 → 没有事实 → 没有经历 → 没有路径 → 没有经验解锁」，
     * 整条兜底链会静默断掉（实测：`unlocks=0`）。
     *
     * 所以**在这里补做 legacy 检索**，把「什么时候取样本」整体后移，
     * 而不是把这份样本丢掉。无 key 时它给出的是演示案例的 curated 快照，
     * 有 key 时上面那条 `deps.search` 分支走实时多意图检索。
     */
    session =
      session.evidenceFacts.length > 0 || session.pathClusters.length > 0
        ? session
        : await hydrateLegacyEvidence(session);
    facts = experienceFactsFromLegacy(session);
  }

  /**
   * 实时结果为空时，黄金案例作为“证据地板”而不是竞争来源。
   * 只有人工快照自身也通过亲历资格审查才启用；界面保留 curated provenance，
   * 不会把快照伪装成实时结果。
   */
  if (deps.search && facts.length === 0) {
    const fallbackSession = await hydrateLegacyEvidence(session);
    const fallbackFacts = experienceFactsFromLegacy(fallbackSession);
    if (fallbackFacts.length > 0 && fallbackSession.retrievalRun) {
      const liveNotes = liveRun?.notes ?? [];
      const liveFailureKind = liveRun?.failureKind;
      session = fallbackSession;
      facts = fallbackFacts;
      liveRun = {
        ...fallbackSession.retrievalRun,
        qualifiedSourceCount: new Set(fallbackFacts.map((fact) => fact.sourceId)).size,
        uniqueAuthorCount: new Set(fallbackFacts.map((fact) => fact.author)).size,
        outcome: 'limited',
        ...(liveFailureKind ? { failureKind: liveFailureKind } : {}),
        notes: [
          ...liveNotes,
          '实时结果没有形成合格人物经历，本次改用通过同一资格审查的人工来源快照。',
        ],
      };
    }
  }

  const cases = buildExperienceCases(facts);
  const caseIdByFactId = new Map<string, string>();
  for (const experienceCase of cases) {
    for (const fact of [
      ...experienceCase.conditions,
      ...experienceCase.actions,
      ...experienceCase.costs,
      ...experienceCase.outcomes,
      ...experienceCase.reflections,
    ]) {
      caseIdByFactId.set(fact.id, experienceCase.id);
    }
  }

  const synthesized = await synthesizeExperiencePaths({
    frame,
    cases,
    facts,
    router: deps.router ?? null,
    legacyCluster: ({ question }) =>
      legacyExperiencePaths({ question, facts, caseIdByFactId }),
  });

  const compiled = compileWorldBlueprint({
    sessionId: session.id,
    frame,
    paths: synthesized.paths,
    facts,
  });

  // 标题润色不再阻塞首屏；默认标题可直接进入世界。
  const blueprint = compiled;

  return touch(session, {
    ...(liveRun ? { retrievalRun: liveRun } : {}),
    experienceFacts: facts,
    experienceCases: cases,
    experiencePaths: synthesized.paths,
    worldBlueprint: blueprint,
    status: 'ready_to_play',
  });
}

/**
 * 第五步：设计实验。
 *
 * ## 两条路径（P1-1）
 *
 * - **有世界蓝图**：从本局那个 `keyUnknown` 推导 —— 未知的类型决定
 *   实验形态（时间容量 → 七天记录；队友可得性 → 真去联系三个人）。
 *   这是新主链的路径。
 * - **没有蓝图**（legacy / 刚创建还没 prepare-world）：沿用按问题类型
 *   查表的旧模板。旧路径零变化，测试与既有会话不受影响。
 */
export function designExperiment(session: DecisionSession): DecisionSession {
  const blueprint = session.worldBlueprint;
  const experiment =
    blueprint && blueprint.keyUnknown
      ? experimentFromUnknown({
          unknown: blueprint.keyUnknown,
          frame: blueprint.problemFrame,
          differences: blueprint.paths.flatMap((path) => path.differencesFromUser),
          context: session.userContext,
        })
      : experimentFor({
          type: detectProblemType(session.question),
          context: session.userContext,
        });
  return touch(session, { experiment, status: 'designing_experiment' });
}

/** 认领实验：写入七天回访时间。 */
export function commitExperiment(session: DecisionSession, now = new Date()): DecisionSession {
  const due = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return touch(session, {
    status: 'committed',
    followUp: { dueAt: due.toISOString() },
  });
}

/** 回访作答。 */
export function answerFollowUp(
  session: DecisionSession,
  input: { readonly outcome: 'done' | 'partial' | 'changed-plan'; readonly note?: string },
  now = new Date(),
): DecisionSession {
  if (!session.followUp) {
    return session;
  }
  return touch(session, {
    followUp: {
      ...session.followUp,
      answeredAt: now.toISOString(),
      outcome: input.outcome,
      ...(input.note ? { note: input.note } : {}),
    },
  });
}

function touch(session: DecisionSession, patch: Partial<DecisionSession>): DecisionSession {
  return { ...session, ...patch, updatedAt: new Date().toISOString() };
}

/* -------------------------------------------------------------------------- */
/* 带仓储的组合用例                                                             */
/* -------------------------------------------------------------------------- */

export async function persistSession(
  repository: DecisionSessionRepository,
  session: DecisionSession,
  isNew = false,
): Promise<void> {
  if (isNew) {
    await repository.create(session);
  } else {
    await repository.save(session);
  }
}

/**
 * 读取会话并核对归属。
 *
 * 归属校验刻意放在这里（而不是存储层）：存储层只管存取，
 * 「能不能看这个会话」是授权问题。返回 `null` 而不是抛错 ——
 * 调用方据此回 404，**不泄露「这个 id 存在但不属于你」**。
 */
export async function loadOwnedSession(
  repository: DecisionSessionRepository,
  id: string,
  ownerId: string,
): Promise<DecisionSession | null> {
  const session = await repository.getById(id);
  if (!session || session.ownerId !== ownerId) {
    return null;
  }
  return session;
}

/** 供界面渲染的澄清问题（按会话的问题类型）。 */
export function questionsForSession(session: DecisionSession) {
  return clarifyQuestions(detectProblemType(session.question));
}
