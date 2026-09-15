import type {
  ProblemFrame,
  SearchPlan,
  SearchQuery,
  TransitionIntent,
} from '@/features/experience/domain';
import { buildTransitionIntent } from '@/features/experience/transitionIntent';

export const DEFAULT_MAX_REQUESTS = 3;
export const MAX_SEARCH_REQUESTS = 4;

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
  readonly maxRequests?: number;
}

export function buildSearchPlan(input: BuildSearchPlanInput): SearchPlan {
  const intent = input.intent ?? buildTransitionIntent(input.frame);
  const hasLayeredOrigin =
    intent.target.exact.length > 0 &&
    (intent.origin.family.length > 0 || intent.origin.domain.length > 0);
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

  if (budget >= 4 && hasLayeredOrigin) {
    const relaxedFamilyTerms = intent.origin.family
      .filter((term) => !intent.origin.exact.includes(term))
      .slice(0, 2);
    const relaxedFamily = relaxedFamilyTerms[0];
    const relaxedDomain = intent.origin.domain[0];
    const relaxedOrigin = [...relaxedFamilyTerms, relaxedDomain]
      .filter((term): term is string => Boolean(term));
    candidates.splice(1, 0, {
      id: 'q-similar-relaxed',
      query: `${relaxedOrigin.join(' ')} ${target} 亲身经历 后来`,
      purpose: 'similar-person',
      priority: 2,
      expectedTier: relaxedFamily ? 'same-family' : 'same-domain',
    });
    for (let index = 0; index < candidates.length; index += 1) {
      candidates[index] = { ...candidates[index]!, priority: index + 1 };
    }
  }

  const HIGH_COST = /裸辞|辞职|脱产|全职|创业|二战|留学|读博|gap|GAP/;
  if (budget >= 4 && HIGH_COST.test(input.frame.rawQuestion)) {
    candidates.push({
      id: 'q-cost',
      query: `${target} 亲身经历 付出代价 后来`,
      purpose: 'cost',
      priority: 4,
      expectedTier: 'same-target',
    });
  }

  const seen = new Set<string>();
  const queries = candidates.filter((item) => {
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
