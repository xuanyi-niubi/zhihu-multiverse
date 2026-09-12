import type { PlayerProfile } from '@/core/dm/profile';
import type { ClarificationNeed, ProblemFrame } from '@/features/experience/domain';

/**
 * DecisionSession 领域模型（重构方案 §5.1 / §6.1）。
 *
 * ## 为什么要有这一层
 *
 * 旧模型的核心实体是「人生路线 + 四条轴 + 裁决」：
 *
 * ```text
 * 回答摘要里的第一个时长
 *   → 生成一个浮动范围
 *   → 多条回答聚合成「路径成本」
 *   → 成本的**上沿**成为用户的最低时间要求
 *   → 输出「可行 / 不可行 / 还差 N 个月」
 * ```
 *
 * 这条链在形式上完整，**认识论上不成立**：真实经历是样本，不是统计定律。
 * 把「某个答主用了两年」换算成「你至少需要 13 个月」，是用伪精确
 * 替代了诚实 —— 而它比不给答案更危险（方案 §0）。
 *
 * 新模型的基本单位不是「结论」，而是**可追溯的事实**：
 *
 * | 实体 | 回答什么 |
 * |---|---|
 * | `EvidenceFact` | 某个人，在什么条件下，做了什么，付出了什么（**原文**） |
 * | `PathCluster` | 当前这个问题下，这条走法有哪些人走过、分歧在哪、还缺什么 |
 * | `UserContext` | 你此刻的真实约束（玩家自己给的，不是推断的） |
 * | `RealityExperiment` | 把最大的未知变成一个这周就能做完的验证 |
 *
 * **不存在**任何字段用来表达「这条路对你能不能成」。
 */

/* -------------------------------------------------------------------------- */
/* 1. 可追溯事实                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 事实类型（方案 §5.1）。
 *
 * 刻意只允许这五种：任何一条展示内容都必须能归到其中一类，
 * 于是「这句话到底是从原文来的，还是 AI 说的」永远有答案。
 */
export type FactType = 'action' | 'condition' | 'cost' | 'outcome' | 'opinion';

/**
 * 展示层只允许的四种标记（方案 §4.3）。
 *
 * 这是本产品的**可信度语言**，替代旧的「可行 / 不可行 / 成功概率」：
 *
 * | 标记 | 含义 |
 * |---|---|
 * | `原文` | 可回到明确的知乎来源与原文片段 |
 * | `样本观察` | 「在当前 4 条经历中，有 3 人提到……」而非普遍规律 |
 * | `AI 归纳` | 基于哪些 factId 生成，可展开核对 |
 * | `待验证` | 当前证据或用户信息不足，**不填空** |
 */
export type ClaimKind = 'quote' | 'sample-observation' | 'ai-synthesis' | 'unknown';

/**
 * 一条可追溯事实。
 *
 * `quote` 必须是**原文精确片段**，不是 AI 改写 —— 这条由
 * `tests/decisionSession.test.ts` 断言（含改写检测的负例）。
 */
export interface EvidenceFact {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly retrievedAt: string;
  /** 原文精确片段。 */
  readonly quote: string;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
  readonly factType: FactType;
  /**
   * **只保存原文明确给出的值**（方案 §5.1）。
   *
   * 例如原文写「前后花了两个月」，这里就是 `两个月`。
   * 绝不允许写入推导出的区间或换算结果 —— 那是旧模型犯的错。
   */
  readonly explicitValue?: string;
  /** 0..1：与当前问题的相关性。用于排序，不用于判断真伪。 */
  readonly relevance: number;
}

/* -------------------------------------------------------------------------- */
/* 2. 问题专属路径                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 一条**属于当前问题**的路径（方案 §5.1 / §12 P0）。
 *
 * ## 与旧的 `PathArchetype` 的根本区别
 *
 * 旧的是**产品级**的七条职业路径（脱产转型 / 在职转型 / 平级跳板…），
 * 于是「大二基础一般，要不要参加比赛」会显示「在职转型」——
 * 用户会立刻质疑内容与问题无关（方案 §1.2）。
 *
 * 新的是**会话级**的：路径名由当前问题产生，例如
 * 「先参加，以完成为目标」/「先做 48 小时小样再决定」/「本次不参赛，先补齐基础」。
 */
export interface PathCluster {
  readonly id: string;
  /** **当前问题专属**的名称。 */
  readonly label: string;
  readonly summary: string;
  /** 支撑这条走法的事实。 */
  readonly supportingFactIds: readonly string[];
  /**
   * **反例 / 限制条件**（方案 §5.2）。
   *
   * 检索必须主动找分歧，而不是只找支持某条路线的回答。
   * 一条路径至少要有一个反方样本，否则它只是一面之词。
   */
  readonly opposingFactIds: readonly string[];
  /** 这条路径上的人当时的条件（用于和用户对照）。 */
  readonly conditions: readonly string[];
  /** 当前还无法回答的问题。**这是本产品的核心输出**。 */
  readonly unknowns: readonly string[];
  /** 数据来源：策划审核过的黄金案例，还是 AI 从事实聚类出来的。 */
  readonly origin: 'curated' | 'ai-clustered';
}

/* -------------------------------------------------------------------------- */
/* 3. 用户约束（自己给的，不是推断的）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 用户在澄清阶段给出的约束。
 *
 * **全部可选**，且**绝不推断**（方案 §4.2：不在用户没有给出信息时
 * 推断其经济、心理或家庭承受力）。缺失就是缺失，展示为「待验证」。
 */
export interface UserContext {
  readonly goal: string;
  /** 未来两周能稳定拿出的时间。原文表述，不做单位换算。 */
  readonly availableTime?: string;
  /** 你最想验证的是什么。 */
  readonly wantToVerify?: string;
  /** 最不能接受的损失。 */
  readonly nonNegotiables: readonly string[];
  /** 已经有资源。 */
  readonly existingResources: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 4. 现实实验                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 一个七天内的现实实验（方案 §5.1 / §8 P1-4）。
 *
 * 输出的是「去验证什么」，**不是「你应该选哪条」**。
 * 四个必填字段缺一不可：没有停止信号的实验是赌博，不是实验。
 */
export interface RealityExperiment {
  /** 这个实验要检验的假设。 */
  readonly hypothesis: string;
  /** 具体动作。 */
  readonly action: string;
  /** 时间盒 —— 必须是一个能做完的量级。 */
  readonly timebox: string;
  /** 做完会得到什么产物。 */
  readonly artifact: string;
  /** 什么情况下算「假设成立」。 */
  readonly successSignal: string;
  /** 什么情况下应当停下（防止沉没成本）。 */
  readonly stopSignal: string;
  /** 它降低了哪一个未知。 */
  readonly reducesUnknown: string;
}

/* -------------------------------------------------------------------------- */
/* 5. 会话                                                                     */
/* -------------------------------------------------------------------------- */

export type SessionStatus =
  | 'clarifying'
  | 'retrieving'
  | 'comparing'
  | 'choosing_unknown'
  | 'designing_experiment'
  | 'committed';

/** 检索运行记录：给「这条结论是怎么来的」留证据。 */
export interface RetrievalRun {
  readonly queries: readonly string[];
  /** live / snapshot / curated 三档，**文案必须与事实一致**（方案 §5.3）。 */
  readonly provenance: 'live' | 'snapshot' | 'curated' | 'offline';
  readonly retrievedAt: string;
  readonly sourceCount: number;
  readonly factCount: number;
  /**
   * 被过滤掉的来源数。
   *
   * 这个字段存在的意义：方案 §6.6 要求 trace 里能看到
   * 「来源数量、过滤数量、事实数量、无支持归纳数量」，
   * 否则「我们筛过了」永远只是一句话。
   */
  readonly filteredCount: number;
  /** 没有事实支撑的 AI 归纳数量 —— 应当恒为 0，非 0 就是 bug。 */
  readonly unsupportedSynthesisCount: number;
  readonly notes: readonly string[];
}

/** 七天回访。 */
export interface FollowUp {
  readonly dueAt: string;
  readonly answeredAt?: string;
  readonly outcome?: 'done' | 'partial' | 'changed-plan';
  readonly note?: string;
}

/**
 * 决策会话 —— **唯一业务主轴**（方案 §6.1）。
 *
 * 原来的「世界 / 模型 / 约束 / 游戏属性」不再作为核心业务真相。
 */
export interface DecisionSession {
  readonly id: string;
  /** 归属：知乎账号 url_token，或匿名身份键。 */
  readonly ownerId: string;
  readonly status: SessionStatus;
  /** 用户原话。 */
  readonly question: string;
  readonly userContext: UserContext;
  /**
   * 问题框定（Phase 2 新增）。
   *
   * 与 `userContext` 的分工是刻意的：
   * `userContext` 是**澄清问答的产物**（用户显式选出来的）；
   * `problemFrame` 是**从问题与档案推导的框定**，并且区分了
   * 哪些是用户说的、哪些是解析推断的。
   *
   * 两者并存、**不删 `userContext`**：`clarify.ts`、`ExperimentCard`、
   * 既有 smoke 与组件都还依赖它，迁移期不能动。
   */
  readonly problemFrame: ProblemFrame | null;
  /** 生成问题框定所用的处境档案（复用 `core/dm/profile.ts`，不另造一套）。 */
  readonly profile: PlayerProfile | null;
  /** 模型写的自由文本处境分析；没有就 null。 */
  readonly profileAnalysis: string | null;
  /**
   * 动态澄清问题（Phase 3）。
   *
   * 由 `clarificationNeedsFor(problemFrame)` 生成，**0～2 条**。
   * 长度为 0 表示用户已经说清了这个选择所需的全部信息，
   * 会话直接进入 `comparing`，一个问题都不问。
   */
  readonly clarificationNeeds: readonly ClarificationNeed[];
  readonly retrievalRun: RetrievalRun | null;
  readonly evidenceFacts: readonly EvidenceFact[];
  readonly pathClusters: readonly PathCluster[];
  /** 用户选中的「最想先弄清的那个未知」。 */
  readonly selectedUnknown: string | null;
  readonly experiment: RealityExperiment | null;
  readonly followUp: FollowUp | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* 6. 展示契约                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 一条要展示给用户的断言。
 *
 * UI **只允许**渲染这个类型 —— 它强制每条内容都带上「这是哪一类」，
 * 于是「把 AI 归纳伪装成事实结论」在类型层面就写不出来。
 */
export interface Claim {
  readonly kind: ClaimKind;
  readonly text: string;
  /** `ai-synthesis` 必填：这条归纳基于哪些事实。 */
  readonly basedOnFactIds?: readonly string[];
  /** `quote` 必填：可点开的来源。 */
  readonly sourceUrl?: string;
  readonly author?: string;
}

/**
 * 把一组事实汇总成「**在当前 N 条经历中，有 M 人提到……**」的表述
 * （方案 §4.3 指定的口吻）。
 *
 * 这个函数存在的意义是**防止口吻退化**：只要有人想写「通常需要 X」，
 * 就必须绕过它，而绕过它会在 code review 里显眼。
 */
export function observationOf(input: {
  readonly totalFacts: number;
  readonly mentionCount: number;
  readonly subject: string;
}): Claim {
  return {
    kind: 'sample-observation',
    text: `在当前 ${input.totalFacts} 条可核对经历中，有 ${input.mentionCount} 人提到${input.subject}。样本少且条件不同，不能视为你的预计情况。`,
  };
}

/** 信息缺口（方案 §4.3 的 `待验证`）。**永远不填空**。 */
export function unknownClaim(what: string): Claim {
  return { kind: 'unknown', text: what };
}

/** 原文引用。 */
export function quoteClaim(input: {
  readonly quote: string;
  readonly sourceUrl: string;
  readonly author?: string;
}): Claim {
  return {
    kind: 'quote',
    text: input.quote,
    sourceUrl: input.sourceUrl,
    ...(input.author ? { author: input.author } : {}),
  };
}
