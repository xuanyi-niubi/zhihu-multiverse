import { toD20Face, toModifier, toTotalModifier } from '@/core/brand';
import { collectCheckModifiers } from '@/core/relics';

import type {
  D20CheckRequest,
  D20CheckResult,
  D20Face,
  D20Modifier,
  D20RuleSet,
} from '@/types/game';

/**
 * D20 检定引擎（zhihu-d20-v1）。
 *
 * 严格实现 `types/game.ts` 的契约：
 * - 天然 1 必定失败、天然 20 必定成功，优先级高于总值比较（I-04）；
 * - 其余骰面仅当 rawRoll + totalModifier >= difficulty 时成功（I-05）；
 * - 所有修正先钳制再求和（I-06）；
 * - 相同 seed + checkId + 快照必须得到相同结果（I-10）；
 * - 不读写任何全局状态（I-11）。
 */

export const D20_RULE_SET: D20RuleSet = {
  id: 'zhihu-d20-v1',
  die: 'd20',
  difficultyMin: 1,
  difficultyMax: 30,
  rawRollMin: 1,
  rawRollMax: 20,
  criticalRule: 'natural-1-fail-natural-20-success',
  modifierMin: -20,
  modifierMax: 20,
  totalModifierMin: -60,
  totalModifierMax: 60,
};

/** FNV-1a 字符串哈希，用于把种子转成 32 位整数。 */
export function hashSeed(seed: string): number {
  let hash = 2166136261 >>> 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash >>> 0;
}

/** mulberry32：小而稳定的确定性伪随机数生成器。 */
export function createSeededRng(seed: string): () => number {
  let state = hashSeed(seed) || 0x9e3779b9;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 为一次检定构造确定性随机源。
 *
 * 同一局内同一回合的同一选项，永远掷出同一个骰面——刷新页面不会改变结果，
 * 这让「种子复盘」和「分享同款随机事件」成立。
 */
export function createCheckRng(seed: string, checkId: string, turnIndex: number): () => number {
  return createSeededRng(`${seed}::${turnIndex}::${checkId}`);
}

/** 掷一枚 D20。 */
export function rollD20(rng: () => number): D20Face {
  return toD20Face(Math.floor(rng() * 20) + 1);
}

/**
 * zhihu-d20-v1 的属性换算：0..100 线性映射到 -5..+5。
 *
 * 属性 50 为基准，每 10 点属性折合 1 点 D20 修正；这个斜率让「新手 + 高 DC」
 * 天然不可行，必须依赖遗物或临时效果翻盘。
 */
export function deriveBaseModifier(value: number): D20Modifier {
  return toModifier(Math.round((value - 50) / 10));
}

/** 执行一次检定。`rng` 由调用方注入，便于测试与复盘。 */
export function evaluateCheck(
  request: D20CheckRequest,
  rng: () => number,
): D20CheckResult {
  const { passive, active, appliedIds } = collectCheckModifiers(
    request.inventory,
    request.targetStat,
    request.activatedRelicIds,
  );

  const totalModifier = toTotalModifier(
    request.baseModifier + passive + active + request.temporaryModifier,
  );

  const rawRoll = rollD20(rng);
  const total = rawRoll + totalModifier;

  const critical =
    rawRoll === 1 ? 'critical-failure' : rawRoll === 20 ? 'critical-success' : 'none';

  const outcome =
    rawRoll === 1
      ? 'failure'
      : rawRoll === 20
        ? 'success'
        : total >= request.difficulty
          ? 'success'
          : 'failure';

  const consumedRelicIds = request.activatedRelicIds.filter((relicId) =>
    request.inventory.some(
      (slot) =>
        slot !== null &&
        slot.relic.id === relicId &&
        slot.relic.kind === 'active' &&
        !slot.isConsumed,
    ),
  );

  return {
    checkId: request.checkId,
    turnIndex: request.turnIndex,
    seed: request.seed,
    ruleSetId: request.ruleSet.id,
    targetStat: request.targetStat,
    difficulty: request.difficulty,
    rawRoll,
    modifiers: {
      baseModifier: request.baseModifier,
      passiveRelicModifier: toModifier(passive),
      activeRelicModifier: toModifier(active),
      temporaryModifier: request.temporaryModifier,
      totalModifier,
      appliedRelicIds: appliedIds,
    },
    total,
    outcome,
    critical,
    consumedRelicIds,
    relicDrop: null,
  };
}
