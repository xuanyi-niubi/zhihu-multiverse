import type {
  ExperienceFact,
  ExperienceFactType,
  SearchPurpose,
  SourceQualification,
} from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 经验片段校验（Phase 6 / P0-D）。
 *
 * ## 这一层是整个产品的诚信底线
 *
 * 模型（或未来的任何提取器）只拥有**提议权**：它说「这句是原文里的」，
 * 本模块负责核实。核实规则刻意苛刻：
 *
 * ```text
 * exactQuote.trim() 必须是 source.quote 的逐字子串
 * ```
 *
 * ## 绝不允许「模糊修复」
 *
 * 下面这些做法**全部禁止**（它们会让「AI 改写过的句子」冒充原文）：
 *
 * - Levenshtein 找最接近的句子；
 * - 让 AI 再修一次 quote；
 * - 自动替换标点强行命中；
 * - 用编辑距离放宽子串判定。
 *
 * 校验不过 → **丢**。少一条事实，世界依然成立；
 * 一条假原文，整个「真实经验」的招牌就塌了。
 */

/** 片段最短长度。再短的片段无法独立表达一条经验。 */
export const MIN_EXACT_QUOTE_LENGTH = 12;
/** 单个来源最多提炼几条片段（防 prompt 爆炸）。 */
export const MAX_FACTS_PER_SOURCE = 5;
/** 全局片段上限。 */
export const MAX_TOTAL_FACTS = 30;

const LEGAL_TYPES: readonly ExperienceFactType[] = [
  'condition',
  'action',
  'cost',
  'outcome',
  'reflection',
];

export interface ValidateExtractedFactInput {
  readonly source: KnowledgeSource;
  readonly exactQuote: string;
  readonly type: ExperienceFactType;
  /** 片段 id。缺失时由 sourceId + 序号派生（调用方应给稳定序号）。 */
  readonly id?: string;
  /** 只用于排序。 */
  readonly relevance?: number;
  readonly purposes?: readonly SearchPurpose[];
  readonly qualification?: SourceQualification;
}

/**
 * 校验一条被提议的片段；不过就 `null`。
 *
 * 外层空白允许 trim（那是提取器的手抖，不是内容改写）；
 * **内容本身一个字都不能差**。
 */
export function validateExtractedFact(input: ValidateExtractedFactInput): ExperienceFact | null {
  // 只有核验过的来源才有资格进入经验层
  if (input.source.status !== 'verified') {
    return null;
  }
  if (!LEGAL_TYPES.includes(input.type)) {
    return null;
  }

  const exactQuote = input.exactQuote.trim();
  if (exactQuote.length < MIN_EXACT_QUOTE_LENGTH) {
    return null;
  }
  // 核心校验：逐字子串。没有任何模糊匹配的余地。
  if (!input.source.quote.includes(exactQuote)) {
    return null;
  }

  return {
    id: input.id ?? `fact:${input.source.id}`,
    sourceId: input.source.id,
    sourceUrl: input.source.url,
    author: input.source.author,
    sourceTitle: input.source.title ?? null,
    sourceEditTime: input.source.editTime,
    ...(input.qualification ? { qualification: input.qualification } : {}),
    exactQuote,
    type: input.type,
    relevance: input.relevance ?? 0,
    purposes: [...(input.purposes ?? [])],
  };
}
