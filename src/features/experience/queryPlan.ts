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

function concernTerms(frame: ProblemFrame): string {
  const explicit = [
    ...frame.constraints.filter((item) => item.hard),
    ...frame.concerns.filter((item) => item.hard),
  ].map((item) => item.text.trim()).filter(Boolean);
  return explicit[0]?.slice(0, 18) ?? '';
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
  const target = intent.target.exact[0] ?? desiredChangeOf(input.frame);
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
      query: `${target} 失败 退出 后悔 ${concern}`.trim(),
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

/**
 * 第一阶段只查完整同路经历。调用方可先审核这批结果；足够时便无需模型扩展。
 */
export function buildInitialSearchPlan(frame: ProblemFrame): SearchPlan {
  const exact = buildSearchPlan({ frame, maxRequests: DEFAULT_MAX_REQUESTS }).queries
    .find((query) => query.id === 'q-similar-exact');
  return { queries: exact ? [exact] : [], maxRequests: 1 };
}
