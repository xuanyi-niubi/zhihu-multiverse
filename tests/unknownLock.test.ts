import { describe, expect, it } from 'vitest';

import {
  applyUnknownLock,
  realityRequiredLabel,
  releaseUnknownLock,
  unknownLockFromKey,
} from '@/features/game-mechanics/unknownLock';
import {
  buildActionSpace,
  getActionsByState,
  getSelectableActions,
  getVisibleActions,
} from '@/features/game-mechanics/actionSpace';
import { unknownViewOf } from '@/features/game-mechanics/view';
import type { PlayAction } from '@/features/game-mechanics/domain';
import type { UnknownVariable } from '@/features/experience/domain';

/**
 * UNKNOWN LOCK（§十五-§十六 / §二十五）。
 *
 * ```text
 * 无 unknown → no unknown lock
 * ```
 *
 * 它不是 error，而是「这里 AI 已经没有可靠现实信息继续判断」。
 */

const keyUnknown: UnknownVariable = {
  id: 'unknown-hours',
  label: '每周能否稳定投入 8 小时',
  whyItMatters: '它直接决定高强度比赛这条路是否成立。',
  kind: 'time-capacity',
  origin: 'missing-user-context',
  priority: 1,
};

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

describe('unknownLockFromKey', () => {
  it('keyUnknown 存在即生成（realityRequired 恒为 true）', () => {
    const lock = unknownLockFromKey({ keyUnknown, relatedActionIds: ['action-比赛'] });
    expect(lock).not.toBeNull();
    expect(lock!.id).toBe('unknown-lock-unknown-hours');
    expect(lock!.label).toBe('每周能否稳定投入 8 小时');
    expect(lock!.relatedActionIds).toEqual(['action-比赛']);
    expect(lock!.realityRequired).toBe(true);
  });

  it('无 unknown → no unknown lock', () => {
    expect(unknownLockFromKey({ keyUnknown: null })).toBeNull();
  });

  it('给不出具体行动时锁整条世界线（relatedActionIds 为空）', () => {
    const lock = unknownLockFromKey({ keyUnknown });
    expect(lock!.relatedActionIds).toEqual([]);
  });
});

describe('applyUnknownLock / releaseUnknownLock', () => {
  it('锁定后行动不可选，但仍可见（看得见才谈得上现实验证）', () => {
    const space = buildActionSpace([action('action-比赛'), action('action-退课')]);
    const lock = unknownLockFromKey({ keyUnknown, relatedActionIds: ['action-比赛'] })!;
    const next = applyUnknownLock(space, lock);

    expect(getSelectableActions(next).map((item) => item.id)).toEqual(['action-退课']);
    expect(getVisibleActions(next).map((item) => item.id)).toEqual(['action-比赛', 'action-退课']);
    expect(getActionsByState(next, 'locked')[0]!.reason).toContain('现实验证');
  });

  it('现实回填后还原到锁定之前的状态', () => {
    const space = buildActionSpace([action('action-比赛')]);
    const lock = unknownLockFromKey({ keyUnknown, relatedActionIds: ['action-比赛'] })!;
    const restored = releaseUnknownLock(applyUnknownLock(space, lock), lock);
    expect(restored.actions[0]!.state).toBe('available');
    expect(restored.actions[0]!.reason).toBeUndefined();
  });

  it('没有相关行动时锁定本身仍然成立（世界线级）', () => {
    const before = buildActionSpace([action('action-比赛')]);
    const lock = unknownLockFromKey({ keyUnknown })!;
    const next = applyUnknownLock(before, lock);
    expect(next.actions).toHaveLength(1);
    expect(next.actions[0]!.state).toBe('available');
  });

  it('幂等：重复施加同一把锁结果不变', () => {
    const space = buildActionSpace([action('action-比赛')]);
    const lock = unknownLockFromKey({ keyUnknown, relatedActionIds: ['action-比赛'] })!;
    const once = applyUnknownLock(space, lock);
    expect(JSON.stringify(applyUnknownLock(once, lock))).toBe(JSON.stringify(once));
  });
});

describe('给 UI 的最小形状', () => {
  it('unknownViewOf 只给 id 与 label', () => {
    const lock = unknownLockFromKey({ keyUnknown })!;
    expect(unknownViewOf(lock)).toEqual({ id: 'unknown-lock-unknown-hours', label: '每周能否稳定投入 8 小时' });
  });

  it('realityRequiredLabel 明确标出 REALITY REQUIRED', () => {
    const lock = unknownLockFromKey({ keyUnknown })!;
    expect(realityRequiredLabel(lock)).toContain('REALITY REQUIRED');
  });
});
