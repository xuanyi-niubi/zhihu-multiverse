import type {
  ProblemFrame,
  SearchPlan,
  SearchQuery,
} from '@/features/experience/domain';

/**
 * 检索计划（Phase 4 / P0-C）。
 *
 * ## 为什么 query 由规则拼，而不是让模型写
 *
 * 检索配额是**硬资源**（知乎开放平台有调用上限），而模型会
 * 热情地生成很多「听起来合理」的 query。规则拼出来的 query
 * 每一条都能回答「它替哪种意图服务」，超支时砍哪条也说得出理由。
 *
 * ## 三种意图是强制的
 *
 * 每一份 SearchPlan **必须**同时包含：
 *
 * - `similar-person`：走过同样路的人（用户预期中的证据）；
 * - `alternative`：换了走法的人（对照）；
 * - `counterexample`：失败 / 后悔的人（反例）。
 *
 * 第三种是刻意强制的：只搜「支持用户原本想法」的内容，
 * 这个产品就退化成了一个讨好的搜索框。
 */

/** 默认请求预算。**3 是刻意的**：三种强制意图各占一条。 */
export const DEFAULT_MAX_REQUESTS = 3;
/** 预算上限。再多就开始浪费配额与延迟了。 */
export const MAX_SEARCH_REQUESTS = 4;

/* -------------------------------------------------------------------------- */
/* 关键词                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 从 frame 里抽出「身份词」（大二 / 基础一般 / 应届生…）。
 *
 * 实现刻意朴素：取 `currentSituation` 与约束陈述里 2～12 字的
 * 中文片段。检索引擎对这些词的命中远好于整句。
 */
function identityTerms(frame: ProblemFrame): readonly string[] {
  const candidates = [
    frame.currentSituation,
    ...frame.constraints.map((item) => item.text),
  ];
  const terms: string[] = [];
  for (const text of candidates) {
    for (const piece of text.match(/[\u4e00-\u9fa5]{2,12}/g) ?? []) {
      if (!terms.includes(piece)) {
        terms.push(piece);
      }
    }
  }
  return terms.slice(0, 3);
}

/** 目标短语：检索的主语。缺失时退回原话 —— 原话至少是真实信息。 */
function desiredChangeOf(frame: ProblemFrame): string {
  const target = frame.desiredChange.trim();
  if (target.length >= 2) {
    return target;
  }
  return frame.rawQuestion.trim().slice(0, 24);
}

/* -------------------------------------------------------------------------- */
/* 主函数                                                                      */
/* -------------------------------------------------------------------------- */

export interface BuildSearchPlanInput {
  readonly frame: ProblemFrame;
  readonly maxRequests?: number;
}

/**
 * 由问题框定生成检索计划。**纯函数**：同 frame 必得同 plan。
 *
 * 预算钳制：`[3, 4]` —— 下限 3 保证三种强制意图不被砍掉，
 * 上限 4 是配额纪律。
 */
export function buildSearchPlan(input: BuildSearchPlanInput): SearchPlan {
  const budget = Math.min(
    MAX_SEARCH_REQUESTS,
    Math.max(3, Math.round(input.maxRequests ?? DEFAULT_MAX_REQUESTS)),
  );

  const identity = identityTerms(input.frame);
  const target = desiredChangeOf(input.frame);
  /** 身份词让「相似经验」真的相似：大二的学生不该搜到工作十年的人。 */
  const withIdentity = identity.length > 0 ? `${identity.join(' ')} ` : '';

  const candidates: SearchQuery[] = [
    {
      id: 'q-similar',
      query: `${withIdentity}${target} 经历`,
      purpose: 'similar-person',
      priority: 1,
    },
    {
      id: 'q-alternative',
      query: `${target} 另一种选择 经验`,
      purpose: 'alternative',
      priority: 2,
    },
    {
      id: 'q-counterexample',
      query: `${target} 失败 后悔 踩坑`,
      purpose: 'counterexample',
      priority: 3,
    },
  ];

  /**
   * 高成本尝试才值得多花一条检索预算问「代价」。
   * 触发词与澄清模块（clarification.ts）的高成本触发词保持同一口径。
   */
  const HIGH_COST = /裸辞|辞职|脱产|全职|创业|二战|留学|读博|gap|GAP/;
  if (budget >= 4 && HIGH_COST.test(input.frame.rawQuestion)) {
    candidates.push({
      id: 'q-cost',
      query: `${target} 代价 代价有多大`,
      purpose: 'cost',
      priority: 4,
    });
  }

  // 防御性去重（拼出来的 query 理论上互不相同，但 Identity 词重复时可能撞）
  const seen = new Set<string>();
  const queries = candidates.filter((item) => {
    const key = item.query.replace(/\s+/g, '');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  /** 按优先级截断：强制意图优先级 1–3，任何预算下都活着。 */
  return {
    queries: queries.sort((left, right) => left.priority - right.priority).slice(0, budget),
    maxRequests: budget,
  };
}
