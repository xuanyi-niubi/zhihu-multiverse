import type {
  ActionSpace,
  ActionState,
  PlayAction,
} from '@/features/game-mechanics/domain';

/**
 * Action Space 的确定性转移（§六）。
 *
 * 全部是纯函数：无 React、无 API、无 AI、无 UI、无随机。
 * 同样的输入必然得到同样的行动空间 —— 这让「玩家选择真的改变了
 * 他能做什么」这件事可断言、可复现。
 *
 * ## 四条纪律
 *
 * 1. **immutable**：任何函数都不改入参，只返回新对象；
 * 2. **幂等**：同一动作重复施加不产生重复项、不改变结果；
 * 3. **duplicate id 不重复**：同 id 只保留第一个；
 * 4. `locked` 仍可展示 `reason`；`removed` 默认不展示，但**保留在
 *    数组里供 ViewModel 审计**（所以「展示」与「存在」是两件事）。
 */

/** 稳定排序：id 升序，保证同输入必得同输出。 */
function byActionId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

/** 按 id 去重（保留第一个），再稳定排序。 */
function normalize(actions: readonly PlayAction[]): PlayAction[] {
  const seen = new Set<string>();
  const unique: PlayAction[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) {
      continue;
    }
    seen.add(action.id);
    unique.push(action);
  }
  return unique.sort(byActionId);
}

function findIndexById(space: ActionSpace, actionId: string): number {
  return space.actions.findIndex((action) => action.id === actionId);
}

/** 去掉某个 id 的还原记录（该行动回到了「正常」状态）。 */
function withoutRestore(
  space: ActionSpace,
  actionId: string,
): Pick<ActionSpace, 'restoreState' | 'restoreReason'> {
  const restoreState = { ...(space.restoreState ?? {}) };
  const restoreReason = { ...(space.restoreReason ?? {}) };
  delete restoreState[actionId];
  delete restoreReason[actionId];
  return {
    restoreState: Object.keys(restoreState).length > 0 ? restoreState : undefined,
    restoreReason: Object.keys(restoreReason).length > 0 ? restoreReason : undefined,
  };
}

/**
 * 构建初始行动空间（§六）。
 *
 * `overrides` 允许调用方直接给出某些行动的初始状态（例如情境本身
 * 已经锁掉的行动）。重复 id 只保留第一次出现的那个。
 */
export function buildActionSpace(
  actions: readonly PlayAction[],
  overrides: readonly PlayAction[] = [],
): ActionSpace {
  const byId = new Map<string, PlayAction>();
  for (const action of normalize(actions)) {
    byId.set(action.id, action);
  }
  for (const override of normalize(overrides)) {
    byId.set(override.id, override);
  }
  return { actions: normalize([...byId.values()]) };
}

/**
 * 解锁一条行动。
 *
 * 被真实经验解锁的行动进入 `available` 语义下的 `unlocked` 状态 ——
 * 它是**可以做的**，只是「来源是别人真实走过的路」。重复解锁同一条
 * 行动是**幂等**的，不产生重复项。
 */
export function unlockAction(space: ActionSpace, action: PlayAction): ActionSpace {
  const unlocked: PlayAction = {
    ...action,
    state: 'unlocked',
    origin: action.origin === 'scenario' ? 'experience' : action.origin,
  };
  const existing = findIndexById(space, action.id);
  if (existing >= 0 && space.actions[existing]!.state === 'unlocked') {
    return space;
  }

  const actions = existing >= 0
    ? [...space.actions.slice(0, existing), unlocked, ...space.actions.slice(existing + 1)]
    : [...space.actions, unlocked];

  return { actions: normalize(actions), ...withoutRestore(space, action.id) };
}

/**
 * 锁住一条行动（带**人话** reason）。
 *
 * 找不到这条行动时原样返回：我们不能锁一个不存在的世界线。
 * 已经处于 `locked` 时同样原样返回（幂等，不覆盖已有的解释）。
 */
export function lockAction(space: ActionSpace, actionId: string, reason: string): ActionSpace {
  const index = findIndexById(space, actionId);
  if (index < 0) {
    return space;
  }
  const action = space.actions[index]!;
  if (action.state === 'locked' || action.state === 'removed') {
    return space;
  }

  const next: PlayAction = { ...action, state: 'locked', reason };
  const actions = [...space.actions.slice(0, index), next, ...space.actions.slice(index + 1)];
  return {
    actions: normalize(actions),
    restoreState: { ...(space.restoreState ?? {}), [actionId]: action.state },
    restoreReason: { ...(space.restoreReason ?? {}), [actionId]: action.reason ?? '' },
  };
}

/**
 * 移除一条行动（真实机会成本）。
 *
 * 只改变「能不能做」，**不扣任何数值**。`removed` 的行动默认不展示
 * 给普通用户，但仍留在 `actions` 里供审计。
 */
export function removeAction(space: ActionSpace, actionId: string, reason: string): ActionSpace {
  const index = findIndexById(space, actionId);
  if (index < 0) {
    return space;
  }
  const action = space.actions[index]!;
  if (action.state === 'removed' || action.state === 'locked') {
    return space;
  }

  const next: PlayAction = { ...action, state: 'removed', reason };
  const actions = [...space.actions.slice(0, index), next, ...space.actions.slice(index + 1)];
  return {
    actions: normalize(actions),
    restoreState: { ...(space.restoreState ?? {}), [actionId]: action.state },
    restoreReason: { ...(space.restoreReason ?? {}), [actionId]: action.reason ?? '' },
  };
}

/**
 * 还原一条行动（现实回填后解除锁定，§十六）。
 *
 * 还原到它被锁 / 被移除**之前**的状态与原因（`restoreState` /
 * `restoreReason`）。没有还原记录、或本来就不在 locked / removed，
 * 都原样返回。
 */
export function restoreAction(space: ActionSpace, actionId: string): ActionSpace {
  const index = findIndexById(space, actionId);
  if (index < 0) {
    return space;
  }
  const action = space.actions[index]!;
  if (action.state !== 'locked' && action.state !== 'removed') {
    return space;
  }

  const state: ActionState = space.restoreState?.[actionId] ?? 'available';
  const restored: PlayAction = { ...action, state };
  const previousReason = space.restoreReason?.[actionId];
  if (previousReason !== undefined && previousReason.length > 0) {
    (restored as { reason?: string }).reason = previousReason;
  } else {
    delete (restored as { reason?: string }).reason;
  }

  const actions = [...space.actions.slice(0, index), restored, ...space.actions.slice(index + 1)];
  return { actions: normalize(actions), ...withoutRestore(space, actionId) };
}

/**
 * 可见行动：给普通用户看的列表（`removed` 不展示）。
 *
 * `locked` **在**这里 —— 它必须能显示「为什么现在做不了」，
 * 静静消失才是这个产品最不该做的事。
 */
export function getVisibleActions(space: ActionSpace): readonly PlayAction[] {
  return normalize(space.actions.filter((action) => action.state !== 'removed'));
}

/**
 * 可选择的行动：玩家当前真的能点的（`available` + `unlocked`）。
 *
 * `locked` 与 `removed` 都不在内 —— 前者看得见但点不了，后者默认不展示。
 */
export function getSelectableActions(space: ActionSpace): readonly PlayAction[] {
  return normalize(space.actions.filter(
    (action) => action.state === 'available' || action.state === 'unlocked',
  ));
}

/** 按状态取行动（ViewModel 与测试的公共查询口）。 */
export function getActionsByState(space: ActionSpace, state: ActionState): readonly PlayAction[] {
  return normalize(space.actions.filter((action) => action.state === state));
}

/** 审计视图：连 `removed` 也一起给出来（ViewModel 专用，不面向普通用户）。 */
export function getAuditActions(space: ActionSpace): readonly PlayAction[] {
  return normalize(space.actions);
}
