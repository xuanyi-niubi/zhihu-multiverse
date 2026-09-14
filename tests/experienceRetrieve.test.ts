import { describe, expect, it } from 'vitest';

import {
  MAX_EXPERIENCE_SOURCES,
  retrieveExperienceSources,
} from '@/features/experience/retrieve';
import { buildSearchPlan } from '@/features/experience/queryPlan';

import type { ExperienceSearch } from '@/features/experience/retrieve';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';
import type { ProblemFrame } from '@/features/experience/domain';

/**
 * 经验检索执行层（Phase 4 / P0-C）。
 *
 * 锁四条纪律：去重合并、封顶、失败不抛、缺数据不丢。
 */

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: `src-${Math.random().toString(36).slice(2, 8)}`,
    author: '某位走过这条路的人',
    quote: '我当时大二，基础一般，边上课边做项目，最后拿了省二。',
    upvotes: 120,
    url: 'https://www.zhihu.com/question/1/answer/1',
    retrievedAt: '2026-09-01T00:00:00.000Z',
    status: 'verified',
    editTime: 1756684800,
    authority: 3,
    ...overrides,
  };
}

function frame(): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '',
    unknowns: [],
    parseConfidence: 0.3,
  };
}

function searchOf(map: Record<string, readonly KnowledgeSource[]>): ExperienceSearch {
  return async (query) => map[query] ?? [];
}

describe('去重：同一内容只留一条，意图合并', () => {
  it('同 URL 被两条 query 命中 → 一条来源、两个意图、两个 queryId', async () => {
    const shared = source({ url: 'https://www.zhihu.com/question/1/answer/42' });
    const plan = buildSearchPlan({ frame: frame() });
    const [similar, alternative] = plan.queries;
    const result = await retrieveExperienceSources({
      plan,
      search: searchOf({
        [similar!.query]: [shared],
        [alternative!.query]: [source({ ...shared, id: 'duplicate-entry' })],
      }),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.purposes).toHaveLength(2);
    expect(result.sources[0]!.matchedQueryIds).toEqual([similar!.id, alternative!.id]);
  });

  it('不同 URL 各算一条', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const [similar, alternative] = plan.queries;
    const result = await retrieveExperienceSources({
      plan,
      search: searchOf({
        [similar!.query]: [source({ url: 'https://www.zhihu.com/a' })],
        [alternative!.query]: [source({ url: 'https://www.zhihu.com/b' })],
      }),
    });
    expect(result.sources).toHaveLength(2);
  });
});

describe('封顶与排序', () => {
  it('超过上限只留 12 条', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const flood = Array.from({ length: 40 }, (_, index) =>
      source({ url: `https://www.zhihu.com/flood/${index}`, id: `flood-${index}` }),
    );
    const result = await retrieveExperienceSources({
      plan,
      search: async () => flood,
    });
    expect(result.sources).toHaveLength(MAX_EXPERIENCE_SOURCES);
  });

  it('多意图命中的排在单意图前面（进门顺序，不是评分）', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const [similar, alternative] = plan.queries;
    const multi = source({ url: 'https://www.zhihu.com/multi', authority: 1 });
    const single = source({ url: 'https://www.zhihu.com/single', authority: 5 });
    const result = await retrieveExperienceSources({
      plan,
      search: searchOf({
        [similar!.query]: [multi, single],
        [alternative!.query]: [multi],
      }),
    });
    expect(result.sources[0]!.source.url).toBe('https://www.zhihu.com/multi');
  });
});

describe('失败纪律', () => {
  it('search 抛错 → 不抛，那一路记 0 条', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const result = await retrieveExperienceSources({
      plan,
      search: async () => {
        throw new Error('网络炸了');
      },
    });
    expect(result.sources).toHaveLength(0);
    expect(result.runs).toHaveLength(plan.queries.length);
    for (const run of result.runs) {
      expect(run.sourceCount).toBe(0);
    }
  });

  it('一路失败不影响另一路', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const [similar, alternative] = plan.queries;
    const result = await retrieveExperienceSources({
      plan,
      search: async (query) => {
        if (query === similar!.query) {
          throw new Error('这一路炸了');
        }
        return [source({ url: 'https://www.zhihu.com/ok' })];
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.runs.find((item) => item.queryId === similar!.id)?.sourceCount).toBe(0);
    expect(result.runs.find((item) => item.queryId === alternative!.id)?.sourceCount).toBe(1);
  });

  it('空结果 → 空来源、runs 仍在（诚实降级的前提是有账可查）', async () => {
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame: frame() }),
      search: async () => [],
    });
    expect(result.sources).toHaveLength(0);
    expect(result.runs.length).toBeGreaterThan(0);
  });
});


describe('人物资格审查与均衡选人', () => {
  it('有 frame 时只让亲历者进入经验层，并记录淘汰数', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const similar = plan.queries.find((item) => item.purpose === 'similar-person')!;
    const lived = source({
      id: 'lived',
      title: '大二第一次参加比赛是什么体验？',
      quote: '我当时大二，第一次参加比赛，后来完成了项目，但也耽误了两周课程。',
      url: 'https://www.zhihu.com/lived',
    });
    const advice = source({
      id: 'advice',
      title: '大学生要不要参加比赛？',
      author: '建议型答主',
      quote: '建议基础一般的大学生先学习知识，再决定要不要参加比赛。',
      url: 'https://www.zhihu.com/advice',
    });
    const result = await retrieveExperienceSources({
      plan,
      frame: frame(),
      search: searchOf({ [similar.query]: [lived, advice] }),
    });

    expect(result.rawSourceCount).toBe(2);
    expect(result.sources.map((item) => item.source.id)).toEqual(['lived']);
    expect(result.sources[0]?.qualification?.firsthand).toBe('yes');
    expect(result.sources[0]?.qualification?.assignedTrack).toBe('similar');
    expect(result.rejectedCount).toBe(1);
  });

  it('同一作者的多条回答只选择一条，人数不会膨胀', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const similar = plan.queries.find((item) => item.purpose === 'similar-person')!;
    const result = await retrieveExperienceSources({
      plan,
      frame: frame(),
      search: searchOf({
        [similar.query]: [
          source({ id: 'a', author: '同一个人', title: '参加比赛经历', url: 'https://www.zhihu.com/a' }),
          source({ id: 'b', author: '同一个人', title: '我的比赛复盘', url: 'https://www.zhihu.com/b' }),
        ],
      }),
    });
    expect(result.sources).toHaveLength(1);
  });

  it('抛错与空结果分别记为 failed / empty', async () => {
    const plan = buildSearchPlan({ frame: frame() });
    const first = plan.queries[0]!;
    const result = await retrieveExperienceSources({
      plan,
      search: async (query) => {
        if (query === first.query) throw new Error('upstream');
        return [];
      },
    });
    expect(result.runs.find((item) => item.queryId === first.id)?.status).toBe('failed');
    expect(result.runs.some((item) => item.status === 'empty')).toBe(true);
  });
});
