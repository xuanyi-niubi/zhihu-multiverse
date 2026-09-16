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

  it('同一个词在一条来源里重复出现只算一次，频次靠跨来源累积', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ authorBadge: '会计' }),
        source({ authorBadge: '会计' }),
        source({ authorBadge: '法律' }),
      ],
      target: '导游',
      limit: 1,
    });
    // 会计在 2 条来源里出现 → 排在只出现 1 次的 法律 前面
    expect(terms).toEqual(['会计']);
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

  it('徽章词按（出现次数 → 词长）稳定排序', () => {
    const terms = harvestOriginTerms({
      sources: [
        source({ authorBadge: '会计' }),
        source({ authorBadge: '机械工程' }),
      ],
      target: '导游',
      limit: 1,
    });
    // 同频同为徽章词时，更长的身份词更具体 → 排在前面
    expect(terms).toEqual(['机械工程']);
  });

  it('没有来源 / 全是泛词时返回空（不猜）', () => {
    expect(harvestOriginTerms({ sources: [], target: '导游' })).toEqual([]);
    expect(
      harvestOriginTerms({ sources: [source({ title: '我的经历分享' })], target: '导游' }),
    ).toEqual([]);
  });

  it('标题（问题级共享元数据）绝不能当词源', () => {
    /**
     * 实测：搜索返回的多是同一个问题的多个回答，标题在它们之间共享，
     * 于是任何标题 n-gram 都"自动跨来源重复"。抽出来的会是
     * `什么` / `当的越久` / `为什么电` 这种碎片 —— 量的不是起点，是问题热度。
     */
    const terms = harvestOriginTerms({
      sources: [
        source({ title: '为什么电工当的越久,越会怕电?' }),
        source({ title: '为什么电工当的越久,越会怕电?' }),
        source({ title: '做一名电工是什么体验?' }),
      ],
      target: '导游',
      origin: '电工',
    });
    expect(terms).toEqual([]);
  });

  it('长徽章只取最前的 4 字词头（不切一堆重叠前缀）', () => {
    const terms = harvestOriginTerms({
      sources: [source({ authorBadge: '特种作业操作证持证人' })],
      target: '导游',
      origin: '电工',
    });
    expect(terms).toEqual(['特种作业']);
  });

  it('账号 slug（AuthorSignature）不是身份文本，绝不能当词源', () => {
    // 实测：线上真抽出过 `wu fang zhen 导游 亲身经历 后来`，
    // 根因就是 @ 名 slug（zhen-shi-ren-wu-cai-fang 这类）被切成了拼音碎片。
    const terms = harvestOriginTerms({
      sources: [
        source({ authorSignature: 'zhen-shi-ren-wu-cai-fang' }),
        source({ authorSignature: 'zhen-shi-ren-wu-cai-fang' }),
        source({ authorSignature: 'wu-zu-niao-64' }),
      ],
      target: '导游',
    });
    expect(terms).toEqual([]);
  });

  it('纯拉丁碎片不会因为出现在徽章里就被当成起点词', () => {
    const single = harvestOriginTerms({
      sources: [source({ authorBadge: 'wu fang zhen' })],
      target: '导游',
    });
    expect(single).toEqual([]);

    // 跨来源重复的拉丁词才算数（说明它真的是这批人的共同标记）
    const repeated = harvestOriginTerms({
      sources: [source({ authorBadge: 'AI 从业' }), source({ authorBadge: 'AI 方向' })],
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
