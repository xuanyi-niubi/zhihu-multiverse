import type { DmTurnInput } from '@/core/dm/prompt';

/**
 * 知乎搜索查询构造。
 *
 * 背景：AI DM 每一幕都要检索站内语料作为 grounding。但四幕如果都用玩家原话
 * 当 query，会命中同一批结果（还叠加了 LRU 缓存），导致第 2–4 幕的溯源角标
 * 反复指向同一个答主——评委连玩两幕就会看出来。
 *
 * 解决思路：按「幕序 + 该幕的冲突主题」派生差异化查询词，让每一幕检索到
 * 与当下处境更贴合的讨论，同时天然利用上搜索缓存（不同 query 不互相命中）。
 *
 * 配额意识：搜索 1000 次/天。这里不加额外请求，只是把同一个请求的 query
 * 换得更准，所以调用量不变。
 */

/** 每一幕的检索焦点：从「起步」到「收束」逐步推进。 */
const ACT_FOCUS: Readonly<Record<number, string>> = {
  1: '起步 要不要开始 第一步',
  2: '第一次受挫 坚持不下去 失败',
  3: '外部压力 家人 同辈 怎么取舍',
  4: '复盘 结局 后悔 值不值得',
};

/** 从处境档案里挑一个最具体的领域词，让 query 不泛化。 */
function domainHint(input: DmTurnInput): string {
  const profile = input.profile;

  if (profile) {
    const background = profile.background.replace(/学生|在读|大[一二三四]|研[一二三]/g, '').trim();
    if (background.length > 0 && background !== '背景未明确') {
      return background.slice(0, 12);
    }
  }

  return '';
}

/**
 * 为该幕构造搜索 query。
 *
 * 优先级：目标 + 领域词 + 幕次焦点。目标是玩家原话里信息量最大的部分，
 * 领域词让检索更聚焦，幕次焦点保证四幕各不相同。
 */
export function buildSearchQuery(input: DmTurnInput): string {
  const focus = ACT_FOCUS[input.turnIndex] ?? '校园抉择';

  // 玩家原话：截短避免 query 过长导致相关性下降
  const goal = input.goal.trim().slice(0, 24);

  if (goal.length === 0) {
    return `校园 ${focus}`;
  }

  const domain = domainHint(input);
  const parts = [goal, domain, focus].filter((part) => part.length > 0);

  return parts.join(' ').slice(0, 60);
}
