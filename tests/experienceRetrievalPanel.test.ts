import { describe, expect, it } from 'vitest';

import { extractProfile } from '@/core/dm/profile';
import { buildProblemFrame } from '@/features/experience/frame';
import { buildSearchPlan, buildSameTargetQuery, searchRequestBudget } from '@/features/experience/queryPlan';
import { retrieveExperienceSources } from '@/features/experience/retrieve';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';
import type { ProblemFrame, SimilarityTier } from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 检索端点面板回归（线上事故的永久守卫）。
 *
 * ## 事故
 *
 * 线上「我是电工专业，想转行当导游」显示「观测盲区 · 0 位可核验亲历者」。
 * 根因不是门槛太高，而是门槛判错了词：旧实现把目标端点解析成 `当导游`
 * （`转行当导游` 左剥一个 `转` 字），检索词因此是
 * `电工 当导游 亲身经历 后来`，而资格门槛又要求来源正文**逐字包含**
 * `当导游`。于是下面这四条真实风格的候选全部被判 `unrelated`。
 *
 * 这组测试用**真实句子 + 真实风格的候选**把这条链子钉住：
 * 端点必须干净、合格候选必须能进经验层、模型调用必须是 0 次。
 */

function frameFor(question: string): ProblemFrame {
  const profile = extractProfile(question);
  return buildProblemFrame({ question, profile, analysis: null });
}

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'source',
    author: '答主',
    title: '转行经历',
    quote: '我后来转行做了导游，第一年几乎没有收入。',
    upvotes: 100,
    url: 'https://www.zhihu.com/answer/1',
    retrievedAt: '2026-09-15T00:00:00.000Z',
    status: 'verified',
    editTime: 1756684800,
    authority: 3,
    ...overrides,
  };
}

/**
 * 四条「人写的」候选：两条相似起点、一条其他背景转导游、一条反例。
 * 它们在第一轮精确查询里就会被返回（假检索对任何 query 都返回这一批）。
 */
const CANDIDATES: readonly KnowledgeSource[] = [
  source({
    id: 'mechanical',
    author: '甲答主',
    authorBadge: '机械工程',
    title: '机械专业毕业，后来转行做了导游，三年了',
    quote: '我本科读的机械，毕业进厂半年就受不了了。后来我决定转行做导游，先考了导游证，第一年基本没收入，现在带团稳定下来了。',
    url: 'https://www.zhihu.com/answer/1001',
  }),
  source({
    id: 'electrical',
    author: '乙答主',
    authorBadge: '电气自动化',
    title: '电气自动化转行做导游，我踩过的坑',
    quote: '我原来是电气自动化专业的，做了两年设备维护，后来转行当导游。当时家里反对，我自己考了导游证，收入一开始腰斩，坚持了三年才回本。',
    url: 'https://www.zhihu.com/answer/1002',
  }),
  source({
    id: 'accounting',
    author: '丙答主',
    authorBadge: '会计',
    title: '会计转行做导游值得吗？我的两年经历',
    quote: '我做了五年会计，后来考证转行做导游。我当时以为换个环境就好了，结果发现收入不稳定，第一年很焦虑，第二年才慢慢适应。',
    url: 'https://www.zhihu.com/answer/1003',
  }),
  source({
    id: 'quit-guide',
    author: '丁答主',
    authorBadge: '旅游从业',
    title: '劝退：做了三年导游我为什么退出',
    quote: '我做导游三年，后来退出转做旅游产品。导游这行旺季累到崩溃，淡季没收入，我最后悔的是没有早点准备退路。',
    url: 'https://www.zhihu.com/answer/1004',
  }),
];

describe('端点面板：任何问题都要抽出用户自己写的词', () => {
  const panel: readonly { readonly question: string; readonly origin: string; readonly target: string }[] = [
    { question: '我是电工专业，想转行当导游', origin: '电工', target: '导游' },
    { question: '大三法学，想转计算机，但怕脱产以后找不到工作', origin: '大三法学', target: '计算机' },
    { question: '和室友长期冲突，要不要搬宿舍', origin: '和室友长期冲突', target: '搬宿舍' },
    { question: '我是钟表修复师，想转古籍修复师', origin: '钟表修复师', target: '古籍修复师' },
    { question: '电气工程专业，想做导游', origin: '电气工程', target: '导游' },
  ];

  for (const item of panel) {
    it(`「${item.question}」→ 起点 ${item.origin} / 目标 ${item.target}`, () => {
      const frame = frameFor(item.question);
      const intent = buildTransitionIntent(frame);

      expect(intent.origin.exact).toContain(item.origin);
      expect(intent.target.exact).toContain(item.target);

      const queries = buildSearchPlan({ frame, intent }).queries.map((query) => query.query);
      expect(queries.some((query) => query.includes(item.target))).toBe(true);
      for (const query of queries) {
        expect(query).not.toContain('做出一个改变现状的决定');
        expect(query).not.toContain('入技术岗');
        expect(query).not.toContain('当导游');
      }
    });
  }

  it('开放式问题（没有明确转变）不产生垃圾检索词', () => {
    const frame = frameFor('二本文科女，没有任何技能，父母是农民，家里几乎没有存款，以后要怎么走，有什么出路？');
    const intent = buildTransitionIntent(frame);
    const queries = buildSearchPlan({ frame, intent }).queries.map((query) => query.query);

    expect(intent.target.exact).toEqual([]);
    for (const query of queries) {
      expect(query).not.toContain('做出一个改变现状的决定');
      expect(query.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('「电工转导游」端到端：合格候选必须进经验层', () => {
  const question = '我是电工专业，想转行当导游';

  /**
   * 没有那一次语义扩展时，机械/电气/会计转导游都只能诚实地标成
   * `same-target`（其他背景进入同一目标）—— 因为「同族/同域」需要
   * 扩展词才能判断。这里断言的是**它们不再被判无关**。
   */
  it('四条候选里至少三条被收下，且没有一条是 unrelated', async () => {
    const frame = frameFor(question);
    const searched: string[] = [];
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async (query) => {
        searched.push(query);
        return CANDIDATES;
      },
    });

    const tiers = Object.fromEntries(
      result.sources.map((item) => [item.source.id, item.qualification?.similarityTier]),
    ) as Record<string, SimilarityTier | undefined>;

    expect(result.sources.length).toBeGreaterThanOrEqual(3);
    expect(tiers.mechanical).toBe('same-target');
    expect(tiers.electrical).toBe('same-target');
    expect(tiers.accounting).toBe('same-target');
    expect(Object.values(tiers)).not.toContain('unrelated');
    expect(result.similarity?.exactCount).toBe(0);
    expect(result.similarity?.bestAvailableTier).toBe('same-target');
    expect(result.similarity?.widened).toBe(true);

    // 检索词必须是人会写的词
    expect(searched.every((query) => !query.includes('当导游'))).toBe(true);
    expect(searched.some((query) => query.includes('导游'))).toBe(true);
  });

  /** 语义扩展买到的正是「相似起点 / 同类背景」这两个更精确的等级。 */
  it('拿到起点扩展词后，机械与电气被提升为相似起点', async () => {
    const frame = frameFor(question);
    const intent = buildTransitionIntent(frame, {
      familyOrigins: ['机械', '电气', '自动化'],
      domainOrigins: ['工科'],
      adjacentTargets: ['领队'],
      counterTerms: ['退出', '后悔'],
    });

    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame, intent }),
      frame,
      intent,
      search: async () => CANDIDATES,
    });

    const tiers = Object.fromEntries(
      result.sources.map((item) => [item.source.id, item.qualification?.similarityTier]),
    ) as Record<string, SimilarityTier | undefined>;

    expect(tiers.mechanical).toBe('same-family');
    expect(tiers.electrical).toBe('same-family');
    expect(tiers.accounting).toBe('same-target');
    expect(result.similarity?.bestAvailableTier).toBe('same-family');
  });

  /**
   * 成本契约：手上**已经**有完全同路 / 相似起点 / 同类背景的人，
   * 就不再支付那次语义扩展。只有还停在「其他转导游」或更弱时才花。
   */
  it('已拿到相似起点时不再支付模型调用', async () => {
    const frame = frameFor(question);
    const intent = buildTransitionIntent(frame, {
      familyOrigins: ['机械', '电气', '自动化'],
      domainOrigins: ['工科'],
      adjacentTargets: ['领队'],
      counterTerms: ['退出', '后悔'],
    });
    const exactQuery = buildSearchPlan({ frame, intent }).queries
      .find((item) => item.id === 'q-similar-exact')!;

    let expansionCalls = 0;
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame, intent }),
      frame,
      intent,
      expandIntent: async () => {
        expansionCalls += 1;
        return intent;
      },
      search: async (query) => (query === exactQuery.query ? [CANDIDATES[0]!, CANDIDATES[1]!] : []),
    });

    expect(expansionCalls).toBe(0);
    expect(result.similarity?.bestAvailableTier).toBe('same-family');
  });

  it('手上只有「其他转导游」时，仍然愿意花一次扩展去够更高的层级', async () => {
    const frame = frameFor(question);
    let expansionCalls = 0;
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      expandIntent: async () => {
        expansionCalls += 1;
        return buildTransitionIntent(frame, {
          familyOrigins: ['机械'],
          domainOrigins: ['工科'],
          adjacentTargets: [],
          counterTerms: [],
        });
      },
      search: async (query) => {
        if (query.includes('机械') || query.includes('工科')) return [CANDIDATES[0]!];
        return [CANDIDATES[2]!];
      },
    });

    expect(expansionCalls).toBe(1);
    expect(result.similarity?.bestAvailableTier).toBe('same-family');
  });

  it('没有模型可用时，用零成本的「丢起点保目标」查询替代语义扩展', async () => {
    const frame = frameFor(question);
    const fallback = buildSameTargetQuery({ frame });

    expect(fallback).not.toBeNull();
    expect(fallback?.id).toBe('q-similar-target');
    expect(fallback?.query).toContain('导游');
    expect(fallback?.query).not.toContain('电工');
    expect(fallback?.expectedTier).toBe('same-target');

    const searched: string[] = [];
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async (query) => {
        searched.push(query);
        return query.includes('电工') ? [] : CANDIDATES;
      },
    });

    expect(searched.some((query) => query === fallback?.query)).toBe(true);
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
    expect(searched.length).toBeLessThanOrEqual(searchRequestBudget());
  });
});

describe('相同终点的方向纪律', () => {
  it('作者本人就是目标身份时，不算「其他背景进入这个目标」', async () => {
    const frame = frameFor('我是电工专业，想转行当导游');
    const reverse = source({
      id: 'reverse',
      author: '戊答主',
      title: '做了五年导游，我转行了',
      quote: '我原来是导游，带团五年，后来转行去做旅游产品，收入稳定多了。',
      url: 'https://www.zhihu.com/answer/1005',
    });

    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => [reverse],
    });

    expect(result.sources).toHaveLength(0);
    expect(result.rawSourceCount).toBe(1);
  });

  /**
   * 同一个洞的另一种写法：「我是导游」被守住了，但「**我做**导游三年」漏了，
   * 于是反向故事照样冒充「其他背景进入导游行业」，还占掉一个相似轨名额。
   */
  it('「我做导游三年，后来退出」也不能算同路', async () => {
    const frame = frameFor('我是电工专业，想转行当导游');
    const reverse = source({
      id: 'reverse-present',
      author: '己答主',
      title: '我做导游三年，后来退出了',
      quote: '我做导游三年，后来退出转做旅游产品，我最后悔的是没有早点准备退路。',
      url: 'https://www.zhihu.com/answer/1006',
    });

    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => [reverse],
    });

    expect(result.sources).toHaveLength(0);
  });

  /**
   * 反例补位（P1）。
   *
   * 相似轨只有 3 个名额。一条「转行之后后悔」的真实经历，如果被判进相似轨，
   * 就会被挤掉 —— 而反例是这个产品最不该缺席的视角。补位允许它按
   * 「反例查询确实捞到过它」进入反例轨。
   */
  it('反例轨道空缺时，用反例查询捞到的真实经历补位', async () => {
    const frame = frameFor('我是电工专业，想转行当导游');
    const regret = source({
      id: 'regret',
      author: '庚答主',
      authorBadge: '教师',
      title: '转行做导游我后悔了吗',
      quote: '我原来是教师，后来转行做导游，第一年收入腰斩，我当时很焦虑，现在还在犹豫要不要退出。',
      url: 'https://www.zhihu.com/answer/1007',
    });

    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => [...CANDIDATES, regret],
    });

    expect(result.sources).toHaveLength(4);
    const counter = result.sources.filter((item) => item.qualification?.assignedTrack === 'counter');
    expect(counter).toHaveLength(1);
    // 补位的人必须真的是反例查询捞到的（不许拿无关内容凑数）
    expect(counter[0]?.purposes).toContain('counterexample');
    expect(result.sources.some((item) => item.source.id === 'regret')).toBe(true);
    /**
     * 注意：具体是**哪一条**被补进反例轨，由与相似轨同一套确定性排序决定
     * （等级 → rankScore → 权威度 → id）—— 最像的人先坐相似轨，剩下的才去补位。
     * 这里只断言机制，不断言身份。
     */
  });

  it('反例轨优先补「像反例」的那条，而不是排名碰巧空出来的顺利故事', async () => {
    const frame = frameFor('我是电工专业，想转行当导游');
    const seat = (id: string, quote: string, upvotes: number) =>
      source({
        id,
        author: `答主-${id}`,
        title: '我的经历',
        quote,
        upvotes,
        url: `https://www.zhihu.com/answer/${id}`,
      });

    // 三条顺利的相似经历：权威度高，先坐满相似轨
    const smooth = [
      seat('s1', '我原来是机械专业的，后来转行做导游，现在带团很顺利。', 5000),
      seat('s2', '我原来是电气专业的，后来转行做导游，现在收入不错。', 5000),
      seat('s3', '我原来做会计，后来转行做导游，现在很喜欢这份工作。', 5000),
    ];
    // 剩下的两条：一条顺利但排名更高（upvotes 300），一条后悔但排名更低（10）
    const leftoverSmooth = seat('l1', '我原来是教师，后来转行做导游，现在过得挺好。', 300);
    const leftoverRegret = seat(
      'l2',
      '我原来做销售，后来转行做导游，第一年收入腰斩，我现在很后悔，准备退出。',
      10,
    );

    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => [...smooth, leftoverSmooth, leftoverRegret],
    });

    const counter = result.sources.filter((item) => item.qualification?.assignedTrack === 'counter');
    expect(counter).toHaveLength(2);
    // 第一个反例席位必须给「后悔、准备退出」那条，而不是排名更高的 l1
    expect(counter[0]?.source.id).toBe('l2');
    expect(counter[1]?.source.id).toBe('l1');
    // 相似轨仍然是权威度最高的三条（同分之间的先后是排序细节，这里只看集合）
    expect(
      result.sources
        .filter((item) => item.qualification?.assignedTrack === 'similar')
        .map((item) => item.source.id)
        .sort(),
    ).toEqual(['s1', 's2', 's3']);

    // 同样输入必须得到同样结果（纯函数、无随机）
    const again = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => [...smooth, leftoverSmooth, leftoverRegret],
    });
    expect(again.sources.map((item) => item.source.id)).toEqual(
      result.sources.map((item) => item.source.id),
    );
  });

  it('被反例查询捞到的同路人仍然占相似轨的位置', async () => {
    const frame = frameFor('我是电工专业，想转行当导游');
    const result = await retrieveExperienceSources({
      plan: buildSearchPlan({ frame }),
      frame,
      search: async () => CANDIDATES,
    });

    const accounting = result.sources.find((item) => item.source.id === 'accounting');
    expect(accounting?.purposes).toContain('counterexample');
    expect(accounting?.qualification?.similarityTier).toBe('same-target');
    expect(accounting?.qualification?.assignedTrack).toBe('similar');
  });
});
