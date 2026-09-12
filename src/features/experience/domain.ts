import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * Experience Engine 的领域契约（迁移期新增，**不改变现有行为**）。
 *
 * ## 它要解决的问题
 *
 * 当前「真实经历」只走到**证据展示**这一步：网格把回答按走法分组，
 * 用户看到卡片、点到原文，然后就结束了。经历本身没有变成可计算的东西，
 * 所以游戏层（推演舱）与它之间只能靠关键词松耦合。
 *
 * 这组类型把经历拆成可复用的几层：
 *
 * ```text
 * ProblemFrame     —— 你问的到底是什么（现实事实与叙事推断分离）
 *   ↓
 * SearchPlan       —— 该去找哪几类经历（相似 / 替代 / 失败 / 代价 / 反例）
 *   ↓
 * ExperienceFact   —— 回答里的**逐字片段**（不是「一条回答=一个 Fact」）
 *   ↓
 * ExperienceCase   —— 把同一来源的片段拼回「一个人的一段经历」
 *   ↓
 * ExperiencePath   —— 若干 Case 组成的走法（动态聚类，增量替换固定走法表）
 *   ↓
 * UserDifference   —— 他们与你到底差在哪（**含 unknown**）
 * ```
 *
 * ## 两条不可违反的纪律（写进类型里）
 *
 * 1. `ExperienceFact.exactQuote` **必须是来源原文的逐字子串** ——
 *    AI 可以挑选片段，不能改写片段。校验见 `validator` 层。
 * 2. `FrameStatement.hard` 区分「用户说的」与「解析推断的」：
 *    只有 `user-explicit` / `experiment-observed` 能当**现实硬条件**，
 *    `parser-synthesis` 只能用于叙事与检索提示。
 *    这条防止「系统推断出来的东西」被当成「用户确认过的事实」。
 */

/* -------------------------------------------------------------------------- */
/* 1. 问题框定                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 一条陈述的**来源**。决定它能不能当硬条件。
 */
export type StatementOrigin =
  /** 用户自己写下的。 */
  | 'user-explicit'
  /** 解析器归纳出来的（可能有偏差，不能当事实）。 */
  | 'parser-synthesis'
  /** 用户做完现实实验后回来报告的（可信，因为是行为结果）。 */
  | 'experiment-observed';

export interface FrameStatement {
  readonly id: string;
  readonly text: string;
  readonly origin: StatementOrigin;

  /**
   * 是否可以作为**现实硬条件**参与判断。
   *
   * 只有 `user-explicit` / `experiment-observed` 可以为 true。
   * `parser-synthesis` 一律 false —— 它只能用于叙事和检索提示。
   */
  readonly hard: boolean;
}

/**
 * 一个尚未确定、但会显著改变结论的变量。
 *
 * 它取代「伪精确缺口」（例如「还差 7 个月」）：
 * 与其给一个来自样本上沿的数字，不如明确说「这一项我们不知道」。
 */
export interface UnknownVariable {
  readonly id: string;
  readonly label: string;
  /** 它为什么会影响结论（一句话，不含预测）。 */
  readonly whyItMatters: string;

  readonly origin:
    /** 用户没提供。 */
    | 'missing-user-context'
    /** 样本之间说法互相矛盾。 */
    | 'experience-disagreement'
    /** 根本找不到可核对的来源。 */
    | 'evidence-gap';

  /** 1 最高。用于决定先问哪一个。 */
  readonly priority: 1 | 2 | 3;
}

/**
 * 问题框定：把一句迷茫拆成「现状 / 想改变什么 / 约束 / 已有资源 / 顾虑」。
 *
 * 与旧实现的关键差别：**现实事实与叙事推断分离**。
 * 旧实现把解析出来的东西直接当事实用，于是系统的一点猜测会变成
 * 后续所有推理的前提。
 */
export interface ProblemFrame {
  readonly rawQuestion: string;

  readonly currentSituation: string;
  readonly desiredChange: string;

  readonly constraints: readonly FrameStatement[];
  readonly resources: readonly FrameStatement[];
  readonly concerns: readonly FrameStatement[];

  /** 这个选择的中心张力（例如「想积累作品 vs 每周只有 8 小时」）。 */
  readonly centralTension: string;
  readonly unknowns: readonly UnknownVariable[];

  /**
   * 0..1，**只表示解析完整度**。
   *
   * 绝不允许展示成「成功概率」「匹配度」「推荐分」——
   * 那会把一个工程指标伪装成对人生的判断。
   */
  readonly parseConfidence: number;
}

/* -------------------------------------------------------------------------- */
/* 2. 检索计划                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 检索意图。
 *
 * 这一层是「主动找分歧」的落点：只搜 `similar-person` 会让用户
 * 只看得到支持某条路的样本。必须同时搜失败与反例。
 */
export type SearchPurpose =
  /** 处境相似的人。 */
  | 'similar-person'
  /** 另一条可选走法。 */
  | 'alternative'
  /** 失败 / 中途退出的经历。 */
  | 'failure'
  /** 付出的代价。 */
  | 'cost'
  /** 最终结果。 */
  | 'outcome'
  /** 明确反对某条路的说法。 */
  | 'counterexample';

export interface SearchQuery {
  readonly id: string;
  readonly query: string;
  readonly purpose: SearchPurpose;
  readonly priority: number;
}

export interface SearchPlan {
  readonly queries: readonly SearchQuery[];
  /** 请求上限（知乎接口有配额，必须显式设限）。 */
  readonly maxRequests: number;
}

/** 一条来源 + 它命中了哪些检索意图。 */
export interface RetrievedExperienceSource {
  readonly source: KnowledgeSource;
  readonly purposes: readonly SearchPurpose[];
  readonly matchedQueryIds: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 3. 可追溯经历                                                               */
/* -------------------------------------------------------------------------- */

export type ExperienceFactType = 'condition' | 'action' | 'cost' | 'outcome' | 'reflection';

/**
 * 一条**逐字**经历片段。
 *
 * `exactQuote` 必须是 `KnowledgeSource.quote` 的子串 —— 抽取层可以
 * 挑片段、标类型，但不能润色。这条纪律由 validator 强制，
 * 因为「AI 改写过的原文」是本产品最不能犯的错。
 */
export interface ExperienceFact {
  readonly id: string;

  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly author: string;

  /** 必须是来源 `quote` 的逐字子串。 */
  readonly exactQuote: string;

  readonly type: ExperienceFactType;

  /** **只用于排序**，不用于判断真实性。 */
  readonly relevance: number;

  readonly purposes: readonly SearchPurpose[];
}

/**
 * 一条来源 → 「一个人的一段经历」。
 *
 * 旧的粒度是「一条回答 = 一个事实」，于是同一段经历被切成互不相干的卡片；
 * 现在按来源重新聚合，才谈得上「他当时是什么条件、做了什么、代价是什么」。
 */
export interface ExperienceCase {
  readonly id: string;

  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly author: string;

  readonly conditions: readonly ExperienceFact[];
  readonly actions: readonly ExperienceFact[];
  readonly costs: readonly ExperienceFact[];
  readonly outcomes: readonly ExperienceFact[];
  readonly reflections: readonly ExperienceFact[];
}

/* -------------------------------------------------------------------------- */
/* 4. 与你的差异                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 一个变量上「你」与「样本」的关系。
 *
 * `unknown` 是**一等公民**：不知道就写不知道。
 * 这个产品的价值主要在「指出差异」，而差异里最重要的一类是
 * 「你们的条件根本不可比，因为我们不知道你的那一项」。
 */
export type DifferenceRelation = 'same' | 'different' | 'unknown';

export interface UserDifference {
  readonly variable: string;

  readonly userValue?: string;
  readonly experienceValue?: string;

  readonly relation: DifferenceRelation;

  /** 支撑这个判断的事实（可点回原文）。 */
  readonly evidenceFactIds: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 5. 动态路径                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 一条**动态聚类**出来的走法。
 *
 * 与 `decision-session/routes.ts` 的固定走法表相比：
 * 那个是人工词表（`legacy-fallback`），这个是模型读真实片段后聚出来的
 * （`model-clustered`）。迁移期两者共存，前者作为后者的兜底。
 */
export interface ExperiencePath {
  readonly id: string;

  readonly label: string;
  readonly summary: string;

  readonly supportingCaseIds: readonly string[];
  readonly opposingCaseIds: readonly string[];

  readonly supportingFactIds: readonly string[];
  readonly opposingFactIds: readonly string[];

  readonly observedConditions: readonly string[];
  readonly observedActions: readonly string[];
  readonly observedCosts: readonly string[];
  readonly observedOutcomes: readonly string[];

  readonly differencesFromUser: readonly UserDifference[];

  readonly unknowns: readonly UnknownVariable[];

  readonly origin: 'model-clustered' | 'legacy-fallback';
}

/* -------------------------------------------------------------------------- */
/* 6. 动态澄清（Phase 3）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 一条**该问的**澄清问题。
 *
 * 与旧 `ClarifyQuestion` 的关键差别：它带 `reason` 与 `missingVariable`，
 * 因此系统能回答「为什么问这个」「答了会改变什么」。
 *
 * 旧实现固定问三件事，不看用户已经说过什么 —— 用户写了「怕影响课程」，
 * 还是会被问一遍「哪种损失你不愿意接受」。这里靠复用 `frame.unknowns`
 * 保证「说过就不问」。
 */
export interface ClarificationNeed {
  readonly id: string;

  readonly question: string;

  /**
   * 它改变什么。三选一是刻意的：任何一条澄清都必须能落到
   * 检索 / 世界 / 实验三者之一，否则它就是「为画像完整而收集无用信息」。
   */
  readonly reason: 'changes-retrieval' | 'changes-world' | 'changes-experiment';

  /** 它补的是哪个变量（答复按这个字段落地，因此加新问题不需要改答复逻辑）。 */
  readonly missingVariable: string;

  readonly answerType: 'choice' | 'number' | 'short-text';

  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
  }[];

  readonly priority: number;

  /** 一行说明，供界面显示（可省略）。 */
  readonly hint?: string;
  /** 是否允许跳过。澄清一律允许跳过。 */
  readonly optional?: boolean;
}
