import { describe, expect, it } from 'vitest';

import {
  PATH_ARCHETYPES,
  buildMesh,
  costProfileOf,
  evidencedPaths,
  isEmptyMesh,
  matchArchetypes,
} from '@/core/evidence/mesh';
import { authorityScore, gradeOf, gradeLabel, strengthOf } from '@/core/evidence/strength';
import { durationToMonths, extractDuration, toPathCards } from '@/core/evidence/cards';
import { describePlan, keywordSetsFor, planQueries } from '@/core/evidence/plan';
import { AXES } from '@/core/decision/axis';

import type { PathCard } from '@/types/evidence';

/** 证据层的契约测试（方案 §5）。重点锁住「无据不填数」。 */

const NOW = Date.parse('2026-09-12T00:00:00.000Z');

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
    upvotes: 500,
    title: '在职备考两年上岸',
    quote: '我是在职备考两年上岸的，代价是两年没有周末，颈椎也出了问题。',
    shape: {
      from: '二本法学',
      move: '在职备考',
      duration: '两年',
      cost: ['两年没有周末', '颈椎出了问题'],
      outcome: '上岸',
    },
    status: 'verified',
    ...overrides,
  };
}

describe('extractDuration / durationToMonths', () => {
  it('认阿拉伯数字与中文数字', () => {
    expect(extractDuration('花了2年')).toBe('2年');
    expect(extractDuration('三年才上岸')).toBe('3年');
    expect(extractDuration('十个月')).toBe('10个月');
    expect(extractDuration('半年就放弃')).toBe('半年');
  });

  it('没有明确时长时返回 null（不编）', () => {
    expect(extractDuration('很久很久')).toBeNull();
    expect(extractDuration('花了点时间')).toBeNull();
  });

  it('月数换算给出保守区间而不是精确值', () => {
    expect(durationToMonths('2年')).toEqual({ min: 19, max: 29 });
    expect(durationToMonths('半年')).toEqual({ min: 6, max: 6 });
    expect(durationToMonths(null)).toBeNull();
  });
});

describe('matchArchetypes', () => {
  it('按关键词归档到互斥路线', () => {
    expect(matchArchetypes(card())).toContain('path-part-time-pivot');
    expect(matchArchetypes(card({ title: '考公上岸经验', quote: '考公上岸经验分享，体制内三年。' }))).toContain(
      'path-stable-track',
    );
  });

  it('每条原型都有 id/label/summary/keywords', () => {
    for (const archetype of PATH_ARCHETYPES) {
      expect(archetype.pathId).toMatch(/^path-/);
      expect(archetype.label.length).toBeGreaterThan(0);
      expect(archetype.summary.length).toBeGreaterThan(0);
      expect(archetype.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('costProfileOf', () => {
  it('缺项为 null，不被当成 0', () => {
    const bare = card({
      quote: '就是转了，没什么好说的。',
      shape: { from: '', move: '转行', duration: null, cost: [], outcome: '' },
    });
    const profile = costProfileOf([bare]);
    expect(profile.timeCostMonths).toBeNull();
    expect(profile.moneyCost).toBe('unknown');
    expect(profile.irreversible).toBeNull();
    expect(profile.requiresAlly).toBeNull();
  });

  it('资金档位取最高的那条样本', () => {
    const cheap = card({ cardId: 'c1', quote: '基本没花什么钱，免费资源够用。' });
    const expensive = card({ cardId: 'c2', quote: '为了这个负债了两年。' });
    expect(costProfileOf([cheap, expensive]).moneyCost).toBe('high');
  });

  it('时间成本取所有样本的区间包络', () => {
    const short = card({ cardId: 'c1', shape: { from: '', move: '', duration: '半年', cost: [], outcome: '' } });
    const long = card({ cardId: 'c2', shape: { from: '', move: '', duration: '3年', cost: [], outcome: '' } });
    expect(costProfileOf([short, long]).timeCostMonths).toEqual({ min: 6, max: 43 });
  });
});

describe('strengthOf / gradeOf', () => {
  it('样本量主导：一条高权威孤例弱于三条普通同向样本', () => {
    const lone = strengthOf([card({ authorityRank: 4, quote: '我两年上岸。' })], NOW);
    const three = strengthOf(
      [
        card({ cardId: 'c1', authorityRank: 1, quote: '我两年上岸。' }),
        card({ cardId: 'c2', authorityRank: 1, quote: '我两年上岸。' }),
        card({ cardId: 'c3', authorityRank: 1, quote: '我两年上岸。' }),
      ],
      NOW,
    );
    expect(three.strength).toBeGreaterThan(lone.strength);
  });

  it('结果说法互相矛盾时降权', () => {
    const consistent = strengthOf(
      [
        card({ cardId: 'c1', shape: { from: '', move: '', duration: null, cost: [], outcome: '成功转行' } }),
        card({ cardId: 'c2', shape: { from: '', move: '', duration: null, cost: [], outcome: '成功转行' } }),
      ],
      NOW,
    );
    const conflict = strengthOf(
      [
        card({ cardId: 'c1', shape: { from: '', move: '', duration: null, cost: [], outcome: '成功转行' } }),
        card({ cardId: 'c2', shape: { from: '', move: '', duration: null, cost: [], outcome: '彻底失败' } }),
      ],
      NOW,
    );
    expect(conflict.consistency).toBeLessThan(consistent.consistency);
    expect(conflict.strength).toBeLessThan(consistent.strength);
  });

  it('strong 必须同时满足强度与样本量（一个人说了不算）', () => {
    expect(gradeOf({ strength: 0.99, sampleSize: 1 })).toBe('partial');
    expect(gradeOf({ strength: 0.7, sampleSize: 3 })).toBe('strong');
    expect(gradeOf({ strength: 0.1, sampleSize: 3 })).toBe('thin');
    expect(gradeOf({ strength: 0, sampleSize: 0 })).toBe('thin');
  });

  it('权威度缺失不等于不可信，但明显低于有等级', () => {
    expect(authorityScore(0)).toBeLessThan(authorityScore(2));
    expect(authorityScore(0)).toBeGreaterThan(0);
    expect(authorityScore(4)).toBe(1);
  });

  it('三档都有给人看的中文说明', () => {
    expect(gradeLabel('strong')).toBe('有据');
    expect(gradeLabel('partial')).toContain('自行判断');
    expect(gradeLabel('thin')).toBe('证据不足');
  });

  it('空样本强度为 0 且有解释', () => {
    const empty = strengthOf([], NOW);
    expect(empty.strength).toBe(0);
    expect(empty.reasons.length).toBeGreaterThan(0);
  });

  /**
   * v3 §19：删掉失效的 freshness 维度。
   *
   * 官方 `EditTime` 实测返回近期时间戳，导致新鲜度因子恒为 1 ——
   * 一个「看起来在算、其实不参与排序」的装饰维度。
   * v3 的原则：**缺信号就删维度，不要伪造差异**。
   *
   * 下面几条把三因子口径钉死：**若有人把 freshness 加回权重，它们会红**。
   */
  it('v3 §19：strength 恰等于 sample×0.45 + authority×0.30 + consistency×0.25', () => {
    const cards = [
      card({ cardId: 'c1', authorityRank: 3 }),
      card({ cardId: 'c2', authorityRank: 3 }),
      card({ cardId: 'c3', authorityRank: 4 }),
    ];
    const breakdown = strengthOf(cards, NOW);
    const expected = Number(
      (breakdown.sample * 0.45 + breakdown.authority * 0.3 + breakdown.consistency * 0.25).toFixed(4),
    );
    expect(breakdown.strength).toBe(expected);
  });

  it('v3 §19：freshness 恒为 1，且抓取时间不再影响强度', () => {
    // 给一条极旧的样本：若 freshness 还参与，强度会与新鲜样本不同
    const old = strengthOf([card({ retrievedAt: '2005-01-01T00:00:00.000Z' })], NOW);
    const fresh = strengthOf([card({ retrievedAt: '2026-09-01T00:00:00.000Z' })], NOW);

    expect(old.freshness).toBe(1);
    expect(fresh.freshness).toBe(1);
    expect(old.strength).toBe(fresh.strength);
  });

  it('v3 §19：矛盾样本被降权（一致性权重 0.25 生效）', () => {
    const consistent = strengthOf(
      [
        card({ cardId: 'c1', authorityRank: 1, shape: { from: '', move: '', duration: null, cost: [], outcome: '上岸' } }),
        card({ cardId: 'c2', authorityRank: 1, shape: { from: '', move: '', duration: null, cost: [], outcome: '上岸' } }),
      ],
      NOW,
    );
    const conflict = strengthOf(
      [
        card({ cardId: 'c1', authorityRank: 1, shape: { from: '', move: '', duration: null, cost: [], outcome: '上岸' } }),
        card({ cardId: 'c2', authorityRank: 1, shape: { from: '', move: '', duration: null, cost: [], outcome: '放弃' } }),
      ],
      NOW,
    );
    // 完全不一致时一致性从 1 掉到 0.5 → 扣除 0.5 × 0.25 = 0.125
    expect(consistent.strength - conflict.strength).toBeGreaterThanOrEqual(0.12);
  });
});

describe('buildMesh', () => {
  const meshInput = {
    goal: '大二想转码',
    queries: ['大二 转码 经历'],
    provenance: 'zhihu-search' as const,
    axes: AXES,
    now: NOW,
  };

  it('确定性：与输入顺序无关，同批卡必得同一 meshHash', () => {
    const a = card({ cardId: 'c1', title: '在职转码两年上岸' });
    const b = card({ cardId: 'c2', title: '脱产考研失败复盘', quote: '脱产二战失败，退不回来了。' });

    const first = buildMesh({ ...meshInput, cards: [a, b] });
    const second = buildMesh({ ...meshInput, cards: [b, a] });
    expect(second.meshHash).toBe(first.meshHash);
    expect(second.paths.map((path) => path.pathId)).toEqual(first.paths.map((path) => path.pathId));
  });

  it('每条路线都带样本量与档位（分母必须可见）', () => {
    const mesh = buildMesh({ ...meshInput, cards: [card()] });
    for (const path of mesh.paths) {
      expect(typeof path.sampleSize).toBe('number');
      expect(['strong', 'partial', 'thin']).toContain(path.grade);
      expect(path.evidenceStrength).toBeGreaterThanOrEqual(0);
      expect(path.evidenceStrength).toBeLessThanOrEqual(1);
    }
  });

  it('没有样本时是空网格，而不是编出内容', () => {
    const mesh = buildMesh({ ...meshInput, cards: [] });
    expect(isEmptyMesh(mesh)).toBe(true);
    expect(evidencedPaths(mesh)).toHaveLength(0);
    // 空网格仍然给出全部路线（界面需要显示「证据不足」而不是留白）
    expect(mesh.paths).toHaveLength(PATH_ARCHETYPES.length);
    expect(mesh.paths.every((path) => path.grade === 'thin')).toBe(true);
  });

  it('无法归档的卡不进任何路线（不硬塞）', () => {
    const orphan = card({
      title: '今天天气不错',
      quote: '随便聊聊天气和午饭吃了什么，没有别的意思。',
      shape: { from: '', move: '', duration: null, cost: [], outcome: '' },
    });
    const mesh = buildMesh({ ...meshInput, cards: [orphan] });
    expect(evidencedPaths(mesh)).toHaveLength(0);
  });

  it('provenance 与 queries 被如实保留（透明可查）', () => {
    const mesh = buildMesh({ ...meshInput, cards: [card()] });
    expect(mesh.provenance).toBe('zhihu-search');
    expect(mesh.queries).toEqual(['大二 转码 经历']);
    expect(mesh.meshId).toMatch(/^mesh-/);
  });
});

describe('toPathCards', () => {
  const item = {
    Title: '在职转码两年上岸的真实经历 - 知乎',
    ContentType: 'answer',
    ContentID: '123456',
    ContentText: '我是在职备考两年上岸的，代价是两年没有周末。',
    Url: 'https://www.zhihu.com/answer/123456',
    CommentCount: 12,
    VoteUpCount: 890,
    AuthorName: '答主乙',
    AuthorityLevel: '3',
    EditTime: Math.floor(Date.parse('2025-06-01T00:00:00.000Z') / 1000),
  };

  it('把检索结果折成结构化卡，并带抓取/编辑时间', () => {
    const cards = toPathCards([item], {
      goal: '想转码',
      keywordSets: keywordSetsFor(planQueries({ goal: '大二想转码' })),
      retrievedAt: '2026-09-12T00:00:00.000Z',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('verified');
    expect(cards[0].upvotes).toBe(890);
    expect(cards[0].author).toBe('答主乙');
    expect(cards[0].authority).toBe('high');
    expect(cards[0].retrievedAt).toContain('2025-06-01');
  });

  it('没有原文或不是 https 的结果一律丢弃', () => {
    const bad = { ...item, ContentText: '短', Url: 'http://insecure.example.com/a' };
    expect(
      toPathCards([bad], {
        goal: 'g',
        keywordSets: [],
        retrievedAt: '2026-09-12T00:00:00.000Z',
      }),
    ).toHaveLength(0);
  });

  it('同一内容被多个 query 命中时只保留一张卡', () => {
    const cards = toPathCards([item, { ...item }], {
      goal: 'g',
      keywordSets: [],
      retrievedAt: '2026-09-12T00:00:00.000Z',
    });
    expect(cards).toHaveLength(1);
  });

  it('接口不给赞同数时是 null，不补 0 也不编造', () => {
    const cards = toPathCards([{ ...item, VoteUpCount: 0 }], {
      goal: 'g',
      keywordSets: [],
      retrievedAt: '2026-09-12T00:00:00.000Z',
    });
    expect(cards[0].upvotes).toBeNull();
  });
});

describe('planQueries', () => {
  it('产出 3–5 条互不相同的检索词，且覆盖处境与分歧', () => {
    const plan = planQueries({ goal: '大三法学想转计算机，但怕脱产找不到工作' });
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan.length).toBeLessThanOrEqual(5);
    expect(new Set(plan.map((item) => item.query)).size).toBe(plan.length);
    expect(plan.some((item) => item.intent === 'divergence')).toBe(true);
    expect(describePlan(plan)).toEqual(plan.map((item) => item.query));
  });

  it('空目标返回空计划，而不是编一句万能查询', () => {
    expect(planQueries({ goal: '   ' })).toHaveLength(0);
  });

  it('关键词集与路线原型一一对应（保证归档互斥）', () => {
    const sets = keywordSetsFor(planQueries({ goal: '大二想转码' }));
    expect(sets).toHaveLength(PATH_ARCHETYPES.length);
  });
});
