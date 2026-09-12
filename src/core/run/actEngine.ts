import { toDifficulty } from '@/core/brand';

/** 属性快照：只要这三项，不依赖 game 层的具体类型（避免循环依赖）。 */
export interface StatSnapshot {
  readonly san: number;
  readonly skill: number;
  readonly bond: number;
}

/**
 * 动态幕系统（最终版 §5，P0 的第一刀）。
 *
 * 目的：把「第几回合」换成「叙事张力驱动的幕」。
 *
 * 现状问题（最终版原文）：`turnIndex` 硬编码 1~4、`dcBandFor(turnIndex)` 纯查表，
 * 与玩家状态无关 —— 于是"同样是第 2 回合"，谁玩都一样难，摸两把就摸出规律。
 *
 * 现在的规则：
 * - 每局有一个**张力预算** `tensionBudget`（初始值由出身决定）；
 * - 每个选择按结果与风险增减预算：豪赌烧得快、稳扎稳打省着花；
 * - 预算耗尽、三属性任一见底、或玩家主动收束 → 终局。
 *   于是有的局 3 幕结束，有的能拖到 6–7 幕；
 * - 难度带由**预算 + 当前属性 + 已用遗物**共同决定，不再查回合号。
 *
 * 两条纪律：**确定性**（同输入同输出，不用随机）与**有界**（幕数与难度都有硬上限，
 * 不会出现"玩家运气好就一直玩下去"或"难度无限膨胀"）。
 */

export interface ActState {
  /** 当前是第几幕（1 起）。 */
  readonly actIndex: number;
  /** 叙事张力预算：耗尽即终局。 */
  readonly tensionBudget: number;
  /** 距离上一次"危机幕"过了几幕，用于动态插入危机而不是固定第 N 幕。 */
  readonly turnsSinceLastCrisis: number;
}

/** 张力预算的边界：下限用于终局判定，上限防止"越攒越多"。 */
export const TENSION_MIN = 0;
export const TENSION_MAX = 100;

/** 幕数硬上限：即使预算没耗尽也不无限拖（演示节奏可控）。 */
export const ACT_HARD_CAP = 8;

/** 初始张力预算：按出身给（不同出身的"人生余量"本就不同）。 */
const ORIGIN_TENSION: Record<string, number> = {
  assassin: 88,
  'law-to-cs': 88,
  survivor: 76,
  'kaoyan-second': 76,
  default: 84,
};

export function createActState(originId?: string): ActState {
  const budget = ORIGIN_TENSION[originId ?? ''] ?? ORIGIN_TENSION.default;
  return { actIndex: 1, tensionBudget: budget, turnsSinceLastCrisis: 0 };
}

export interface ActEvent {
  readonly outcome: 'success' | 'failure' | 'none';
  /** 高风险路线烧得更快。 */
  readonly risky?: boolean;
  /** 心智掉得越狠，张力消耗越快。 */
  readonly sanDelta?: number;
  /** 是否有人并肩（省张力）。 */
  readonly allied?: boolean;
}

/**
 * 消耗规则（可解释、可对账）：
 * - 底价：每一幕都要花 12 点（时间不会停）
 * - 失败 +6，成功 −4（走通了反而松一口气）
 * - 高风险 +4
 * - 心智消耗超过 10 再加 4
 * - 有人并肩 −3
 */
export function consumeTension(state: ActState, event: ActEvent): ActState {
  let budget = state.tensionBudget - 12;

  if (event.outcome === 'failure') {
    budget -= 6;
  } else if (event.outcome === 'success') {
    budget += 4;
  }
  if (event.risky) {
    budget -= 4;
  }
  if ((event.sanDelta ?? 0) <= -10) {
    budget -= 4;
  }
  if (event.allied) {
    budget += 3;
  }

  const crisis = state.turnsSinceLastCrisis + 1;
  return {
    actIndex: state.actIndex + 1,
    tensionBudget: Math.max(TENSION_MIN, Math.min(TENSION_MAX, budget)),
    turnsSinceLastCrisis: crisis,
  };
}

/** 终局判定：预算耗尽 / 三属性任一见底 / 幕数到硬上限。 */
export function shouldEndRun(state: ActState, stats: StatSnapshot): boolean {
  if (state.tensionBudget <= TENSION_MIN) {
    return true;
  }
  if (stats.san <= 0 || stats.skill <= 0 || stats.bond <= 0) {
    return true;
  }
  return state.actIndex > ACT_HARD_CAP;
}

/** 该不该插一个"危机幕"：连续三幕没危机就插一个（而不是固定第 N 幕）。 */
export function crisisDue(state: ActState): boolean {
  return state.turnsSinceLastCrisis >= 3;
}

export interface TensionBand {
  /** 给 prompt 的难度带（如 "15-17"）。 */
  readonly band: string;
  /** 带的中值，用于引擎侧钳制。 */
  readonly center: number;
  /** 这一带是怎么来的（可解释性）。 */
  readonly reasons: readonly string[];
}

/**
 * 难度带：由张力 + 属性 + 遗物数共同决定。
 *
 * 张力越低（快撑不住了）→ 越难；属性越低 → 越难；遗物越多 → 略难
 * （你带的东西越多，遇到的局也越硬）。全部有界，钳在 11..20。
 */
export function tensionBand(state: ActState, stats: StatSnapshot, relicCount = 0): TensionBand {
  const reasons: string[] = [];
  let center = 13;

  const pressure = TENSION_MAX - state.tensionBudget;
  if (pressure >= 60) {
    center += 3;
    reasons.push('张力接近耗尽：局势吃紧');
  } else if (pressure >= 30) {
    center += 2;
    reasons.push('张力消耗过半');
  } else if (pressure <= 10) {
    center -= 1;
    reasons.push('张力充裕：还有余地');
  }

  const weakStats = [stats.san, stats.skill, stats.bond].filter((value) => value < 35).length;
  if (weakStats > 0) {
    center += weakStats;
    reasons.push(`有 ${weakStats} 项属性偏低`);
  }

  if (relicCount >= 3) {
    center += 1;
    reasons.push('携带遗物很多');
  }

  const clamped = Math.max(11, Math.min(20, Math.round(center)));
  const band = `${toDifficulty(clamped - 1)}-${toDifficulty(clamped + 1)}`;
  return { band, center: clamped, reasons };
}

/** 展示用的一句话（不含数字）。 */
export function actSummary(state: ActState): string {
  if (state.tensionBudget <= 20) {
    return '这一局已经拖到了极限';
  }
  if (state.tensionBudget <= 50) {
    return '还能往前推几幕';
  }
  return '时间还够，可以慢慢走';
}
