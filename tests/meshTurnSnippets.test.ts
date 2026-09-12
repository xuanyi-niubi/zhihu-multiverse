import { describe, expect, it } from 'vitest';

import { meshToTurnSnippets } from '@/core/evidence/meshClient';

import type { DecisionPath, EvidenceMesh, PathCard } from '@/types/evidence';

/**
 * 证据网格 → AI 回合语料（v2 §1 第 1 条）。
 *
 * 这一层是「知乎真正成为游戏核心」的接线点：
 * 在它之前，`play/page.tsx` 里的 `zhihuSnippets` 是**硬编码空数组**，
 * 检索结果从未进入回合生成。因此这里必须有回归保护 ——
 * 一旦有人把接线拆掉，测试要立刻红。
 */

function card(overrides: Partial<PathCard> = {}): PathCard {
  return {
    cardId: 'card-1',
    sourceId: 'src-1',
    author: '答主甲',
    authorUrlToken: null,
    sourceUrl: 'https://www.zhihu.com/answer/1',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    authority: 'high',
    authorityRank: 3,
    upvotes: 421,
    title: '在职转码两年上岸',
    quote: '我是在职备考两年上岸的，代价是两年没有周末。',
    shape: { from: '二本法学', move: '在职备考', duration: '两年', cost: [], outcome: '上岸' },
    status: 'verified',
    ...overrides,
  };
}

function path(overrides: Partial<DecisionPath> = {}): DecisionPath {
  return {
    pathId: 'path-part-time-pivot',
    label: '在职转型',
    summary: '边工作边挪',
    cards: [card()],
    sampleSize: 3,
    grade: 'strong',
    evidenceStrength: 0.8,
    costProfile: {
      timeCostMonths: { min: 19, max: 29 },
      moneyCost: 'medium',
      irreversible: null,
      requiresAlly: null,
    },
    ...overrides,
  };
}

function mesh(paths: readonly DecisionPath[]): EvidenceMesh {
  return {
    meshId: 'mesh-test',
    goal: '大三法学想转计算机',
    queries: ['大三 法学 转码'],
    paths,
    axes: [],
    meshHash: 'deadbeefdeadbeef',
    generatedAt: '2026-09-12T00:00:00.000Z',
    provenance: 'zhihu-search',
  };
}

describe('meshToTurnSnippets', () => {
  it('把真实路径卡转成 AI 可消费的语料（知乎真正进入回合生成）', () => {
    const snippets = meshToTurnSnippets(mesh([path()]));
    expect(snippets).toHaveLength(1);
    expect(snippets[0].author).toBe('答主甲');
    expect(snippets[0].quote).toContain('在职备考');
    expect(snippets[0].sourceUrl).toBe('https://www.zhihu.com/answer/1');
    expect(snippets[0].upvotes).toBe(421);
    expect(snippets[0].answerId).toBe('src-1');
  });

  it('空网格 → 空数组（不编造语料）', () => {
    expect(meshToTurnSnippets(mesh([]))).toHaveLength(0);
    expect(meshToTurnSnippets(mesh([path({ sampleSize: 0, cards: [] })]))).toHaveLength(0);
  });

  it('thin 路线没有卡片，自然不产生片段', () => {
    const thin = path({ grade: 'thin', evidenceStrength: 0.05, sampleSize: 0, cards: [] });
    expect(meshToTurnSnippets(mesh([thin]))).toHaveLength(0);
  });

  it('按网格给出的路径顺序取（网格已按证据强度排序，因此先取最有据的）', () => {
    const strong = path({ pathId: 'p-strong', cards: [card({ cardId: 'c-strong' })] });
    const weak = path({
      pathId: 'p-weak',
      grade: 'partial',
      evidenceStrength: 0.45,
      cards: [card({ cardId: 'c-weak', author: '答主乙', sourceId: 'src-2' })],
    });
    const snippets = meshToTurnSnippets(mesh([strong, weak]));
    expect(snippets[0].answerId).toBe('src-1');
    expect(snippets[1].answerId).toBe('src-2');
  });

  it('跨路线去重：同一张卡不会重复注入 prompt', () => {
    const shared = card({ cardId: 'card-shared' });
    const snippets = meshToTurnSnippets(
      mesh([
        path({ pathId: 'p1', cards: [shared] }),
        path({ pathId: 'p2', cards: [shared] }),
      ]),
    );
    expect(snippets).toHaveLength(1);
  });

  it('limit 生效，避免把 prompt 撑爆', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      card({ cardId: `card-${index}`, sourceId: `src-${index}` }),
    );
    expect(meshToTurnSnippets(mesh([path({ cards: many })]), { limit: 5 })).toHaveLength(5);
  });

  it('接口没给赞同数时不带 upvotes 字段（不补 0，不编数字）', () => {
    const snippets = meshToTurnSnippets(mesh([path({ cards: [card({ upvotes: null })] })]));
    expect(snippets[0].upvotes).toBeUndefined();
  });

  it('所有片段都带 https 原链接（AI 不能凭空造来源）', () => {
    const snippets = meshToTurnSnippets(mesh([path()]));
    for (const snippet of snippets) {
      expect(snippet.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});
