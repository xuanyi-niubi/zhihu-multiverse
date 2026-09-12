import { describe, expect, it } from 'vitest';

import { toDmSnippets } from '@/core/zhihu/snippets';

import type { ZhihuSearchItem } from '@/core/zhihu/client';

/**
 * 知乎搜索结果 → AI DM 语料片段的映射测试。
 *
 * 重点是筛选与清洗规则：权威度优先、去高亮标签、按赞同排序、丢掉不可用条目。
 */

function item(overrides: Partial<ZhihuSearchItem> = {}): ZhihuSearchItem {
  return {
    Title: '法学转计算机可行吗 - 知乎',
    ContentType: 'Answer',
    ContentID: '1496180442',
    ContentText: '我就法学转 it 的，干到现在，快 30 了，说几点感受。',
    Url: 'https://www.zhihu.com/question/421912811/answer/1496180442',
    CommentCount: 12,
    VoteUpCount: 100,
    AuthorName: '匿名用户',
    AuthorityLevel: '4',
    ...overrides,
  };
}

describe('toDmSnippets', () => {
  it('映射基本字段并去掉标题的「- 知乎」后缀', () => {
    const [snippet] = toDmSnippets([item()]);

    expect(snippet.author).toBe('匿名用户');
    expect(snippet.title).toBe('法学转计算机可行吗');
    expect(snippet.answerId).toBe('1496180442');
    expect(snippet.upvotes).toBe(100);
    expect(snippet.sourceUrl).toBe('https://www.zhihu.com/question/421912811/answer/1496180442');
  });

  it('优先保留中权威及以上内容', () => {
    const snippets = toDmSnippets([
      item({ ContentID: 'low', AuthorityLevel: '1', VoteUpCount: 999 }),
      item({ ContentID: 'high', AuthorityLevel: '3', VoteUpCount: 10 }),
    ]);

    expect(snippets).toHaveLength(1);
    expect(snippets[0].answerId).toBe('high');
  });

  it('全部低权威时退回全集，不把演示卡死', () => {
    const snippets = toDmSnippets([
      item({ ContentID: 'a', AuthorityLevel: '1' }),
      item({ ContentID: 'b', AuthorityLevel: '1' }),
    ]);

    expect(snippets).toHaveLength(2);
  });

  it('按赞同数降序排列', () => {
    const snippets = toDmSnippets([
      item({ ContentID: 'low', VoteUpCount: 5 }),
      item({ ContentID: 'high', VoteUpCount: 500 }),
    ]);

    expect(snippets[0].answerId).toBe('high');
  });

  it('清洗高亮标签与折叠空白', () => {
    const [snippet] = toDmSnippets([
      item({ ContentText: '这是<em>重点</em>\n\n  内容' }),
    ]);

    expect(snippet.quote).toBe('这是重点 内容');
  });

  it('超长摘要被截断', () => {
    const [snippet] = toDmSnippets([item({ ContentText: '啊'.repeat(400) })]);

    expect(snippet.quote.length).toBeLessThanOrEqual(140);
    expect(snippet.quote.endsWith('…')).toBe(true);
  });

  it('丢弃空标题、空内容与非 https 链接', () => {
    const snippets = toDmSnippets([
      item({ ContentID: 'no-title', Title: '' }),
      item({ ContentID: 'no-content', ContentText: '   ' }),
      item({ ContentID: 'bad-url', Url: 'http://www.zhihu.com/x' }),
      item({ ContentID: 'good' }),
    ]);

    expect(snippets).toHaveLength(1);
    expect(snippets[0].answerId).toBe('good');
  });

  it('作者名为空时回落到「知乎用户」', () => {
    const [snippet] = toDmSnippets([item({ AuthorName: '   ' })]);

    expect(snippet.author).toBe('知乎用户');
  });

  it('limit 生效', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      item({ ContentID: `c${index}`, VoteUpCount: index }),
    );

    expect(toDmSnippets(many, { limit: 3 })).toHaveLength(3);
  });

  it('空输入返回空数组', () => {
    expect(toDmSnippets([])).toEqual([]);
  });
});
