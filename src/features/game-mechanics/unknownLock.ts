import type { ActionSpace, UnknownLock } from '@/features/game-mechanics/domain';
import { lockAction, restoreAction } from '@/features/game-mechanics/actionSpace';
import type { UnknownVariable } from '@/features/experience/domain';

/**
 * UNKNOWN LOCK：把「模型不知道」从缺陷变成玩法（§十五-§十六）。
 *
 * ## 它不是 error
 *
 * 它表示：**这里 AI 已经没有可靠现实信息继续判断。**
 * 最终 UI 会显示 `REALITY REQUIRED`。
 *
 * ## 来源唯一
 *
 * 只来自 `WorldBlueprint.keyUnknown`。没有 `keyUnknown` → **不生成**。
 * 这个模块**绝不猜** unknown 的答案。
 */

/**
 * keyUnknown → 世界线锁定（§十五）。
 *
 * `relatedActionIds` 由调用方给出（哪些行动被这条未知卡住）；
 * 给不出来就是空数组 —— 那表示锁的是整条世界线，而不是某条具体行动。
 */
export function unknownLockFromKey(input: {
  readonly keyUnknown: UnknownVariable | null;
  readonly relatedActionIds?: readonly string[];
}): UnknownLock | null {
  if (!input.keyUnknown) {
    return null;
  }
  const related = [...new Set(input.relatedActionIds ?? [])]
    .filter((id) => id.length > 0)
    .sort();

  return {
    id: `unknown-lock-${input.keyUnknown.id}`,
    label: input.keyUnknown.label,
    relatedActionIds: related,
    realityRequired: true,
  };
}

/** 把未知锁落进行动空间（只锁行动，不扣任何数值）。 */
export function applyUnknownLock(
  space: ActionSpace,
  lock: UnknownLock,
  reason?: string,
): ActionSpace {
  const explanation =
    reason ??
    `这条世界线还不能确认：你现在还不知道「${lock.label}」。留到现实验证（REALITY REQUIRED）。`;
  let next = space;
  for (const actionId of lock.relatedActionIds) {
    next = lockAction(next, actionId, explanation);
  }
  return next;
}

/**
 * 现实回填后解除锁定（§十六）。
 *
 * 玩家回到现实做了验证之后，对应的未知被消掉，被它锁住的行动还原到
 * 锁定之前的状态与原因。
 */
export function releaseUnknownLock(space: ActionSpace, lock: UnknownLock): ActionSpace {
  let next = space;
  for (const actionId of lock.relatedActionIds) {
    next = restoreAction(next, actionId);
  }
  return next;
}

/** 声明式 UI 文案：这个未知需要玩家回到现实才能继续。 */
export function realityRequiredLabel(lock: UnknownLock): string {
  return `REALITY REQUIRED · ${lock.label}`;
}
