import { describe, expect, it } from 'vitest';

import type { RealityExperiment } from '@/features/decision-session/domain';
import {
  realityPassViewOf,
  sessionEndgameViewOf,
} from '@/components/game/session/viewModel';
import type { SessionExperienceView } from '@/components/game/session/types';

/**
 * 终局视图的契约（Agent 03 §十九 - §二十二 / §二十八）。
 *
 * ```text
 * endgame 用 original question        —— 原问题不被模型润色覆盖
 * Reality Quest 用真实 timebox        —— 不写死「未来 7 天」
 * ```
 */

const EXPERIMENT: RealityExperiment = {
  hypothesis: '如果我能连续两周稳定投入，就说明这件事排得进我的生活。',
  action: '接下来两周每天用 40 分钟做一个最小项目。',
  timebox: '接下来 2 周，每天 40 分钟',
  artifact: '一个可以给人看的 demo 仓库',
  successSignal: '两周里有 10 天真的做到了',
  stopSignal: '连续 4 天做不到就停下来重新安排',
  reducesUnknown: '我能不能稳定投入',
};

const EXPERIENCES: readonly SessionExperienceView[] = [
  {
    id: 'case-a',
    title: '先验证，再下注',
    author: '甲',
    sourceUrl: 'https://www.zhihu.com/answer/a',
    summary: '我先做了一个最小项目。',
  },
];

function view(overrides: Partial<Parameters<typeof sessionEndgameViewOf>[0]> = {}) {
  return sessionEndgameViewOf({
    originalQuestion: '我大二，想参加比赛，但怕课程跟不上。',
    keyUnknown: '我能不能连续两周每天稳定投入两小时',
    experiment: EXPERIMENT,
    steps: ['先做一个小项目'],
    unlockedActions: ['先验证，再下注'],
    highlights: ['有人真的这样走过：先验证，再下注'],
    experiences: EXPERIENCES,
    ...overrides,
  });
}

describe('原问题：只能来自 DecisionSession（§二十）', () => {
  it('逐字保留，不做 trim、不做润色', () => {
    const original = '我大二，想参加比赛，但怕课程跟不上。';
    expect(view().originalQuestion).toBe(original);
  });

  it('绝不用重写后的问题覆盖原问题', () => {
    const result = view();
    expect(result.originalQuestion).not.toBe(result.rewrittenQuestion);
    expect(result.originalQuestion).toContain('比赛');
  });
});

describe('新问题：只能来自 keyUnknown（§二十一）', () => {
  it('有 keyUnknown 时原样使用', () => {
    expect(view().rewrittenQuestion).toBe('我能不能连续两周每天稳定投入两小时');
  });

  it('没有 keyUnknown 时诚实地是 null，不编一个问题', () => {
    expect(view({ keyUnknown: null }).rewrittenQuestion).toBeNull();
    expect(view({ keyUnknown: '   ' }).rewrittenQuestion).toBeNull();
  });

  it('不会凭空加数字来显得更精确', () => {
    const generated = view({ keyUnknown: null }).rewrittenQuestion;
    expect(generated).toBeNull();
    // 重写后的问题里不该出现我们没被给过的量化条件
    expect(view().rewrittenQuestion).not.toMatch(/成功率|匹配度|预计/);
  });
});

describe('五块结构：顺序就是字段顺序（§十九）', () => {
  it('原问题 → 新问题 → 多看见的行动 → 经验回顾 → Reality Pass', () => {
    expect(Object.keys(view())).toEqual([
      'originalQuestion',
      'rewrittenQuestion',
      'steps',
      'unlockedActions',
      'highlights',
      'experiences',
      'realityPass',
    ]);
  });

  it('不给任何判定数字', () => {
    const serialized = JSON.stringify(view());
    expect(serialized).not.toMatch(/score|rating|winRate|成功率|匹配度|百分比/);
  });
});

describe('Reality Pass：用真实 timebox（§二十二）', () => {
  it('timebox 逐字来自 experiment，不写死「未来 7 天」', () => {
    const pass = view().realityPass;
    expect(pass).not.toBeNull();
    expect(pass!.timebox).toBe(EXPERIMENT.timebox);
    expect(pass!.timebox).not.toContain('7 天');
  });

  it('只给 timebox / action / 信号；会留下什么与停止信号仍原样带着（由 UI 折叠）', () => {
    const pass = realityPassViewOf(EXPERIMENT);
    expect(pass).toEqual({
      timebox: EXPERIMENT.timebox,
      action: EXPERIMENT.action,
      artifact: EXPERIMENT.artifact,
      successSignal: EXPERIMENT.successSignal,
      stopSignal: EXPERIMENT.stopSignal,
    });
  });

  it('没有实验时不编一个计划', () => {
    expect(view({ experiment: null }).realityPass).toBeNull();
    expect(realityPassViewOf(null)).toBeNull();
  });

  it('时间盒出现别的量级时同样成立（不假设一定是「天」）', () => {
    const pass = realityPassViewOf({ ...EXPERIMENT, timebox: '这个周末的 3 个小时' });
    expect(pass!.timebox).toBe('这个周末的 3 个小时');
  });
});

describe('真实经验回顾：没有就诚实为空（§十九 第 4 项）', () => {
  it('保留经验标题、作者与摘要原话', () => {
    const result = view();
    expect(result.experiences.map((item) => item.id)).toEqual(['case-a']);
    expect(result.experiences[0]!.summary).toBe('我先做了一个最小项目。');
  });

  it('没有引用到经历时是空数组，不填一段编的', () => {
    expect(view({ experiences: [] }).experiences).toEqual([]);
  });
});
