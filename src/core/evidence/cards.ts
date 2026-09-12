import { stableHash } from '@/core/run/deterministic';
import { authorityLabel } from '@/core/evidence/strength';
import type { ZhihuSearchItem } from '@/core/zhihu/client';
import type { PathCard, PathShape } from '@/types/evidence';

/**
 * Path Extractor（方案 §5.1 ②）：把一条检索结果归纳成一张**前人路径卡**。
 *
 * 三条纪律，全部为了「无据不填数」：
 *
 * 1. **每个字段都可能为 null**：`duration` / `moneyCost` / `irreversible` 等，
 *    原文里找不到依据就是 `null`，**不允许用「通常」「大概」补一个值**。
 * 2. **抽取只认字面**：这里刻意用确定性的短语规则，不用模型 ——
 *    模型可以参与「这张卡属于哪条路线」的归纳，但不能凭空写出数字。
 *    确定性抽取的好处是可测试、可复核、可解释。
 * 3. **status 只可能是 verified**：证据层不接受剧本数据。
 */

/** 摘要里的高亮标记与空白清洗（与 `core/zhihu/snippets.ts` 同口径）。 */
function clean(raw: string): string {
  return raw
    .replace(/<\/?em>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * 时长抽取的合法上限（用真实数据实测校准出来的）。
 *
 * 没有任何一条真实人生路径要花 10 年以上 —— 而中文里「18年」「16年」
 * 常是「哪一年」的意思（实测：「18年毕业后…」被误读成 173–259 个月，
 * 直接把一条路线的时间成本推到 14 年以上）。上限是拦掉这类语义误读最省事的闸。
 */
const MAX_YEARS = 10;
const MAX_MONTHS = MAX_YEARS * 12;

/** 中文数字 → 阿拉伯数字（只处理抽时间成本需要的 0–99）。 */
const CN_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseCnNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (text.length === 1 && text in CN_DIGITS) {
    return CN_DIGITS[text];
  }
  // 十一 / 二十 / 二十三 这类
  if (text.startsWith('十') && text.length === 1) {
    return 10;
  }
  if (text.startsWith('十')) {
    const rest = CN_DIGITS[text.slice(1)];
    return rest === undefined ? null : 10 + rest;
  }
  const [tens, ones] = text.split('十');
  const t = CN_DIGITS[tens];
  if (t === undefined) {
    return null;
  }
  if (text.endsWith('十')) {
    return t * 10;
  }
  const o = CN_DIGITS[ones ?? ''];
  return o === undefined ? null : t * 10 + o;
}

/**
 * 抽取「花了多久」。
 *
 * 只认明确的时长表述（N 年 / N 个月 / 半年）。
 * 找不到就返回 null —— 时间成本是裁决的核心输入，编不得。
 *
 * ⚠️ **实测踩到的语义陷阱**（这层过滤是真实数据的产物，不是防御性编程）：
 * 中文里「18年」既可能是「18 年时间」也可能是「2018 年」，
 * 于是「18年毕业后…」会被误读成 173–259 个月，直接把一条路线的
 * 时间成本推到 14 年以上。因此年份表述必须排除三类上下文：
 *
 * | 形态 | 例子 | 处置 |
 * |---|---|---|
 * | 后接时间标记 | 「18年**毕业后**」「16年**的时候**」 | 拒绝 |
 * | 前接系词/是 | 「毕业时**是 16 年**」 | 拒绝 |
 * | 数值越界 | 「9年？」（反问，或误匹配） | 拒绝 |
 */
export function extractDuration(text: string): string | null {
  // 年份后紧跟这些词时，它是「哪一年」而不是「多久」
  const CALENDAR_AFTER = /^(?:毕业|入学|入职|出生|的时候|那年|那一年|初|底|末|前|后|的|左右|代)/;
  // 月份后紧跟这些词时同理
  const MONTH_CALENDAR_AFTER = /^(?:的|那|初|底|末)/;

  /** 一条时长表述是否可信；返回归一化后的值。 */
  const acceptable = (raw: string, unit: '年' | '个月', after: string): string | null => {
    if (raw === '半') {
      return unit === '年' ? '半年' : '半个月';
    }

    const value = parseCnNumber(raw);
    if (value === null || value <= 0) {
      return null;
    }

    if (unit === '年') {
      // 越界：没有任何一条真实人生路径要花 10 年以上（16 年/18 年都是「哪一年」误读）
      if (value > MAX_YEARS) {
        return null;
      }
      // 后接时间标记：是「哪一年」而不是「多久」
      if (CALENDAR_AFTER.test(after)) {
        return null;
      }
      return `${value}年`;
    }

    // 月份：1–12 且后接「的/那/初/底/末」时是日历月而不是时长
    if (value <= 12 && MONTH_CALENDAR_AFTER.test(after)) {
      return null;
    }
    if (value > MAX_MONTHS) {
      return null;
    }
    return `${value}个月`;
  };

  const patterns: ReadonlyArray<{ readonly re: RegExp; readonly unit: '年' | '个月' }> = [
    { re: /([0-9]+|[零一二两三四五六七八九十]+|半)\s*年半?/g, unit: '年' },
    { re: /([0-9]+|[零一二两三四五六七八九十]+|半)\s*个?月/g, unit: '个月' },
  ];

  for (const { re, unit } of patterns) {
    for (const match of text.matchAll(re)) {
      const raw = match[1];
      const end = (match.index ?? 0) + match[0].length;
      const after = text.slice(end, end + 3);
      const normalized = acceptable(raw, unit, after);
      if (normalized !== null) {
        return normalized;
      }
    }
  }

  return null;
}

/** 把「N 年 / N 个月 / 半年」解析回月数区间（用于代价画像）。 */
export function durationToMonths(duration: string | null): { readonly min: number; readonly max: number } | null {
  if (!duration) {
    return null;
  }
  if (duration === '半年') {
    return { min: 6, max: 6 };
  }
  if (duration === '半个月') {
    return { min: 0, max: 1 };
  }
  const match = /^(\d+)(年|个月)$/.exec(duration);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const months = match[2] === '年' ? value * 12 : value;
  // 单点表述给一个 ±20% 的保守区间，避免把「两年」当成精确的 24 个月
  const spread = Math.max(1, Math.round(months * 0.2));
  return { min: Math.max(1, months - spread), max: months + spread };
}

const MONEY_HIGH = /(负债|借钱|贷款|刷信用卡|透支|花光|掏空|家底|学费|报班花了|脱产.{0,4}没收入)/;const MONEY_MEDIUM = /(存款|积蓄|生活费|兼职|打零工|省吃俭用|自费)/;
const MONEY_LOW = /(不花钱|免费|白嫖|零成本|没花什么钱)/;
const IRREVERSIBLE = /(退学|辞职.{0,6}(?:没|不)回头|错过|来不及|年龄.{0,4}(?:大|超)|没有退路|一条道走到黑|死磕)/;
const ALLY_NEEDED = /(家里人支持|父母支持|家人支持|对象支持|有人带|导师|同学一起|抱团|组队|战友)/;
const SOLO = /(一个人|独自|没人帮|无人支持|孤军|全靠自己)/;

/** 抽取资金代价档位。三者都没提到就是 unknown，不猜。 */
export function extractMoneyCost(text: string): 'low' | 'medium' | 'high' | 'unknown' {
  if (MONEY_HIGH.test(text)) return 'high';
  if (MONEY_MEDIUM.test(text)) return 'medium';
  if (MONEY_LOW.test(text)) return 'low';
  return 'unknown';
}

/** 抽取「付出的代价」列表：按句子切，取含代价信号的句子。 */
export function extractCosts(text: string): readonly string[] {
  const sentences = text
    .split(/[。！？；\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  const signals = /(代价|成本|牺牲|放弃|失去|崩|抑郁|焦虑|熬夜|体检|脱发|分手|退学|降薪|gap|空窗)/i;
  return sentences.filter((sentence) => signals.test(sentence)).slice(0, 3);
}

/** 抽取结果：取含结果信号的句子，没有就不编。 */
export function extractOutcome(text: string): string {
  const sentences = text
    .split(/[。！？；\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
  const signals = /(上岸|拿到 ?offer|入职|转行成功|毕业|录取|考上了|做成了|失败了|放弃了|后悔|值了|算是|最终|后来)/i;
  const hit = sentences.filter((sentence) => signals.test(sentence)).slice(-1)[0];
  return hit ? truncate(hit, 60) : '';
}

/** 抽取起点处境：标题里通常就写着。 */
export function extractFrom(title: string, text: string, goal: string): string {
  const source = clean(title);
  const bracket = /【(.{2,20})】|\[(.{2,20})\]/.exec(source);
  if (bracket) {
    return bracket[1] ?? bracket[2] ?? '';
  }
  const situation = /((?:大[一二三四]|研[一二三]|本科|二本|三本|专科|双非|211|985|应届|毕业)[^，。,\s]{0,10})/.exec(source);
  if (situation) {
    return situation[1];
  }
  return goal.trim().slice(0, 16);
}

/** 抽取「做了什么」：优先用命中该路线的关键词短语。 */
export function extractMove(title: string, text: string, keywords: readonly string[]): string {
  const source = `${clean(title)} ${text}`;
  const hit = keywords.find((keyword) => source.includes(keyword));
  return hit ?? truncate(clean(title), 24);
}

/**
 * 单条检索结果 → PathCard。
 *
 * @param keywords 该结果命中的路线关键词，用于抽 `move`。
 */
export function toPathCard(input: {
  readonly item: ZhihuSearchItem;
  readonly goal: string;
  readonly keywords: readonly string[];
  readonly retrievedAt: string;
  /** 内容编辑时间（秒级 Unix）；缺失时退回 retrievedAt。 */
  readonly editTimeSeconds?: number;
}): PathCard | null {
  const { item } = input;
  const quote = clean(item.ContentText);
  const title = clean(item.Title).replace(/\s*-\s*知乎$/, '');
  const url = item.Url;

  // 没有可引用原文或没有 https 链接的一律不进证据网格
  if (quote.length < 12 || !/^https:\/\//.test(url)) {
    return null;
  }

  const rank = Number(item.AuthorityLevel);
  const authorityRank = Number.isFinite(rank) ? rank : 0;
  const sourceId = item.ContentID.trim().length > 0 ? item.ContentID : stableHash(url);

  // 新鲜度按内容编辑时间算（有则用），否则退回抓取时间
  const retrievedAt =
    typeof input.editTimeSeconds === 'number' && input.editTimeSeconds > 0
      ? new Date(input.editTimeSeconds * 1000).toISOString()
      : input.retrievedAt;

  const combined = `${title} ${quote}`;

  const shape: PathShape = {
    from: extractFrom(item.Title, quote, input.goal),
    move: extractMove(item.Title, quote, input.keywords),
    duration: extractDuration(combined),
    cost: extractCosts(quote),
    outcome: extractOutcome(quote),
  };

  return {
    cardId: `card-${stableHash(`card::${sourceId}`).slice(0, 12)}`,
    sourceId,
    author: item.AuthorName.trim().length > 0 ? item.AuthorName.trim().slice(0, 32) : '知乎用户',
    authorUrlToken: null,
    sourceUrl: url as `https://${string}`,
    retrievedAt,
    authority: authorityLabel(authorityRank),
    authorityRank,
    upvotes:
      Number.isFinite(item.VoteUpCount) && item.VoteUpCount > 0 ? Math.round(item.VoteUpCount) : null,
    title: truncate(title, 60),
    quote: truncate(quote, 200),
    shape,
    status: 'verified',
  };
}

/** 批量转换并按 cardId 去重（不同 query 会命中同一条内容）。 */
export function toPathCards(
  items: readonly ZhihuSearchItem[],
  input: {
    readonly goal: string;
    readonly keywordSets: ReadonlyArray<readonly string[]>;
    readonly retrievedAt: string;
    readonly limit?: number;
  },
): readonly PathCard[] {
  const byId = new Map<string, PathCard>();

  items.forEach((item, index) => {
    // 每条结果只归到「第一个命中它的关键词集」，避免同一条内容被算进两条路线
    const keywords = input.keywordSets.find((set) =>
      set.some((keyword) => `${item.Title} ${item.ContentText}`.includes(keyword)),
    ) ?? [];

    const card = toPathCard({
      item,
      goal: input.goal,
      keywords,
      retrievedAt: input.retrievedAt,
      editTimeSeconds: item.EditTime,
    });

    if (card && !byId.has(card.cardId)) {
      byId.set(card.cardId, card);
    } else if (!card && index === 0) {
      // 第一条就不可用时不做任何补救：证据网格宁可空，也不塞剧本数据
    }
  });

  const sorted = [...byId.values()].sort((left, right) => {
    if (right.authorityRank !== left.authorityRank) {
      return right.authorityRank - left.authorityRank;
    }
    return (right.upvotes ?? 0) - (left.upvotes ?? 0);
  });

  return input.limit === undefined ? sorted : sorted.slice(0, input.limit);
}

/* -------------------------------------------------------------------------- */
/* 落盘快照通道（v2 §11.2 DEMO MODE 的合法证据来源）                            */
/* -------------------------------------------------------------------------- */

/** 落盘快照的最小形状（`knowledgeSource` 规范化后的合法来源）。 */
export interface SnapshotSource {
  readonly id: string;
  readonly author: string;
  readonly quote: string;
  readonly upvotes: number | null;
  readonly url: string;
  readonly retrievedAt: string;
  readonly status: 'verified' | 'scripted';
  /** 内容编辑时间（秒级 Unix）：优先用于新鲜度与真实年份展示。 */
  readonly editTime?: number | null;
  /** 权威等级原值：接进卡片后证据强度才算得准（否则一律按「缺失」降权）。 */
  readonly authority?: number | null;
}

/**
 * 把**已落盘的真实快照**转成路径卡。
 *
 * 这是 DEMO MODE 唯一合法的证据来源：快照由 `npm run sync:zhihu` 用官方
 * Access Secret 真实抓取并落盘（带 `retrievedAt`），因此可以进证据网格。
 *
 * **`scripted` 来源一律拒绝**：剧本数据可以出现在叙事里，但绝不能进证据网格。
 * 这是 v2 §22.2「demo 数据不可伪装 verified」在代码层的唯一执行点 ——
 * 演示的完整性不靠编数据，靠确定性引擎 + 离线剧本。
 */
export function snapshotToPathCards(
  sources: readonly SnapshotSource[],
  input: {
    readonly goal: string;
    readonly keywordSets: ReadonlyArray<readonly string[]>;
    /** 已知来源 id → 路线 id（人工确认过的归档），优先于关键词匹配。 */
    readonly pathOverrides?: Readonly<Record<string, string>>;
    readonly limit?: number;
  },
): readonly PathCard[] {
  const cards: PathCard[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    // 只有 verified + 有抓取时间 + https 链接才允许进证据网格
    if (source.status !== 'verified' || source.retrievedAt.length === 0) {
      continue;
    }
    if (!/^https:\/\//.test(source.url) || source.quote.trim().length < 12) {
      continue;
    }

    const text = `${source.author} ${source.quote}`;
    const keywords =
      input.keywordSets.find((set) => set.some((keyword) => text.includes(keyword))) ?? [];

    const card = toPathCard({
      item: {
        Title: source.author,
        ContentType: 'answer',
        ContentID: source.id,
        ContentText: source.quote,
        Url: source.url,
        CommentCount: 0,
        VoteUpCount: source.upvotes ?? 0,
        AuthorName: source.author,
        // 权威等级与编辑时间都要接进来：否则证据强度会把 50 条高权威样本
        // 全部按「权威度缺失」降权，强度算出来永远偏低
        ...(typeof source.authority === 'number' ? { AuthorityLevel: String(source.authority) } : {}),
        ...(typeof source.editTime === 'number' && source.editTime > 0 ? { EditTime: source.editTime } : {}),
      },
      goal: input.goal,
      keywords,
      retrievedAt: source.retrievedAt,
    });

    if (card && !seen.has(card.cardId)) {
      // 归档提示挂在卡片上，由 mesh builder 读取（见 mesh.ts 的 buildMesh）
      seen.add(card.cardId);
      const hint = input.pathOverrides?.[source.id];
      cards.push(hint ? { ...card, pathHint: hint } : card);
    }
  }

  return input.limit === undefined ? cards : cards.slice(0, input.limit);
}
