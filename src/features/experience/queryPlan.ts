import type {
  ProblemFrame,
  SearchPlan,
  SearchQuery,
  TransitionIntent,
} from '@/features/experience/domain';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';

export const DEFAULT_MAX_REQUESTS = 3;
/**
 * 计划层的**硬上限**（不是默认值）。
 *
 * 2026-09-16：从 4 提到 12。原因是知乎检索次数已经不是瓶颈
 * （次数不够时再上 key 池），而"多发一条查询"能换到的真实能力很多：
 * 丢起点保目标、放宽层拆分、年代线索、反例加厚。默认值仍是 3 条强制视角，
 * 真正放宽发生在检索执行层（`searchRequestBudget()`）。
 */
export const MAX_SEARCH_REQUESTS = 12;
/**
 * 每局实际检索预算（执行层用）：默认 10，可用 `APP_MAX_SEARCH_REQUESTS` 调。
 *
 * 2026-09-16 从 8 提到 10：加了第二条年代查询（`q-era-mid`），
 * 它的收益已被真实数据验证（把中位年份从 2025 拉回 2020）。
 */
export const DEFAULT_SEARCH_BUDGET = 10;

/**
 * 每局知乎检索预算。**这是唯一该调的地方**：想省额度就调小，
 * 想打满分层放宽/年代查询就调大（硬上限 `MAX_SEARCH_REQUESTS`）。
 */
export function searchRequestBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.APP_MAX_SEARCH_REQUESTS);
  const value = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_SEARCH_BUDGET;
  return Math.min(MAX_SEARCH_REQUESTS, Math.max(DEFAULT_MAX_REQUESTS, value));
}

const STAGE = /大[一二三四五]|研[一二三]|应届|本科|专科|硕士|博士|高[一二三]|毕业生/g;
const IDENTITY = /数据科学|计算机|软件工程|人工智能|非科班|跨专业|双非|二本|一本|基础(?:一般|薄弱|较差)|零基础/g;

function explicitIdentityTerms(frame: ProblemFrame): readonly string[] {
  const terms: string[] = [];
  const add = (value: string) => {
    const term = value.trim();
    if (term.length >= 2 && term.length <= 16 && !terms.includes(term)) terms.push(term);
  };
  for (const match of frame.rawQuestion.match(STAGE) ?? []) add(match);
  for (const match of frame.rawQuestion.match(IDENTITY) ?? []) add(match);
  for (const statement of frame.constraints.filter((item) => item.hard)) {
    for (const match of statement.text.match(STAGE) ?? []) add(match);
    for (const match of statement.text.match(IDENTITY) ?? []) add(match);
  }
  return terms.slice(0, 4);
}

function desiredChangeOf(frame: ProblemFrame): string {
  const target = frame.desiredChange.trim();
  return target.length >= 2 ? target : frame.rawQuestion.trim().slice(0, 24);
}

/**
 * 检索用的目标词。
 *
 * 端点解析不出来时**不回退到画像标签**（`转入技术岗` 这种标签没有哪个答主
 * 会写在回答里，只会搜出空结果），而是退回用户原话的第一个子句 ——
 * 至少它还是用户自己写下的词，在知乎里是搜得到东西的。
 */
function searchTargetOf(frame: ProblemFrame, intent: TransitionIntent): string {
  const exact = intent.target.exact[0];
  if (exact) return exact;
  const clause = frame.rawQuestion
    .split(/[，,。！？；;\n]/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (clause && clause.length >= 2) return clause.slice(0, 16);
  return desiredChangeOf(frame);
}

function concernTerms(frame: ProblemFrame): string {
  const explicit = [
    ...frame.constraints.filter((item) => item.hard),
    ...frame.concerns.filter((item) => item.hard),
  ].map((item) => item.text.trim()).filter(Boolean);
  return explicit[0]?.slice(0, 18) ?? '';
}

/** 检索词里的重复 token 只留一次（`失败 退出 后悔 退出` 会浪费关键词权重）。 */
function dedupeTokens(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const value of values) {
    const token = value.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export interface BuildSearchPlanInput {
  readonly frame: ProblemFrame;
  /** 已校验的语义扩展；省略时只使用用户原话里的明确端点。 */
  readonly intent?: TransitionIntent;
  /**
   * **只用于查询**的真实起点词（检索驱动，见 `originTerms.ts`）。
   *
   * 它们来自第一轮真实返回的标题与徽章，是"这批人从哪儿来"的语料证据，
   * 但**不是**用户条件、也**不参与相似等级判定** —— 所以刻意放在这里，
   * 而不是塞进 `intent.origin.family`（那样会让任何共现的身份词
   * 都被冒领成"相似起点"）。抽错词只是白花一次查询。
   */
  readonly extraOriginTerms?: readonly string[];
  readonly maxRequests?: number;
}

export function buildSearchPlan(input: BuildSearchPlanInput): SearchPlan {
  const intent = input.intent ?? buildTransitionIntent(input.frame);
  const extraOriginTerms = (input.extraOriginTerms ?? []).map((term) => term.trim()).filter(Boolean);
  const hasLayeredOrigin =
    intent.target.exact.length > 0 &&
    (intent.origin.family.length > 0 || intent.origin.domain.length > 0 || extraOriginTerms.length > 0);
  const defaultBudget = hasLayeredOrigin ? MAX_SEARCH_REQUESTS : DEFAULT_MAX_REQUESTS;
  const budget = Math.min(MAX_SEARCH_REQUESTS, Math.max(3, Math.round(input.maxRequests ?? defaultBudget)));
  const identity = explicitIdentityTerms(input.frame);
  const target = searchTargetOf(input.frame, intent);
  const concern = intent.counterTerms[0] ?? concernTerms(input.frame);
  const origin = intent.origin.exact[0];
  const withIdentity = origin
    ? `${origin} `
    : identity.length > 0
      ? `${identity.join(' ')} `
      : '';

  const candidates: SearchQuery[] = [
    {
      id: 'q-similar-exact',
      query: `${withIdentity}${target} 亲身经历 后来`,
      purpose: 'similar-person',
      priority: 1,
      expectedTier: origin ? 'exact' : 'same-target',
    },
    {
      id: 'q-alternative',
      query: `${target} 换一种做法 亲身经历 结果`,
      purpose: 'alternative',
      priority: 2,
      expectedTier: 'same-target',
    },
    {
      id: 'q-counterexample',
      query: `${target} ${dedupeTokens(['失败', '退出', '后悔', concern]).join(' ')}`.trim(),
      purpose: 'counterexample',
      priority: 3,
      expectedTier: 'same-target',
    },
  ];

  /**
   * 追加项：**零模型成本**的检索面。
   *
   * 2026-09-16 放宽：每局检索预算从 4 提到 `DEFAULT_SEARCH_BUDGET`（8），
   * 由 `searchRequestBudget()` 决定（`APP_MAX_SEARCH_REQUESTS` 可调，硬上限
   * `MAX_SEARCH_REQUESTS`）。这些追加项全部只花**知乎检索次数**，
   * **不增加任何一次模型调用**：
   *
   * - `q-similar-target` 丢起点保目标（"其他背景进入同一目标"）——
   *   以前只在没有模型时兜底，现在只要有预算就先跑；它是"其他转导游"的主要来源；
   * - `q-similar-family` / `q-similar-domain` 把放宽层**拆成两条**：
   *   合并成一条时"工科"与"电气"会互相稀释，拆开后"工科转导游"更容易被捞到；
   * - `q-era` 带年份线索，主动去捞更早的回答 —— 喂「平行的时间」那条维度；
   * - `q-counter-regret` 把反例拆厚一条（劝退 / 后悔），反例轨更不容易空。
   */
  const extras: SearchQuery[] = [];

  /**
   * 放宽层**排在追加项最前面**：预算紧张时最先被保住的应该是
   * 「相似起点 / 同类背景」（"工科转导游"），因为那是用户最早提出的诉求。
   * 「丢起点保目标」由检索执行层在第二步显式执行，不依赖计划里是否有它。
   */
  if (hasLayeredOrigin) {
    /**
     * 第一层放宽的词：**先花真实语料学到的词**（`extraOriginTerms`），
     * 再补模型给的同族词。等级判定不看这些词 —— 它们只决定"去搜什么"。
     */
    const relaxedFamilyTerms = [...new Set([...extraOriginTerms, ...intent.origin.family])]
      .filter((term) => !intent.origin.exact.includes(term))
      .slice(0, 3);
    const relaxedDomainTerms = intent.origin.domain.slice(0, 2);
    if (relaxedFamilyTerms.length > 0) {
      extras.push({
        id: 'q-similar-family',
        query: `${relaxedFamilyTerms.join(' ')} ${target} 亲身经历 后来`,
        purpose: 'similar-person',
        priority: 0,
        expectedTier: 'same-family',
      });
    }
    if (relaxedDomainTerms.length > 0) {
      extras.push({
        id: 'q-similar-domain',
        query: `${relaxedDomainTerms.join(' ')} ${target} 亲身经历 后来`,
        purpose: 'similar-person',
        priority: 0,
        expectedTier: 'same-domain',
      });
    }
  }

  const transitionHint = TRANSITION_HINTS[intent.transition];
  extras.push({
    id: 'q-similar-target',
    query: `${transitionHint} ${target} 亲身经历 后来`.replace(/\s+/g, ' ').trim(),
    purpose: 'similar-person',
    priority: 0,
    expectedTier: 'same-target',
  });

  /**
   * 年代线索：**两条**，分别锚定"早"与"中"两个时代。
   *
   * 实测（2026-09-16 真实接口，10 条/查询）：
   * ```
   * 转行 导游 亲身经历 后来      → 年份 2023–2026，中位数 2025
   * 导游 2018 亲身经历 后来      → 年份 2018–2025，中位数 2020
   * 导游 2020 亲身经历 后来      → 年份 2020–2025，中位数 2020（10 条里 6 条 2020）
   * 导游 2012 亲身经历 后来      → 年份 2016–2025，中位数 2023  ← 太早反而失效
   * ```
   * 所以锚点取"往前 8 年"与"往前 5 年"：前者把早期（≤锚-8）那一桶填上，
   * 后者填中段（锚-7..锚-4）。**越早越好是错的** —— 2012 明显退化。
   *
   * 这两条查询直接决定「平行的时间」能不能成立（此前 39 个真实问题里
   * 只有 14 个能形成时代对照）。
   */
  const earlyYear = new Date().getUTCFullYear() - 8;
  const midYear = new Date().getUTCFullYear() - 5;
  extras.push({
    id: 'q-era',
    query: `${target} ${earlyYear} 亲身经历 后来`,
    purpose: 'similar-person',
    priority: 0,
  });
  extras.push({
    id: 'q-era-mid',
    query: `${target} ${midYear} 亲身经历 后来`,
    purpose: 'similar-person',
    priority: 0,
  });

  extras.push({
    id: 'q-counter-regret',
    query: `${target} 劝退 后悔 经历`,
    purpose: 'counterexample',
    priority: 0,
  });

  const HIGH_COST = /裸辞|辞职|脱产|全职|创业|二战|留学|读博|gap|GAP/;
  if (HIGH_COST.test(input.frame.rawQuestion)) {
    extras.push({
      id: 'q-cost',
      query: `${target} 亲身经历 付出代价 后来`,
      purpose: 'cost',
      priority: 0,
    });
  }

  // 三条强制视角在先，追加项按价值在后 —— 预算紧张时先砍追加项。
  const ordered: SearchQuery[] = [...candidates, ...extras].map((item, index) => ({
    ...item,
    priority: index + 1,
  }));

  const seen = new Set<string>();
  const queries = ordered.filter((item) => {
    const key = item.query.replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { queries: queries.sort((a, b) => a.priority - b.priority).slice(0, budget), maxRequests: budget };
}

/** 转变类型 → 检索词里的通用转变提示（只服务检索，不参与任何分级）。 */
const TRANSITION_HINTS: Readonly<Record<TransitionIntent['transition'], string>> = {
  'career-change': '转行',
  'major-change': '转专业',
  entry: '',
  choice: '',
  other: '',
};

/**
 * 「丢起点、保目标」的零成本放宽查询。
 *
 * ## 它存在的理由
 *
 * 分层放宽原来只有一个入口：一次模型语义扩展（起点同族/同域词）。
 * 但**没有模型**的部署（无 key、演示模式、模型超时）那时只能退回
 * 三条原始查询，于是「其他背景进入同一目标」这类真实经历根本不会
 * 出现在候选里 —— 而它们恰恰是案例里最该被展示的「相同终点」。
 *
 * 这条查询把放宽做成**纯确定性**的：只保留用户自己写下的目标，
 * 去掉起点。等级仍由正文独立判定（查询目的不能当结论），
 * 所以它不会把无关内容塞进经验层。
 *
 * 目标缺失、或与精确查询撞车（撞车=白花一次配额）时返回 null。
 */
export function buildSameTargetQuery(input: {
  readonly frame: ProblemFrame;
  readonly intent?: TransitionIntent;
}): SearchQuery | null {
  const intent = input.intent ?? buildTransitionIntent(input.frame);
  const target = intent.target.exact[0];
  if (!target) return null;

  const hint = TRANSITION_HINTS[intent.transition];
  const query = `${hint} ${target} 亲身经历 后来`.replace(/\s+/g, ' ').trim();

  const exact = buildSearchPlan({
    frame: input.frame,
    ...(input.intent ? { intent: input.intent } : {}),
    maxRequests: DEFAULT_MAX_REQUESTS,
  }).queries.find((item) => item.id === 'q-similar-exact');
  if (exact && exact.query.replace(/\s+/g, '') === query.replace(/\s+/g, '')) return null;

  return {
    id: 'q-similar-target',
    query,
    purpose: 'similar-person',
    priority: 2,
    expectedTier: 'same-target',
  };
}

/**
 * 第一阶段只查完整同路经历。调用方可先审核这批结果；足够时便无需模型扩展。
 */
export function buildInitialSearchPlan(frame: ProblemFrame): SearchPlan {
  const exact = buildSearchPlan({ frame, maxRequests: DEFAULT_MAX_REQUESTS }).queries
    .find((query) => query.id === 'q-similar-exact');
  return { queries: exact ? [exact] : [], maxRequests: 1 };
}
