import { describe, expect, it } from 'vitest';

import { endgameAnswerOf } from '@/features/game-world/endgameAnswer';

import type { ExperienceFact, ProblemFrame } from '@/features/experience/domain';
import type { RealityExperiment } from '@/features/decision-session/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';

/**
 * 终局答案（P1-2 加强）。
 *
 * 这组测试守三条纪律：
 * 1. **每一句都有出处**：经历类内容必须是原文的连续前缀 + 答主 + 原文链接；
 * 2. **没有就不写**：拿不到可核验片段时如实留空，绝不写"你成长了"；
 * 3. **不给结论**：不出现成功率 / 匹配度 / 推荐分。
 */

const FRAME: ProblemFrame = {
  rawQuestion: '我是电工专业，想转行当导游',
  currentSituation: '电工专业',
  desiredChange: '转行当导游',
  constraints: [
    { id: 'c1', text: '每周只有 8 小时', origin: 'user-explicit', hard: true },
    { id: 'c2', text: '家里反对', origin: 'parser-synthesis', hard: false },
  ],
  resources: [],
  concerns: [],
  centralTension: '想转行 vs 时间少',
  unknowns: [{ id: 'u1', label: '你未来两周能稳定拿出多少时间', whyItMatters: '决定实验做多大', origin: 'missing-user-context', priority: 1 }],
  parseConfidence: 0.5,
};

function fact(overrides: Partial<ExperienceFact> & { readonly id: string }): ExperienceFact {
  return {
    sourceId: `src-${overrides.id}`,
    sourceUrl: `https://www.zhihu.com/answer/${overrides.id}`,
    author: `答主-${overrides.id}`,
    sourceTitle: '我的转行经历',
    exactQuote: '我后来辞职去考了导游证，第一年基本没有收入，靠之前的积蓄撑过去。',
    type: 'action',
    relevance: 0.5,
    purposes: ['similar-person'],
    ...overrides,
  };
}

const EXPERIMENT: RealityExperiment = {
  hypothesis: 'h',
  action: '连续 7 天记录真实投入',
  timebox: '7 天，每天约 2 分钟记录',
  artifact: '一份记录',
  successSignal: '中位数达到你心里那条线',
  stopSignal: '如果它开始影响最重要的事，立刻停下。',
  reducesUnknown: '你未来两周能稳定拿出多少时间',
};

function blueprint(overrides: Partial<WorldBlueprint> = {}): WorldBlueprint {
  return {
    version: 'world-blueprint-v1',
    sessionId: 'sess-1',
    problemFrame: FRAME,
    centralTension: FRAME.centralTension,
    paths: [],
    keyUnknown: {
      id: 'unknown-time',
      label: '你未来两周能稳定拿出多少时间',
      whyItMatters: '它决定实验做多大',
      origin: 'missing-user-context',
      priority: 1,
    },
    acts: [
      { act: 1, objective: 'enter-world', titleHint: 't', conflict: 'c', primaryPathIds: [], experienceFactIds: ['f-action'], unlockIds: [] },
      { act: 2, objective: 'experience-cost', titleHint: 't', conflict: 'c', primaryPathIds: [], experienceFactIds: ['f-cost'], unlockIds: [] },
      { act: 3, objective: 'meet-counterexample', titleHint: 't', conflict: 'c', primaryPathIds: [], experienceFactIds: ['f-counter'], unlockIds: [] },
    ],
    experienceFacts: [],
    unlocks: [],
    forbiddenClaims: ['不得宣称成功概率'],
    ...overrides,
  };
}

describe('终局答案：把本局真实发生过的事凝练成答案', () => {
  const facts: readonly ExperienceFact[] = [
    fact({
      id: 'f-action',
      type: 'action',
      relevance: 0.9,
      qualification: { similarityTier: 'same-family' } as ExperienceFact['qualification'],
    }),
    fact({
      id: 'f-cost',
      type: 'cost',
      relevance: 0.4,
      exactQuote: '代价是两年时间没有稳定收入，家里也一直不理解。',
    }),
    fact({
      id: 'f-counter',
      type: 'reflection',
      relevance: 0.2,
      exactQuote: '我最庆幸的是早点退出了，那两年我几乎没攒下钱，现在想想很后悔。',
      purposes: ['counterexample'],
    }),
    fact({
      id: 'f-unlock',
      type: 'action',
      relevance: 0.7,
      exactQuote: '先去旅行社做两个月兼职带团，确认自己受得了再考证。',
    }),
    fact({
      id: 'f-exact',
      type: 'action',
      relevance: 0.1,
      qualification: { similarityTier: 'exact' } as ExperienceFact['qualification'],
      exactQuote: '我原来是电工，后来辞职考了导游证，现在带团三年了。',
    }),
  ];

  const withFacts = blueprint({
    experienceFacts: facts,
    unlocks: [
      {
        id: 'unlock-1',
        label: '先兼职再说',
        description: 'd',
        sourceFactIds: ['f-unlock'],
        choice: { text: '先去旅行社兼职两个月', hint: 'h' },
        availableFromAct: 2,
      },
    ],
  });

  it('带上你问的原句、你补的硬条件、你走过的路', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: ['先兼职去带团', '拒绝了一个稳定的岗位'],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });

    expect(answer.question).toBe('我是电工专业，想转行当导游');
    // 只收用户明确说过的硬条件（软条件不进）
    expect(answer.conditions).toEqual(['每周只有 8 小时']);
    expect(answer.walked).toEqual(['先兼职去带团', '拒绝了一个稳定的岗位']);
    expect(answer.unknown).toBe('你未来两周能稳定拿出多少时间');
    expect(answer.nextStep?.action).toBe(EXPERIMENT.action);
  });

  it('经历类内容全部是原文前缀，并带答主与原文链接', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: [],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });

    const all = [...answer.taken, ...answer.borrowed, ...answer.costs, ...(answer.counter ? [answer.counter] : [])];
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) {
      const source = facts.find((entry) => entry.id === item.id)!;
      // 逐字：展示的必须是原文的连续前缀（只允许尾部省略号）
      const body = item.quote.replace(/…$/, '');
      expect(source.exactQuote).toContain(body);
      expect(item.author).toBe(source.author);
      expect(item.sourceUrl).toBe(source.sourceUrl);
    }
  });

  it('相似等级更好的片段优先（exact 排在 same-family 前面）', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: [],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });
    expect(answer.borrowed[0]?.id).toBe('f-exact');
  });

  it('反例优先取带「后悔 / 退出」信号的那条', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: [],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });
    expect(answer.counter?.id).toBe('f-counter');
    expect(answer.counter?.kind).toBe('counter');
  });

  it('只把玩家**真的采用过**的解锁写进「你采用了谁的经验」', () => {
    const used = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: [],
      usedUnlockIds: ['unlock-1'],
      experiment: EXPERIMENT,
    });
    expect(used.taken.map((item) => item.id)).toEqual(['f-unlock']);

    const unused = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: [],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });
    expect(unused.taken).toHaveLength(0);
  });

  it('一条真实片段都没有时如实留空，并说明为什么', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: blueprint({ experienceFacts: [] }),
      walked: ['随便选了一下'],
      usedUnlockIds: [],
      experiment: EXPERIMENT,
    });

    expect(answer.borrowed).toHaveLength(0);
    expect(answer.costs).toHaveLength(0);
    expect(answer.counter).toBeNull();
    expect(answer.note).toContain('没有拿到可核验的本人亲历片段');
    // 只剩「你走过的路」与「仍然不知道」——仍然是一份答案，不是空白
    expect(answer.walked).toEqual(['随便选了一下']);
    expect(answer.unknown).toBe('你未来两周能稳定拿出多少时间');
  });

  it('不产生任何结论式数字（成功率 / 匹配度 / 推荐分）', () => {
    const answer = endgameAnswerOf({
      frame: FRAME,
      blueprint: withFacts,
      walked: ['a'],
      usedUnlockIds: ['unlock-1'],
      experiment: EXPERIMENT,
    });
    const text = JSON.stringify(answer);
    expect(text).not.toMatch(/成功率|匹配度|推荐分|%\s*$/);
  });

  it('同一输入两次结果逐字节一致（纯函数、无随机）', () => {
    const input = { frame: FRAME, blueprint: withFacts, walked: ['a'], usedUnlockIds: ['unlock-1'], experiment: EXPERIMENT };
    expect(JSON.stringify(endgameAnswerOf(input))).toBe(JSON.stringify(endgameAnswerOf(input)));
  });
});
