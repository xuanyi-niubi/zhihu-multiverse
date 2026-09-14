import { describe, expect, it } from 'vitest';

import { qualifyExperienceSource } from '@/features/experience/qualification';
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
        title: '工作十年后参加行业比赛',
        quote: '我在工作十年后报名参加行业比赛，后来完成了项目并顺利结项。',
      }),
      frame,
      purposes: ['similar-person'],
    });
    expect(result.assignedTrack).toBe('adjacent');
  });
});
