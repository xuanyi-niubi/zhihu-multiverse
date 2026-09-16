import { describe, expect, it } from 'vitest';

import { buildProblemFrame } from '@/features/experience/frame';
import {
  buildInitialSearchPlan,
  buildSearchPlan,
  DEFAULT_MAX_REQUESTS,
  MAX_SEARCH_REQUESTS,
  searchRequestBudget,
} from '@/features/experience/queryPlan';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';
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

describe('预算：默认 3、上限 12、下限 3', () => {
  it('不传 maxRequests → 3 条 query（三条强制视角）', () => {
    const plan = buildSearchPlan({ frame: frameOf('大二想参加比赛') });
    expect(plan.queries).toHaveLength(3);
    expect(plan.maxRequests).toBe(DEFAULT_MAX_REQUESTS);
  });

  it('显式传预算 → 按预算放宽（2026-09-16 起上限为 12）', () => {
    const plan = buildSearchPlan({ frame: frameOf('想裸辞创业'), maxRequests: 10 });
    expect(plan.maxRequests).toBe(10);
    expect(plan.queries.length).toBeGreaterThan(3);
    expect(plan.queries.length).toBeLessThanOrEqual(10);
  });

  it('显式传超大值 → 钳到硬上限 MAX_SEARCH_REQUESTS', () => {
    const plan = buildSearchPlan({ frame: frameOf('想裸辞创业'), maxRequests: 999 });
    expect(plan.maxRequests).toBe(MAX_SEARCH_REQUESTS);
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
  it('裸辞类问题 → 计划里有 cost 意图', () => {
    const plan = buildSearchPlan({
      frame: frameOf('想裸辞创业'),
      maxRequests: searchRequestBudget(),
    });
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

describe('跨行业转变的分层检索', () => {
  it('首轮只搜索精确起点与精确目标，不先支付模型成本', () => {
    const plan = buildInitialSearchPlan(frameOf('我是电工专业，然后想转导游', {
      currentSituation: '电工专业',
      desiredChange: '转导游',
    }));

    expect(plan.maxRequests).toBe(1);
    expect(plan.queries).toHaveLength(1);
    expect(plan.queries[0]).toMatchObject({ purpose: 'similar-person', expectedTier: 'exact' });
    expect(plan.queries[0]?.query).toContain('电工');
    expect(plan.queries[0]?.query).toContain('导游');
  });

  it('拿到开放式语义扩展后，在放宽后的预算里分别搜精确 / 同族 / 同域 / 相同终点 / 年代 / 反例', () => {
    const frame = frameOf('我是电工专业，然后想转导游', {
      currentSituation: '电工专业',
      desiredChange: '转导游',
    });
    const intent = buildTransitionIntent(frame, {
      familyOrigins: ['电气', '自动化'],
      domainOrigins: ['工科'],
      adjacentTargets: ['领队'],
      counterTerms: ['离职', '后悔'],
    });
    const plan = buildSearchPlan({
      frame,
      intent,
      maxRequests: searchRequestBudget(),
    });

    expect(plan.queries).toHaveLength(searchRequestBudget());
    const text = plan.queries.map((item) => item.query).join('\n');
    expect(text).toContain('电工');
    expect(text).toContain('电气');
    expect(text).toContain('工科');
    expect(plan.queries.every((item) => item.purpose !== 'similar-person' || item.query.includes('导游'))).toBe(true);
    expect(text).not.toContain('做出一个改变现状的决定');
    expect(plan.queries.some((item) => item.expectedTier === 'exact')).toBe(true);
    expect(plan.queries.some((item) => item.expectedTier === 'same-family')).toBe(true);
    expect(plan.queries.some((item) => item.expectedTier === 'same-domain')).toBe(true);
    // 年代查询与常驻的「丢起点保目标」都在场（都零模型成本）
    expect(plan.queries.some((item) => item.id === 'q-era')).toBe(true);
    expect(plan.queries.some((item) => item.id === 'q-similar-target')).toBe(true);
  });

  it('显式压到三条预算时仍保留相似、替代、反例三个视角', () => {
    const frame = frameOf('我是电工专业，然后想转导游', {
      currentSituation: '电工专业',
      desiredChange: '转导游',
    });
    const plan = buildSearchPlan({
      frame,
      intent: buildTransitionIntent(frame, {
        familyOrigins: ['电气'],
        domainOrigins: ['工科'],
        adjacentTargets: ['领队'],
        counterTerms: [],
      }),
      maxRequests: 3,
    });
    expect(plan.queries).toHaveLength(3);
    expect(plan.queries.map((item) => item.purpose)).toEqual([
      'similar-person',
      'alternative',
      'counterexample',
    ]);
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
