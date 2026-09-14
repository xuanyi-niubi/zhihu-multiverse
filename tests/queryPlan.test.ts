import { describe, expect, it } from 'vitest';

import { buildProblemFrame } from '@/features/experience/frame';
import {
  buildSearchPlan,
  DEFAULT_MAX_REQUESTS,
  MAX_SEARCH_REQUESTS,
} from '@/features/experience/queryPlan';
import { extractProfile } from '@/core/dm/profile';

import type { ProblemFrame, SearchPurpose } from '@/features/experience/domain';

/**
 * 检索计划（Phase 4 / P0-C）。
 *
 * 这组测试守的最重要一条：
 *
 * > **任何一份计划都必须包含失败 / 反例视角。**
 *
 * 只搜支持用户原本观点的内容，产品就退化成一个讨好的搜索框。
 */

function frameOf(question: string, overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  const profile = extractProfile(question);
  return {
    ...buildProblemFrame({ question, profile, analysis: null }),
    ...overrides,
  };
}

const PURPOSES: readonly SearchPurpose[] = [
  'similar-person',
  'alternative',
  'failure',
  'cost',
  'outcome',
  'counterexample',
];

describe('预算：默认 3、上限 4、下限 3', () => {
  it('不传 maxRequests → 3 条 query', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛') });
    expect(plan.queries).toHaveLength(3);
    expect(plan.maxRequests).toBe(DEFAULT_MAX_REQUESTS);
  });

  it('显式传 10 → 钳到 4（高成本问题才有第 4 条候选）', () => {
    const plan = buildSearchPlan({ frame: frameOf('想裸辞创业'), maxRequests: 10 });
    expect(plan.maxRequests).toBe(MAX_SEARCH_REQUESTS);
    expect(plan.queries).toHaveLength(4);
  });

  it('显式传 1 → 不低于 3（三种强制意图一条都不能少）', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛'), maxRequests: 1 });
    expect(plan.maxRequests).toBe(3);
    expect(plan.queries).toHaveLength(3);
  });
});

describe('意图覆盖：相似 + 替代 + 反例，一条不少', () => {
  it('三种强制意图永远在场', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛') });
    const purposes = plan.queries.map((item) => item.purpose);
    expect(purposes).toContain('similar-person');
    expect(purposes).toContain('alternative');
    expect(purposes).toContain('counterexample');
  });

  it('每条 query 的 purpose 都在合法集合里', () => {
    const plan = buildSearchPlan({ frame: frameOf('想裸辞创业') });
    for (const query of plan.queries) {
      expect(PURPOSES).toContain(query.purpose);
      expect(query.id.length).toBeGreaterThan(0);
      expect(query.query.trim().length).toBeGreaterThan(0);
      expect(query.priority).toBeGreaterThan(0);
    }
  });

  it('query 文本互不相同（撞车=浪费配额）', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二基础一般，想参加比赛') });
    const texts = plan.queries.map((item) => item.query.replace(/\s+/g, ''));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('高成本尝试才多花一条预算问代价', () => {
  it('裸辞类问题 + 预算 4 → 有 cost 意图', () => {
    const plan = buildSearchPlan({ frame: frameOf('想裸辞创业'), maxRequests: 4 });
    expect(plan.queries.some((item) => item.purpose === 'cost')).toBe(true);
  });

  it('普通比赛问题 → 不出 cost 意图（省配额）', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛') });
    expect(plan.queries.some((item) => item.purpose === 'cost')).toBe(false);
  });
});

describe('确定性', () => {
  it('同一问题两次生成逐字节一致', () => {
    const question = '大二数据科学，基础一般，想参加比赛但怕影响课程';
    const a = JSON.stringify(buildSearchPlan({ frame: frameOf(question) }));
    const b = JSON.stringify(buildSearchPlan({ frame: frameOf(question) }));
    expect(a).toBe(b);
  });

  it('身份词进入相似检索（大二的学生不该搜到工作十年的人）', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛') });
    const similar = plan.queries.find((item) => item.purpose === 'similar-person');
    expect(similar?.query).toContain('大二');
  });
});


describe('检索词只使用用户明确身份', () => {
  it('parser-synthesis 的软条件不会混进查询', () => {
    const plan = buildSearchPlan({
      frame: frameOf('大二想参加比赛', {
        constraints: [
          { id: 'soft', text: '家庭无法支持', origin: 'parser-synthesis', hard: false },
        ],
      }),
    });
    expect(plan.queries.map((item) => item.query).join(' ')).not.toContain('家庭无法支持');
  });

  it('相似检索明确寻找亲历与后续结果', () => {
    const similar = buildSearchPlan({ frame: frameOf('大二想参加比赛') })
      .queries.find((item) => item.purpose === 'similar-person');
    expect(similar?.query).toContain('亲身经历');
    expect(similar?.query).toContain('后来');
  });
});
