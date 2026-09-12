import generated from '@/data/zhihuSources.generated.json';

import { normalizeKnowledgeSource, type KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 已落盘的真实知乎来源（由 `npm run sync:zhihu` 用官方 key 生成）。
 *
 * 读取规则刻意宽容：文件损坏、字段缺失、或某条来源没有抓取时间，都会被
 * `normalizeKnowledgeSource` 降级成 `scripted` —— 宁可显示「剧本模拟引用」，
 * 也不把一个无法核查的数字当成真实社区数据展示。
 */

interface GeneratedFile {
  readonly generatedAt?: string | null;
  readonly sources?: Record<string, unknown>;
  /** 黄金 Demo Case：caseId → { label, anchors, paths }（v2 §21）。 */
  readonly cases?: Record<string, { readonly anchors?: unknown }>;
  /** 锚点 → 声明的路线 id（精确到锚点）。 */
  readonly anchorPaths?: Record<string, unknown>;
}

const FILE = generated as GeneratedFile;

/** 快照生成时间；没有做过同步时为 null。 */
export const SOURCES_GENERATED_AT: string | null =
  typeof FILE.generatedAt === 'string' && FILE.generatedAt.length > 0 ? FILE.generatedAt : null;

const RESOLVED: ReadonlyMap<string, KnowledgeSource> = (() => {
  const map = new Map<string, KnowledgeSource>();
  const raw = FILE.sources ?? {};

  for (const [id, value] of Object.entries(raw)) {
    const normalized = normalizeKnowledgeSource(value, id);
    if (normalized) {
      map.set(id, normalized);
    }
  }

  return map;
})();

/** 已认证来源的条数（供健康检查与文档引用）。 */
export function verifiedSourceCount(): number {
  return [...RESOLVED.values()].filter((source) => source.status === 'verified').length;
}

/**
 * 按 id 取已认证来源。
 *
 * 只返回 `verified`：脚本态来源由调用方自己的占位数据承担，
 * 不从这里返回，避免「看起来像真实来源」的混淆。
 */
export function getVerifiedSource(id: string | null | undefined): KnowledgeSource | null {
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  const found = RESOLVED.get(id);
  return found && found.status === 'verified' ? found : null;
}

/**
 * 全部已认证来源（供 DEMO MODE 构建证据网格）。
 *
 * **只返回 `verified`**：证据网格的输入只能是可以核查的真实快照。
 * `scripted` 来源在这个出口就被拦下 —— 它连机会都不该有。
 */
export function allVerifiedSources(): readonly KnowledgeSource[] {
  return [...RESOLVED.values()].filter((source) => source.status === 'verified');
}

/**
 * 按 id 前缀取来源（含 `#2` `#3` 这类同锚点的多条变体）。
 *
 * 黄金 Demo Case 的一个锚点会召回多条同向经历（同步脚本每条最多存 3 条），
 * 它们共享 `id` 前缀，因此用前缀聚合 —— 证据网格需要**多条样本**才能
 * 判定一条前人路径，单条只是个人经历。
 */
export function sourcesByPrefix(prefix: string): readonly KnowledgeSource[] {
  return [...RESOLVED.values()].filter(
    (source) => source.id === prefix || source.id.startsWith(`${prefix}#`),
  );
}

/** 黄金 Case 的索引：caseId → 锚点 id 列表。空的快照返回空对象。 */
export function caseIndex(): Readonly<Record<string, readonly string[]>> {
  const raw = FILE.cases;
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const out: Record<string, readonly string[]> = {};
  for (const [caseId, value] of Object.entries(raw)) {
    const anchors = value?.anchors;
    if (Array.isArray(anchors)) {
      out[caseId] = anchors.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  }
  return out;
}

/**
 * 锚点 → 它在同步脚本里声明的路线 id。
 *
 * 为什么需要这个映射：真实语料的措辞**不可预测**（实测「转行 AI」这类表述
 * 不会命中路线关键词表），纯关键词归档会让大量真实样本变成孤儿卡，
 * 于是「有 60 条真实来源」却聚不出任何一条路线。
 *
 * 因此采用**双轨**：
 * - 同步时人工确认过的锚点路线（`TARGETS[].path`）优先 —— 这是「人工核验」的落点；
 * - 关键词匹配（`matchArchetypes`）作为兜底，覆盖未声明路线的锚点。
 */
export function anchorPathIndex(): Readonly<Record<string, string>> {
  const raw = FILE.anchorPaths;
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [anchor, path] of Object.entries(raw)) {
    if (typeof path === 'string' && path.startsWith('path-')) {
      out[anchor] = path;
    }
  }
  return out;
}
