import { PATH_ARCHETYPES } from '@/core/evidence/mesh';

import type { PlannedQuery, QueryIntent } from '@/types/evidence';

/**
 * Query Planner（方案 §5.1 ①）：把玩家的一句迷茫拆成 3–5 个检索意图。
 *
 * 为什么不能只用玩家原话当 query（`core/zhihu/query.ts` 已经踩过这个坑）：
 * 一句话通常只能命中一类结果。我们要的是**多条互斥路线的样本**，
 * 所以必须按「处境 / 分歧 / 约束」三个方向各自展开。
 *
 * 这里是确定性规则实现（不调模型）：目标是**零额外延迟、零配额浪费、
 * 可被测试钉死**。模型版本留作后续增强点，但当前版本已经能覆盖
 * 校园 / 职场新人的常见表述。
 *
 * 配额意识：搜索 1000–5000 次/天。这里最多产出 5 个 query，
 * 且每个 query 都经过 `stableHash` 缓存键去重（见 `/api/mesh`）。
 */

/** 领域词表：命中即作为检索的聚焦域。命中越多越靠前。 */
const DOMAIN_LEXICON: readonly string[] = [
  '计算机', '转码', '程序员', '前端', '后端', '算法', '数据',
  '法学', '法考', '律师', '医学', '临床', '护理', '土木', '机械', '化工',
  '考公', '考编', '公务员', '事业单位', '教师', '体制内',
  '考研', '保研', '留学', '申博', '读博', '二战',
  '产品经理', '运营', '设计', '会计', '审计', '金融', '券商', '咨询', '销售',
  '国企', '央企', '大厂', '外企', '创业',
];

/** 动作词表：玩家到底想做什么。 */
const ACTION_LEXICON: readonly string[] = [
  '转行', '转码', '转型', '跨考', '跨专业', '换行业', '跳槽', '裸辞', '辞职',
  '考公', '考编', '考研', '留学', '读博', '上岸', '找工作', '实习', 'gap', '休学',
  '转专业', '换赛道', '换工作', '二战', '复读', '创业', '读研',
];

/**
 * 「转/换 + 目标」的开放式动作抽取。
 *
 * 词表永远不够长（真实表述有长尾），所以补一条受控的正则：
 * 只认「转/换 + 2–6 个非标点字」，且目标不能是「而/成」这类虚词。
 * 这是确定性规则，不是模型生成 —— 宁可漏，不可编。
 */
const OPEN_ACTION = /(?:转|换)([\u4e00-\u9fa5]{2,6}?)(?=[，,。；;、\s]|$|但|可是|不过)/;

/** 处境词表：玩家现在站在哪里。 */
const SITUATION_LEXICON: readonly string[] = [
  '大三', '大四', '大二', '大一', '研一', '研二', '研三', '应届', '毕业',
  '二本', '三本', '专科', '双非', '211', '985', '在职', '宝妈', '往届',
];

const MAX_QUERIES = 5;

/**
 * 宽领域（v3 §20 的二次选择入口）。
 *
 * `DOMAIN_LEXICON` 是**窄词表**（「计算机」「法学」「考研」这种具体方向），
 * 长尾表述很容易一个都不命中。这时不该硬搜，而应当问一句
 * 「你更接近哪一类」，让玩家点一个再二次检索。
 *
 * 六个分类覆盖校园与职场新人的常见岔路：
 * 学业 / 职业 / 转行 / 城市 / 创业 / 生活。
 */
export interface DomainOption {
  readonly id: string;
  readonly label: string;
  /** 玩家点选后用于二次检索的检索词。 */
  readonly querySeed: string;
  /** 该宽领域下的信号词（用于置信度判定与事件领域对齐）。 */
  readonly signals: readonly string[];
}

export const DOMAIN_OPTIONS: readonly DomainOption[] = [
  {
    id: 'study',
    label: '学业',
    querySeed: '考研 绩点 专业课 真实经历',
    signals: ['考研', '保研', '绩点', '挂科', '复试', '调剂', '读研', '博士', '申博', '论文', '毕设', '专业课'],
  },
  {
    id: 'career',
    label: '职业',
    querySeed: '应届生 第一份工作 真实经历',
    signals: [
      '求职', '简历', '面试', 'offer', '实习', '转正', '晋升', '跳槽', '试用期',
      '大厂', '外包', '工作', '岗位', '职业', '就业', '秋招', '春招', '校招', '薪资', '涨薪', '裁员',
    ],
  },
  {
    id: 'pivot',
    label: '转行',
    querySeed: '转行 零基础 需要多久 真实经历',
    signals: ['转行', '转码', '跨考', '跨专业', '换行业', '零基础', '转岗', '换赛道', '自学'],
  },
  {
    id: 'city',
    label: '城市',
    querySeed: '留在大城市 还是 回老家 真实经历',
    signals: ['大城市', '回老家', '一线', '二线', '房租', '户口', '买房', '异地', '漂', '北漂', '沪漂'],
  },
  {
    id: 'startup',
    label: '创业',
    querySeed: '创业 独立开发 收入 真实经历',
    signals: ['创业', '独立开发', '副业', '接单', '做产品', '合伙人', '融资', '开店', '自由职业'],
  },
  {
    id: 'life',
    label: '生活',
    querySeed: '家庭期待 同辈压力 真实经历',
    signals: [
      '家里', '父母', '家庭', '期待', '压力', '焦虑', '身体', '健康', '对象',
      '结婚', '作息', '情绪', '同辈', '生活', '心态',
    ],
  },
];

/**
 * 歧义信号黑名单：命中这些词**不算方向**。
 *
 * 实测教训：`life` 原本包含「比较」，于是
 * 「中午吃什么**比较**好」被判定为「有生活方向」而通过。
 * 这类词在口语里太常见，作为领域信号只会制造假阳性 ——
 * 而假阳性的代价正是「把玩家放进一个空网格」。
 *
 * 因此宁可漏（多问一次），不可错（白玩一局）。
 */
const AMBIGUOUS_SIGNALS: readonly string[] = [
  '比较', '随便', '可能', '应该', '觉得', '感觉', '时候', '问题', '事情',
];

/**
 * 领域置信度（v3 §20）。
 *
 * 这是**现场最容易出事故的地方**：自定义输入可能是一句与职业决策无关的话
 * （「今天天气不错」）。如果直接拿去检索，会得到一张空网格，
 * 而玩家已经进入游戏 —— 那就是一次白玩。
 *
 * 判定刻意保守（宁可多问一次，不要白玩一局）：
 *
 * | 信号 | 加分 |
 * |---|---|
 * | 命中窄领域词（`DOMAIN_LEXICON`） | +0.5 |
 * | 命中宽领域信号词（每多一个 +0.2，上限 0.4） | +0.2 / 个 |
 * | 命中动作词或处境词 | +0.2 |
 *
 * **阈值定在 0.2，语义是「至少要有一点点方向感」**。
 *
 * 这个数字是实测定出来的，中间踩过一次死循环：
 * 「我在纠结要不要回老家」只命中一个宽领域信号（「回老家」= 0.2），
 * 而玩家点选「城市」之后的检索词得分同样是 0.2 ——
 * 只要阈值高于 0.2，就会「拦下 → 二次选择 → 又被拦下」无限循环。
 *
 * 0.2 的正确性在于：**命中任一宽领域即视为有方向**（那是玩家自己给的线索），
 * 而完全无关的输入（「今天天气不错」）得分仍是 0，照样被拦。
 * 想更严的话也允许玩家主动换一个领域，但不能阻断。
 */
export interface DomainConfidence {
  readonly score: number;
  /** 命中的窄领域词（具体方向）。 */
  readonly matchedDomains: readonly string[];
  /** 命中的宽领域。 */
  readonly matchedBroad: readonly DomainOption[];
}

export const DOMAIN_CONFIDENCE_THRESHOLD = 0.2;

export function domainConfidenceOf(input: PlanInput): DomainConfidence {
  const haystack = `${input.goal ?? ''} ${input.background ?? ''}`.trim();
  if (haystack.length === 0) {
    return { score: 0, matchedDomains: [], matchedBroad: [] };
  }

  const matchedDomains = firstHits(haystack, DOMAIN_LEXICON, 4);
  let score = matchedDomains.length > 0 ? 0.5 : 0;

  /**
   * 宽领域匹配时先剔除歧义信号：
   * 命中「比较」「随便」这类词不算方向 —— 否则
   * 「中午吃什么比较好」会被误判为「有生活方向」。
   */
  const matchedBroad = DOMAIN_OPTIONS.filter((option) =>
    option.signals.some(
      (signal) => !AMBIGUOUS_SIGNALS.includes(signal) && haystack.includes(signal),
    ),
  );
  if (matchedBroad.length > 0) {
    score += Math.min(0.4, 0.2 * matchedBroad.length);
  }

  const hasAction = extractAction(haystack) !== null;
  const hasSituation = firstHits(haystack, SITUATION_LEXICON, 1).length > 0;
  if (hasAction || hasSituation) {
    score += 0.2;
  }

  return {
    score: Math.min(1, Number(score.toFixed(2))),
    matchedDomains,
    matchedBroad,
  };
}

/** 置信度是否足够直接检索。 */
export function isConfidentEnough(match: DomainConfidence): boolean {
  return match.score >= DOMAIN_CONFIDENCE_THRESHOLD;
}


function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function firstHits(text: string, lexicon: readonly string[], limit: number): readonly string[] {
  return lexicon.filter((word) => text.includes(word)).slice(0, limit);
}

/**
 * 从玩家原话里抽出「分歧轴线」关键词：
 * 用于 `divergence` 意图，让检索命中「后悔 / 成功」两侧的样本。
 */
function divergenceTerms(action: string | null): readonly string[] {
  if (!action) {
    return ['后悔', '值不值'];
  }
  // 两侧都要：只搜「成功」会得到幸存者偏差的网格
  return [`${action}后悔`, `${action}成功`];
}

/**
 * 抽动作：先查词表，命中不了再退回开放式「转/换 + 目标」正则。
 *
 * 为什么两层：词表保证精度（不会把「转眼」当成动作），
 * 正则保证召回（真实表述是长尾，「转计算机」不在任何词表里）。
 */
export function extractAction(text: string): string | null {
  const fromLexicon = ACTION_LEXICON.find((word) => text.includes(word));
  if (fromLexicon) {
    return fromLexicon;
  }
  const match = OPEN_ACTION.exec(text);
  if (!match) {
    return null;
  }
  const target = match[1];
  if (/^(而|成|为|到|向|过|来|去|眼|手|身|头|弯|圈)/.test(target)) {
    return null;
  }
  return `转${target}`;
}

export interface PlanInput {
  readonly goal: string;
  /** 已解析的处境档案（可选）：有则让处境检索更准。 */
  readonly background?: string | null;
}

/**
 * 生成检索计划。
 *
 * 输出顺序即优先级：前两个是核心（处境 + 分歧），后面是补充。
 * 调用方可以按配额截断，且截断后仍能得到一张可用的网格。
 */
export function planQueries(input: PlanInput): readonly PlannedQuery[] {
  const goal = input.goal.trim();
  const background = (input.background ?? '').trim();
  const haystack = `${goal} ${background}`;

  if (haystack.trim().length === 0) {
    return [];
  }

  const domains = firstHits(haystack, DOMAIN_LEXICON, 2);
  const actions = firstHits(haystack, ACTION_LEXICON, 2);
  const situations = firstHits(haystack, SITUATION_LEXICON, 2);

  const core = uniq([...domains, ...actions]).slice(0, 2);
  const domainText = core.join(' ');
  const action = extractAction(goal) ?? actions[0] ?? null;
  const situationText = situations.join(' ');

  const queries: PlannedQuery[] = [];

  // ① 处境：我从哪来 + 我想去哪
  if (domainText.length > 0) {
    queries.push({
      intent: 'situation',
      query: `${situationText} ${domainText} 经历`.trim().slice(0, 50),
      keywords: uniq([...core, ...situations]).slice(0, 6),
    });
  }

  // ② 分歧：两侧的样本必须都拿到，否则网格只有一条路线（无法对比）
  if (action) {
    for (const term of divergenceTerms(action)) {
      if (queries.length >= MAX_QUERIES) break;
      queries.push({
        intent: 'divergence',
        query: `${term} 真实经历`.trim().slice(0, 50),
        keywords: [action, term.replace('后悔', '').replace('成功', '')].filter((item) => item.length > 0),
      });
    }
  }

  // ③ 约束：钱、时间、家庭支持 —— 代价画像的数据来源
  if (domainText.length > 0) {
    queries.push({
      intent: 'constraint',
      query: `${domainText} 时间 成本 后悔`.trim().slice(0, 50),
      keywords: ['成本', '时间', '脱产'],
    });
  }

  // ④ 兜底：玩家的原话本身就是最好的检索词之一
  if (queries.length < MAX_QUERIES && goal.length >= 6) {
    queries.push({
      intent: 'situation',
      query: goal.slice(0, 40),
      keywords: core.slice(0, 3),
    });
  }

  // 去重（同 query 只留第一条）并限流
  const seen = new Set<string>();
  const unique: PlannedQuery[] = [];
  for (const planned of queries) {
    if (planned.query.length === 0 || seen.has(planned.query)) {
      continue;
    }
    seen.add(planned.query);
    unique.push(planned);
  }

  return unique.slice(0, MAX_QUERIES);
}

/**
 * 用路线原型的关键词 + 本次检索词，构造卡片归属用的关键词集。
 *
 * 顺序与 `PATH_ARCHETYPES` 一致，`cards.ts` 的 `toPathCards` 依赖这个顺序
 * 来保证「一条内容只算进一条路线」。
 */
export function keywordSetsFor(
  plan: readonly PlannedQuery[],
  pathArchetypes: readonly { readonly keywords: readonly string[] }[] = PATH_ARCHETYPES,
): ReadonlyArray<readonly string[]> {
  const fromPlan = plan.flatMap((planned) => planned.keywords);
  return pathArchetypes.map((archetype) => uniq([...archetype.keywords, ...fromPlan]));
}

/** 供界面展示：这次到底搜了什么（透明可查，答评委用）。 */
export function describePlan(plan: readonly PlannedQuery[]): readonly string[] {
  return plan.map((planned) => planned.query);
}

export type { QueryIntent };
