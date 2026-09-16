import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 平行的时间 —— 把「年份」做成与相似等级**正交**的第三条维度。
 *
 * ## 为什么需要它
 *
 * 现在做到的是「平行的人」：相似起点 / 同类背景 / 相同终点 / 相邻路径，
 * 全是**空间**维度上的放宽。但同一个问题在 2015 年和 2024 年的高赞回答
 * 是两个世界 —— 「要不要转计算机」在缺口大的年份是"赶紧转"，
 * 在卷到极致的年份是"劝退"。也就是说：**「这条路成立」本身有保质期**。
 *
 * 知乎语料天然自带年份（`KnowledgeSource.editTime` → `ExperienceFact.sourceEditTime`），
 * 这是别人家产品没有的资产。本地真实检索缓存实测：单个问题的时间跨度
 * 可达 13 年（2013–2026）。
 *
 * ## 三条纪律（都写进实现里）
 *
 * 1. **年份是「最后编辑时间」，不是发布时间**。字段里没有 createdTime，
 *    所以文案必须说「最后编辑于 X 年」，并且这个限定要跟着一起展示 ——
 *    把近似当事实，正是这个产品最不能犯的错。
 * 2. **只有合格来源进桶**（有逐字片段、有作者、有原文链接），且只有
 *    **两个以上时代都有人**才算 `comparable`。
 * 3. **凑不出对照就如实说**：宁可写「这一局只找到一个时代」，
 *    也不拿不相关的人去硬凑一个"时间对照"。
 *
 * 纯函数、零模型：同输入必得同输出。
 */

export interface EraItem {
  readonly fact: ExperienceFact;
  readonly year: number;
}

export interface EraBucket {
  readonly id: 'early' | 'mid' | 'recent';
  readonly label: string;
  readonly items: readonly EraItem[];
}

export interface EraTrack {
  /** 只含**有人的**时代，按时间从早到晚。 */
  readonly buckets: readonly EraBucket[];
  /** 两个以上时代都有人，才算真的能对照。 */
  readonly comparable: boolean;
  /** 最早与最晚相差多少年。 */
  readonly gapYears: number;
  readonly earliestYear: number | null;
  readonly latestYear: number | null;
  /** 给纸面用的诚实文案（含「最后编辑时间」的限定）。 */
  readonly note: string;
}

export interface EraTrackOptions {
  /** 便于测试注入"现在"。 */
  readonly now?: number;
  /** 每个时代最多取几条（默认 2）。 */
  readonly maxPerBucket?: number;
}

/** 能进纸面的下限：逐字片段够长、有作者、有原文链接。 */
const MIN_QUOTE_CHARS = 12;
/** 跨度小于这个年数就不值得叫"不同年代"。 */
const MIN_GAP_YEARS = 3;
/** 以最晚年份为锚分的三代：≤ 锚-8 / 锚-7..锚-4 / ≥ 锚-3。 */
const EARLY_BACKSPAN = 8;
const MID_BACKSPAN = 4;

/**
 * 一个片段对应的年份（**最后编辑时间**）。
 *
 * 返回 null 表示没有可用的时间信息 —— 调用方必须当"不知道"处理，
 * 不能默认成"近年"。
 */
export function editedYearOf(fact: ExperienceFact): number | null {
  const stamp = fact.sourceEditTime;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0) {
    return null;
  }
  const year = new Date(stamp * 1000).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? year : null;
}

function citable(fact: ExperienceFact): boolean {
  return (
    fact.exactQuote.replace(/\s+/g, '').length >= MIN_QUOTE_CHARS &&
    fact.author.trim().length > 0 &&
    fact.sourceUrl.trim().length > 0
  );
}

export function eraTrackOf(
  facts: readonly ExperienceFact[],
  options: EraTrackOptions = {},
): EraTrack {
  const maxPerBucket = Math.max(1, Math.round(options.maxPerBucket ?? 2));

  /**
   * 只统计**有年份且有出处**的片段。
   * 没有年份的片段不参与分代 —— 它们在「仍然不知道」那一栏里如实待着。
   */
  const dated: EraItem[] = [];
  for (const fact of facts) {
    if (!citable(fact)) continue;
    const year = editedYearOf(fact);
    if (year === null) continue;
    dated.push({ fact, year });
  }

  if (dated.length === 0) {
    return {
      buckets: [],
      comparable: false,
      gapYears: 0,
      earliestYear: null,
      latestYear: null,
      note: '这一局的来源没有可用的时间信息，我们不猜年代。',
    };
  }

  const years = dated.map((item) => item.year);
  const earliestYear = Math.min(...years);
  const latestYear = Math.max(...years);
  const gapYears = latestYear - earliestYear;
  const earlyTo = latestYear - EARLY_BACKSPAN;
  const midFrom = earlyTo + 1;
  const midTo = latestYear - MID_BACKSPAN;
  const recentFrom = midTo + 1;

  const definitions: readonly {
    readonly id: EraBucket['id'];
    readonly label: string;
    readonly match: (year: number) => boolean;
  }[] = [
    { id: 'early', label: `${earlyTo} 年及以前`, match: (year) => year <= earlyTo },
    { id: 'mid', label: `${midFrom}–${midTo} 年`, match: (year) => year >= midFrom && year <= midTo },
    { id: 'recent', label: `${recentFrom} 年及以后`, match: (year) => year >= recentFrom },
  ];

  const buckets: EraBucket[] = [];
  for (const definition of definitions) {
    const items = dated
      .filter((item) => definition.match(item.year))
      .slice()
      .sort((left, right) => left.year - right.year || left.fact.id.localeCompare(right.fact.id))
      .slice(0, maxPerBucket);
    if (items.length > 0) {
      buckets.push({ id: definition.id, label: definition.label, items });
    }
  }

  const comparable = buckets.length >= 2 && gapYears >= MIN_GAP_YEARS;

  const caveat = '（年份取自知乎的「最后编辑时间」，不是这篇回答第一次发布的时间。）';
  const note = comparable
    ? `同一条路，不同年代的人说法不一样：最早与最晚相差 ${gapYears} 年。我们只把原话放在一起 —— 这条路什么时候成立、现在还成不成立，要你自己去验证。${caveat}`
    : `这一局只在「${buckets[0]?.label ?? '同一个时代'}」里找到了走过这条路的人，我们不为了凑一个「时间对照」去拿不相关的人。${caveat}`;

  return { buckets, comparable, gapYears, earliestYear, latestYear, note };
}
