import type { EvidenceFact, PathCluster } from '@/features/decision-session/domain';

/**
 * 问题专属路径聚类（重构方案 §5.1 / §12 P0）。
 *
 * ## 它替换了什么
 *
 * 旧的 `PATH_ARCHETYPES` 是**产品级**的七条职业路径
 * （脱产转型 / 在职转型 / 跨行换赛道 / 原地深耕 / 平级跳板 / 求稳路线 / 先缓一缓）。
 * 它们被跨场景复用，于是「大二基础一般，要不要参加比赛」会显示「在职转型」——
 * 用户会立刻质疑内容与问题无关（方案 §1.2 实测）。
 *
 * ## 新做法
 *
 * 路径名**属于当前问题**：先识别问题类型（比赛 / 升学就业 / 第一份工作 / 转方向），
 * 再用该类型下的**走法信号**把真实事实聚类。
 *
 * 关键纪律：
 *
 * 1. **路径只能从真实事实里长出来**。某个走法没有任何事实命中 → 这条路径不出现
 *    （方案 §5.3：少于两条高相关事实就不生成三条路径，直接说证据不足）。
 * 2. **每条路径都要尽力找反例**（方案 §5.2）。找不到就如实标 `unknowns`，
 *    不许为了排版好看假装有分歧。
 * 3. 全部确定性：无随机、无模型。同样的 (问题, 事实) 必得同样的聚类。
 */

/* -------------------------------------------------------------------------- */
/* 1. 问题类型                                                                 */
/* -------------------------------------------------------------------------- */

export type ProblemType = 'competition' | 'postgrad-or-job' | 'first-job' | 'pivot' | 'city';

export interface ProblemTypeSpec {
  readonly id: ProblemType;
  readonly label: string;
  readonly detect: readonly string[];
}

export const PROBLEM_TYPES: readonly ProblemTypeSpec[] = [
  {
    id: 'competition',
    label: '比赛与项目',
    detect: ['比赛', '竞赛', '参赛', '项目', '大创', '数模', '建模', 'hackathon', '挑战赛'],
  },
  {
    id: 'postgrad-or-job',
    label: '升学与就业',
    detect: ['考研', '读研', '保研', '考公', '考编', '二战', '上岸', '申博', '读博', '公务员'],
  },
  {
    id: 'first-job',
    label: '第一份实习或工作',
    detect: ['实习', 'offer', '校招', '秋招', '春招', '第一份工作', '试用期', '转正', '跳槽'],
  },
  {
    id: 'pivot',
    label: '转专业与转行',
    detect: ['转专业', '转行', '转码', '跨考', '跨专业', '换赛道', '换行业', '辞职', '裸辞'],
  },
  {
    /**
     * 「城市与去留」是第五类。
     *
     * 为什么必须有：黄金案例《毕业前夜》问的是「留在大城市还是回老家」，
     * 而它原本被判成「第一份实习或工作」类 —— 因为「应届毕业」命中了那一类。
     * 结果证据网格给出「看平台与成长空间 / 先保住收入」，与去留问题无关。
     * 四类覆盖不了它，所以补一类，而不是把案例删掉。
     */
    id: 'city',
    label: '城市与去留',
    detect: ['大城市', '回老家', '一线', '二线', '留在', '城市', '户口', '异地', '漂', '房租', '离家'],
  },
];

/**
 * 判定问题类型。
 *
 * 按命中数降序；**全不命中返回 null**（而不是兜底成本文第一类）——
 * 兜底会让「今天天气不错」也被归成「比赛与项目」，那是错配的源头。
 */
export function detectProblemType(question: string): ProblemType | null {
  const text = question.trim();
  if (text.length === 0) {
    return null;
  }

  let best: { id: ProblemType; hits: number } | null = null;
  for (const spec of PROBLEM_TYPES) {
    const hits = spec.detect.filter((word) => text.includes(word)).length;
    if (hits > 0 && (best === null || hits > best.hits)) {
      best = { id: spec.id, hits };
    }
  }
  return best?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* 2. 每个问题类型下的走法                                                       */
/* -------------------------------------------------------------------------- */

interface RouteSpec {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** 命中这些词的事实 = 这条走法的**支持样本**。 */
  readonly support: readonly string[];
  /**
   * 命中这些词的事实 = 这条走法的**限制或反例**（方案 §5.2）。
   *
   * 刻意与 `support` 分开声明：只找支持样本的检索是一面之词，
   * 而「主动呈现反例」是本产品区别于搜索摘要的地方（方案 §11）。
   */
  readonly limit: readonly string[];
}

/**
 * 走法定义。
 *
 * 这些词表来自对**已落盘真实快照**的阅读（`src/data/zhihuSources.generated.json`），
 * 不是凭空写的：例如「比赛」类型下的第二条路径来自一条明确说
 * 「为什么建议选择项目而不是竞赛」的真实回答。
 */
const ROUTES: Readonly<Record<ProblemType, readonly RouteSpec[]>> = {
  competition: [
    {
      id: 'comp-join-and-learn',
      label: '直接报名，边做边学',
      summary: '不等准备好，先进队再补技术，靠比赛逼着成长。',
      support: ['参加', '报名', '参赛经历', '分工', '边做', '赛制', '赛题', '组队', '队友'],
      limit: ['没时间', '兼顾', '挂科', '中途退出', '半途', '精力有限', '顾不过来'],
    },
    {
      id: 'comp-build-first',
      label: '先做一个能交付的项目，再决定报不报名',
      summary: '先把基础和一个完整交付做出来，不急着上赛场。',
      support: ['项目', '打基础', '系统架构', '工程实践', '不建议竞赛', '而不是竞赛', '先做'],
      limit: ['错过', '下次', '拖', '一直准备', '来不及'],
    },
    {
      id: 'comp-time-first',
      label: '参赛，但先解决课内与竞赛的时间冲突',
      summary: '真正的问题往往不是参不参赛，而是时间能不能长期兼顾。',
      support: ['兼顾', '时间安排', '平衡', '碎片', '时间管理', '课内', '效率'],
      limit: ['刷题', '吃不消', '无休止', '强度'],
    },
  ],
  'postgrad-or-job': [
    {
      id: 'pg-postgrad',
      label: '先考研读研，把学历和方向一起解决',
      summary: '用两到三年换取一次重新选择方向的机会。',
      support: ['考研', '读研', '备考', '二战', '上岸', '复习', '初试', '复试'],
      limit: ['压力', '失败', '调剂', '一年', '成本'],
    },
    {
      id: 'pg-job',
      label: '直接就业，用工作里的一手经验换方向',
      summary: '先进职场，在真实项目里验证自己适合什么。',
      support: ['就业', '秋招', '找工作', '实习', 'offer', '面试', '简历', '校招'],
      limit: ['学历', '门槛', '受限', '晋升'],
    },
    {
      id: 'pg-public',
      label: '走考公考编，优先确定性',
      summary: '把稳定性放在成长速度之前。',
      support: ['考公', '考编', '公务员', '体制内', '事业单位', '编制'],
      limit: ['竞争', '比例', '上岸难', '岗位'],
    },
  ],
  'first-job': [
    {
      id: 'fj-platform',
      label: '看平台与成长空间，先进能学到东西的地方',
      summary: '把「能不能快速成长」放在薪资前面。',
      support: ['平台', '成长', '团队', '学到', '氛围', '大厂', '业务'],
      limit: ['加班', '消耗', '拧螺丝', '边缘'],
    },
    {
      id: 'fj-income',
      label: '先保住收入与确定性',
      summary: '先解决生存与稳定，再谈长期方向。',
      support: ['薪资', '待遇', '稳定', '国企', '央企', '收入', '保障'],
      limit: ['天花板', '成长慢', '养老'],
    },
    {
      id: 'fj-experience',
      label: '先接一段实习，用真实经历替代想象',
      summary: '不确定就先去做一段，用经历换判断。',
      support: ['实习', '积累', '试错', '经历', '体验', '了解'],
      limit: ['打杂', '学不到', '廉价'],
    },
  ],
  pivot: [
    {
      id: 'pv-full-time',
      label: '脱产全力转，接受收入中断',
      summary: '停下手里的收入来源，集中一段时间完成转向。',
      support: ['脱产', '裸辞', '辞职', '全力', '全职', '破釜沉舟'],
      limit: ['风险', '积蓄', '断了', '后悔', '压力'],
    },
    {
      id: 'pv-part-time',
      label: '不脱产，边工作边把新方向做起来',
      summary: '保住现金流，用业余时间慢慢迁移。',
      support: ['在职', '业余', '下班', '周末', '副业', '边工作边', '自学'],
      limit: ['慢', '精力', '坚持', '碎片'],
    },
    {
      id: 'pv-validate-first',
      label: '先小规模验证，再决定要不要全押',
      summary: '用一个能撤回的小动作先测试这条路。',
      support: ['先试', '试水', '小规模', '验证', '接单', '体验一下'],
      limit: ['拖', '一直在试', '不敢', '犹豫'],
    },
  ],
  city: [
    {
      id: 'city-stay',
      label: '留在大城市，用成本换机会密度',
      summary: '接受更高的房租与竞争，换取更多岗位与更快的成长速度。',
      support: ['留在大城市', '留在大城市闯', '北上广', '一线', '机会多', '平台多', '不回'],
      limit: ['房租', '压力', '通勤', '孤独', '攒不下'],
    },
    {
      id: 'city-home',
      label: '回老家，用确定性换掉一部分可能性',
      summary: '接受机会变少，换取更低的成本与更近的家人。',
      support: ['回老家', '回家', '考编', '老家', '父母身边', '小城市', '稳定下来'],
      limit: ['不甘心', '机会少', '后悔', '关系', '天花板'],
    },
    {
      id: 'city-middle',
      label: '先去一个中间城市，把两头的代价都压低',
      summary: '不去最卷的，也不回最稳的，找一个成本与机会的折中点。',
      support: ['二线', '新一线', '折中', '中间', '换个城市', '成都', '杭州', '武汉', '长沙'],
      limit: ['陌生', '重新开始', '人脉', '不了解'],
    },
  ],
};

/** 该问题类型下的全部走法（供界面在「证据不足」时说明我们找过哪些方向）。 */
export function routeLabelsFor(type: ProblemType): readonly string[] {
  return ROUTES[type].map((route) => route.label);
}

/**
 * 该问题类型对应的**路径集**（`PathArchetype` 形状）。
 *
 * ## 为什么需要它
 *
 * 推演舱的证据网格原本固定用产品级的七条职业路径来分组与命名，
 * 于是「大二基础要不要参加比赛」会显示「在职转型 / 平级跳板」——
 * 与问题无关（实测确认）。把问题专属走法装成 `PathArchetype`
 * 交给 `buildMesh`，分组与标签就都跟着问题走。
 *
 * `support` 作为 `keywords`：它本来就是「命中这些词的事实属于这条走法」，
 * 与 `PathArchetype.keywords` 的语义完全一致，因此不需要第二套词表。
 */
export function archetypesFor(type: ProblemType): readonly {
  readonly pathId: string;
  readonly label: string;
  readonly summary: string;
  readonly keywords: readonly string[];
}[] {
  return ROUTES[type].map((route) => ({
    pathId: route.id,
    label: route.label,
    summary: route.summary,
    keywords: route.support,
  }));
}

/* -------------------------------------------------------------------------- */
/* 3. 聚类                                                                     */
/* -------------------------------------------------------------------------- */

function matchCount(text: string, words: readonly string[]): number {
  return words.filter((word) => text.includes(word)).length;
}

/** 事实的可检索文本：原文 + 明确值。 */
function textOf(fact: EvidenceFact): string {
  return `${fact.quote}${fact.explicitValue ?? ''}`;
}

export interface ClusterResult {
  /** 只有**至少有一条支持事实**的走法才会成为路径。 */
  readonly clusters: readonly PathCluster[];
  /** 命中问题类型但没能聚到任何走法的事实数（如实统计给 trace 看）。 */
  readonly unassignedFacts: number;
  /** 该问题类型下我们**考虑过但证据不足**的走法名（诚实展示用）。 */
  readonly insufficientRoutes: readonly string[];
}

/**
 * 把事实聚成问题专属路径。
 *
 * 返回值里 `insufficientRoutes` 是刻意保留的：当三条走法里只有两条有证据时，
 * 界面应当说「第三条目前没有找到可核对经历」，而不是把它悄悄删掉 ——
 * 后者会让用户以为「世界上只有两种做法」。
 */
export function clusterPaths(input: {
  readonly question: string;
  readonly facts: readonly EvidenceFact[];
  readonly type: ProblemType;
}): ClusterResult {
  const specs = ROUTES[input.type];
  const assigned = new Set<string>();
  const clusters: PathCluster[] = [];
  const insufficientRoutes: string[] = [];

  for (const spec of specs) {
    const supporting: EvidenceFact[] = [];
    const opposing: EvidenceFact[] = [];

    for (const fact of input.facts) {
      const text = textOf(fact);
      const supportHits = matchCount(text, spec.support);
      const limitHits = matchCount(text, spec.limit);

      if (supportHits > 0) {
        supporting.push(fact);
        assigned.add(fact.id);
      } else if (limitHits > 0) {
        // 只命中限制词的事实：它是这条走法的反例，不构成支持
        opposing.push(fact);
      }
    }

    if (supporting.length === 0) {
      insufficientRoutes.push(spec.label);
      continue;
    }

    /**
     * 反例补全：优先用本走法自己的限制样本；若没有，
     * 借用**其它走法**的支持样本中带转折词的那些 ——
     * 「有人说 A，但他同时提到 B 的代价」正是最有价值的分歧。
     */
    const borrowed = opposing.length > 0 ? [] : input.facts.filter((fact) => {
      if (assigned.has(fact.id) && supporting.includes(fact)) {
        return false;
      }
      return /但|不过|然而|可是|其实|问题在于|代价是/.test(fact.quote);
    }).slice(0, 2);

    const opposingFacts = [...opposing, ...borrowed].slice(0, 3);

    clusters.push({
      id: spec.id,
      label: spec.label,
      summary: spec.summary,
      supportingFactIds: supporting.map((fact) => fact.id),
      opposingFactIds: opposingFacts.map((fact) => fact.id),
      conditions: supporting
        .map((fact) => fact.explicitValue)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .slice(0, 4),
      unknowns: unknownsFor(spec, supporting, opposingFacts),
      origin: 'curated',
    });
  }

  return {
    clusters,
    unassignedFacts: input.facts.filter((fact) => !assigned.has(fact.id)).length,
    insufficientRoutes,
  };
}

/**
 * 这条走法上仍然无法回答的问题。
 *
 * **这是本产品的核心输出之一**（方案 §3.1 第四步的「当前未知」）。
 * 刻意不生成「你行不行」这类判断，只生成「哪些信息还缺」。
 */
function unknownsFor(
  spec: RouteSpec,
  supporting: readonly EvidenceFact[],
  opposing: readonly EvidenceFact[],
): readonly string[] {
  const unknowns: string[] = [];

  if (supporting.length < 3) {
    unknowns.push(`这条走法目前只有 ${supporting.length} 条可核对经历，样本太少，不能说明它在多数人身上成立。`);
  }
  if (opposing.length === 0) {
    unknowns.push('目前没有找到明确提到代价或中途退出的经历，因此这条走法的下行风险仍是未知。');
  }
  // 每种走法缺的那块信息不一样，这里给的是「这条走法最常缺什么」
  if (spec.id === 'comp-join-and-learn' || spec.id === 'comp-time-first') {
    unknowns.push('你每周能稳定投入多少小时，决定这条走法是否现实。');
  } else if (spec.id === 'pg-postgrad' || spec.id === 'pv-full-time') {
    unknowns.push('你能承受多长的收入或时间中断，决定这条走法可不可行。');
  } else if (spec.id === 'fj-platform' || spec.id === 'fj-income') {
    unknowns.push('你更在意两年后的能力，还是这两个月的现金流，决定哪一条更适合你。');
  } else {
    unknowns.push('你手上已有的资源（时间、技能、人脉）有多少可以直接迁移，决定这条走法的启动成本。');
  }

  return unknowns;
}
