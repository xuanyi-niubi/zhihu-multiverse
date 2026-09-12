import { rngFor } from '@/core/run/deterministic';

import { toHiddenSignal, type HiddenSignal, type WorldHidden, type WorldStats } from '@/features/run/contracts';

import type { HiddenKey, TemplateEffect } from '@/data/sceneTemplates';
import type { TargetStat } from '@/types/game';

/**
 * 世界状态（P1）：属性 + 五个隐藏状态 + flags，以及它们的**纯迁移**。
 *
 * 三点设计约束：
 *
 * 1. **纯函数**：`applyEffect` 不读任何全局状态、不用 `Math.random`，
 *    因此「同一 Manifest + 同一选择序列」必然得到同一状态轨迹（P1 退出门槛的一半）。
 * 2. **隐藏状态只以定性信号对外暴露**：UI 拿 `hiddenSignals()`，拿不到裸数值。
 *    「身体开始报警」可以给玩家看，「bodyAlarm=63」不行。
 * 3. **初始值也来自种子**：否则同一颗种子在不同设备上开局就不一样，
 *    挑战可比性从第一秒就断了。
 */

export interface WorldState {
  readonly stats: WorldStats;
  readonly hidden: WorldHidden;
  readonly flags: readonly string[];
}

export const HIDDEN_KEYS: readonly HiddenKey[] = [
  'bodyAlarm',
  'peerPressure',
  'runway',
  'mentorTrust',
  'socialDebt',
];

const STAT_KEYS: readonly TargetStat[] = ['san', 'skill', 'bond'];

/** 属性与隐藏状态统一钳制到 0..100 的闭区间整数。 */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * 用种子派生开局的隐藏状态。
 *
 * 区间是刻意的：`runway`（可支配时间）开局偏充裕、`bodyAlarm` 偏低，
 * 这样前三幕的「代价」才有从好变坏的下行空间；具体数值由种子决定。
 */
export function createInitialWorld(seed: string, stats: WorldStats): WorldState {
  const rng = rngFor(seed, 'world', 'init');
  const between = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

  const hidden: WorldHidden = {
    bodyAlarm: between(0, 25),
    peerPressure: between(0, 25),
    runway: between(45, 80),
    mentorTrust: between(40, 70),
    socialDebt: between(0, 20),
  };

  return {
    stats: {
      san: clampUnit(stats.san),
      skill: clampUnit(stats.skill),
      bond: clampUnit(stats.bond),
    },
    hidden,
    flags: [],
  };
}

/** 安全增量：非数值 / NaN / Infinity 一律当 0，避免一次脏数据把属性归零。 */
function delta(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 应用一份效果，返回新状态（不修改入参）。 */
export function applyEffect(state: WorldState, effect: TemplateEffect): WorldState {
  // 逐字段构造新对象：契约里的字段都是 readonly，这里不做原地修改
  const stats: WorldStats = {
    san: clampUnit(state.stats.san + delta(effect.stats?.san)),
    skill: clampUnit(state.stats.skill + delta(effect.stats?.skill)),
    bond: clampUnit(state.stats.bond + delta(effect.stats?.bond)),
  };

  const hidden: WorldHidden = {
    bodyAlarm: clampUnit(state.hidden.bodyAlarm + delta(effect.hidden?.bodyAlarm)),
    peerPressure: clampUnit(state.hidden.peerPressure + delta(effect.hidden?.peerPressure)),
    runway: clampUnit(state.hidden.runway + delta(effect.hidden?.runway)),
    mentorTrust: clampUnit(state.hidden.mentorTrust + delta(effect.hidden?.mentorTrust)),
    socialDebt: clampUnit(state.hidden.socialDebt + delta(effect.hidden?.socialDebt)),
  };

  const flags = state.flags.slice();
  for (const flag of effect.flags ?? []) {
    if (typeof flag === 'string' && flag.length > 0 && !flags.includes(flag)) {
      flags.push(flag);
    }
  }

  return { stats, hidden, flags };
}

/** 依次应用多份效果。 */
export function applyEffects(state: WorldState, effects: readonly TemplateEffect[]): WorldState {
  return effects.reduce<WorldState>((current, effect) => applyEffect(current, effect), state);
}

/**
 * 隐藏状态的**极性**：不是所有键都「越高越糟」。
 *
 * - 越高越糟：`bodyAlarm`（身体报警）、`peerPressure`（同辈压力）、`socialDebt`（人情债）
 * - 越高越好：`runway`（可支配时间/余量）、`mentorTrust`（导师信任）
 *
 * 忽略极性会把「时间充裕、导师信任」误报成警报 —— 这不是文案问题，
 * 是会把玩家往反方向推的语义错误。
 */
const HIGH_IS_BAD: readonly HiddenKey[] = ['bodyAlarm', 'peerPressure', 'socialDebt'];

/** 把「越高越糟」的信号翻转成「越高越好」的语义。 */
const INVERTED: Record<HiddenSignal, HiddenSignal> = {
  calm: 'critical',
  watch: 'alert',
  alert: 'watch',
  critical: 'calm',
};

/** 单个隐藏状态的定性信号。**唯一的数据出口。** */
export function signalFor(key: HiddenKey, value: number): HiddenSignal {
  const raw = toHiddenSignal(value);
  return HIGH_IS_BAD.includes(key) ? raw : INVERTED[raw];
}

/**
 * 隐藏状态 → 定性信号。
 *
 * **这是隐藏状态唯一的对外出口。** 任何 UI 都不应该拿到 `hidden` 里的小数值；
 * 需要展示时一律走这里。
 */
export function hiddenSignals(state: WorldState): Record<HiddenKey, HiddenSignal> {
  const out = {} as Record<HiddenKey, HiddenSignal>;
  for (const key of HIDDEN_KEYS) {
    out[key] = signalFor(key, state.hidden[key]);
  }
  return out;
}

/** 只看「需要提醒玩家」的那几条信号，用于窄屏信号条。 */
export function alertingSignals(state: WorldState): ReadonlyArray<{ key: HiddenKey; level: HiddenSignal }> {
  return HIDDEN_KEYS.map((key) => ({ key, level: signalFor(key, state.hidden[key]) })).filter(
    (item) => item.level === 'alert' || item.level === 'critical',
  );
}

export type RunOverReason = 'san-depleted';

/** 结算判定：SAN 归零即中断（救场与否由上层决定）。 */
export function isRunOver(state: WorldState): { readonly over: boolean; readonly reason?: RunOverReason } {
  return state.stats.san <= 0 ? { over: true, reason: 'san-depleted' } : { over: false };
}
