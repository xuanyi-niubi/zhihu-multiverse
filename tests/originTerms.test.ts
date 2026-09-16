import { describe, expect, it } from 'vitest';

import { harvestOriginTerms } from '@/features/experience/originTerms';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 真实起点词（检索驱动）。
 *
 * 起因：实测发现放宽层靠模型给的是**抽象标签**（技能型蓝领 / 持证技术工种），
 * 一条都命中不了；而第一轮返回的标题与作者徽章里本来就写着真实起点词
 * （机械工程 / 电气自动化 / 教师 …）。这里把词源换成"从语料里学词"。
 *
 * 纪律：**行业无关**（不含任何职业/专业清单）、零模型、抽错词只是白花一次
 * 查询而不是放宽门槛（资格判定仍由同一套矩阵决定）。
 */

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: `src-${Math.random().toString(36).slice(2, 8)}`,
    author: '某答主',
    title: null,
    authorBadge: null,
    quote: '我后来真的走过这条路，第一年很难。',
    upvotes: 10,
    url: 'https://www.zhihu.com/answer/1',
    retrievedAt: '2026-09-16T00:00:00.000Z',
    status: 'verified',
    editTime: 1_700_000_000,
    authority: 3,
    ...overrides,
  };
}

describe('从真实来源里学「起点词」', () => {
  it('作者徽章是身份声明：单条来源也采用', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ authorBadge: '机械工程' }),
        source({ authorBadge: '电气自动化' }),
        source({ authorBadge: '教师' }),
      ],
      target: '导游',
      origin: '电工',
    });

    expect(terms).toContain('机械工程');
    expect(terms).toContain('电气自动化');
    expect(terms).toContain('教师');
  });

  it('标题里的词必须跨来源重复才算共同起点', () => {
    const once = harvestOriginTerms({
      sources: [source({ title: '从土木到导游的真实经历' })],
      target: '导游',
    });
    expect(once).not.toContain('土木');

    const twice = harvestOriginTerms({
      sources: [
        source({ title: '从土木到导游的真实经历' }),
        source({ title: '土木毕业以后我转行了' }),
      ],
      target: '导游',
    });
    expect(twice).toContain('土木');
  });

  it('长片段切窗：真实语料里长句也能切出起点词', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ title: '机械工程专业毕业，后来我转行了' }),
        source({ title: '机械工程毕业那年我做了决定' }),
      ],
      target: '导游',
    });
    expect(terms).toContain('机械工程');
  });

  it('泛词、目标词、用户自己的起点词都不采用（行业无关）', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ authorBadge: '知乎用户', title: '我的转行经历分享与建议' }),
        source({ authorBadge: '匿名用户', title: '经历分享：转行这件事' }),
        source({ authorBadge: '导游' }),
        source({ authorBadge: '电工' }),
      ],
      target: '导游',
      origin: '电工',
    });

    for (const banned of ['知乎', '匿名', '经历', '分享', '建议', '转行', '导游', '电工']) {
      expect(terms).not.toContain(banned);
    }
  });

  it('同一个词在一条来源里重复出现只算一次，频次靠跨来源累积', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ title: '会计会计会计，会计转行' }),
        source({ title: '会计转行以后' }),
        source({ title: '另一个故事' }),
      ],
      target: '导游',
    });
    expect(terms).toContain('会计');
  });

  it('徽章词排在标题词前面（身份声明比标题噪声更可信）', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ authorBadge: '会计' }),
        source({ title: '会计转行实录' }),
        source({ title: '会计转行第二年' }),
      ],
      target: '导游',
      limit: 1,
    });
    expect(terms).toEqual(['会计']);
  });

  it('没有来源 / 全是泛词时返回空（不猜）', () => {
    expect(harvestOriginTerms({ sources: [], target: '导游' })).toEqual([]);
    expect(
      harvestOriginTerms({ sources: [source({ title: '我的经历分享' })], target: '导游' }),
    ).toEqual([]);
  });

  it('纯拉丁碎片（拼音）不会因为出现在徽章里就被当成起点词', () => {
    // 实测教训：线上真的抽出过 `wu fang zhen 导游 亲身经历 后来` 这种查询
    const single = harvestOriginTerms({
      sources: [source({ authorSignature: 'wu fang zhen' })],
      target: '导游',
    });
    expect(single).toEqual([]);

    // 跨来源重复的拉丁词才算数（说明它真的是这批人的共同标记）
    const repeated = harvestOriginTerms({
      sources: [source({ authorSignature: 'AI 从业' }), source({ authorSignature: 'AI 方向' })],
      target: '导游',
    });
    expect(repeated).toContain('AI');
  });

  it('同频时中文词优先于拉丁词', () => {
    const terms = harvestOriginTerms({
      sources: [source({ authorBadge: 'AI' }), source({ authorBadge: '机械' })],
      target: '导游',
      limit: 1,
    });
    expect(terms).toEqual(['机械']);
  });

  it('limit 生效，且同一输入两次结果一致（纯函数）', () => {
    const sources = [
      source({ authorBadge: '机械工程' }),
      source({ authorBadge: '电气自动化' }),
      source({ authorBadge: '教师' }),
      source({ authorBadge: '会计' }),
    ];
    const first = harvestOriginTerms({ sources, target: '导游', limit: 2 });
    const second = harvestOriginTerms({ sources, target: '导游', limit: 2 });

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
  });
});
