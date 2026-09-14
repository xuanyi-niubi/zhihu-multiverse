import { describe, expect, it } from 'vitest';

import {
  buildActionSpace,
  getActionsByState,
  getAuditActions,
  getSelectableActions,
  getVisibleActions,
  lockAction,
  removeAction,
  restoreAction,
  unlockAction,
} from '@/features/game-mechanics/actionSpace';
import type { PlayAction } from '@/features/game-mechanics/domain';

/**
 * Action Space 纯函数（§六）。
 *
 * 核心承诺：玩家的选择真的改变「他能做什么」——
 * 新增 / 移除 / 锁定 / 解锁，全部确定性、无随机。
 */

function action(id: string, overrides: Partial<PlayAction> = {}): PlayAction {
  return {
    id,
    label: `行动 ${id}`,
    state: 'available',
    origin: 'scenario',
    sourceFactIds: [],
    ...overrides,
  };
}

describe('buildActionSpace', () => {
  it('按 id 稳定排序，同输入必得同输出', () => {
    const build = () => buildActionSpace([action('c'), action('a'), action('b')]);
    expect(build().actions.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('duplicate id 不重复（保留第一个）', () => {
    const space = buildActionSpace([action('a', { label: '第一条' }), action('a', { label: '第二条' })]);
    expect(space.actions).toHaveLength(1);
    expect(space.actions[0]!.label).toBe('第一条');
  });

  it('overrides 可以覆盖同 id 的初始状态', () => {
    const space = buildActionSpace(
      [action('a')],
      [action('a', { state: 'locked', reason: '情境本身就不允许' })],
    );
    expect(space.actions).toHaveLength(1);
    expect(space.actions[0]!.state).toBe('locked');
  });

  it('immutable：不改入参', () => {
    const input = [action('a')];
    buildActionSpace(input);
    expect(input).toHaveLength(1);
    expect(input[0]!.state).toBe('available');
  });
});

describe('unlockAction', () => {
  it('解锁后进入 unlocked（可做，但来源是真实经验）', () => {
    const space = unlockAction(
      buildActionSpace([action('a')]),
      action('b', { origin: 'experience', sourceFactIds: ['act-1'] }),
    );
    expect(space.actions.find((item) => item.id === 'b')!.state).toBe('unlocked');
    expect(getSelectableActions(space).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('幂等：重复解锁同一条不产生重复项', () => {
    const once = unlockAction(buildActionSpace([action('a')]), action('b'));
    const twice = unlockAction(once, action('b'));
    expect(twice.actions).toHaveLength(2);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('scenario 来源的行动被经验解锁后标为 experience', () => {
    const space = unlockAction(buildActionSpace([action('a')]), action('a'));
    expect(space.actions[0]!.origin).toBe('experience');
  });
});

describe('lockAction', () => {
  it('锁住后仍可展示 reason', () => {
    const space = lockAction(buildActionSpace([action('a')]), 'a', '这条路暂时关闭：周末已经投进比赛项目。');
    const locked = getActionsByState(space, 'locked')[0]!;
    expect(locked.reason).toContain('这条路暂时关闭');
    expect(getVisibleActions(space).map((item) => item.id)).toEqual(['a']);
    expect(getSelectableActions(space)).toHaveLength(0);
  });

  it('找不到行动时原样返回（不锁一条不存在的世界线）', () => {
    const before = buildActionSpace([action('a')]);
    expect(lockAction(before, 'ghost', 'reason')).toBe(before);
  });

  it('幂等：已锁住时不被第二次 reason 覆盖', () => {
    const once = lockAction(buildActionSpace([action('a')]), 'a', '第一次原因');
    const twice = lockAction(once, 'a', '第二次原因');
    expect(getActionsByState(twice, 'locked')[0]!.reason).toBe('第一次原因');
  });
});

describe('removeAction', () => {
  it('移除后默认不展示给普通用户，但 ViewModel 可保留审计', () => {
    const space = removeAction(buildActionSpace([action('a'), action('b')]), 'b', '这条路真的关掉了。');
    expect(getVisibleActions(space).map((item) => item.id)).toEqual(['a']);
    expect(getAuditActions(space).map((item) => item.id)).toEqual(['a', 'b']);
    expect(getActionsByState(space, 'removed')[0]!.reason).toBe('这条路真的关掉了。');
  });

  it('幂等', () => {
    const once = removeAction(buildActionSpace([action('a')]), 'a', '原因');
    expect(JSON.stringify(removeAction(once, 'a', '原因'))).toBe(JSON.stringify(once));
  });
});

describe('restoreAction', () => {
  it('还原到被锁之前的状态与原因', () => {
    const locked = lockAction(buildActionSpace([action('a')]), 'a', '暂时关闭');
    const restored = restoreAction(locked, 'a');
    expect(restored.actions[0]!.state).toBe('available');
    expect(restored.actions[0]!.reason).toBeUndefined();
    expect(restored.restoreState).toBeUndefined();
  });

  it('本来就不在 locked / removed 时原样返回', () => {
    const before = buildActionSpace([action('a')]);
    expect(restoreAction(before, 'a')).toBe(before);
  });

  it('被移除的行动也能还原（现实回填）', () => {
    const removed = removeAction(
      unlockAction(buildActionSpace([action('a')]), action('b')),
      'b',
      '代价关闭',
    );
    const restored = restoreAction(removed, 'b');
    expect(restored.actions.find((item) => item.id === 'b')!.state).toBe('unlocked');
  });
});
