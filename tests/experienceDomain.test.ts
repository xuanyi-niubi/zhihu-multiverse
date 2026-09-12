import { describe, expect, it } from 'vitest';

import {
  checkExactQuote,
  checkExperienceCase,
  checkExperiencePath,
  checkFrameStatement,
  mayBeHard,
} from '@/features/experience/invariants';

import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  FrameStatement,
} from '@/features/experience/domain';

/**
 * Experience 领域契约（Phase 1）。
 *
 * 纯类型本身没什么可测，所以这里测的是**语义纪律**：
 * 形状对但内容违规的数据必须能被拦下。
 * 三条纪律各自对应一个真实的失效模式（见各用例注释）。
 */

function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  return {
    id: 'f1',
    sourceId: 's1',
    sourceUrl: 'https://www.zhihu.com/question/1/answer/2',
    author: '某答主',
    exactQuote: '前后花了两个月',
    type: 'cost',
    relevance: 0.5,
    purposes: ['cost'],
    ...overrides,
  };
}

function path(overrides: Partial<ExperiencePath> = {}): ExperiencePath {
  return {
    id: 'p1',
    label: '先做小样再决定',
    summary: '用一次小交付替代空想。',
    supportingCaseIds: ['c1'],
    opposingCaseIds: [],
    supportingFactIds: ['f1'],
    opposingFactIds: [],
    observedConditions: [],
    observedActions: [],
    observedCosts: [],
    observedOutcomes: [],
    differencesFromUser: [],
    unknowns: [],
    origin: 'legacy-fallback',
    ...overrides,
  };
}

describe('hard 陈述规则（解析推断不得当事实）', () => {
  it('只有用户明说与实验观测能作为硬条件', () => {
    expect(mayBeHard('user-explicit')).toBe(true);
    expect(mayBeHard('experiment-observed')).toBe(true);
    expect(mayBeHard('parser-synthesis')).toBe(false);
  });

  it('**解析器推断被标成硬条件时必须报错**', () => {
    const bad: FrameStatement = {
      id: 's1',
      text: '用户每周大概能拿出 8 小时',
      origin: 'parser-synthesis',
      hard: true,
    };
    expect(checkFrameStatement(bad)).toContain('不能标记为硬条件');
  });

  it('解析推断作为软条件（检索提示）是允许的', () => {
    const ok: FrameStatement = {
      id: 's1',
      text: '似乎更在意成长速度',
      origin: 'parser-synthesis',
      hard: false,
    };
    expect(checkFrameStatement(ok)).toBeNull();
  });

  it('空文本被拒', () => {
    expect(
      checkFrameStatement({ id: 's1', text: '   ', origin: 'user-explicit', hard: true }),
    ).toBeTruthy();
  });
});

describe('逐字引用规则（AI 可挑片段，不可改写）', () => {
  const sourceQuote = '当时我前后花了两个月才把基础补上，中间还挂了科。';

  it('片段确实出现在原文里 → 通过', () => {
    expect(checkExactQuote(fact({ exactQuote: '前后花了两个月' }), sourceQuote)).toBeNull();
  });

  it('**片段被改写（哪怕只改一个字）必须被拦下**', () => {
    // 原文是「两个月」，这里写成「2 个月」
    expect(checkExactQuote(fact({ exactQuote: '前后花了2个月' }), sourceQuote)).toContain('逐字子串');
  });

  it('凭空生成的片段必须被拦下', () => {
    expect(checkExactQuote(fact({ exactQuote: '我大概花了半年' }), sourceQuote)).toContain('逐字子串');
  });

  it('不可溯源的片段被拦下（无 url / 无作者）', () => {
    expect(checkExactQuote(fact({ sourceUrl: '' }), sourceQuote)).toBeTruthy();
    expect(checkExactQuote(fact({ author: '  ' }), sourceQuote)).toBeTruthy();
  });

  it('空片段被拒', () => {
    expect(checkExactQuote(fact({ exactQuote: '   ' }), sourceQuote)).toBeTruthy();
  });
});

describe('空 Case / 空 Path 禁止（宁可不给，也不给空壳）', () => {
  function experienceCase(overrides: Partial<ExperienceCase> = {}): ExperienceCase {
    return {
      id: 'c1',
      sourceId: 's1',
      sourceUrl: 'https://www.zhihu.com/question/1/answer/2',
      author: '某答主',
      conditions: [],
      actions: [],
      costs: [],
      outcomes: [],
      reflections: [],
      ...overrides,
    };
  }

  it('没有任何片段的 Case 被拒', () => {
    expect(checkExperienceCase(experienceCase())).toContain('没有任何片段');
  });

  it('有片段但来源不可溯源的 Case 被拒', () => {
    expect(checkExperienceCase(experienceCase({ costs: [fact()], author: '' }))).toContain('不可溯源');
  });

  it('正常 Case 通过', () => {
    expect(checkExperienceCase(experienceCase({ costs: [fact()] }))).toBeNull();
  });

  it('**模型聚类但没有事实支撑的路径被拒**', () => {
    expect(
      checkExperiencePath(path({ origin: 'model-clustered', supportingFactIds: [] })),
    ).toContain('没有任何事实支撑');
  });

  it('legacy 路径必须关联 Case', () => {
    expect(checkExperiencePath(path({ origin: 'legacy-fallback', supportingCaseIds: [] }))).toContain(
      '没有关联任何 Case',
    );
  });

  it('没有名称或说明的路径被拒', () => {
    expect(checkExperiencePath(path({ label: '' }))).toBeTruthy();
    expect(checkExperiencePath(path({ summary: ' ' }))).toBeTruthy();
  });

  it('正常路径通过', () => {
    expect(checkExperiencePath(path())).toBeNull();
  });

  it('legacy 路径允许暂时没有独立事实（证据在 Case 上）', () => {
    expect(checkExperiencePath(path({ origin: 'legacy-fallback', supportingFactIds: [] }))).toBeNull();
  });
});
