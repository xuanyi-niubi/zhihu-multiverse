import type { ActionSpace, UnknownLockPayload } from '@/features/game-mechanics/domain';
import { lockAction } from '@/features/game-mechanics/actionSpace';
import type { UnknownVariable } from '@/features/experience/domain';

/**
 * UNKNOWN LOCK（§11-§12 / §48 / §58 / §80）。
 *
 * ## 把「模型不知道」从缺陷变成玩法
 *
 * 系统明确承认「这里 AI 无法继续判断」，然后把一条 Action / Worldline
 * 标记为 UNKNOWN LOCK：
 *
 * ```text
 * 这条世界线是否成立，取决于一个你现在还不知道的事实。
 * → 需要现实验证
 * ```
 *
 * 玩家因此不会觉得「AI 不够聪明」，而会觉得「这件事只能我自己去现实确认」。
 *
 * ## 禁止猜答案
 *
 * 这个模块只消费现有 `keyUnknown` / `UnknownVariable`，
 * **绝不用模型猜 unknown 的答案**。
 */

export interface UnknownLockCandidate {
  readonly unknownId: string;
  readonly unknownLabel: string;
  readonly affectsActionIds: readonly string[];
  readonly explanation: string;
}

/**
 * 未知 → 世界线锁定。
 *
 * unknown 存在即成立（世界线可以整体锁住）；如果同时能指向具体行动，
 * 就一并锁住那条行动。`affectsActionIds` 由调用方提供，本模块不发明。
 */
export function unknownLockCandidate(input: {
  readonly unknown: UnknownVariable;
  readonly affectsActionIds?: readonly string[];
}): UnknownLockCandidate {
  const affects = [...new Set(input.affectsActionIds ?? [])].sort();
  return {
    unknownId: input.unknown.id,
    unknownLabel: input.unknown.label,
    affectsActionIds: affects,
    explanation: `这条世界线还不能确认：你现在还不知道「${input.unknown.label}」。${input.unknown.whyItMatters} 留到现实验证。`,
  };
}

/** 把未知锁落进行动空间（只锁行动，不改数值）。 */
export function applyUnknownLock(space: ActionSpace, candidate: UnknownLockCandidate): ActionSpace {
  let next = space;
  for (const actionId of candidate.affectsActionIds) {
    next = lockAction(next, actionId, 'unknown_variable', candidate.explanation, {
      unknownId: candidate.unknownId,
    });
  }
  return next;
}

/**
 * 现实回填后解除锁定（§58 / §2）。
 *
 * 未来支持「用户回到现实做了验证」时，同一个 unknownId 解除锁定。
 */
export function releaseUnknownLock(space: ActionSpace, unknownId: string): ActionSpace {
  const stillLocked = space.locked.filter(
    (locked) => !(locked.reason === 'unknown_variable' && locked.unknownId === unknownId),
  );
  const released = space.locked
    .filter((locked) => locked.reason === 'unknown_variable' && locked.unknownId === unknownId)
    .map((locked) => locked.action);

  return {
    ...space,
    available: [...space.available, ...released].sort((left, right) => left.id.localeCompare(right.id)),
    locked: stillLocked,
  };
}

/** 便捷：未知锁候选 → Encounter payload。 */
export function unknownLockPayload(candidate: UnknownLockCandidate): UnknownLockPayload {
  return {
    kind: 'unknown_lock',
    unknownId: candidate.unknownId,
    unknownLabel: candidate.unknownLabel,
    affectsActionIds: candidate.affectsActionIds,
    explanation: candidate.explanation,
  };
}
