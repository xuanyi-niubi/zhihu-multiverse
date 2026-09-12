import type { KnowledgeSource } from '@/features/run/knowledgeSource';
import type { EvidenceFact, FactType } from '@/features/decision-session/domain';

/**
 * 快照 → 可追溯事实（重构方案 §5.1 / §12 P0）。
 *
 * ## 它替换了什么
 *
 * 旧链路是：
 *
 * ```text
 * 回答摘要里的第一个时长
 *   → durationToMonths 生成一个 ±20% 的浮动范围
 *   → 多条回答聚合成「路径成本」
 *   → 成本的**上沿**成为用户的最低时间要求
 *   → 输出「可行 / 不可行 / 还差 N 个月」
 * ```
 *
 * 中间那步「为单点时长人为生成浮动范围」是本方案点名要删的（§7.3）：
 * 它把「某个人说两个月」伪装成了「两个月上下浮动」——
 * 而原文里根本没有浮动，那是代码造出来的精度。
 *
 * ## 新规则
 *
 * 1. `quote` 必须是**原文精确片段**（直接取 `KnowledgeSource.quote`，不做任何改写）；
 * 2. `explicitValue` **只在原文明确写出数值时才有值**，且保留原文措辞（「两个月」）；
 * 3. 原文没写数值 → `explicitValue` 为 `undefined`，展示层显示「待验证」。
 *    **不许推导、不许插值、不许区间化。**
 */

/**
 * 时长候选形式。
 *
 * 分两类，**这是本模块最关键的一处判断**：
 *
 * - `UNAMBIGUOUS`（含「个」/「半年」/「年半」）：字面就是时长，可直接采信；
 * - `AMBIGUOUS`（「X 年」「X 周」「X 天」）：**必须**附近有投入线索词
 *   （花 / 用 / 需要 / 大概…），否则它极可能是日期或时点。
 *
 * 为什么必须分开：初版把日期与时长混在一起匹配，于是
 * 「2025年11月14日09:00-11月18日10:00举行」被提取成 `00-11月`，
 * 「一般每年的一月份」被提取成 `一月` —— 把**日期**当成了**时长**。
 * 那正是本方案 §1.2 点名要消灭的伪精确：用一个看起来精确的值替代诚实。
 */
const UNAMBIGUOUS_DURATION =
  /(\d+\s*[-~到至]\s*\d+\s*个月)|(\d+\s*个月)|([一二两三四五六七八九十]+个月)|(半年)|([一二两三四五六七八九十]+年半)/g;
const AMBIGUOUS_DURATION =
  /(\d+\s*[-~到至]\s*\d+\s*(?:年|周|天))|(\d+\s*(?:年|周|天))|([一二两三四五六七八九十]+年)/g;

/** 投入线索词：出现在候选值之前，才认为它是「花了多久」而不是一个时点。 */
const DURATION_CUES: readonly string[] = [
  '花', '用', '需要', '大概', '约', '前后', '历时', '持续', '过了', '耗', '投入', '坚持', '干了', '做了',
];

/**
 * 日期／时刻片段。**先剔除再找时长** ——
 * 「2025年11月14日 09:00-11月18日10:00」整段都不该参与时长提取。
 */
const DATE_SPAN =
  /\d{4}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*[日号])?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}:\d{2}(?::\d{2})?/g;

/** 月份名（一月/二月…十二月）：后面跟「份/初/中/底」或前面是「年/每」时不是时长。 */
const MONTH_NAME = /^[一二三四五六七八九十]+月$/;

function hasCueBefore(text: string, index: number, window = 10): boolean {
  const head = text.slice(Math.max(0, index - window), index);
  return DURATION_CUES.some((cue) => head.includes(cue));
}

function looksLikeMonthName(text: string, index: number, matched: string): boolean {
  if (!MONTH_NAME.test(matched)) {
    return false;
  }
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + matched.length, index + matched.length + 1);
  return /[年每]/.test(before) || /[份初中底]/.test(after);
}

/** 从原文里取**已经存在**的数值表达。找不到就返回 undefined。 */
export function explicitValueIn(quote: string): string | undefined {
  // 先剔除日期与时刻，避免把时点当成时长
  const cleaned = quote.replace(DATE_SPAN, '〔日期〕');

  // 1) 无歧义时长：字面就是「X 个月 / 半年 / X 年半」，直接采信
  for (const matched of cleaned.matchAll(UNAMBIGUOUS_DURATION)) {
    return matched[0].replace(/\s+/g, '');
  }

  // 2) 有歧义时长：必须附近有投入线索词，且不是月份名
  for (const matched of cleaned.matchAll(AMBIGUOUS_DURATION)) {
    const raw = matched[0];
    const index = matched.index ?? 0;
    if (looksLikeMonthName(cleaned, index, raw.replace(/\s+/g, ''))) {
      continue;
    }
    if (hasCueBefore(cleaned, index)) {
      return raw.replace(/\s+/g, '');
    }
  }

  return undefined;
}

const TYPE_SIGNALS: readonly { readonly type: FactType; readonly words: readonly string[] }[] = [
  { type: 'cost', words: ['花', '成本', '代价', '学费', '成本是', '投入', '个月', '一年', '半年', '熬夜', '积蓄'] },
  { type: 'outcome', words: ['上岸', '拿到', '成功', '失败', '毕业', 'offer', '录取', '获奖', '转正', '结果'] },
  { type: 'condition', words: ['基础', '当时', '大二', '大三', '大四', '在职', '双非', '二本', '前提', '条件', '如果'] },
  { type: 'opinion', words: ['建议', '我认为', '我觉得', '应该', '不要', '最好', '值得', '没必要'] },
  { type: 'action', words: ['参加', '复习', '学', '做', '转', '报', '投', '写', '练'] },
];

/** 判定事实类型。按优先级从「代价/结果」到「泛动作」。 */
export function factTypeOf(quote: string): FactType {
  for (const signal of TYPE_SIGNALS) {
    if (signal.words.some((word) => quote.includes(word))) {
      return signal.type;
    }
  }
  return 'opinion';
}

/**
 * 相关性：当前问题与原文的字符级重叠比例。
 *
 * 刻意用朴素做法（问题里的字有多少出现在原文里），理由是
 * **可复核**：任何更聪明的语义相似度都会引入无法向评委解释的判断。
 * 它只用于排序与过滤，**不用于判断真伪**。
 */
export function relevanceOf(question: string, quote: string): number {
  const chars = [...new Set(question.replace(/[，,。？?！!\s]/g, ''))];
  if (chars.length === 0) {
    return 0;
  }
  const hits = chars.filter((char) => quote.includes(char)).length;
  return Number((hits / chars.length).toFixed(3));
}

/** 一条知乎来源 → 一条可追溯事实。 */
export function toEvidenceFact(input: {
  readonly source: KnowledgeSource;
  readonly question: string;
  /** 事实 id 前缀（通常用问题类型），保证跨会话稳定。 */
  readonly idPrefix?: string;
}): EvidenceFact {
  const { source, question } = input;
  const quote = source.quote;
  const value = explicitValueIn(quote);
  const prefix = input.idPrefix ?? 'fact';

  return {
    id: `${prefix}:${source.id}`,
    sourceId: source.id,
    sourceUrl: source.url,
    ...(source.author ? { author: source.author } : {}),
    retrievedAt: source.retrievedAt,
    quote,
    factType: factTypeOf(quote),
    ...(value ? { explicitValue: value } : {}),
    relevance: relevanceOf(question, quote),
  };
}

/**
 * 批量转换 + 按相关性过滤。
 *
 * `minRelevance` 存在的原因（方案 §5.2「相关性与来源质量筛选」）：
 * 把「大二参加比赛」的问题配上「在职转型」的素材，正是旧版本
 * 标签错位的根源。所以宁可用更少的事实，也不混入不相关来源。
 */
export function toEvidenceFacts(input: {
  readonly sources: readonly KnowledgeSource[];
  readonly question: string;
  readonly idPrefix?: string;
  readonly minRelevance?: number;
}): { readonly facts: readonly EvidenceFact[]; readonly filteredCount: number } {
  const minRelevance = input.minRelevance ?? 0;
  const all = input.sources
    // 只接受核验过的来源：scripted/unknown 不得进入事实层
    .filter((source) => source.status === 'verified')
    .map((source) =>
      toEvidenceFact({
        source,
        question: input.question,
        ...(input.idPrefix ? { idPrefix: input.idPrefix } : {}),
      }),
    );

  const facts = all.filter((fact) => fact.relevance >= minRelevance);
  return { facts, filteredCount: all.length - facts.length };
}
