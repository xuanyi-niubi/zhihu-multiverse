import { describe, expect, it } from 'vitest';

import { attachDifferencesToPaths, compareUserToCase } from '@/features/experience/compare';

import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
} from '@/features/experience/domain';

/**
 * 用户差异对照（Phase 9 / P0-E）。
 *
 * 这组测试守的纪律：
 *
 * > **不能明确比较就是 unknown，绝不语义猜测；绝不产出匹配度。**
 */

function conditionFact(exactQuote: string, id = 'fact:c:0'): ExperienceFact {
  return {
    id,
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote,
    type: 'condition',
    relevance: 0.5,
    purposes: [],
  };
}

function caseOf(conditions: readonly ExperienceFact[]): ExperienceCase {
  return {
    id: 'case:live:src-1',
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    conditions,
    actions: [],
    costs: [],
    outcomes: [],
    reflections: [],
  };
}

function frameWith(constraints: readonly { text: string; hard: boolean }[]): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: constraints.map((item, index) => ({
      id: `constraint-${index + 1}`,
      text: item.text,
      origin: 'user-explicit' as const,
      hard: item.hard,
    })),
    resources: [],
    concerns: [],
    centralTension: '',
    unknowns: [],
    parseConfidence: 0.5,
  };
}

describe('数值可比：同单位才做算术', () => {
  it('每周 8 小时 vs 每周 30 小时 → different', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '每周只能投入 8 小时', hard: true }]),
      experienceCase: caseOf([conditionFact('我当时每周花 30 个小时在比赛上', 'fact:c:1')]),
    });
    expect(differences[0]!.relation).toBe('different');
    expect(differences[0]!.userValue).toBe('8小时');
    expect(differences[0]!.experienceValue).toBe('30小时');
    expect(differences[0]!.evidenceFactIds).toEqual(['fact:c:1']);
  });

  it('数值接近（±25% 内）→ same', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '每周只能投入 8 小时', hard: true }]),
      experienceCase: caseOf([conditionFact('我大概每周投入 9 小时', 'fact:c:2')]),
    });
    expect(differences[0]!.relation).toBe('same');
  });

  it('单位不同（月 vs 小时）→ 不比，unknown', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '每周只能投入 8 小时', hard: true }]),
      experienceCase: caseOf([conditionFact('我准备了一整个月', 'fact:c:3')]),
    });
    expect(differences[0]!.relation).toBe('unknown');
  });
});

describe('非数值：只有逐字命中才敢说 same', () => {
  it('条件片段逐字含着用户硬条件 → same', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '大二', hard: true }]),
      experienceCase: caseOf([conditionFact('我当时大二，基础一般', 'fact:c:4')]),
    });
    expect(differences[0]!.relation).toBe('same');
  });

  it('没有可比信息 → unknown（绝不猜「差不多」）', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '家里支持我', hard: true }]),
      experienceCase: caseOf([conditionFact('我当时大二，基础一般', 'fact:c:5')]),
    });
    expect(differences[0]!.relation).toBe('unknown');
  });

  it('推断出的（hard=false）条件根本不参与比较', () => {
    const differences = compareUserToCase({
      frame: frameWith([{ text: '风险偏好低', hard: false }]),
      experienceCase: caseOf([conditionFact('我风险偏好也低，求稳', 'fact:c:6')]),
    });
    expect(differences).toHaveLength(0);
  });
});

describe('展示纪律：没有伪精确', () => {
  it('差异结果里不出现百分比 / 匹配度 / 推荐字样', () => {
    const differences = compareUserToCase({
      frame: frameWith([
        { text: '每周只能投入 8 小时', hard: true },
        { text: '家里支持我', hard: true },
      ]),
      experienceCase: caseOf([
        conditionFact('我当时每周花 30 个小时在比赛上', 'fact:c:7'),
        conditionFact('家人不同意我搞这些', 'fact:c:8'),
      ]),
    });
    const serialized = JSON.stringify(differences);
    expect(serialized).not.toMatch(/%|成功率|匹配度|推荐|概率/);
  });
});

describe('汇总到路径', () => {
  const path: ExperiencePath = {
    id: 'path-1',
    label: '直接报名',
    summary: '边做边学。',
    supportingCaseIds: ['case:live:src-1'],
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
  };

  it('每条路径最多 3 条差异', () => {
    const many: ExperienceCase = {
      ...caseOf([]),
      id: 'case:live:src-1',
    };
    // 一个 case 产不出 3+ 条差异（每条硬条件最多一条），用两条路径的 case 验证封顶逻辑
    const cases = [many, { ...many, id: 'case:other' }];
    const result = attachDifferencesToPaths({
      frame: frameWith([
        { text: '每周只能投入 8 小时', hard: true },
        { text: '大二', hard: true },
        { text: '家里支持我', hard: true },
        { text: '基础一般', hard: true },
      ]),
      paths: [path],
      cases: cases.map((item, index) => ({
        ...item,
        conditions: [
          conditionFact('我当时每周花 30 个小时在比赛上', `fact:d${index}a`),
          conditionFact('我当时大二，基础一般', `fact:d${index}b`),
          conditionFact('家里人很支持我', `fact:d${index}c`),
        ],
      })),
    });
    expect(result[0]!.differencesFromUser.length).toBeLessThanOrEqual(3);
  });

  it('different 排在 same / unknown 前面（信息量最大的先说）', () => {
    const result = attachDifferencesToPaths({
      frame: frameWith([
        { text: '每周只能投入 8 小时', hard: true },
        { text: '大二', hard: true },
      ]),
      paths: [path],
      cases: [
        {
          ...caseOf([
            conditionFact('我当时大二，基础一般', 'fact:e1'),
            conditionFact('我当时每周花 30 个小时在比赛上', 'fact:e2'),
          ]),
        },
      ],
    });
    expect(result[0]!.differencesFromUser[0]!.relation).toBe('different');
  });
});
