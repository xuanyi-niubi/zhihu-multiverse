import type {
  ActionOption,
  ActionSpace,
  LockReason,
  LockedAction,
  RemovedAction,
  UnlockedAction,
} from '@/features/game-mechanics/domain';

/**
 * Action Space 的确定性转移（§62 / §75）。
 *
 * 全部是纯函数：无 React、无 API、无 AI、无 UI、无随机。
 * 同样的输入必然得到同样的行动空间 —— 这让「玩家选择真的改变了
 * 他能做什么」这件事可断言、可复现。
 */

/** 稳定排序：id 升序，保证同输入必得同输出。 */
function byActionId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function sortOptions(actions: readonly ActionOption[]): ActionOption[] {
  return [...actions].sort(byActionId);
}

function meetsRequirements(action: ActionOption, satisfied: ReadonlySet<string>): boolean {
  return action.requirements.every((requirement) => satisfied.has(requirement.key));
}

function firstMissing(
  action: ActionOption,
  satisfied: ReadonlySet<string>,
): { readonly key: string; readonly description?: string } | null {
  return action.requirements.find((requirement) => !satisfied.has(requirement.key)) ?? null;
}

function conditionExplanation(requirement: { readonly key: string; readonly description?: string }): string {
  return requirement.description
    ? `这条路还缺一个条件：${requirement.description}。`
    : `这条路还缺一个条件：${requirement.key}。`;
}

/** 从空间里找到某条行动（available / locked / unlocked / removed 都找）。 */
export function findAction(space: ActionSpace, actionId: string): ActionOption | null {
  const inAvailable = space.available.find((action) => action.id === actionId);
  if (inAvailable) {
    return inAvailable;
  }
  const inLocked = space.locked.find((locked) => locked.action.id === actionId);
  if (inLocked) {
    return inLocked.action;
  }
  const inUnlocked = space.unlocked.find((unlocked) => unlocked.action.id === actionId);
  if (inUnlocked) {
    return inUnlocked.action;
  }
  const inRemoved = space.removed.find((removed) => removed.action.id === actionId);
  return inRemoved?.action ?? null;
}

/** 把某条行动从所有列表里移除，得到一个干净的基底。 */
function dropAction(space: ActionSpace, actionId: string): ActionSpace {
  return {
    available: space.available.filter((action) => action.id !== actionId),
    locked: space.locked.filter((locked) => locked.action.id !== actionId),
    unlocked: space.unlocked.filter((unlocked) => unlocked.action.id !== actionId),
    removed: space.removed.filter((removed) => removed.action.id !== actionId),
  };
}

/**
 * 构建初始行动空间（§62）。
 *
 * 没有满足需求条件的行动进入 `available`，其余进入 `locked`
 * （reason = `missing_condition`）—— 缺条件必须**说出来**，不能静静消失。
 */
export function buildInitialActionSpace(
  actions: readonly ActionOption[],
  satisfiedConditionKeys: readonly string[] = [],
): ActionSpace {
  const satisfied = new Set(satisfiedConditionKeys);
  const available: ActionOption[] = [];
  const locked: LockedAction[] = [];

  for (const action of sortOptions(actions)) {
    const missing = firstMissing(action, satisfied);
    if (!missing) {
      available.push(action);
      continue;
    }
    locked.push({
      action,
      reason: 'missing_condition',
      conditionKey: missing.key,
      explanation: conditionExplanation(missing),
    });
  }

  return { available, locked, unlocked: [], removed: [] };
}

/**
 * 解锁一条行动（§35 / §63）。
 *
 * 被真实经验解锁的行动**永远无检定**，并且进入 `available` ——
 * 原来的 `ExperienceChoiceUnlock` 在此被复用，而不是另造一套。
 */
export function unlockAction(
  space: ActionSpace,
  action: ActionOption,
  meta: { readonly sourceFactIds: readonly string[]; readonly encounterId?: string },
): ActionSpace {
  const base = dropAction(space, action.id);
  const unlocked: UnlockedAction = {
    action,
    unlockedBy: 'experience',
    sourceFactIds: [...meta.sourceFactIds],
    ...(meta.encounterId ? { encounterId: meta.encounterId } : {}),
  };
  return {
    available: sortOptions([...base.available, action]),
    locked: base.locked,
    unlocked: [...base.unlocked, unlocked].sort((left, right) => byActionId(left.action, right.action)),
    removed: base.removed,
  };
}

/**
 * 锁住一条行动。
 *
 * 找不到这条行动时**原样返回**：我们不能锁一个不存在的世界线。
 */
export function lockAction(
  space: ActionSpace,
  actionId: string,
  reason: LockReason,
  explanation: string,
  extra?: { readonly conditionKey?: string; readonly unknownId?: string },
): ActionSpace {
  const action = findAction(space, actionId);
  if (!action) {
    return space;
  }
  const base = dropAction(space, actionId);
  const locked: LockedAction = {
    action,
    reason,
    explanation,
    ...(extra?.conditionKey ? { conditionKey: extra.conditionKey } : {}),
    ...(extra?.unknownId ? { unknownId: extra.unknownId } : {}),
  };
  return {
    ...base,
    locked: [...base.locked, locked].sort((left, right) => byActionId(left.action, right.action)),
  };
}

/**
 * 移除一条行动（Opportunity Cost，§9 / §25）。
 *
 * 只改变「能不能做」，**不扣任何数值**。
 */
export function removeAction(space: ActionSpace, actionId: string, explanation: string): ActionSpace {
  const action = findAction(space, actionId);
  if (!action) {
    return space;
  }
  const base = dropAction(space, actionId);
  const removed: RemovedAction = { action, reason: 'opportunity_cost', explanation };
  return {
    ...base,
    removed: [...base.removed, removed].sort((left, right) => byActionId(left.action, right.action)),
  };
}

/**
 * 借用一组条件后重算可用性（§5 / §65）。
 *
 * 只有 `missing_condition` 且所有需求都被满足的行动才会回到 `available`；
 * 因未知（`unknown_variable`）或代价（`opportunity_cost`）锁住的行动
 * **不会**因为借条件而解锁。
 */
export function applyConditionShift(
  space: ActionSpace,
  adoptedConditionKeys: readonly string[],
): ActionSpace {
  const satisfied = new Set(adoptedConditionKeys);
  const stillLocked: LockedAction[] = [];
  const newlyAvailable: ActionOption[] = [];

  for (const locked of space.locked) {
    if (locked.reason === 'missing_condition' && meetsRequirements(locked.action, satisfied)) {
      newlyAvailable.push(locked.action);
      continue;
    }
    stillLocked.push(locked);
  }

  return {
    ...space,
    available: sortOptions([...space.available, ...newlyAvailable]),
    locked: stillLocked,
  };
}

/** 尚未满足的条件 key（去重、稳定排序）—— 供条件借用 UI 提示。 */
export function missingConditionKeys(space: ActionSpace): readonly string[] {
  const keys = new Set<string>();
  for (const locked of space.locked) {
    if (locked.reason === 'missing_condition' && locked.conditionKey) {
      keys.add(locked.conditionKey);
    }
  }
  return [...keys].sort();
}
