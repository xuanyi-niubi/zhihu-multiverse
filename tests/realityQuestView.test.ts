import { describe, expect, it } from 'vitest';

import { realityQuestViewOf } from '@/features/game-world/questView';

import type { RealityExperiment } from '@/features/decision-session/domain';
import type { WorldActSpec, WorldBlueprint } from '@/features/game-world/domain';

/**
 * 终局现实支线的视图模型（P1-2）。
 *
 * 两条纪律在这里被钉住：
 * 1. 「这一局你重新看见了什么」只能来自本局真实发生过的事；
 * 2. 没有实验就不给承诺候选 —— 认下的必须是有停止信号的验证。
 */

function act(overrides: Partial<WorldActSpec>): WorldActSpec {
  return {
    act: 1,
    objective: 'enter-world',
    titleHint: '进入',
    conflict: 'c',
    primaryPathIds: [],
    experienceFactIds: [],
    unlockIds: [],
    ...overrides,
  };
}

const ACTS: readonly WorldActSpec[] = [
  act({ act: 1, objective: 'enter-world', experienceFactIds: ['f1'] }),
  act({ act: 2, objective: 'experience-cost', experienceFactIds: ['f2'] }),
  act({ act: 3, objective: 'meet-counterexample', experienceFactIds: ['f3'] }),
  act({ act: 4, objective: 'final-reflection' }),
];

function blueprint(overrides: Partial<WorldBlueprint> = {}): WorldBlueprint {
  return {
    version: 'world-blueprint-v1',
    sessionId: 'sess-1',
    problemFrame: {
      rawQuestion: '大二想参加比赛',
      currentSituation: '大二',
      desiredChange: '参加比赛',
      constraints: [],
      resources: [],
      concerns: [],
      centralTension: '想积累 vs 时间少',
      unknowns: [],
      parseConfidence: 0.4,
    },
    centralTension: '想积累 vs 时间少',
    paths: [
      {
        id: 'path-1',
        label: '直接报名，边做边学',
        summary: 's',
        supportingCaseIds: [],
        opposingCaseIds: [],
        supportingFactIds: [],
        opposingFactIds: [],
        observedConditions: [],
        observedActions: [],
        observedCosts: [],
        observedOutcomes: [],
        differencesFromUser: [],
        unknowns: [],
        origin: 'model-clustered',
      },
    ],
    keyUnknown: {
      id: 'unknown-time',
      label: '你未来两周能稳定拿出多少时间',
      whyItMatters: '它决定实验做多大',
      origin: 'missing-user-context',
      priority: 1,
    },
    acts: ACTS,
    experienceFacts: [],
    unlocks: [
      {
        id: 'unlock-path-1',
        label: '先做小样',
        description: '先做一个小样再决定',
        sourceFactIds: ['f1'],
        choice: { text: '先做 48 小时小样', hint: 'h' },
        availableFromAct: 2,
      },
    ],
    forbiddenClaims: ['不得宣称成功概率'],
    ...overrides,
  };
}

const EXPERIMENT: RealityExperiment = {
  hypothesis: 'h',
  action: '连续 7 天记录真实投入',
  timebox: '7 天，每天约 2 分钟记录',
  artifact: '一份记录',
  successSignal: '中位数达到你心里那条线',
  stopSignal: '如果它开始影响课程，立刻停下。',
  reducesUnknown: '你未来两周能稳定拿出多少时间',
};

describe('没有蓝图 → 不渲染（legacy 终局零变化）', () => {
  it('blueprint 为 null 时返回 null', () => {
    expect(
      realityQuestViewOf({ sessionId: 's1', blueprint: null, experiment: null, usedUnlockIds: [] }),
    ).toBeNull();
  });

  it('blueprint 为 undefined 时返回 null', () => {
    expect(
      realityQuestViewOf({ sessionId: 's1', blueprint: undefined, experiment: null, usedUnlockIds: [] }),
    ).toBeNull();
  });
});

describe('回顾条目只来自本局真实发生过的事', () => {
  it('真实走法 + 真的撞见反例 → 两条都出现', () => {
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(view.seen[0]).toContain('有人真的这样走过');
    expect(view.seen[0]).toContain('直接报名，边做边学');
    expect(view.seen.some((item) => item.includes('撞见了他们'))).toBe(true);
  });

  it('反例幕没有证据时不写「撞见了反例」', () => {
    const noCounter = blueprint({
      acts: ACTS.map((item) =>
        item.act === 3 ? { ...item, experienceFactIds: [] } : item,
      ),
    });
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: noCounter,
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(view.seen.some((item) => item.includes('撞见了他们'))).toBe(false);
  });

  it('真的选过经验解锁 → 出现第三条；没选过就不出现', () => {
    const used = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: ['unlock-path-1'],
    })!;
    expect(used.seen.some((item) => item.includes('原本不存在的做法'))).toBe(true);

    const unused = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(unused.seen.some((item) => item.includes('原本不存在的做法'))).toBe(false);
  });

  it('最多三条，且不编没有出处的条目', () => {
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: ['unlock-path-1'],
    })!;
    expect(view.seen.length).toBeLessThanOrEqual(3);
    for (const item of view.seen) {
      expect(item).not.toMatch(/%|成功率|匹配度|推荐/);
    }
  });

  it('空蓝图（没有路径、没有事实、没有解锁）→ 回顾为空，而不是硬凑', () => {
    const empty = blueprint({
      paths: [],
      unlocks: [],
      acts: ACTS.map((item) => ({ ...item, experienceFactIds: [] })),
    });
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: empty,
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(view.seen).toHaveLength(0);
  });
});

describe('承诺候选：没有实验就不给按钮', () => {
  it('有实验 → 候选带动作 / 时间盒 / 成功信号 / 停止信号', () => {
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: EXPERIMENT,
      usedUnlockIds: [],
    })!;
    expect(view.candidate).not.toBeNull();
    expect(view.candidate!.id).toBe('reality-quest:sess-1');
    expect(view.candidate!.action).toBe(EXPERIMENT.action);
    expect(view.candidate!.timeBox).toBe(EXPERIMENT.timebox);
    expect(view.candidate!.signal).toBe(EXPERIMENT.successSignal);
    // verifyHint 用停止信号：认下时就要知道什么时候该停
    expect(view.candidate!.verifyHint).toBe(EXPERIMENT.stopSignal);
  });

  it('没有实验 → candidate 为 null，但给出回去设计的入口', () => {
    const view = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(view.candidate).toBeNull();
    expect(view.designHref).toBe('/session/sess-1');
  });

  it('keyUnknown 原样带出（没有时就 null，不编一个问题）', () => {
    const withUnknown = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint(),
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(withUnknown.keyUnknown).toBe('你未来两周能稳定拿出多少时间');

    const withoutUnknown = realityQuestViewOf({
      sessionId: 'sess-1',
      blueprint: blueprint({ keyUnknown: null }),
      experiment: null,
      usedUnlockIds: [],
    })!;
    expect(withoutUnknown.keyUnknown).toBeNull();
  });
});
