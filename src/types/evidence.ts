/**
 * 证据层与决策层的数据契约（`DESIGN.md` §4 游戏核心机制 / §5 知乎证据系统）。
 *
 * 这一层是**纯类型 + 纯函数**的地基，三条铁律写在最前面：
 *
 * 1. **无据不填数**：`thin` 证据路线上的任何数值都必须是 `null` / `'unknown'`，
 *    绝不允许 AI 或引擎补一个「看起来合理」的数字。理由见 §5.2。
 * 2. **分母必须可见**：每条路线都要带 `sampleSize` 与 `grade`，
 *    界面必须能回答「这条结论是几个人说的」。
 * 3. **确定性优先**：网格与裁决都是纯函数产物，可哈希、可复现、可进挑战链接。
 */

import type { HiddenKey } from '@/data/sceneTemplates';

/* -------------------------------------------------------------------------- */
/* 1. 刚性轴：把「难度」换成「约束」                                            */
/* -------------------------------------------------------------------------- */

/**
 * 四条轴对应四类真实约束，且都能被玩家一句话理解（§6.1）。
 *
 * - `runway`         还能不赚钱地撑几个月（硬）
 * - `drawdown`       能承受的最大损失幅度（硬）
 * - `reversibility`  这条路走错后能不能回头（软，由证据决定而非玩家自陈）
 * - `ally`           是否有人并肩（软）
 */
export type AxisId = 'runway' | 'drawdown' | 'reversibility' | 'ally';

export interface MechanicalAxis {
  readonly id: AxisId;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  /** 该轴是不是硬约束：硬轴越线即确定失败，软轴只影响代价大小。 */
  readonly hard: boolean;
  /** 给玩家看的一句话解释（不解释清楚，玩家不会认真拖这个滑杆）。 */
  readonly hint: string;
}

/**
 * 玩家约束画像。四个字段与四条轴一一对应。
 *
 * 注意：`reversibility` 不由玩家自陈 —— 它是路线的属性，不是人的属性。
 * 因此玩家侧只提供三条，第四条在裁决时从 `DecisionPath.costProfile` 读取。
 */
export interface ConstraintProfile {
  /** 还能不赚钱地撑几个月。 */
  readonly runwayMonths: number;
  /** 能承受的损失幅度（0..100 的抽象刻度，对应 SAN / 钱 / 关系的综合承受力）。 */
  readonly drawdown: number;
  /** 是否有人并肩：0 = 独自，1 = 有同伴，中间值表示程度。 */
  readonly ally: number;
}

/* -------------------------------------------------------------------------- */
/* 2. 前人路径卡：真实检索结果的唯一结构化形态                                  */
/* -------------------------------------------------------------------------- */

export type EvidenceGrade = 'strong' | 'partial' | 'thin';

/** 权威等级。缺失一律 `unknown`，不猜。 */
export type AuthorityLevel = 'high' | 'medium' | 'low' | 'unknown';

/**
 * 一条前人经历的结构化六要素。
 *
 * **每一个字段都可能为 `null`，且为 `null` 时必须如实显示「未知」。**
 * 抽取层只做「原文里能找到依据就填」这一件事；找不到就是不知道。
 */
export interface PathShape {
  /** 起点处境，例如「二本法学大三」。 */
  readonly from: string;
  /** 做了什么，例如「在职备考计算机」。 */
  readonly move: string;
  /** 花了多久（原文口径，例如「两年」）。无据为 null。 */
  readonly duration: string | null;
  /** 付出的代价（原文提到的每一项）。 */
  readonly cost: readonly string[];
  /** 结果（止于原文口径，不推广成规律）。 */
  readonly outcome: string;
}

/** 代价画像：由一组同向的卡聚合，缺项为 null 而不是 0。 */
export interface CostProfile {
  readonly timeCostMonths: { readonly min: number; readonly max: number } | null;
  readonly moneyCost: 'low' | 'medium' | 'high' | 'unknown';
  /** 是否「走错就回不来」。三者都没提到时为 null。 */
  readonly irreversible: boolean | null;
  readonly requiresAlly: boolean | null;
}

/**
 * 一条**路径需求**（v3 §5.1）。
 *
 * 与 `DecisionPath` 的区别：`DecisionPath` 是「一群真人走过的路」，
 * 而 `PathCost` 是「这条具体选项要求你具备什么」——
 * 它没有证据卡（因此没有 `grade`），只表达需求。
 *
 * 存在的理由：让**一幕里的选项**也能走 `verdictFor` 判定，
 * 从而拆除「掷骰子决定选项成败」这条与世界观冲突的旧路径。
 */
export interface PathCost {
  readonly id: string;
  readonly label: string;
  /** 硬轴需求（时间 / 承压）；缺项不产生需求。 */
  readonly timeCostMonths: { readonly min: number; readonly max: number } | null;
  readonly moneyCost: CostProfile['moneyCost'];
  readonly irreversible: boolean | null;
  readonly requiresAlly: boolean | null;
}

/** 一幕里玩家做出的选择（用于裁决与复盘，与具体剧本结构解耦）。 */
export interface ChoiceResolution {
  /** 现实裁决：这条选项在你的条件下是否成立。**唯一的成败来源**。 */
  readonly verdict: Verdict;
  /** 命运掷骰（v3 §5.2）：只决定遭遇与叙事枝节，**不参与成败**。 */
  readonly fate: FateRoll | null;
  /** 由 verdict 推出：breached 即「这条走不通」，viable / unknown 即走得动。 */
  readonly isSuccess: boolean;
  /** 需求本身，供界面对照展示（「你 6 / 需求 9」）。 */
  readonly demand: PathCost;
}

/**
 * 命运掷骰（v3 §5.2 的 Fate Roll）。
 *
 * **它不决定真相。** 它只决定这场遭遇的品质：
 * 是否遇到贵人、事件是普通/稀有/灾难、NPC 是否愿意帮忙。
 * 因此它永远不能改变 `verdict`。
 */
export interface FateRoll {
  readonly face: number;
  readonly quality: 'mishap' | 'ordinary' | 'fortunate' | 'breakthrough';
  readonly label: string;
}

/**
 * 一条被结构化的前人经历。
 *
 * `status` 只允许 `verified`：证据层不接受剧本数据 —— 剧本可以进叙事，
 * 但不能进证据网格。这是 `features/run/knowledgeSource.ts` 那条「只有 verified
 * 才允许出现数字」铁律在证据层的加强版。
 */
export interface PathCard {
  readonly cardId: string;
  /** 来源唯一 id，与 `KnowledgeSource.id` 同源，用于溯源浮层反查。 */
  readonly sourceId: string;
  readonly author: string;
  readonly authorUrlToken: string | null;
  readonly sourceUrl: `https://${string}`;
  /** 抓取日期（ISO）。界面必须显示它。 */
  readonly retrievedAt: string;
  readonly authority: AuthorityLevel;
  /** 权威等级原值（数字，越大越权威；缺失为 0），供确定性聚合使用。 */
  readonly authorityRank: number;
  /** 真实赞同数；接口没给就是 null，不显示。 */
  readonly upvotes: number | null;
  readonly title: string;
  readonly quote: string;
  readonly shape: PathShape;
  readonly status: 'verified';
  /**
   * 归档提示：人工确认过的路线 id（落盘在 `sources.generated.json` 的 `anchorPaths`）。
   *
   * 为什么需要它：真实语料的措辞不可预测 —— 实测「转行 AI」「留在大城市」
   * 这类表述不会命中任何路线关键词，纯关键词归档会让大量真实样本变成孤儿卡
   * （有 60 条真实来源却聚不出任何一条路线）。因此 Mesh Builder
   * **优先采用归档提示**，关键词匹配只作兜底。
   */
  readonly pathHint?: string;
}

/* -------------------------------------------------------------------------- */
/* 3. 决策路径与证据网格                                                        */
/* -------------------------------------------------------------------------- */

/** 一条互斥路线：若干张同向的卡 + 确定性聚合出的代价画像。 */
export interface DecisionPath {
  readonly pathId: string;
  readonly label: string;
  /** 一句话说清这条路在做什么。 */
  readonly summary: string;
  readonly cards: readonly PathCard[];
  readonly sampleSize: number;
  readonly grade: EvidenceGrade;
  /** 0..1 的证据强度，用于「证据应力条」。 */
  readonly evidenceStrength: number;
  readonly costProfile: CostProfile;
}

/** 一次推演的证据网格：路径 + 轴 + 指纹。 */
export interface EvidenceMesh {
  readonly meshId: string;
  readonly goal: string;
  /** 实际用过的检索词，透明可查。 */
  readonly queries: readonly string[];
  readonly paths: readonly DecisionPath[];
  readonly axes: readonly MechanicalAxis[];
  /** 纯函数产物：同一批卡必得同一哈希，用于对标与挑战链接。 */
  readonly meshHash: string;
  readonly generatedAt: string;
  /** 数据来源：真实检索 / 落盘快照 / 离线预置。 */
  readonly provenance: 'zhihu-search' | 'snapshot' | 'demo';
}

/* -------------------------------------------------------------------------- */
/* 4. 裁决结果（§6.2 / §6.3）                                                   */
/* -------------------------------------------------------------------------- */

/** 证据不足时不允许裁决 —— 这是 `unknown` 存在的原因。 */
export type Verdict =
  | {
      readonly kind: 'viable';
      /** 最紧的那条硬轴还剩多少余量；无硬轴时为 null。 */
      readonly margin: number;
      readonly bindingAxis: AxisId | null;
    }
  | {
      readonly kind: 'breached';
      readonly breachedAxis: AxisId;
      /** 超出上限的量（正数）。 */
      readonly overBy: number;
      /** 还差多少才能站住：给玩家的那句话就是从这里来的。 */
      readonly shortfallLabel: string;
    }
  | {
      readonly kind: 'unknown';
      readonly reason: string;
    };

/**
 * 临界点：让结论翻转的那个最小改动。
 *
 * 这是本方案最值钱的 UI 元素（§6.3）—— 它把「你失败了」翻译成
 * 「你哪个假设最脆弱、改哪个变量会让结论翻转」。
 */
export interface CriticalPoint {
  readonly pathId: string;
  readonly verdict: Verdict;
  /** 需要拨动的那条轴。 */
  readonly axis: AxisId;
  /** 当前值 / 翻转到可行所需的值 / 要移动多少。 */
  readonly current: number;
  readonly required: number;
  readonly delta: number;
  /** 给玩家看的一句话（不含裸数字恐吓，落在定性 + 一个量）。 */
  readonly narrative: string;
}

/* -------------------------------------------------------------------------- */
/* 5. 双牌对比（§7.1）                                                          */
/* -------------------------------------------------------------------------- */

export interface SandwichCard {
  readonly label: string;
  readonly constraints: ConstraintProfile;
  /** 该组约束下每条路线的裁决。 */
  readonly verdicts: ReadonlyArray<{ readonly pathId: string; readonly verdict: Verdict }>;
  /** 该组约束下唯一最紧的干预点。 */
  readonly critical: CriticalPoint | null;
  /** 结论为可行的路线数。 */
  readonly viableCount: number;
}

export interface Sandwich {
  readonly meshId: string;
  readonly cardA: SandwichCard;
  readonly cardB: SandwichCard;
  /** 两张牌结论不同的路线 —— 对比的看点。 */
  readonly divergentPathIds: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 6. 承诺与回执（§7.2）                                                        */
/* -------------------------------------------------------------------------- */

export type CommitmentOutcome = 'done' | 'partial' | 'missed';

export interface Commitment {
  readonly commitmentId: string;
  readonly runId: string;
  /** 账号维度主键（知乎 url_token）；未登录不落盘。 */
  readonly ownerKey: string;
  readonly action: string;
  readonly timeBox: string;
  readonly signal: string;
  /** 到期时间（ISO）。 */
  readonly dueAt: string;
  readonly verifyHint: string;
  /** 这条动作绑定到哪条路线（可空：有些动作是跨路线的）。 */
  readonly pathId: string | null;
  readonly status: 'committed' | 'done' | 'partial' | 'missed';
  readonly committedAt: string;
  readonly receipt: Receipt | null;
}

export interface Receipt {
  readonly reportedAt: string;
  readonly outcome: CommitmentOutcome;
  /** 用户原话（≤200 字），不做改写。 */
  readonly note: string;
  readonly blocker: string | null;
}

/* -------------------------------------------------------------------------- */
/* 7. 四维终局结算（§9）                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 赢 ≠ 走完四幕。四个认知维度，全部可解释、可计算。
 */
export interface ClarityScore {
  /** 终局时能否一句话说清「我在哪条轴上最紧」（0..100）。 */
  readonly clarity: number;
  /** 走过的路线里有多少是 strong 证据支撑的（0..100）。 */
  readonly evidenceCoverage: number;
  /** 赛前对代价的预估 vs 引擎算出的代价，差距越小越高（0..100）。 */
  readonly costAwareness: number;
  /** 是否在硬轴上留了余量（0..100）。 */
  readonly reversibility: number;
  /** 四维总分（0..400），用于展示与复盘。 */
  readonly total: number;
}

/* -------------------------------------------------------------------------- */
/* 8. 认知账本（§8）                                                            */
/* -------------------------------------------------------------------------- */

export interface Belief {
  readonly pathId: string;
  readonly label: string;
  /** 玩家当时的判断。 */
  readonly expectedViable: boolean;
  /** 事后回执得到的事实；未回执为 unknown。 */
  readonly actualOutcome: 'viable' | 'breached' | 'unknown';
  /** 这次判断的置信度 0..1。 */
  readonly confidence: number;
}

export interface CognitiveLedger {
  readonly totalRuns: number;
  readonly beliefs: readonly Belief[];
  /** 上一局开了头但没走完的问题，下一局必须被优先提起。 */
  readonly openThreads: readonly string[];
  /** 已回收的承诺 —— 唯一带 ground truth 的数据。 */
  readonly resolvedCommitments: readonly Commitment[];
  readonly motifs: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 9. 网格查询意图（§5.1 ① Query Planner 的产物）                               */
/* -------------------------------------------------------------------------- */

export type QueryIntent = 'situation' | 'divergence' | 'constraint';

export interface PlannedQuery {
  readonly intent: QueryIntent;
  readonly query: string;
  /** 该意图对应的路线关键词，供 Mesh Builder 分组。 */
  readonly keywords: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 10. 隐藏状态键的再导出（避免下游各自 import 数据层）                          */
/* -------------------------------------------------------------------------- */

export type { HiddenKey };
