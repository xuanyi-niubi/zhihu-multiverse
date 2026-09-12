import { snapshotToPathCards, type SnapshotSource } from '@/core/evidence/cards';
import { buildMesh, PATH_ARCHETYPES } from '@/core/evidence/mesh';
import { archetypesFor, detectProblemType } from '@/features/decision-session/routes';
import { AXES } from '@/core/decision/axis';
import { caseIndex, sourcesByPrefix } from '@/data/knowledgeSources';

import type { KnowledgeSource } from '@/features/run/knowledgeSource';
import type { EvidenceMesh } from '@/types/evidence';

/**
 * 黄金 Demo Case（v2 §21 / §15.2）。
 *
 * ⚠️ **与 v2 原文的一处刻意偏离，必须说清**：
 *
 * v2 §15.2 要求「手工准备 3 个高质量 Case，每一个都必须人工核验」，
 * 但 v2 §22.2 同时要求「**demo 数据不可伪装 verified**」，§2.2 原则 C 要求
 * 「未知就是未知」。手工编写的「前人经历」一旦进证据网格，就是伪造来源 ——
 * 两者不能同时满足。
 *
 * 本实现的取舍：**Case 是真实检索结果的聚合视图，不是手写数据。**
 * - 检索词由人挑选（这就是「人工核验」：确认这些议题值得探）；
 * - 经历内容全部来自 `npm run sync:zhihu` 用官方 key 真实抓取的快照；
 * - 没有快照时，Case 返回空网格，界面如实显示「证据不足」。
 *
 * 于是「离线演示」不是靠编数据，而是靠**一次性真实抓取 + 落盘复用**。
 */

/** Case 的元数据：给界面用的标题与检索意图。 */
export interface DemoCase {
  readonly caseId: string;
  readonly title: string;
  /** 玩家会输入的那句迷茫（首页「人生裂缝」入口用它预填）。 */
  readonly goal: string;
  /** 这一局的核心抉择（世界线 A / B 的分野）。 */
  readonly fork: string;
  /**
   * **人工策划的匹配短语**。
   *
   * 为什么需要它：`goal` 与 `fork` 是完整的书面表述，而玩家（以及路演脚本）
   * 会用**口语化的近义说法**。实测踩到过：路演脚本原话
   * 「大二基础一般，要不要参加这次比赛？」与 `goal`
   * 「大二，基础一般，想直接参加比赛，但怕耽误课程」没有足够字面重叠，
   * 于是**演示时黄金案例匹配不上** —— 而演示必须稳定。
   *
   * 用人工策划而不是放宽通用相似度：`matchDemoCase` 决定「给访客看哪份证据」，
   * 错配的代价是给他看别人的经历。短语表可控、可复核、可测试。
   *
   * 命中规则：问题包含任一长度 ≥3 的短语即命中。
   */
  readonly matchHints: readonly string[];
  /** 检索锚点数量与来源数量（如实展示分母）。 */
  readonly anchors: number;
  readonly sources: number;
}

/**
 * 三个黄金 Case 的定义。
 *
 * `caseId` 与同步脚本的 `TARGETS[].case` 一一对应；
 * `goal` 刻意写成**玩家的口吻**（v2 §5.2 的例子风格），
 * 因为它会直接进 Query Planner 与推演舱。
 */
export const DEMO_CASES: readonly DemoCase[] = [
  {
    caseId: 'demo-sophomore',
    title: '大二的夏天',
    goal: '大二，基础一般，想直接参加比赛，但怕耽误课程',
    fork: '先补基础再参赛 vs 直接参赛边做边学',
    matchHints: [
      '大二基础一般',
      '要不要参加这次比赛',
      '要不要参加比赛',
      '该不该参加比赛',
      '基础一般',
      '耽误课程',
      '大二参加',
    ],
    anchors: 0,
    sources: 0,
  },
  {
    caseId: 'demo-graduate',
    title: '毕业前夜',
    goal: '应届毕业，纠结留在大城市还是回老家',
    fork: '留在大城市闯 vs 回老家考编稳住',
    matchHints: [
      '留在大城市还是回老家',
      '留在大城市',
      '回老家',
      '应届毕业',
      '考编稳住',
      '毕业留哪',
    ],
    anchors: 0,
    sources: 0,
  },
  {
    caseId: 'demo-pivot',
    title: '辞职信',
    goal: '工作两年想转行 AI，纠结裸辞全力冲还是边工作边转型',
    fork: '裸辞全力冲 vs 边工作边转型',
    matchHints: [
      '裸辞全力冲',
      '边工作边转型',
      '想转行',
      '工作两年',
      '要不要裸辞',
      '转行',
    ],
    anchors: 0,
    sources: 0,
  },
];

/** 由真实快照装配一个 KnowledgeSource → SnapshotSource。 */
function toSnapshot(source: KnowledgeSource): SnapshotSource {
  return {
    id: source.id,
    author: source.author,
    quote: source.quote,
    upvotes: source.upvotes,
    url: source.url,
    retrievedAt: source.retrievedAt,
    status: source.status,
    // 权威度与编辑时间必须带上：漏掉它们等于白白丢掉官方接口给的分级信号
    // （实测 60 条快照里 50 条是 rank 4，漏传会让证据强度一致偏低）
    editTime: source.editTime,
    authority: source.authority,
  };
}

/** 收集某 Case 下的全部真实来源（一个锚点可能有多条同向样本）。 */
export function caseSources(caseId: string): readonly KnowledgeSource[] {
  return caseEntries(caseId).map((entry) => entry.source);
}

/** 来源 + 它所属的锚点（用于把「锚点声明的路线」传给网格构建）。 */
interface CaseEntry {
  readonly anchor: string;
  readonly source: KnowledgeSource;
}

function caseEntries(caseId: string): readonly CaseEntry[] {
  const anchors = caseIndex()[caseId];
  if (!anchors || anchors.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: CaseEntry[] = [];
  for (const anchor of anchors) {
    for (const source of sourcesByPrefix(anchor)) {
      if (seen.has(source.id)) {
        continue;
      }
      seen.add(source.id);
      out.push({ anchor, source });
    }
  }
  return out;
}

/** 该 Case 是否有可用样本（界面据此决定是渲染网格还是「证据不足」）。 */
export function hasCase(caseId: string): boolean {
  return caseSources(caseId).some((source) => source.status === 'verified');
}

/**
 * 由真实快照构建某 Case 的证据网格。
 *
 * 纯函数：同一份快照必得同一张网格（`meshHash` 一致），因此 Case 可以被
 * 挑战链接引用、可以被复盘；改动只可能来自重新抓取快照。
 *
 * @param now 固定时间戳，用于让网格可复现（测试与挑战链接需要）
 */
export function demoMeshFor(caseId: string, now: number = Date.now()): EvidenceMesh | null {
  const meta = DEMO_CASES.find((item) => item.caseId === caseId);
  if (!meta) {
    return null;
  }

  const entries = caseEntries(caseId);
  if (entries.length === 0) {
    return null;
  }

  /**
   * 路径集**属于当前问题**，不用产品级的七条职业路径。
   *
   * 起因（实测确认）：`anchorPaths` 把「大二要不要参加比赛」的四个锚点
   * 分别映射到了 `path-slow-down` / `path-lateral-move` / `path-part-time-pivot`，
   * 于是推演舱里出现「先缓一缓 / 平级跳板 / 在职转型」—— 与问题无关。
   *
   * 现在改为按问题类型取**问题专属走法**（比赛 → 直接报名边做边学 /
   * 先做能交付的项目 / 先解决课内与竞赛的时间冲突），并且：
   * - 分组与命名都用这套走法（`buildMesh({ archetypes })`）；
   * - **丢弃失效的 `anchorPaths` 覆盖** —— 它的 pathId 已不在新集合里，
   *   保留只会让卡片被静默丢弃；
   * - 归类完全由来源原文的关键词命中决定，因此可复核、可复现。
   */
  const problemType = detectProblemType(meta.goal);
  const archetypes = problemType ? archetypesFor(problemType) : PATH_ARCHETYPES;
  const keywordSets = archetypes.map((archetype) => archetype.keywords);

  const cards = snapshotToPathCards(
    entries.map((entry) => toSnapshot(entry.source)),
    { goal: meta.goal, keywordSets },
  );

  if (cards.length === 0) {
    return null;
  }

  return buildMesh({
    goal: meta.goal,
    cards,
    archetypes,
    queries: [`${meta.title} · ${meta.fork}`],
    provenance: 'snapshot',
    axes: AXES,
    now,
  });
}

/** Case 的实时统计（分母必须可见）。 */
export function demoCaseStats(caseId: string): { readonly anchors: number; readonly sources: number } {
  const anchors = caseIndex()[caseId]?.length ?? 0;
  return { anchors, sources: caseSources(caseId).length };
}

/** 列出所有**当前可用**的 Case（有真实样本的）。 */
export function availableDemoCases(): readonly DemoCase[] {
  return DEMO_CASES.map((meta) => {
    const stats = demoCaseStats(meta.caseId);
    return { ...meta, anchors: stats.anchors, sources: stats.sources };
  }).filter((meta) => meta.sources > 0);
}

/**
 * 按玩家输入的目标**反查**最接近的黄金 Case（v3 §20 的延伸）。
 *
 * ## 为什么必须有这个函数
 *
 * 实测到的真实问题：`/compare?goal=…` 对**未配置 key 的访客**
 * 会显示「这次没有可用的证据网格」—— 因为它走实时检索，而访客没有知乎 key。
 * 于是这个「绝杀时刻」的舞台对默认访客完全空转。
 *
 * 但站点明明**已经落盘了真实快照**（`sync:zhihu` 产出）。
 * 所以正确行为是：目标与某个黄金 Case 足够接近时，直接用那份快照 ——
 * 零配额、零延迟，且**每个访客都能看到真实证据**。
 *
 * ## 判定方式刻意保守
 *
 * 用「标题 + 目标」的字面包含关系，而不是语义相似度：
 * 宁可偶尔不命中（那就退回实时检索），也不要错误地把游客的目标
 * 归到不相关的 Case 上 —— 那等于给他看别人的证据。
 */
export function matchDemoCase(goal: string): DemoCase | null {
  const text = goal.trim();
  // 过短的输入信息量太低：实测「比赛」会因反向包含命中整个 Case
  if (text.length < 6) {
    return null;
  }

  for (const meta of DEMO_CASES) {
    if (demoCaseStats(meta.caseId).sources === 0) {
      continue;
    }

    /**
     * 0) **人工策划短语优先**。
     *
     * 这条排在通用相似度之前，是因为它是最可靠的信号：
     * 短语表是人看着案例写的，命中即命中。路演脚本的原话依赖这条命中，
     * 否则演示时会出现「黄金案例没匹配上」的翻车。
     */
    if (meta.matchHints.some((hint) => hint.length >= 3 && text.includes(hint))) {
      return { ...meta, ...demoCaseStats(meta.caseId) };
    }

    // 1) 玩家原话里包含了 Case 的完整目标表述（点了裂缝卡再进来）
    if (text.includes(meta.goal)) {
      return { ...meta, ...demoCaseStats(meta.caseId) };
    }

    /**
     * 2) **反向包含必须要求玩家输入足够长**。
     *
     * 实测踩到的漏洞：`meta.goal.includes(text)` 对短输入极不友好 ——
     * 输入「比赛」会被判定为命中「大二…想直接参加**比赛**…」这个 Case。
     * 于是任何提到某个泛词的人都会被告知「你的目标和《大二的夏天》接近」。
     *
     * 因此反向包含只在玩家给了较长表述（≥10 字）时才允许：
     * 那时「Case 的目标里包含我说的这句话」才算一个可信的信号。
     */
    if (text.length >= 10 && meta.goal.includes(text)) {
      return { ...meta, ...demoCaseStats(meta.caseId) };
    }

    // 3) 关键词命中：标题 + 分野里的实词，命中两个以上才算接近
    const keywords = [meta.title, ...meta.fork.split(/\s+vs\s+/)]
      .join(' ')
      .split(/[，,、\s]+/)
      .filter((word) => word.length >= 2);
    const hits = keywords.filter((word) => text.includes(word)).length;
    if (hits >= 2) {
      return { ...meta, ...demoCaseStats(meta.caseId) };
    }
  }

  return null;
}
