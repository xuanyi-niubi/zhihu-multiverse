import type { AuthorityLevel, PathCard } from '@/types/evidence';

/**
 * 证据强度评分（方案 §5.2；**v3 §19 修订**）。
 *
 * 这个模块存在的唯一理由是：**把「可溯源」从道德承诺变成可计算的机制**。
 *
 * ## v3 §19：删掉失效的 freshness 维度
 *
 * 原设计有四个因子，其中**新鲜度**依赖官方接口的 `EditTime`。
 * 实测那个字段返回的是近期时间戳（与 `retrievedAt` 同量级），
 * 不像用户真实编辑时间 —— 于是新鲜度因子**恒等于 1**，
 * 等于一个不参与排序的装饰维度。
 *
 * v3 §19 的原则：
 *
 * > **缺信号，就删维度；不要伪造差异。**
 *
 * 因此改为三因子（权重相应上调）；`freshnessScore` 保留但不再参与计算，
 * 待将来拿到可靠的发布时间／更新时间后再恢复。
 *
 * | 因子 | 权重 | 含义 |
 * |---|---|---|
 * | 样本量 | 0.45 | 一个人说的不叫证据 |
 * | 权威度 | 0.30 | 平台给的分级 |
 * | 一致性 | 0.25 | 结果说法是否互相矛盾 |
 *
 * 输出是 0..1，落到 `EvidenceGrade` 三档。**没有任何数值来自模型。**
 */

/** 权威等级原始值（数字越大越权威）→ 归一化 0..1。 */
export function authorityScore(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) {
    return 0.35; // 缺失不等于不可信，但明显低于有等级的内容
  }
  if (rank >= 4) return 1;
  if (rank >= 3) return 0.85;
  if (rank >= 2) return 0.65;
  return 0.45;
}

export function authorityLabel(rank: number): AuthorityLevel {
  if (!Number.isFinite(rank) || rank <= 0) return 'unknown';
  if (rank >= 4) return 'high';
  if (rank >= 3) return 'high';
  if (rank >= 2) return 'medium';
  return 'low';
}

/**
 * 新鲜度：**v3 §19 起停用**，不参与 `strengthOf` 计算。
 *
 * 保留函数是为了两点：
 * 1. 将来官方接口给出可靠的发布时间／更新时间时可直接恢复；
 * 2. 界面浮层仍需要展示「这条内容是哪一年的」—— 那是**展示**，不是权重。
 *
 * 之所以不能继续拿它当权重：实测它的输入（`EditTime`）恒为近期值，
 * 于是因子恒等于 1，等于一个不参与排序的装饰维度。
 * **缺信号就删维度，不要伪造差异。**
 */
export function freshnessScore(retrievedAt: string, now: number): number {
  const parsed = Date.parse(retrievedAt);
  if (!Number.isFinite(parsed)) {
    return 0.6;
  }
  const years = Math.max(0, (now - parsed) / (365 * 24 * 3600 * 1000));
  // 前 2 年满权重，之后每 3 年掉 0.15，地板 0.4
  const decay = Math.max(0, years - 2) / 3 * 0.15;
  return Math.max(0.4, 1 - decay);
}

/** 样本量因子：对数收敛，1 条 = 0.45，3 条 = 0.8，6 条以上接近 1。 */
export function sampleFactor(sampleSize: number): number {
  if (sampleSize <= 0) {
    return 0;
  }
  if (sampleSize === 1) {
    return 0.45;
  }
  return Math.min(1, 0.45 + 0.35 * Math.log2(sampleSize));
}

/**
 * 一致性因子：结果说法的重复率。
 *
 * 做法刻意朴素（同一个结果的字面重复）—— 因为我们只有短摘要，
 * 任何更聪明的语义聚类都会引入不可复核的判断。宁可保守。
 */
export function consistencyScore(cards: readonly PathCard[]): number {
  if (cards.length <= 1) {
    return 1;
  }
  const buckets = new Map<string, number>();
  for (const card of cards) {
    const key = card.shape.outcome.trim().slice(0, 6);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const top = Math.max(...buckets.values());
  return top / cards.length;
}

export interface StrengthBreakdown {
  readonly strength: number;
  readonly sample: number;
  readonly authority: number;
  /** **已停用**（v3 §19）：恒为 1，不参与 strength 计算。保留字段以便将来恢复。 */
  readonly freshness: number;
  readonly consistency: number;
  readonly reasons: readonly string[];
}

/**
 * 计算一组卡的证据强度。
 *
 * 权重刻意让**样本量**占主导（0.4）：一个高权威但孤例的说法，
 * 不应该比三条普通人同向的经历更有分量 —— 前者是个案，后者才是路径。
 */
export function strengthOf(cards: readonly PathCard[], now: number = Date.now()): StrengthBreakdown {
  const reasons: string[] = [];

  if (cards.length === 0) {
    return {
      strength: 0,
      sample: 0,
      authority: 0,
      freshness: 1,
      consistency: 0,
      reasons: ['没有任何站内样本'],
    };
  }

  const sample = sampleFactor(cards.length);
  const authority = Math.max(...cards.map((card) => authorityScore(card.authorityRank)));
  const consistency = consistencyScore(cards);

  /**
   * **v3 §19**：三因子加权，freshness 已停用。
   *
   * 为什么 consistency 权重（0.25）压过 freshness 原本的位置：
   * 一致性是**跨样本**的信号，权威度是单条信号。多条样本互相矛盾时，
   * 再高的单条权威也不该被采信。
   */
  const strength = Number((sample * 0.45 + authority * 0.3 + consistency * 0.25).toFixed(4));

  if (cards.length === 1) {
    reasons.push('只有 1 条样本：这是个人经历，不是路径');
  }
  if (cards.length >= 3) {
    reasons.push(`${cards.length} 条样本同向`);
  }
  if (authority < 0.5) {
    reasons.push('样本权威度偏低');
  }
  if (consistency < 0.6) {
    reasons.push('这些样本的结果说法互相不一致');
  }

  // freshness 恒为 1：v3 §19 删掉该维度后它已不参与计算
  return { strength, sample, authority, freshness: 1, consistency, reasons };
}

/**
 * 三档定级。
 *
 * **`strong` 必须同时满足强度与样本量**：这是为了防止
 * 「一条特别高权威、特别新的回答」被评成强证据 —— 一个人说了不算。
 */
export function gradeOf(input: {
  readonly strength: number;
  readonly sampleSize: number;
}): 'strong' | 'partial' | 'thin' {
  if (input.sampleSize >= 3 && input.strength >= 0.6) {
    return 'strong';
  }
  if (input.sampleSize >= 1 && input.strength >= 0.3) {
    return 'partial';
  }
  return 'thin';
}

/** 给玩家看的证据说明（不含恐吓，如实说分母）。 */
export function gradeLabel(grade: 'strong' | 'partial' | 'thin'): string {
  switch (grade) {
    case 'strong':
      return '有据';
    case 'partial':
      return '样本有限，请自行判断';
    case 'thin':
      return '证据不足';
  }
}
