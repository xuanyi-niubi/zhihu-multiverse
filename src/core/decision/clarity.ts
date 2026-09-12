import { axisCapsFor, axisValuesFor, clampScore } from '@/core/decision/axis';
import { judgeMesh } from '@/core/decision/verdict';

import type { ClarityScore, ConstraintProfile, DecisionPath, Verdict } from '@/types/evidence';

/**
 * 四维终局结算（方案 §9）：**赢 ≠ 走完四幕**。
 *
 * 对一个声称解决人生迷茫的产品，用「走完几幕」当胜负判据是维度错误。
 * 这里换成四个可解释、可复算的认知维度：
 *
 * | 维度 | 回答的问题 |
 * |---|---|
 * | 清晰度 | 你知不知道自己在哪条轴上最紧？ |
 * | 证据覆盖 | 你考虑的路有多少是有据可依的？ |
 * | 代价认知 | 你对代价的预判有多接近真实？ |
 * | 可逆性管理 | 你有没有给自己留退路？ |
 *
 * 四条都不依赖模型，全部由确定性引擎算出；因此同一局重放必然同一份结算，
 * 可以直接进复盘与挑战链接。
 */

/** 赛前对「可投入月数」的自评（玩家以为自己能撑多久）。 */
export interface PreRunEstimate {
  readonly runwayMonths: number;
}

export interface ClarityInput {
  readonly paths: readonly DecisionPath[];
  readonly constraints: ConstraintProfile;
  /** 玩家赛前自评；缺省时该项按中性分处理，而不是直接判低分。 */
  readonly estimate?: PreRunEstimate | null;
  /** 玩家在局中实际「看过」的路线 id（展开过前人经历才算看过）。 */
  readonly exploredPathIds?: readonly string[];
}

/** 玩家自评与路线需求的差距容忍度：差 12 个月即归零。 */
const COST_ERROR_TOLERANCE_MONTHS = 12;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 清晰度：终局时「最紧的那条轴」是否与引擎算出的瓶颈一致。
 *
 * 判定方式刻意朴素：引擎算出 binding axis，玩家若能说清（在界面上确认过
 * 临界点），即得分。没有临界点时给中性偏高分 —— 因为「没有瓶颈」
 * 本身就是一种清晰的结论。
 */
function clarityScore(criticalAxis: string | null, acknowledgedAxes: readonly string[]): number {
  if (!criticalAxis) {
    return 75;
  }
  return acknowledgedAxes.includes(criticalAxis) ? 100 : 35;
}

/** 证据覆盖：看过且为 strong 的路线占比。 */
function evidenceCoverage(paths: readonly DecisionPath[], explored: readonly string[]): number {
  const evidenced = paths.filter((path) => path.sampleSize > 0);
  if (evidenced.length === 0) {
    return 0;
  }
  const strong = evidenced.filter((path) => path.grade === 'strong');
  if (strong.length === 0) {
    // 没有 strong 路线时，退化为「看过多少有据路线」的比例
    const exploredEvidenced = evidenced.filter((path) => explored.includes(path.pathId));
    return clampScore((exploredEvidenced.length / evidenced.length) * 60);
  }
  const coveredStrong = strong.filter((path) => explored.includes(path.pathId));
  return clampScore((coveredStrong.length / strong.length) * 100);
}

/**
 * 代价认知：玩家对时间的预判有多接近真实需求。
 *
 * **偏差方向有意义**：低估需求（以为自己撑得住）比高估更危险，
 * 所以低估的扣分比高估更重 —— 这是这个维度唯一一处不对称，刻意为之。
 */
function costAwareness(paths: readonly DecisionPath[], estimate: PreRunEstimate | null | undefined): number {
  if (!estimate || !Number.isFinite(estimate.runwayMonths)) {
    return 50; // 没自评就不奖不罚
  }

  const requirements = paths
    .filter((path) => path.sampleSize > 0)
    .flatMap((path) => axisCapsFor(path))
    .filter((cap) => cap.axis === 'runway')
    .map((cap) => cap.requirement);

  if (requirements.length === 0) {
    return 50;
  }

  const actual = Math.max(...requirements);
  const error = estimate.runwayMonths - actual;
  const magnitude = Math.min(1, Math.abs(error) / COST_ERROR_TOLERANCE_MONTHS);

  if (error >= 0) {
    return clampScore((1 - magnitude) * 100);
  }
  // 低估：同样幅度扣得更狠（×1.4），保证「以为自己撑得住」不会拿高分
  return clampScore(Math.max(0, 1 - magnitude * 1.4) * 100);
}

/**
 * 可逆性管理：可行的路线里，是否至少在一条硬轴上留了余量。
 *
 * 只统计可行的路线 —— 越线的路线谈不上「留退路」。
 */
function reversibility(paths: readonly DecisionPath[], constraints: ConstraintProfile): number {
  const judged = judgeMesh({ paths, constraints });
  const viable = judged.verdicts.filter((item) => item.verdict.kind === 'viable');

  if (viable.length === 0) {
    return 20; // 一条都走不通时给低分，但不归零（归零会读成「你完蛋了」）
  }

  const values = axisValuesFor(constraints);
  const margins = viable.map((item) => {
    const path = paths.find((candidate) => candidate.pathId === item.pathId);
    if (!path) {
      return 0;
    }
    const caps = axisCapsFor(path).filter((cap) => cap.axis === 'runway' || cap.axis === 'drawdown');
    if (caps.length === 0) {
      return 1;
    }
    const ratios = caps.map((cap) => {
      const axis = cap.axis === 'runway' ? { min: 0, max: 24 } : { min: 0, max: 100 };
      const span = Math.max(1, axis.max - axis.min);
      return clamp01((values[cap.axis] - cap.requirement) / (span * 0.25));
    });
    return Math.min(...ratios);
  });

  return clampScore((margins.reduce((sum, value) => sum + value, 0) / margins.length) * 100);
}

export function clarityOf(input: ClarityInput): ClarityScore {
  const explored = input.exploredPathIds ?? [];
  const judged = judgeMesh({ paths: input.paths, constraints: input.constraints });
  const criticalAxis: string | null = judged.critical ? judged.critical.axis : null;

  // 玩家「确认过临界点」等价于展开过临界点所在路线的前人经历
  const acknowledgedAxes = judged.critical && explored.includes(judged.critical.pathId) ? [judged.critical.axis] : [];

  const clarity = clarityScore(criticalAxis, acknowledgedAxes);
  const evidenceCoverageScore = evidenceCoverage(input.paths, explored);
  const costAwarenessScore = costAwareness(input.paths, input.estimate);
  const reversibilityScore = reversibility(input.paths, input.constraints);

  return {
    clarity: clampScore(clarity),
    evidenceCoverage: clampScore(evidenceCoverageScore),
    costAwareness: clampScore(costAwarenessScore),
    reversibility: clampScore(reversibilityScore),
    total:
      clampScore(clarity) +
      clampScore(evidenceCoverageScore) +
      clampScore(costAwarenessScore) +
      clampScore(reversibilityScore),
  };
}

/**
 * 四维结算的一句话结语（大白话，不给玩家看裸数字焦虑）。
 *
 * 与 `DESIGN.md` 的文案纪律一致：定性、不恐吓、不复述分数。
 */
export function clarityVerdict(score: ClarityScore): string {
  const weakest = (
    [
      { key: 'clarity', value: score.clarity, text: '你还没说清自己卡在哪一条轴上' },
      { key: 'evidenceCoverage', value: score.evidenceCoverage, text: '你看过的路里，有据可依的还不够多' },
      { key: 'costAwareness', value: score.costAwareness, text: '你对要付出多少时间的预判偏乐观' },
      { key: 'reversibility', value: score.reversibility, text: '你没给自己留够退路' },
    ] as const
  ).reduce((worst, item) => (item.value < worst.value ? item : worst));

  if (weakest.value >= 70) {
    return '这一局你要么看得很清，要么运气不错 —— 至少你没有把自己逼到死角。';
  }
  return `这一局最该补的是：${weakest.text}。这比分数本身重要。`;
}

export type { Verdict };
