import { applyEffect, type WorldState } from '@/core/run/worldState';

import type { HiddenKey, TemplateEffect } from '@/data/sceneTemplates';
import type { TargetStat } from '@/types/game';

/**
 * 适配器：把**既有的剧本数据**（预置剧本 / AI DM 生成的关卡）翻译成因果引擎的效果。
 *
 * 为什么要这一层：`scenarioCompiler` 的模板自带 `effects`，而现有剧本只有
 * `onSuccess/onFail.statDeltas`（三属性）。隐藏状态没有数据来源，于是这里用一组
 * **确定性、可解释**的规则把它补上 —— 风险选项会推高身体报警与同辈压力，
 * 稳妥选项让身体缓一口气，专业力增长换来导师信任，欠人情则累积人情债。
 *
 * 这是「规则引擎负责数值」的具体落点：数值来自规则，不来自模型，也不来自随机。
 * 规则改了要同步 `SCENARIO_REVISION`，否则老挑战会静默变味道。
 */

export type OutcomeKind = 'success' | 'failure' | 'no-check';

export interface ScenarioChoiceLike {
  readonly id: string;
  readonly text: string;
  readonly check?: { readonly targetStat: TargetStat; readonly difficulty: number };
}

export interface OutcomeLike {
  readonly statDeltas: Partial<Record<TargetStat, number>>;
  readonly relicId?: string;
}

/** 风险选项的基础代价（无论成败，身体都会记账）。 */
const RISK_BASE: Partial<Record<HiddenKey, number>> = { bodyAlarm: 12, runway: -8 };

/** 隐藏状态增量：只看「是否风险选项 + 成败 + 属性变化」，全部确定性。 */
export function hiddenDeltaFor(
  choice: ScenarioChoiceLike,
  kind: OutcomeKind,
  outcome?: OutcomeLike,
): Partial<Record<HiddenKey, number>> {
  const delta: Partial<Record<HiddenKey, number>> = {};

  const add = (key: HiddenKey, value: number): void => {
    delta[key] = (delta[key] ?? 0) + value;
  };

  if (choice.check) {
    for (const [key, value] of Object.entries(RISK_BASE) as [HiddenKey, number][]) {
      add(key, value);
    }
    if (kind === 'failure') {
      // 失败要额外记账：身体更糟，同辈噪声更大
      add('bodyAlarm', 4);
      add('peerPressure', 8);
    }
  } else {
    // 稳妥路径让身体缓一口气，但也吃掉一点时间
    add('bodyAlarm', -6);
    add('runway', -4);
  }

  const statDeltas = outcome?.statDeltas ?? {};

  // 专业力有增长 → 导师更信任你
  if ((statDeltas.skill ?? 0) > 0) {
    add('mentorTrust', 5);
  }
  // 羁绊有增长 → 人情债下降；反之则欠下人情
  if ((statDeltas.bond ?? 0) > 0) {
    add('socialDebt', -6);
  } else if ((statDeltas.bond ?? 0) < 0) {
    add('mentorTrust', -4);
    add('socialDebt', 4);
  }
  // 心智掉得狠 → 同辈噪声更容易钻进来
  if ((statDeltas.san ?? 0) <= -10) {
    add('peerPressure', 6);
  }

  return delta;
}

/**
 * 把「结果 + 隐藏增量」合成一份引擎可用的效果。
 *
 * ⚠️ **刻意不带 `stats`**：属性由既有的 `resolveStatDeltas`（含遗物与出身倍率）
 * 推进并发给 HUD，这里若再应用一次，世界状态里就会出现第二份会漂移的属性。
 * 属性同步走 `syncStats`，保持**单一事实源**。
 */
export function outcomeEffect(
  choice: ScenarioChoiceLike,
  kind: OutcomeKind,
  outcome?: OutcomeLike,
): TemplateEffect {
  return {
    hidden: hiddenDeltaFor(choice, kind, outcome),
    flags: [choice.check ? 'path-risky' : 'path-safe'],
  };
}

/**
 * 推进世界状态：这是 play 页每回合隐藏状态的唯一来源。
 *
 * 只动隐藏状态与 flags；属性由 `syncStats` 显式同步。
 */
export function advanceWorldWithChoice(
  world: WorldState,
  choice: ScenarioChoiceLike,
  kind: OutcomeKind,
  outcome?: OutcomeLike,
): WorldState {
  return applyEffect(world, outcomeEffect(choice, kind, outcome));
}

/**
 * 把权威属性同步进世界状态。
 *
 * play 页的属性是 HUD 认的那一份（经过遗物、出身倍率、救场等全部加工），
 * 世界状态里的属性只用于「信号极性以外的引擎逻辑」，必须与它保持一致。
 */
export function syncStats(
  world: WorldState,
  stats: { readonly san: number; readonly skill: number; readonly bond: number },
): WorldState {
  return { ...world, stats: { san: stats.san, skill: stats.skill, bond: stats.bond } };
}

/**
 * 选项语义标签（AI 生成）→ 隐藏状态增量（引擎决定）。
 *
 * 这是「AI 即机制」的关键一环：AI 可以自由创造选项，但**代价的数值仍由规则表决定**。
 * 于是 AI 的创造力不会破坏平衡性，同时玩家能感到"我做的这个决定有分量"。
 *
 * 未标注 tags 的旧数据一律按 neutral 处理（向后兼容，也避免 AI 忘了标就变成送分选项）。
 */
export interface ChoiceTagLike {
  readonly moral?: 'good' | 'neutral' | 'dark';
  readonly efficiency?: 'direct' | 'indirect' | 'risky';
  readonly social?: 'ally' | 'neutral' | 'antagonize';
}

export function hiddenDeltaForTags(tags: ChoiceTagLike | undefined): Partial<Record<HiddenKey, number>> {
  const delta: Partial<Record<HiddenKey, number>> = {};
  const add = (key: HiddenKey, value: number): void => {
    delta[key] = (delta[key] ?? 0) + value;
  };

  if (!tags) {
    return delta;
  }

  // 道德：走暗路要付人情债与身体账；行好事换来导师信任
  if (tags.moral === 'dark') {
    add('socialDebt', 8);
    add('bodyAlarm', 4);
  } else if (tags.moral === 'good') {
    add('mentorTrust', 6);
    add('socialDebt', -4);
  }

  // 效率：直接动手省时间但更耗身体；绕路费时间
  if (tags.efficiency === 'direct') {
    add('bodyAlarm', 6);
    add('runway', 4);
  } else if (tags.efficiency === 'risky') {
    add('bodyAlarm', 10);
    add('peerPressure', 6);
  } else if (tags.efficiency === 'indirect') {
    add('runway', -6);
  }

  // 社交：结盟降压力、树敌升压力
  if (tags.social === 'ally') {
    add('peerPressure', -8);
    add('mentorTrust', 4);
  } else if (tags.social === 'antagonize') {
    add('peerPressure', 10);
    add('socialDebt', 4);
  }

  return delta;
}

/**
 * 带选项语义的推进：在既有「风险/稳妥」规则之上**叠加** tags 的增量。
 *
 * 叠加而非覆盖 —— 一个"高风险且道德灰暗"的选项应当同时吃到两边的代价。
 */
export function advanceWorldWithChoiceTags(
  world: WorldState,
  choice: ScenarioChoiceLike,
  kind: OutcomeKind,
  outcome?: OutcomeLike,
  tags?: ChoiceTagLike,
): WorldState {
  const base = advanceWorldWithChoice(world, choice, kind, outcome);
  const tagDelta = hiddenDeltaForTags(tags);
  if (Object.keys(tagDelta).length === 0) {
    return base;
  }
  return applyEffect(base, { hidden: tagDelta });
}
