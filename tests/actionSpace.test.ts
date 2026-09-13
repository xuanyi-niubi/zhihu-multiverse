import { describe, expect, it } from 'vitest';

import {
  applyConditionShift,
  buildInitialActionSpace,
  findAction,
  lockAction,
  missingConditionKeys,
  removeAction,
  unlockAction,
} from '@/features/game-mechanics/actionSpace';
import type { ActionOption } from '@/features/game-mechanics/domain';

/**
 * Action Space 纯函数（§62 / §75）。
 *
 * 核心承诺：玩家的选择真的改变「他能做什么」——
 * 新增 / 移除 / 锁定 / 解锁，全部确定性、无随机。
 */

function action(id: string, overrides: Partial<ActionOption> = {}): ActionOption {
  return {
    id,
    label: `行动 ${id}`,
    source: 'user',
    sourceFactIds: [],
    requirements: [],
    ...overrides,
  };
}

describe('buildInitialActionSpace', () => {
  it('无需求条件的行动直接可用', () => {
    const space = buildInitialActionSpace([action('a'), action('b')]);
    expect(space.available.map((item) => item.id)).toEqual(['a', 'b']);
    expect(space.locked).toHaveLength(0);
  });

  it('缺条件 → 锁定，并给出人话解释（不做隐藏惩罚）', () => {
    const space = buildInitialActionSpace([
      action('a', { requirements: [{ key: 'team', description: '一个固定队友' }] }),
    ]);
    expect(space.available).toHaveLength(0);
    expect(space.locked[0]!.reason).toBe('missing_condition');
    expect(space.locked[0]!.conditionKey).toBe('team');
    expect(space.locked[0]!.explanation).toContain('固定队友');
  });

  it('已满足条件 → 可用', () => {
    const space = buildInitialActionSpace(
      [action('a', { requirements: [{ key: 'team' }] })],
      ['team'],
    );
    expect(space.available.map((item) => item.id)).toEqual(['a']);
  });

  it('稳定排序：同输入必得同输出', () => {
    const build = () => buildInitialActionSpace([action('c'), action('a'), action('b')]);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    expect(build().available.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('unlockAction（PATH UNLOCK 的落地，§35）', () => {
  it('新增行动进入 available + unlocked，并记录来源', () => {
    const base = buildInitialActionSpace([action('a')]);
    const unlocked = action('x', { source: 'experience', sourceFactIds: ['fact:1'] });
    const next = unlockAction(base, unlocked, { sourceFactIds: ['fact:1'], encounterId: 'e1' });
    expect(next.available.map((item) => item.id).sort()).toEqual(['a', 'x']);
    expect(next.unlocked).toHaveLength(1);
    expect(next.unlocked[0]!.sourceFactIds).toEqual(['fact:1']);
    expect(next.unlocked[0]!.encounterId).toBe('e1');
  });

  it('重复解锁不会产生两条', () => {
    const base = buildInitialActionSpace([]);
    const unlocked = action('x', { source: 'experience' });
    const once = unlockAction(base, unlocked, { sourceFactIds: ['f1'] });
    const twice = unlockAction(once, unlocked, { sourceFactIds: ['f1'] });
    expect(twice.unlocked).toHaveLength(1);
    expect(twice.available).toHaveLength(1);
  });
});

describe('lockAction / removeAction', () => {
  it('锁定把行动移出可用并给出理由', () => {
    const space = buildInitialActionSpace([action('a')]);
    const next = lockAction(space, 'a', 'opportunity_cost', '你把时间用在了别处。');
    expect(next.available).toHaveLength(0);
    expect(next.locked[0]!.reason).toBe('opportunity_cost');
    expect(next.locked[0]!.explanation).toBe('你把时间用在了别处。');
  });

  it('移除把行动放进 removed，不扣任何数值', () => {
    const space = buildInitialActionSpace([action('a')]);
    const next = removeAction(space, 'a', '这周的时间已经花掉了。');
    expect(next.available).toHaveLength(0);
    expect(next.removed[0]!.action.id).toBe('a');
    expect(next.removed[0]!.explanation).toContain('时间');
  });

  it('锁 / 移除不存在的行动是 no-op（不发明世界线）', () => {
    const space = buildInitialActionSpace([action('a')]);
    expect(lockAction(space, 'ghost', 'opportunity_cost', 'x')).toBe(space);
    expect(removeAction(space, 'ghost', 'x')).toBe(space);
    expect(findAction(space, 'ghost')).toBeNull();
  });
});

describe('applyConditionShift', () => {
  it('借用条件只解锁 missing_condition，不影响代价锁定', () => {
    let space = buildInitialActionSpace([
      action('cond', { requirements: [{ key: 'team' }] }),
      action('plain'),
    ]);
    space = lockAction(space, 'plain', 'opportunity_cost', '时间已经花掉');
    const next = applyConditionShift(space, ['team']);
    expect(next.available.map((item) => item.id)).toEqual(['cond']);
    expect(next.locked.map((item) => item.action.id)).toEqual(['plain']);
  });

  it('missingConditionKeys 去重且稳定', () => {
    const space = buildInitialActionSpace([
      action('a', { requirements: [{ key: 'team' }] }),
      action('b', { requirements: [{ key: 'time' }] }),
      action('c', { requirements: [{ key: 'team' }] }),
    ]);
    expect(missingConditionKeys(space)).toEqual(['team', 'time']);
  });
});
