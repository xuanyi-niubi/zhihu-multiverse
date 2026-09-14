import { describe, expect, it } from 'vitest';

import type { ActionSpace } from '@/features/game-mechanics/domain';
import { choiceViewsOf } from '@/components/game/session/viewModel';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';

/**
 * 选项视图的契约（Agent 03 §八 / §九 / §十 / §十一 / §二十八）。
 *
 * 这些断言锁的是**产品事实**，不是样式：
 *
 * ```text
 * 普通选项  只有 title / hint —— 不出现 check / DC / 骰面 / 属性
 * 解锁选项  必须有来源（来自真实经历）
 * 锁定选项  必须有原因，而且不可选
 * ```
 */

function choice(overrides: Partial<ScenarioChoice> & { id: string }): ScenarioChoice {
  return {
    text: `选项 ${overrides.id}`,
    ghostEchoStat: '这条路有人真实走过',
    onSuccess: { feedback: '', statDeltas: {} },
    ...overrides,
  } as ScenarioChoice;
}

function space(actions: ActionSpace['actions']): ActionSpace {
  return { actions };
}

describe('普通选项：只展示 title / description（§九）', () => {
  it('即使底层带 check / DC，也不会出现在视图里', () => {
    const raw = choice({
      id: 'c1',
      text: '先做一个小项目',
      hint: '用一周时间',
      // 底层 legacy 仍然带检定 —— 它绝不能进新主链的视图
      check: { targetStat: 'skill', difficulty: 18 },
    });

    const [view] = choiceViewsOf({ choices: [raw] });

    expect(view.state).toBe('available');
    expect(view.title).toBe('先做一个小项目');
    expect(view.description).toBe('用一周时间');
    // 整个对象里不允许出现任何判定字段
    expect(Object.keys(view).sort()).toEqual(['description', 'id', 'state', 'title']);
    expect(JSON.stringify(view)).not.toMatch(/difficulty|check|DC|dice|skill|san/i);
  });

  it('没有 hint 时不编一句描述', () => {
    const [view] = choiceViewsOf({ choices: [choice({ id: 'c2' })] });
    expect(view).not.toHaveProperty('description');
  });
});

describe('解锁选项：必须带来源（§十）', () => {
  it('experienceUnlockId 存在 → state=unlocked + sourceLabel + experienceId', () => {
    const raw = choice({
      id: 'choice-unlock-1',
      text: '先验证，再下注',
      experienceUnlockId: 'unlock-1',
      sourceFactIds: ['f1', 'f2'],
    });

    const [view] = choiceViewsOf({ choices: [raw] });

    expect(view.state).toBe('unlocked');
    expect(view.sourceLabel).toBe('来自真实经历');
    expect(view.experienceId).toBe('unlock-1');
    expect(view.sourceFactIds).toEqual(['f1', 'f2']);
  });

  it('Action Space 说是 unlocked 时同样成立（origin=experience）', () => {
    const raw = choice({ id: 'choice-2' });
    const [view] = choiceViewsOf({
      choices: [raw],
      actionSpace: space([
        {
          id: 'action-choice-2',
          label: '别人真的这样做过',
          state: 'unlocked',
          origin: 'experience',
          sourceFactIds: ['f9'],
        },
      ]),
    });

    expect(view.state).toBe('unlocked');
    expect(view.sourceLabel).toBe('来自真实经历');
  });

  it('解锁选项绝不静默降级成普通选项', () => {
    const [view] = choiceViewsOf({
      choices: [choice({ id: 'c3', experienceUnlockId: 'unlock-3' })],
    });
    expect(view.state).not.toBe('available');
    expect(view.sourceLabel).toBeTruthy();
  });
});

describe('锁定选项：必须有原因（§十一）', () => {
  it('Action Space 锁住它时，reason 原样成为 lockedReason', () => {
    const raw = choice({ id: 'c4', text: '本周末再投入一个项目' });
    const [view] = choiceViewsOf({
      choices: [raw],
      actionSpace: space([
        {
          id: 'action-c4',
          label: '本周末再投入一个项目',
          state: 'locked',
          origin: 'scenario',
          sourceFactIds: [],
          reason: '你已经把本周末投入到了当前项目。',
        },
      ]),
    });

    expect(view.state).toBe('locked');
    expect(view.lockedReason).toBe('你已经把本周末投入到了当前项目。');
    // 锁定的选项没有来源可言，也不会被当成解锁
    expect(view.sourceLabel).toBeUndefined();
  });

  it('锁住却没有给出原因时，也必须给一句人话（不是 disabled opacity-50）', () => {
    const [view] = choiceViewsOf({
      choices: [choice({ id: 'c5' })],
      actionSpace: space([
        { id: 'action-c5', label: '某条路', state: 'locked', origin: 'scenario', sourceFactIds: [] },
      ]),
    });

    expect(view.state).toBe('locked');
    expect(view.lockedReason && view.lockedReason.length).toBeGreaterThan(0);
  });

  it('removed 也不可做，同样要说明', () => {
    const [view] = choiceViewsOf({
      choices: [choice({ id: 'c6' })],
      actionSpace: space([
        {
          id: 'action-c6',
          label: '某条路',
          state: 'removed',
          origin: 'scenario',
          sourceFactIds: [],
          reason: '这条路的代价已经发生。',
        },
      ]),
    });

    expect(view.state).toBe('locked');
    expect(view.lockedReason).toBe('这条路的代价已经发生。');
  });
});
