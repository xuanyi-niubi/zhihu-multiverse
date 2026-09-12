import { alertingSignals, hiddenSignals, type WorldState } from '@/core/run/worldState';

import type { HiddenKey } from '@/data/sceneTemplates';
import type { HiddenSignal } from '@/features/run/contracts';

/**
 * 隐藏状态的**人话文案**。
 *
 * 产品约定：玩家永远看不到后台数值，只看到「身体开始报警」这类定性信号。
 * 这里把 `key × level` 映射成一句不带数字的中文，任何 UI 都只能通过它展示隐藏状态。
 *
 * 极性由 `worldState.signalFor` 统一处理（`runway` / `mentorTrust` 越高越好），
 * 所以本文件里 level 的语义是一致的：`calm` 最好、`critical` 最糟。
 */

const SIGNAL_TEXT: Record<HiddenKey, Record<HiddenSignal, string>> = {
  bodyAlarm: {
    calm: '身体状态还行',
    watch: '有点累',
    alert: '身体开始报警',
    critical: '身体在硬撑',
  },
  peerPressure: {
    calm: '同辈噪声不大',
    watch: '偶尔被比较',
    alert: '同辈噪声升高',
    critical: '被同辈压得喘不过气',
  },
  runway: {
    calm: '时间还够',
    watch: '日程开始变紧',
    alert: '时间很紧',
    critical: '几乎没时间了',
  },
  mentorTrust: {
    calm: '导师信任稳固',
    watch: '导师态度平稳',
    alert: '导师信任松动',
    critical: '导师不再指望你',
  },
  socialDebt: {
    calm: '没有欠下人情',
    watch: '欠了些人情',
    alert: '人情债在累积',
    critical: '人情债压身',
  },
};

/** 信号条上的一条。`tone` 只影响配色，不承载额外语义。 */
export interface SignalItem {
  readonly key: HiddenKey;
  readonly level: HiddenSignal;
  readonly text: string;
  readonly tone: 'calm' | 'watch' | 'warn' | 'danger';
}

const TONE: Record<HiddenSignal, SignalItem['tone']> = {
  calm: 'calm',
  watch: 'watch',
  alert: 'warn',
  critical: 'danger',
};

/** 固定展示顺序：先身体、再同辈、再时间、再信任、最后人情。 */
export const SIGNAL_ORDER: readonly HiddenKey[] = [
  'bodyAlarm',
  'peerPressure',
  'runway',
  'mentorTrust',
  'socialDebt',
];

/** 单条信号的展示项。 */
export function signalItem(key: HiddenKey, level: HiddenSignal): SignalItem {
  return { key, level, text: SIGNAL_TEXT[key][level], tone: TONE[level] };
}

/** 全部五条（固定顺序），用于展开态。 */
export function allSignalItems(world: WorldState): readonly SignalItem[] {
  const signals = hiddenSignals(world);
  return SIGNAL_ORDER.map((key) => signalItem(key, signals[key]));
}

/**
 * 只挑需要提醒玩家的那几条（alert / critical），用于常驻窄条。
 *
 * 复用 `worldState.alertingSignals`：「什么算警告」的判定只有一处，
 * 避免 UI 与引擎对同一状态给出不同结论。
 */
export function stripItems(world: WorldState): readonly SignalItem[] {
  return alertingSignals(world)
    .map(({ key, level }) => signalItem(key, level))
    .sort((left, right) => SIGNAL_ORDER.indexOf(left.key) - SIGNAL_ORDER.indexOf(right.key));
}
