import { clampCheckDifficulty } from '@/agents/types';

/**
 * 动态难度适配（规范 §4.5 / §4.4「Difficulty Judge」）。
 *
 * 核心纪律：**难度只由可观测的对局历史与世界状态算出来**，不交给模型拍脑袋。
 * 模型可以提出「这一检定的直觉难度」，但引擎会按这里的偏移重新钳制。
 *
 * 五条规则直接来自规范：
 * 1. 连续成功 3 次 → +2
 * 2. 连续失败 2 次 → −1
 * 3. 持有强力遗物 → +1（每件，最多 +2）
 * 4. 剧情处于高潮（最后一幕 / SAN 临界）→ +3
 * 5. 现实锚点低 → 波动增大（偏移按 seed 确定性抖动，而非随机）
 */

export interface PerformanceProfile {
  readonly act: number;
  readonly totalActs: number;
  /** 按时间顺序的检定结果（最近的在末尾）。 */
  readonly outcomes: readonly ('success' | 'failure' | 'none')[];
  readonly equippedRelicCount: number;
  readonly strongRelicCount: number;
  readonly san: number;
  /** 现实锚点 0..1；未实现该系统的阶段传 1。 */
  readonly realityAnchor: number;
  readonly seed: string;
}

export interface DifficultyAdjustment {
  readonly offset: number;
  /** 命中的规则，用于评审展示与调试（可解释性）。 */
  readonly reasons: readonly string[];
  /** 波动幅度（锚点低时 > 0）。 */
  readonly variance: number;
}

const STREAK_SUCCESS = 3;
const STREAK_FAILURE = 2;

/** 末尾连续同类结果的长度。 */
function trailingStreak(outcomes: readonly string[], kind: string): number {
  let count = 0;
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (outcomes[index] !== kind) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * 计算难度偏移。
 *
 * 返回值刻意**有界**（−2..+5）：难度可以变，但不能把玩家逼到必败或送分。
 */
export function adaptDifficulty(profile: PerformanceProfile): DifficultyAdjustment {
  const reasons: string[] = [];
  let offset = 0;

  const successStreak = trailingStreak(profile.outcomes, 'success');
  const failureStreak = trailingStreak(profile.outcomes, 'failure');

  if (successStreak >= STREAK_SUCCESS) {
    offset += 2;
    reasons.push(`连续 ${successStreak} 次成功 +2`);
  }
  if (failureStreak >= STREAK_FAILURE) {
    offset -= 1;
    reasons.push(`连续 ${failureStreak} 次失败 −1`);
  }

  const relicBonus = Math.min(2, Math.max(0, profile.strongRelicCount));
  if (relicBonus > 0) {
    offset += relicBonus;
    reasons.push(`强力遗物 ×${relicBonus} +${relicBonus}`);
  }

  // 高潮：最后一幕，或 SAN 已进临界区
  const isClimax = profile.act >= profile.totalActs || profile.san < 30;
  if (isClimax) {
    offset += 3;
    reasons.push(profile.act >= profile.totalActs ? '终幕 +3' : 'SAN 临界 +3');
  }

  // 锚点低 → 波动增大（确定性抖动，不用随机数）
  const variance = profile.realityAnchor < 0.3 ? 1 : 0;
  if (variance > 0) {
    offset += deterministicJitter(profile.seed, profile.act);
    reasons.push('现实锚点偏低：难度波动增大');
  }

  const clamped = Math.max(-2, Math.min(5, Math.round(offset)));
  return { offset: clamped, reasons, variance };
}

/** 由 seed 与幕次派生的确定性抖动：−1 / 0 / +1。 */
export function deterministicJitter(seed: string, act: number): number {
  let hash = 2166136261;
  const text = `${seed}:jitter:${act}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 3) - 1;
}

/** 「强力遗物」的判定：主动型或带数值修饰的遗物。 */
export function isStrongRelic(relic: { readonly kind: string; readonly effect?: unknown }): boolean {
  return relic.kind === 'active' || Boolean(relic.effect);
}

/** 把 AI 提出的难度按动态偏移重新钳制（引擎拥有最终解释权）。 */
export function resolveCheckDifficulty(aiDifficulty: number, adjustment: DifficultyAdjustment): number {
  return clampCheckDifficulty(aiDifficulty, adjustment.offset);
}
