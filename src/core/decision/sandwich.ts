import { clampAxis } from '@/core/decision/axis';
import { criticalPointFor, judgeMesh, verdictFor } from '@/core/decision/verdict';

import type { ConstraintProfile, Sandwich, SandwichCard, Verdict } from '@/types/evidence';

/**
 * 双牌对比（方案 §7.1）：同一份证据网格 × 两组约束，并排推演。
 *
 * **这是「平行宇宙」四个字第一次真的成立**：两张牌的证据完全相同，
 * 唯一变量是玩家自己的处境。于是「换个条件会怎样」变成可以直接看的对比，
 * 而不是靠想象。
 *
 * 工程前提：裁决是纯函数且 O(路线数)，所以滑杆可以做到零延迟实时重算，
 * **不需要任何网络请求**。
 */

export interface ConstraintGap {
  readonly label: string;
  readonly runwayFactor: number;
  readonly drawdownFactor: number;
  readonly allyValue: number;
}

/** 默认对比的两组约束：余量充足 vs 余量紧张。 */
export const DEFAULT_GAP: ConstraintGap = {
  label: '余量充足',
  runwayFactor: 2,
  drawdownFactor: 1.4,
  allyValue: 100,
};

export const TIGHT_GAP: ConstraintGap = {
  label: '余量紧张',
  runwayFactor: 0.5,
  drawdownFactor: 0.6,
  allyValue: 0,
};

/**
 * 由当前约束派生一张对比牌。
 *
 * 钳制一律走 `clampAxis`，所以即使传入极端倍数也不会造出越界的轴值
 * —— 双牌对比不能因为一个乘法就产生「不可能存在的处境」。
 */
export function deriveConstraints(
  base: ConstraintProfile,
  gap: ConstraintGap,
): ConstraintProfile {
  return {
    runwayMonths: clampAxis('runway', base.runwayMonths * gap.runwayFactor),
    drawdown: clampAxis('drawdown', base.drawdown * gap.drawdownFactor),
    ally: clampAxis('ally', gap.allyValue),
  };
}

function buildCard(
  meshPaths: Parameters<typeof judgeMesh>[0]['paths'],
  constraints: ConstraintProfile,
  label: string,
): SandwichCard {
  const judged = judgeMesh({ paths: meshPaths, constraints });
  const viableCount = judged.verdicts.filter((item) => item.verdict.kind === 'viable').length;

  return {
    label,
    constraints,
    verdicts: judged.verdicts,
    critical: judged.critical,
    viableCount,
  };
}

/** 两张牌结论不同的路线：这是对比的看点，也是演示时最该指给评委看的地方。 */
function divergentPathIds(cardA: SandwichCard, cardB: SandwichCard): readonly string[] {
  const byIdB = new Map(cardB.verdicts.map((item) => [item.pathId, item.verdict]));
  const divergent: string[] = [];

  for (const item of cardA.verdicts) {
    const other = byIdB.get(item.pathId);
    if (!other) {
      continue;
    }
    if (item.verdict.kind !== other.kind) {
      divergent.push(item.pathId);
    }
  }

  return divergent;
}

export function buildSandwich(input: {
  readonly meshId: string;
  readonly paths: Parameters<typeof judgeMesh>[0]['paths'];
  readonly constraints: ConstraintProfile;
  readonly gapB?: ConstraintGap;
}): Sandwich {
  const constraintsA = deriveConstraints(input.constraints, DEFAULT_GAP);
  const constraintsB = deriveConstraints(input.constraints, input.gapB ?? TIGHT_GAP);

  const cardA = buildCard(input.paths, constraintsA, DEFAULT_GAP.label);
  const cardB = buildCard(input.paths, constraintsB, (input.gapB ?? TIGHT_GAP).label);

  return {
    meshId: input.meshId,
    cardA,
    cardB,
    divergentPathIds: divergentPathIds(cardA, cardB),
  };
}

/**
 * 单条路线的敏感度：这条路在两组约束下的结论是否翻转。
 *
 * 用于「拿这条路去对比」时只展示真正会翻转的那一条，
 * 而不是把所有路线都摊开让人自己找。
 */
export function sensitivityOf(input: {
  readonly path: Parameters<typeof verdictFor>[0]['path'];
  readonly constraints: ConstraintProfile;
  readonly gapB?: ConstraintGap;
}): {
  readonly underA: Verdict;
  readonly underB: Verdict;
  readonly flips: boolean;
  readonly critical: ReturnType<typeof criticalPointFor>;
} {
  const constraintsA = deriveConstraints(input.constraints, DEFAULT_GAP);
  const constraintsB = deriveConstraints(input.constraints, input.gapB ?? TIGHT_GAP);

  const underA = verdictFor({ path: input.path, constraints: constraintsA });
  const underB = verdictFor({ path: input.path, constraints: constraintsB });

  return {
    underA,
    underB,
    flips: underA.kind !== underB.kind,
    critical:
      criticalPointFor({ path: input.path, constraints: constraintsA }) ??
      criticalPointFor({ path: input.path, constraints: constraintsB }),
  };
}
