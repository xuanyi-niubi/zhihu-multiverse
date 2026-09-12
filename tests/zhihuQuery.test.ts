import { describe, expect, it } from 'vitest';

import { buildSearchQuery } from '@/core/zhihu/query';

import type { DmTurnInput } from '@/core/dm/prompt';

/**
 * 搜索 query 构造测试。
 *
 * 核心不变量：**四幕的 query 必须互不相同**。否则 AI DM 会反复拿到同一批
 * 语料（还会命中 LRU 缓存），溯源角标在评委眼里就穿帮了。
 */

function input(over: Partial<DmTurnInput> = {}): DmTurnInput {
  return {
    goal: '大三法学，想转计算机，但怕脱产找不到工作',
    seed: 'SEED-2026-TEST',
    turnIndex: 1,
    totalTurns: 4,
    stats: { san: 90, skill: 10, bond: 20 },
    inventory: [],
    zhihuSnippets: [],
    history: [],
    personaTags: [],
    ...over,
  };
}

describe('buildSearchQuery', () => {
  it('四幕的 query 互不相同', () => {
    const queries = [1, 2, 3, 4].map((turnIndex) =>
      buildSearchQuery(input({ turnIndex })),
    );

    expect(new Set(queries).size).toBe(4);
  });

  it('包含玩家目标的关键词', () => {
    const query = buildSearchQuery(input());
    expect(query).toContain('转计算机');
  });

  it('不同目标产生不同 query', () => {
    const a = buildSearchQuery(input({ goal: '大三法学，想转计算机' }));
    const b = buildSearchQuery(input({ goal: '双非本科怎么冲大厂实习' }));

    expect(a).not.toBe(b);
  });

  it('空目标也能产出可用 query，不返回空串', () => {
    const query = buildSearchQuery(input({ goal: '' }));

    expect(query.length).toBeGreaterThan(0);
    expect(query).toContain('校园');
  });

  it('query 长度受控，不无限增长', () => {
    const query = buildSearchQuery(input({ goal: '一'.repeat(200) }));
    expect(query.length).toBeLessThanOrEqual(60);
  });

  it('每一幕都带该幕的检索焦点', () => {
    expect(buildSearchQuery(input({ turnIndex: 1 }))).toContain('起步');
    expect(buildSearchQuery(input({ turnIndex: 2 }))).toContain('受挫');
    expect(buildSearchQuery(input({ turnIndex: 3 }))).toContain('压力');
    expect(buildSearchQuery(input({ turnIndex: 4 }))).toContain('复盘');
  });

  it('越界幕数回落到通用焦点而不抛异常', () => {
    expect(() => buildSearchQuery(input({ turnIndex: 9 }))).not.toThrow();
    expect(buildSearchQuery(input({ turnIndex: 9 }))).toContain('校园抉择');
  });

  it('有处境档案时用其领域词而非泛称', () => {
    const query = buildSearchQuery(
      input({
        goal: '想转行',
        profile: {
          background: '法学 大三学生',
          target: '转入技术岗',
          constraints: [],
          fears: [],
          resources: [],
          keyTension: '想转行但怕失败',
          riskAppetite: 'low',
          arc: ['a', 'b', 'c', 'd'],
        },
      }),
    );

    // 「大三」「学生」这类泛称被剥掉，保留「法学」这个具体领域词
    expect(query).toContain('法学');
    expect(query).not.toContain('大三学生');
  });

  it('结果稳定：同输入同输出', () => {
    const first = buildSearchQuery(input({ turnIndex: 2 }));
    const second = buildSearchQuery(input({ turnIndex: 2 }));
    expect(first).toBe(second);
  });
});
