import { stableHash } from '@/core/run/deterministic';

/**
 * 心理状态系统（v2 §4.2.3 / 重构计划 §6.2）。
 *
 * 规范原文的三条硬规则：
 * - `stress > 70` → 检定难度 +2
 * - `stress > 90` → 难度 +5，且失败时触发创伤事件
 * - `clarity < 30` → 玩家看不到检定难度
 *
 * 为什么做成确定性引擎而不是让模型打分：压力会改 DC。一旦 AI 能改 DC，
 * 「同一局可复盘」就断了——所以压力由**可观测的对局事实**累加得出。
 */

export interface TraumaEvent {
  readonly id: string;
  readonly act: number;
  readonly label: string;
}

export interface MentalState {
  /** 0..100：越高越容易失误。 */
  readonly stress: number;
  /** 0..100：低于 30 时玩家看不到检定难度。 */
  readonly clarity: number;
  readonly traumas: readonly TraumaEvent[];
  /** 是否处于崩溃边缘（stress ≥ 90）。 */
  readonly breakdown: boolean;
}

export const STRESS_HARD = 70;
export const STRESS_BREAKDOWN = 90;
export const CLARITY_BLIND = 30;

export function createMentalState(seed: string): MentalState {
  // 开局压力/清晰度由种子派生（同一局开局一致），范围刻意小
  const hash = stableHash(`mental:${seed}`);
  const stress = 10 + (parseInt(hash.slice(0, 2), 16) % 11); // 10..20
  const clarity = 62 + (parseInt(hash.slice(2, 4), 16) % 16); // 62..77
  return { stress, clarity, traumas: [], breakdown: false };
}

export interface MentalEvent {
  readonly act: number;
  /** 心智变化（负数=消耗）。 */
  readonly sanDelta: number;
  readonly outcome: 'success' | 'failure' | 'none';
  /** 是否走了高风险路线（AI 标注的 efficiency=risky）。 */
  readonly risky: boolean;
  /** 是否有人并肩（social=ally）。 */
  readonly allied: boolean;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/**
 * 推进心理状态。
 *
 * 规则（可解释）：
 * - 心智掉得越多，压力涨得越多；失败比成功更伤；高风险额外加压
 * - 成功且有人并肩 → 压力缓解、清晰度回升
 * - 压力过 90 且失败 → 记一次创伤（创伤会让清晰度永久性略降）
 */
export function applyMentalEvent(state: MentalState, event: MentalEvent): MentalState {
  let stress = state.stress;
  let clarity = state.clarity;
  let traumas = state.traumas;

  if (event.sanDelta < 0) {
    stress += Math.round(Math.abs(event.sanDelta) * 0.9);
    clarity -= Math.round(Math.abs(event.sanDelta) * 0.4);
  }

  if (event.outcome === 'failure') {
    stress += event.risky ? 8 : 4;
    clarity -= event.risky ? 6 : 3;
  } else if (event.outcome === 'success') {
    stress -= event.allied ? 6 : 3;
    clarity += 4;
  }

  if (event.risky) {
    stress += 3;
  }

  stress = clamp(stress);
  clarity = clamp(clarity);

  const breakdown = stress >= STRESS_BREAKDOWN;
  if (breakdown && event.outcome === 'failure') {
    const id = `trauma-${event.act}`;
    if (!traumas.some((trauma) => trauma.id === id)) {
      traumas = [
        ...traumas,
        {
          id,
          act: event.act,
          label: event.risky ? '那一次豪赌崩了，你到现在还不敢回想' : '连续受挫让你开始怀疑自己的判断',
        },
      ];
      // 创伤留下痕迹：清晰度永久性下降
      clarity = clamp(clarity - 5);
    }
  }

  return { stress, clarity, traumas, breakdown };
}

/** 压力带来的难度偏移：0 / +2 / +5（规范原文数值）。 */
export function mentalDifficultyOffset(state: MentalState): number {
  if (state.stress > STRESS_BREAKDOWN) {
    return 5;
  }
  if (state.stress > STRESS_HARD) {
    return 2;
  }
  return 0;
}

/** 清晰度低时玩家看不到检定 DC（UI 据此隐藏数值）。 */
export function canSeeDifficulty(state: MentalState): boolean {
  return state.clarity >= CLARITY_BLIND;
}

/** 给 prompt / UI 的定性描述（不含数字）。 */
export function mentalSignals(state: MentalState): readonly string[] {
  const signals: string[] = [];
  if (state.stress >= STRESS_BREAKDOWN) {
    signals.push('精神已经到极限');
  } else if (state.stress > STRESS_HARD) {
    signals.push('压力很大，手在抖');
  } else if (state.stress > 45) {
    signals.push('有点紧');
  }
  if (state.clarity < CLARITY_BLIND) {
    signals.push('看不清局势');
  } else if (state.clarity < 50) {
    signals.push('思路有点乱');
  }
  if (state.traumas.length > 0) {
    // 刻意不写"带着 N 处"——出口文案里不许出现数字（连计数也不行）
    signals.push('身上有没愈合的地方');
  }
  return signals;
}
