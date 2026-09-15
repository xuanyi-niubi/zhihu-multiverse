import { describe, expect, it } from 'vitest';

import { qualifyExperienceSource } from '@/features/experience/qualification';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';
import type { ProblemFrame } from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

const frame: ProblemFrame = {
  rawQuestion: '大二数据科学，基础一般，想参加比赛但怕影响课程',
  currentSituation: '大二数据科学，基础一般',
  desiredChange: '参加比赛',
  constraints: [
    { id: 'time', text: '不能影响课程', origin: 'user-explicit', hard: true },
  ],
  resources: [],
  concerns: [],
  centralTension: '积累经验与课程时间',
  unknowns: [],
  parseConfidence: 0.8,
};

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'source',
    author: '答主',
    title: '大二第一次参加比赛是什么体验？',
    quote: '我当时大二，基础一般，报名参加比赛，后来做完了项目，但确实耽误了两周课程。',
    upvotes: 20,
    url: 'https://www.zhihu.com/question/1/answer/2',
    retrievedAt: '2026-09-14T00:00:00.000Z',
    status: 'verified',
    editTime: 1756684800,
    authority: 1,
    ...overrides,
  };
}

describe('人物资格审查', () => {
  it('亲历、相关且命中明确条件时才进入相似轨道', () => {
    const result = qualifyExperienceSource({
      source: source(),
      frame,
      purposes: ['similar-person'],
    });
    expect(result.eligibleAsCase).toBe(true);
    expect(result.firsthand).toBe('yes');
    expect(result.assignedTrack).toBe('similar');
    expect(result.matchedConstraints.length).toBeGreaterThan(0);
  });

  it('纯建议不能冒充一个走过这条路的人', () => {
    const result = qualifyExperienceSource({
      source: source({
        quote: '建议大学生先把基础学好，然后再考虑要不要报名参加比赛。',
      }),
      frame,
      purposes: ['similar-person'],
    });
    expect(result.firsthand).toBe('no');
    expect(result.eligibleAsCase).toBe(false);
  });

  it('明显推广内容即使使用第一人称也不能进入人物经历', () => {
    const result = qualifyExperienceSource({
      source: source({
        quote: '我当时也基础一般，后来参加比赛成功了，想领取资料请加微信私信咨询付费课程。',
      }),
      frame,
      purposes: ['similar-person'],
    });
    expect(result.commercialRisk).toBe('high');
    expect(result.eligibleAsCase).toBe(false);
  });

  it('没有命中用户条件的相似检索结果只能进入邻近轨道', () => {
    const result = qualifyExperienceSource({
      source: source({
        title: '工作十年后参加比赛',
        quote: '我在工作十年后报名参加比赛，后来完成了项目并顺利结项。',
      }),
      frame,
      purposes: ['similar-person'],
    });
    expect(result.similarityTier).toBe('same-target');
    expect(result.assignedTrack).toBe('similar');
  });
});

const transitionFrame: ProblemFrame = {
  rawQuestion: '我是电工专业，然后想转导游',
  currentSituation: '电工专业',
  desiredChange: '转导游',
  constraints: [],
  resources: [],
  concerns: [],
  centralTension: '',
  unknowns: [],
  parseConfidence: 0.8,
};

function transitionSource(quote: string): KnowledgeSource {
  return source({
    title: '我的转行经历',
    quote,
    url: `https://www.zhihu.com/answer/${encodeURIComponent(quote)}`,
  });
}

function tierOf(quote: string) {
  return qualifyExperienceSource({
    source: transitionSource(quote),
    frame: transitionFrame,
    purposes: ['similar-person'],
    intent: buildTransitionIntent(transitionFrame, {
      familyOrigins: ['电气类', '自动化'],
      domainOrigins: ['工科', '机械专业'],
      adjacentTargets: ['领队', '旅游从业'],
      counterTerms: ['退出', '后悔'],
    }),
  });
}

describe('跨行业经历相似等级', () => {
  it('完整命中起点与目标才是完全同路', () => {
    const result = tierOf('我原来是电工，后来转行做了导游，最后留在旅行社工作。');
    expect(result.similarityTier).toBe('exact');
    expect(result.matchedOriginTerms).toContain('电工');
    expect(result.matchedTargetTerms).toContain('导游');
  });

  it('同职业族与同领域按层级放宽', () => {
    expect(tierOf('我学的是自动化，后来转行做导游，最后带上了团。').similarityTier)
      .toBe('same-family');
    expect(tierOf('我机械专业毕业，后来转行做导游，最后进入旅行社。').similarityTier)
      .toBe('same-domain');
  });

  it('其他背景进入相同目标仍可参考，但不能冒充同起点', () => {
    expect(tierOf('我原来做会计，后来考证转行做导游，最后开始带团。').similarityTier)
      .toBe('same-target');
  });

  it('目标相邻时明确降为相邻路径', () => {
    const result = tierOf('我工科毕业，后来进入旅游行业做领队，最后开始带团。');
    expect(result.similarityTier).toBe('adjacent-target');
    expect(result.assignedTrack).toBe('adjacent');
  });

  it('仅仅是别的转行故事不能进入经验层', () => {
    const result = tierOf('我以前是程序员，后来转行做产品经理，最后成功入职。');
    expect(result.similarityTier).toBe('unrelated');
    expect(result.eligibleAsCase).toBe(false);
  });

  it('查询目的不能替正文决定相似性', () => {
    const result = tierOf('我后来决定换工作，最后进入了互联网公司。');
    expect(result.similarityTier).toBe('unrelated');
    expect(result.assignedTrack).not.toBe('similar');
  });
});
