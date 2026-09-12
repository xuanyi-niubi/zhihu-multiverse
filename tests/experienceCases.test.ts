import { describe, expect, it } from 'vitest';

import { buildExperienceCases } from '@/features/experience/cases';

import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 经历聚合（Phase 7 / P0-E）。
 *
 * 核心承诺：**Case 不发明任何东西** —— 只 group / sort。
 */

let seq = 0;
function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact:src-1:${seq}`,
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/question/9/answer/1',
    author: '某位走过这条路的人',
    exactQuote: '我当时大二，基础一般，边上课边准备比赛。',
    type: 'action',
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

describe('按来源聚合', () => {
  it('同一来源的片段归成一个 Case', () => {
    const cases = buildExperienceCases([
      fact({ id: 'f1', type: 'condition', exactQuote: '我当时大二，基础一般' }),
      fact({ id: 'f2', type: 'action', exactQuote: '边上课边准备比赛' }),
      fact({ id: 'f3', type: 'outcome', exactQuote: '最后拿了省二' }),
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.conditions).toHaveLength(1);
    expect(cases[0]!.actions).toHaveLength(1);
    expect(cases[0]!.outcomes).toHaveLength(1);
    expect(cases[0]!.id).toBe('case:live:src-1');
  });

  it('不同来源不合并（拼出来的「人」不存在）', () => {
    const cases = buildExperienceCases([
      fact({ id: 'f1', sourceId: 'live:a', type: 'action' }),
      fact({ id: 'f2', sourceId: 'live:b', type: 'action' }),
    ]);
    expect(cases).toHaveLength(2);
  });

  it('Case 里的片段与输入逐字一致（不生成新事实、不写 summary）', () => {
    const quote = '我当时大二，基础一般，边上课边准备比赛。';
    const cases = buildExperienceCases([fact({ id: 'f1', type: 'action', exactQuote: quote })]);
    expect(cases[0]!.actions[0]!.exactQuote).toBe(quote);
    expect('summary' in (cases[0] as object)).toBe(false);
  });
});

describe('准入规则：有行动，或有条件且有结果', () => {
  it('只有 condition → 不升级为 Case', () => {
    const cases = buildExperienceCases([fact({ type: 'condition' })]);
    expect(cases).toHaveLength(0);
  });

  it('condition + outcome（无 action）→ 升级', () => {
    const cases = buildExperienceCases([
      fact({ type: 'condition' }),
      fact({ type: 'outcome', exactQuote: '最后拿了省二' }),
    ]);
    expect(cases).toHaveLength(1);
  });

  it('有 action（哪怕孤零零一条）→ 升级', () => {
    const cases = buildExperienceCases([fact({ type: 'action' })]);
    expect(cases).toHaveLength(1);
  });

  it('只有 cost + reflection → 不升级', () => {
    const cases = buildExperienceCases([
      fact({ type: 'cost', exactQuote: '每周大概花十个小时' }),
      fact({ type: 'reflection', exactQuote: '我觉得值得尝试，越早越好。' }),
    ]);
    expect(cases).toHaveLength(0);
  });
});

describe('确定性', () => {
  it('同输入两次聚合逐字节一致', () => {
    const input = [
      fact({ id: 'f1', type: 'condition' }),
      fact({ id: 'f2', type: 'action' }),
      fact({ id: 'f3', type: 'cost', exactQuote: '每周大概花十个小时' }),
    ];
    expect(JSON.stringify(buildExperienceCases(input))).toBe(JSON.stringify(buildExperienceCases(input)));
  });

  it('桶内按相关性降序', () => {
    const cases = buildExperienceCases([
      fact({ id: 'low', type: 'action', relevance: 0.1 }),
      fact({ id: 'high', type: 'action', relevance: 0.9 }),
    ]);
    expect(cases[0]!.actions[0]!.id).toBe('high');
  });
});
