import type {
  D20Difficulty,
  D20Face,
  D20Modifier,
  D20TotalModifier,
  Ratio,
  RelicChargeCount,
  RunSeed,
  StatValue,
  TurnIndex,
} from '@/types/game';

/**
 * branded 类型的受控构造器。
 *
 * `types/game.ts` 用 `number & { __brand }` 在类型层阻止裸 number 混入玩法数值；
 * 本文件是唯一允许做「运行时校验 + 断言」的地方，所有越界值在此被钳制到规范区间，
 * 对应验收清单里的 I-01（属性边界）与 I-06（修正边界）。
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

/** 0..100 的有限整数。 */
export function toStatValue(value: number): StatValue {
  return clamp(toInt(value, 0), 0, 100) as StatValue;
}

/** 0..1 的比例，不接受 25 这种百分比写法。 */
export function toRatio(value: number): Ratio {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1) as Ratio;
}

/** 1..20 的骰面。 */
export function toD20Face(value: number): D20Face {
  return clamp(toInt(value, 1), 1, 20) as D20Face;
}

/** 1..30 的难度等级。 */
export function toDifficulty(value: number): D20Difficulty {
  return clamp(toInt(value, 1), 1, 30) as D20Difficulty;
}

/** -20..20 的单项修正。 */
export function toModifier(value: number): D20Modifier {
  return clamp(toInt(value, 0), -20, 20) as D20Modifier;
}

/** -60..60 的总修正。 */
export function toTotalModifier(value: number): D20TotalModifier {
  return clamp(toInt(value, 0), -60, 60) as D20TotalModifier;
}

/** 1..3 的遗物充能上限。 */
export function toChargeCount(value: number): RelicChargeCount {
  return clamp(toInt(value, 1), 1, 3) as RelicChargeCount;
}

/**
 * 局内回合编号：1..8。
 *
 * 上限的唯一事实源是 `core/run/actRun.ts` 的 `MAX_TURNS`
 * （v2 §14 Phase 0 第 1 条要求统一幕数口径）。
 */
export function toTurnIndex(value: number): TurnIndex {
  return clamp(toInt(value, 1), 1, 8) as TurnIndex;
}

/** 局种子：仅做非空兜底，格式由上层生成器约束。 */
export function toSeed(value: string): RunSeed {
  return (value.trim() || 'SEED-2026-XXXXX') as RunSeed;
}
