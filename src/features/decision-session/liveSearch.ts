import { createZhihuClient, type ZhihuConfig, type ZhihuSearchItem } from '@/core/zhihu/client';
import { cleanText } from '@/core/zhihu/snippets';
import { stableHash } from '@/core/run/deterministic';

import type { ExperienceSearch } from '@/features/experience/retrieve';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 实时检索适配器（重构方案 §5.2 / §6.6）。
 *
 * ## 为什么单独一个模块
 *
 * 知乎的 `ZhihuSearchItem` 用的是 PascalCase 原始字段
 * （`ContentText` / `AuthorName` / `VoteUpCount`…），而全站内部说的是
 * `KnowledgeSource`。这层转换必须**只有一处**：
 * 旧代码里这个转换散在 `cards.ts`、`snippets.ts` 等好几处，
 * 正是方案 §1.3 D 说的「多套状态表达同一件事」。
 *
 * ## 与旧 `toPathCard` 的分工
 *
 * - `toPathCard` 产出 `PathCard`（**旧模型的结论层**：已经抽好 from/move/duration）；
 * - 本模块产出 `KnowledgeSource`（**来源层**：原文 + 作者 + 链接 + 时间）。
 *
 * 新流程只需要来源层 —— 抽取与归纳由 `facts.ts` / `routes.ts` 以
 * 「可追溯到 factId」的方式完成，不再预先压成结论。
 */

/** 一条知乎检索结果 → 一条来源。字段不合法（无原文 / 非 https）时返回 null。 */
export function searchItemToSource(item: ZhihuSearchItem, retrievedAt: string): KnowledgeSource | null {
  const quote = cleanText(item.ContentText);
  const url = item.Url;

  // 与旧口径一致：没有可引用原文或没有 https 链接的一律不进证据层
  if (quote.length < 12 || !/^https:\/\//.test(url)) {
    return null;
  }

  const rank = Number(item.AuthorityLevel);
  const authority = Number.isFinite(rank) && rank > 0 ? rank : null;
  const id = item.ContentID.trim().length > 0 ? item.ContentID : stableHash(url);

  return {
    id: `live:${id}`,
    author: item.AuthorName?.trim().length ? item.AuthorName.trim() : '匿名用户',
    title: item.Title?.trim().length ? item.Title.trim() : null,
    authorBadge: item.AuthorBadgeText?.trim().length ? item.AuthorBadgeText.trim() : null,
    contentType: item.ContentType?.trim().length ? item.ContentType.trim() : null,
    quote,
    upvotes: Number.isFinite(item.VoteUpCount) ? item.VoteUpCount : null,
    url,
    // 抓取时间与编辑时间刻意分开：前者是「我们何时拿到的」，
    // 后者是「作者何时写的」。用抓取时间做新鲜度会让所有样本永远「最新」。
    retrievedAt: typeof item.EditTime === 'number' && item.EditTime > 0
      ? new Date(item.EditTime * 1000).toISOString()
      : retrievedAt,
    status: 'verified',
    editTime: typeof item.EditTime === 'number' && item.EditTime > 0 ? item.EditTime : null,
    authority,
  };
}

/**
 * 用一个知乎配置做一次检索，返回来源列表（共享实现）。
 *
 * 失败时返回空数组（不抛）：调用方据此降到 `offline` 并**诚实地**
 * 说「当前没有可核对的来源」，而不是把上游错误包装成「没找到相关内容」。
 */
function searchSources(
  config: ZhihuConfig,
  query: string,
  count: number,
  strict = false,
): Promise<readonly KnowledgeSource[]> {
  return (async () => {
    try {
      const client = createZhihuClient(config);
      const result = await client.search(query, count);
      if (!result.ok) {
        if (strict) {
          throw new Error(`zhihu-search:${result.code}`);
        }
        return [];
      }
      const now = new Date().toISOString();
      return result.data
        .map((item) => searchItemToSource(item, now))
        .filter((source): source is KnowledgeSource => source !== null);
    } catch (error) {
      if (strict) {
        throw error;
      }
      return [];
    }
  })();
}

/** 旧主流程入口：固定取 10 条。 */
export function liveSearchWith(config: ZhihuConfig): (query: string) => Promise<readonly KnowledgeSource[]> {
  return (query: string) => searchSources(config, query, 10);
}

/**
 * 经验引擎入口（Phase 4 / P0-C）。
 *
 * 与 `liveSearchWith` 的唯一差别是数量可调 —— 字段转换**复用同一个
 * `searchItemToSource`**，不复制第二份。经验检索默认取 8 条：
 * 多 intent 去重后通常还剩得下足够样本，又比 10 条省一点传输。
 */
export function experienceSearchWith(config: ZhihuConfig): ExperienceSearch {
  return (query: string, count = 8) => searchSources(config, query, count, true);
}
