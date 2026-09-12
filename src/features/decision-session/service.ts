import { extractProfile, type PlayerProfile } from '@/core/dm/profile';
import { buildProblemFrame } from '@/features/experience/frame';
import { caseSources, matchDemoCase } from '@/data/demoCases';
import { contextFrom, clarifyQuestions, experimentFor } from '@/features/decision-session/clarify';
import { toEvidenceFacts } from '@/features/decision-session/facts';
import { clusterPaths, detectProblemType } from '@/features/decision-session/routes';
import { newSessionId } from '@/features/decision-session/store';

import type {
  DecisionSession,
  PathCluster,
  RealityExperiment,
  RetrievalRun,
  UserContext,
} from '@/features/decision-session/domain';
import type { DecisionSessionRepository } from '@/features/decision-session/store';
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
  const problemFrame = buildProblemFrame({ question, profile, analysis: profileAnalysis });

  const retrieved = await retrieveFor({
    question,
    ...(input.liveSearch ? { liveSearch: input.liveSearch } : {}),
  });
  const paths = buildPaths({ question, sources: retrieved.sources });
  const now = new Date().toISOString();

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
    status: 'clarifying',
    question,
    userContext: { goal: question, nonNegotiables: [], existingResources: [] },
    problemFrame,
    profile,
    profileAnalysis,
    retrievalRun,
    evidenceFacts: paths.facts,
    pathClusters: paths.clusters,
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

/** 第四步：选中「最想先弄清的那个未知」。 */
export function selectUnknown(session: DecisionSession, unknown: string): DecisionSession {
  return touch(session, { selectedUnknown: unknown, status: 'choosing_unknown' });
}

/** 第五步：设计实验。 */
export function designExperiment(session: DecisionSession): DecisionSession {
  const experiment: RealityExperiment = experimentFor({
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
