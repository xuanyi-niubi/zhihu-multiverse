import type { DmZhihuSnippet } from '@/core/dm/prompt';
import type { ZhihuSearchItem } from '@/core/zhihu/client';

/**
 * 把知乎搜索结果映射成 AI DM 可消费的语料片段。
 *
 * 三条筛选规则，对应「权威度优先」的产品要求：
 * 1. 权威等级 >= 2（中权威及以上）优先；不足时退回全部，避免把演示卡死。
 * 2. 摘要清洗：去掉高亮 `<em>` 标签、折叠空白、截断到 140 字。
 * 3. 按赞同数降序，让模型先看到社区公认度最高的经验。
 */

const MAX_QUOTE_LENGTH = 140;

/** 权威等级数字越大越权威；缺失视为最低。 */
function authorityRank(level: string | undefined): number {
  const parsed = Number(level);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cleanText(raw: string): string {
  return raw
    .replace(/<\/?em>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function toDmSnippets(
  items: readonly ZhihuSearchItem[],
  options: { readonly limit?: number; readonly minAuthority?: number } = {},
): DmZhihuSnippet[] {
  const { limit = 5, minAuthority = 2 } = options;

  const usable = items.filter((item) => {
    const text = cleanText(item.ContentText);
    return item.Title.length > 0 && text.length > 0 && /^https:\/\//.test(item.Url);
  });

  const authoritative = usable.filter((item) => authorityRank(item.AuthorityLevel) >= minAuthority);
  const pool = authoritative.length > 0 ? authoritative : usable;

  return pool
    .slice()
    .sort((left, right) => right.VoteUpCount - left.VoteUpCount)
    .slice(0, limit)
    .map((item) => ({
      author: item.AuthorName.trim().length > 0 ? item.AuthorName.trim() : '知乎用户',
      quote: truncate(cleanText(item.ContentText), MAX_QUOTE_LENGTH),
      sourceUrl: item.Url,
      title: truncate(item.Title.replace(/\s*-\s*知乎$/, ''), 60),
      upvotes: item.VoteUpCount,
      answerId: item.ContentID,
    }));
}
