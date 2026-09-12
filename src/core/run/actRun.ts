import {
  ACT_HARD_CAP,
  consumeTension,
  createActState,
  crisisDue,
  shouldEndRun,
  tensionBand,
  type ActEvent,
  type ActState,
  type StatSnapshot,
  type TensionBand,
} from '@/core/run/actEngine';

import type { ConstraintProfile } from '@/types/evidence';

/**
 * 幕数与幕数上限的**唯一事实源**（v2 §14 Phase 0 第 1 条：统一幕数口径）。
 *
 * 在此之前上限散落在四处且互不一致：
 * `dm/prompt.ts` 的 schema 写 8、`dm/input.ts` 钳 1..4、
 * `api/report` 钳 1..4、`brand.ts` 的 `toTurnIndex` 钳 1..4。
 * 「AI 生成的关卡最多几幕」这件事不该有四个答案。
 */
export const MIN_TURNS = 1;
export const MAX_TURNS = ACT_HARD_CAP;

export function clampTurnIndex(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return MIN_TURNS;
  }
  return Math.min(MAX_TURNS, Math.max(MIN_TURNS, Math.round(parsed)));
}

export function clampTotalTurns(value: unknown, fallback = MAX_TURNS): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_TURNS, Math.max(MIN_TURNS, Math.round(parsed)));
}

/* -------------------------------------------------------------------------- */
/* 动态幕：把张力预算真正接进运行时（v2 §14 Phase 0 第 2 条）                     */
/* -------------------------------------------------------------------------- */

/**
 * 一局的幕状态。
 *
 * 由 `core/run/actEngine.ts` 的纯函数驱动，因此**同一局重放必然得到同一幕数**
 * —— 这是「动态幕」能被挑战链接与复盘信任的前提。
 */
export interface RunActState {
  readonly act: ActState;
  readonly lastEvent: ActEvent | null;
}

export function createRunActState(originId?: string): RunActState {
  return { act: createActState(originId), lastEvent: null };
}

/** 每一幕结算后推进预算。 */
export function advanceRunAct(
  state: RunActState,
  event: ActEvent,
): RunActState {
  return { act: consumeTension(state.act, event), lastEvent: event };
}

export interface ActBudgetInput {
  readonly originId?: string;
  /** 初始属性：任一见底即终局。 */
  readonly initialStats: StatSnapshot;
  /** 玩家约束（有则用于难度带解释，这里只影响展示）。 */
  readonly constraints?: ConstraintProfile | null;
}

/**
 * **AI 自由推演**的幕数预算。
 *
 * 与预置剧本的区别是刻意保留的：预置剧本是**人工精调的四幕**（每幕都有手写内容），
 * 它的幕数由剧本本身决定，不该被动态幕改掉；只有 AI 动态生成的关卡才谈得上
 * 「张力耗尽即终局」。
 *
 * 返回值有界（`MIN_TURNS..MAX_TURNS`），因此不会出现「运气好就一直玩下去」。
 */
export function runBudgetFor(input: ActBudgetInput): number {
  let state = createRunActState(input.originId).act;

  for (let act = MIN_TURNS; act <= MAX_TURNS; act += 1) {
    if (shouldEndRun(state, input.initialStats)) {
      return Math.max(MIN_TURNS, act - 1);
    }
    // 中性推进：只消耗底价（每幕 12 点），不预设玩家的选择倾向。
    // 真实局中玩家选了豪赌 / 稳扎稳打会让预算增减，因此实际幕数会在此基础上浮动。
    state = advanceRunAct({ act: state, lastEvent: null }, { outcome: 'none' }).act;
  }

  return MAX_TURNS;
}

/** 该局当前该用哪一档难度带（由预算与状态决定，不再查回合号）。 */
export function bandFor(
  state: RunActState,
  stats: StatSnapshot,
  relicCount = 0,
): TensionBand {
  return tensionBand(state.act, stats, relicCount);
}

/** 是否该插一个危机幕（连续三幕无危机），而不是固定第 N 幕。 */
export function crisisNow(state: RunActState): boolean {
  return crisisDue(state.act);
}

/** 展示用：这一局还剩多少余量（定性，不含数字）。 */
export function actPressureLabel(state: RunActState): string {
  if (state.act.tensionBudget <= 20) {
    return '这一局已经拖到了极限';
  }
  if (state.act.tensionBudget <= 50) {
    return '还能往前推几幕';
  }
  return '时间还够，可以慢慢走';
}

export type { ActEvent, ActState, StatSnapshot, TensionBand };
