import { toChargeCount, toRatio, toTurnIndex } from '@/core/brand';

import type { OwnedZhihuRelic, RelicInventory, TargetStat, ZhihuRelic } from '@/types/game';

/**
 * 遗物栏与遗物效果的纯函数工具集。
 *
 * 全部函数不修改入参，返回新的 RelicInventory，对应验收清单里的
 * I-02（容量）、I-03（唯一性）、I-07（SAN 减伤封顶）、I-08（原子消耗）。
 */

/** 空栏常量：三个空槽。 */
export const EMPTY_INVENTORY: RelicInventory = [null, null, null];

/** 把一张遗物定义包装成局内持有态。 */
export function ownRelic(relic: ZhihuRelic, turnIndex: number): OwnedZhihuRelic {
  const isActive = relic.kind === 'active';

  return {
    relic,
    acquiredAtTurn: toTurnIndex(turnIndex),
    remainingCharges: isActive ? 1 : null,
    maxCharges: isActive ? toChargeCount(1) : null,
    isConsumed: false,
  };
}

/**
 * 放入第一个空槽。
 *
 * - 栏位已满或 id 重复时原样返回，`added` 为 false，由上层决定是否提示「槽位已满」。
 */
export function equipRelic(
  inventory: RelicInventory,
  owned: OwnedZhihuRelic,
): { inventory: RelicInventory; added: boolean } {
  if (inventory.some((slot) => slot?.relic.id === owned.relic.id)) {
    return { inventory, added: false };
  }

  const index = inventory.findIndex((slot) => slot === null);
  if (index < 0) {
    return { inventory, added: false };
  }

  const next = inventory.slice() as Array<OwnedZhihuRelic | null>;
  next[index] = owned;

  return { inventory: next as unknown as RelicInventory, added: true };
}

/** 消耗一次主动遗物充能；被动遗物与已消耗遗物不受影响。 */
export function consumeRelic(inventory: RelicInventory, relicId: string): RelicInventory {
  const next = inventory.map((slot) => {
    if (!slot || slot.relic.id !== relicId || slot.relic.kind !== 'active' || slot.isConsumed) {
      return slot;
    }

    const remaining = Math.max(0, (slot.remainingCharges ?? 0) - 1);

    return { ...slot, remainingCharges: remaining, isConsumed: remaining === 0 };
  });

  return next as unknown as RelicInventory;
}

/** 批量消耗本次检定启用的主动遗物。 */
export function consumeActivatedRelics(
  inventory: RelicInventory,
  activatedIds: readonly string[],
): RelicInventory {
  return activatedIds.reduce<RelicInventory>(
    (current, relicId) => consumeRelic(current, relicId),
    inventory,
  );
}

/**
 * 聚合 SAN 减伤比例。
 *
 * 无论带几件同类遗物，总减伤不超过 0.8（I-07），避免堆叠出免疫效果。
 */
export function collectSanReduction(inventory: RelicInventory): number {
  const total = inventory.reduce((acc, slot) => {
    if (!slot || slot.isConsumed) {
      return acc;
    }

    const relicTotal = slot.relic.effects.reduce((sum, effect) => {
      if (effect.type !== 'san-damage-reduction') {
        return sum;
      }

      return sum + effect.ratio;
    }, 0);

    return acc + relicTotal;
  }, 0);

  return toRatio(Math.min(0.8, total));
}

/**
 * 把「遗物减伤 + 出身易伤」折算成实际生效的属性增减。
 *
 * 顺序固定：先乘易伤倍率，再乘减伤，最后四舍五入。
 * 顺序固定是为了让同一份输入在任何调用点都得到同一个结果（可复盘）。
 */
export function resolveStatDeltas(
  deltas: Partial<Record<TargetStat, number>>,
  sanReduction: number,
  sanDamageMultiplier: number,
): Partial<Record<TargetStat, number>> {
  const rawSan = deltas.san ?? 0;
  const scaled = rawSan < 0 ? rawSan * sanDamageMultiplier : rawSan;
  const san = scaled < 0 ? Math.round(scaled * (1 - sanReduction)) : scaled;

  return { ...deltas, san };
}

export interface CheckModifierTotals {
  readonly passive: number;
  readonly active: number;
  readonly appliedIds: readonly string[];
}

/**
 * 汇总本次检定可用的遗物修正。
 *
 * - 被动遗物只要在栏中且未被消耗即生效（I-09：被动不进 activatedIds）。
 * - 主动遗物只有出现在 activatedIds 时才生效，且按遗物粒度至多计入一次。
 */
export function collectCheckModifiers(
  inventory: RelicInventory,
  targetStat: TargetStat,
  activatedIds: readonly string[],
): CheckModifierTotals {
  let passive = 0;
  let active = 0;
  const appliedIds: string[] = [];

  inventory.forEach((slot) => {
    if (!slot || slot.isConsumed) {
      return;
    }

    const isActivated = activatedIds.includes(slot.relic.id);
    if (slot.relic.kind === 'active' && !isActivated) {
      return;
    }

    if (slot.relic.kind === 'passive' && isActivated) {
      return;
    }

    slot.relic.effects.forEach((effect) => {
      if (effect.type === 'check-modifier' && effect.targetStat === targetStat) {
        passive += effect.modifier;
        if (!appliedIds.includes(slot.relic.id)) {
          appliedIds.push(slot.relic.id);
        }
      }

      if (
        effect.type === 'next-check-modifier' &&
        isActivated &&
        (!effect.targetStat || effect.targetStat === targetStat)
      ) {
        active += effect.modifier;
        if (!appliedIds.includes(slot.relic.id)) {
          appliedIds.push(slot.relic.id);
        }
      }
    });
  });

  return { passive, active, appliedIds };
}
