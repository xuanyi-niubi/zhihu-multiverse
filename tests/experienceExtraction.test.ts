import { describe, expect, it } from 'vitest';

import {
  extractExperienceFacts,
  fallbackFactsFor,
  MAX_EXTRACT_SOURCES,
} from '@/features/experience/extract';
import { MAX_TOTAL_FACTS } from '@/features/experience/validate';

import type { ProviderRouter, RoutedResult } from '@/agents/providerRouter';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 经验片段提取（Phase 6 / P0-D）。
 *
 * 核心承诺：**零模型也能工作；有模型也不能造假**。
 */

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'live:src-1',
    author: '某位走过这条路的人',
    quote: '我当时大二，基础一般，边上课边准备比赛，每周大概花十个小时，最后拿了省二。',
    upvotes: 321,
    url: 'https://www.zhihu.com/question/9/answer/1',
    retrievedAt: '2026-09-01T00:00:00.000Z',
    status: 'verified',
    editTime: 1756684800,
    authority: 3,
    ...overrides,
  };
}

function routerOf(text: string, ok = true): ProviderRouter {
  const result: RoutedResult = {
    ok,
    text,
    provider: ok ? 'fake' : null,
    model: ok ? 'fake-model' : null,
    attempts: [],
  };
  return {
    providers: ['fake'],
    complete: async () => result,
  };
}

const QUESTION = '大二想参加比赛';

describe('fallback：无模型也产出可追溯片段', () => {
  it('verified 来源 → 一条片段，exactQuote 与原文一致', () => {
    const facts = fallbackFactsFor({ source: source(), question: QUESTION });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.exactQuote).toBe(source().quote);
    expect(facts[0]!.sourceUrl).toBe(source().url);
    expect(facts[0]!.author).toBe(source().author);
  });

  it('scripted 来源 → 拒绝', () => {
    expect(fallbackFactsFor({ source: source({ status: 'scripted' }), question: QUESTION })).toHaveLength(0);
  });

  it('类型判型复用现有规则（opinion 归 reflection）', () => {
    // 判型词序：cost/outcome/condition 都不命中时才是 opinion
    const facts = fallbackFactsFor({
      source: source({ quote: '我觉得值得尝试，没必要犹豫，最好直接开始，越早越好。' }),
      question: QUESTION,
    });
    expect(facts[0]!.type).toBe('reflection');
  });
});

describe('model 路径：模型只有提议权', () => {
  it('合法提议被采纳', async () => {
    const src = source();
    const router = routerOf(
      JSON.stringify({
        facts: [{ sourceId: src.id, exactQuote: '边上课边准备比赛，每周大概花十个小时', type: 'cost' }],
      }),
    );
    const result = await extractExperienceFacts({
      sources: [src],
      question: QUESTION,
      router,
    });
    expect(result.source).toBe('model');
    expect(result.facts[0]!.exactQuote).toBe('边上课边准备比赛，每周大概花十个小时');
    expect(result.facts[0]!.type).toBe('cost');
  });

  it('模型改写了原文（差一个字）→ 该条被丢弃', async () => {
    const src = source();
    const router = routerOf(
      JSON.stringify({
        facts: [{ sourceId: src.id, exactQuote: '边上课边准备比赛呀', type: 'action' }],
      }),
    );
    const result = await extractExperienceFacts({ sources: [src], question: QUESTION, router });
    // 模型全军覆没 → 整体回落 fallback（零模型保底）
    expect(result.source).toBe('fallback');
    expect(result.facts).toHaveLength(1);
  });

  it('模型提议不存在的 sourceId → 丢弃', async () => {
    const router = routerOf(
      JSON.stringify({ facts: [{ sourceId: 'live:ghost', exactQuote: '这句话根本不在任何来源里', type: 'cost' }] }),
    );
    const result = await extractExperienceFacts({ sources: [source()], question: QUESTION, router });
    expect(result.source).toBe('fallback');
  });

  it('模型返回烂 JSON → 回落 fallback', async () => {
    const router = routerOf('我觉得你应该直接去参加比赛，加油！');
    const result = await extractExperienceFacts({ sources: [source()], question: QUESTION, router });
    expect(result.source).toBe('fallback');
  });

  it('模型调用失败（ok=false / 抛错）→ 回落 fallback', async () => {
    const failing = routerOf('', false);
    const throwing: ProviderRouter = {
      providers: ['fake'],
      complete: async () => {
        throw new Error('网络炸了');
      },
    };
    for (const router of [failing, throwing]) {
      const result = await extractExperienceFacts({ sources: [source()], question: QUESTION, router });
      expect(result.source).toBe('fallback');
      expect(result.facts).toHaveLength(1);
    }
  });
});

describe('上限三道闸', () => {
  it('来源超过 12 → 只取前 12（与检索层封顶一致）', async () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      source({ id: `live:src-${index}`, url: `https://www.zhihu.com/${index}` }),
    );
    const facts = many.flatMap((item, index) => fallbackFactsFor({ source: item, question: QUESTION, index }));
    // fallback 路径下单来源 1 条 → 全量 20 条会被 extractExperienceFacts 截到 30 内；
    // 而来源闸是 12，通过 extract 入口验证
    const result = await extractExperienceFacts({ sources: many, question: QUESTION, router: null });
    expect(result.facts).toHaveLength(MAX_EXTRACT_SOURCES);
    expect(facts.length).toBe(20);
  });

  it('全局片段不超过 30', async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      source({ id: `live:flood-${index}`, url: `https://www.zhihu.com/flood/${index}` }),
    );
    const result = await extractExperienceFacts({ sources: many, question: QUESTION, router: null });
    expect(result.facts).toHaveLength(Math.min(MAX_TOTAL_FACTS, MAX_EXTRACT_SOURCES));
  });

  it('单来源模型提议超过 5 条 → 只留 5', async () => {
    const src = source({
      quote: '第一条边上课边准备比赛最后拿了省二。第二条我基础一般每周大概花十小时。第三条队友是同班同学一起组队。第四条寒假留校集训两周。第五条指导老师每周看一次进度。第六条赛前熬夜改了三版方案。',
    });
    const LEGAL = ['边上课边准备比赛最后拿了省二。', '我基础一般每周大概花十小时。', '队友是同班同学一起组队。', '第四条寒假留校集训两周。', '指导老师每周看一次进度。', '赛前熬夜改了三版方案。'];
    const router = routerOf(
      JSON.stringify({
        facts: LEGAL.map((exactQuote, index) => ({
          sourceId: src.id,
          exactQuote,
          type: index % 2 === 0 ? 'action' : 'cost',
        })),
      }),
    );
    const result = await extractExperienceFacts({ sources: [src], question: QUESTION, router });
    expect(result.source).toBe('model');
    expect(result.facts).toHaveLength(5);
  });
});
