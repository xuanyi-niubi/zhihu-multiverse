import { durationToMonths } from '@/core/evidence/cards';
import { gradeOf, strengthOf } from '@/core/evidence/strength';
import { stableHash } from '@/core/run/deterministic';

import type {
  CostProfile,
  DecisionPath,
  EvidenceGrade,
  EvidenceMesh,
  PathCard,
} from '@/types/evidence';

/**
 * Mesh Builder（方案 §5.1 ③）：把一组路径卡聚类成互斥路线。
 *
 * **这是整个证据层里最重要的一个「不许用 AI」的函数。**
 *
 * 理由：聚类结果直接决定后面所有裁决。如果这里交给模型，
 * 同一个目标两次打开可能得到不同的路线划分 —— 「同一颗种子同一局」的
 * 确定性承诺会从证据层就断掉。所以这里只做确定性的关键词归档 + 稳定排序。
 *
 * 产物可以被哈希（`meshHash`），因此：
 * - 同一批卡必得同一张网格；
 * - 挑战链接可以带上它，被挑战者看到的是同一份证据。
 */

/* -------------------------------------------------------------------------- */
/* 路线原型：关键词规则，不是模型判断                                            */
/* -------------------------------------------------------------------------- */

export interface PathArchetype {
  readonly pathId: string;
  readonly label: string;
  readonly summary: string;
  /** 命中即视为属于这条路线（命中数多者为归属）。 */
  readonly keywords: readonly string[];
}

/**
 * 七条互斥路线，覆盖校园与职场新人的常见岔路。
 *
 * 关键词刻意写宽（同义词并列）：宁可一条卡被归到正确的路线，
 * 也不要因为用词不同而漏掉 —— 漏掉会让 `sampleSize` 虚低，
 * 直接把一条有据的路线降级成「证据不足」。
 */
export const PATH_ARCHETYPES: readonly PathArchetype[] = [
  {
    pathId: 'path-full-time-pivot',
    label: '脱产转型',
    summary: '辞掉或停下手里的事，全力投入新的方向。',
    keywords: ['脱产', '全职', '辞职备考', '裸辞', 'gap', '二战', '三战', '全力冲', '破釜沉舟'],
  },
  {
    pathId: 'path-part-time-pivot',
    label: '在职转型',
    summary: '一边保住收入一边往新方向挪，速度慢但不失去现金流。',
    keywords: ['在职', '边工作边', '业余', '下班', '周末学', '副业', '兼职转', '不脱产', '考非全'],
  },
  {
    pathId: 'path-cross-field',
    label: '跨行换赛道',
    summary: '换一个行业或专业方向，把过去的积累折价带走。',
    keywords: ['转行', '转码', '跨考', '跨专业', '换行业', '转岗', '转产品', '转数据', '零基础转'],
  },
  {
    pathId: 'path-stay-and-deepen',
    label: '原地深耕',
    summary: '不换方向，把现有赛道做出深度和不可替代性。',
    keywords: ['深耕', '坚持本行', '不转', '熬', '资历', '专业深耕', '继续做', '稳扎稳打'],
  },
  {
    pathId: 'path-stable-track',
    label: '求稳路线',
    summary: '优先选择确定性与抗风险能力强的路径。',
    keywords: ['考公', '考编', '体制内', '国企', '事业单位', '稳定', '铁饭碗', '教师编'],
  },
  {
    pathId: 'path-slow-down',
    label: '先缓一缓',
    summary: '暂时不推大决定，先处理身体、情绪或家庭的事。',
    keywords: ['休息', '休学', '慢下来', '调整', '先治病', '养身体', '喘口气', '暂停'],
  },
  {
    pathId: 'path-lateral-move',
    label: '平级跳板',
    summary: '用现有能力换一个环境或平台，方向改变但身价不降。',
    keywords: ['跳槽', '换公司', '换城市', '外派', '读研过渡', '留学', '换个环境'],
  },
];

/** 一条卡命中哪些路线（可能命中多条，按命中数排序取归属）。 */
export function matchArchetypes(
  card: PathCard,
  archetypes: readonly PathArchetype[] = PATH_ARCHETYPES,
): readonly string[] {
  const haystack = `${card.title} ${card.quote} ${card.shape.move}`.toLowerCase();
  return archetypes
    .filter((archetype) =>
      archetype.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
    )
    .map((archetype) => archetype.pathId);
}

/* -------------------------------------------------------------------------- */
/* 代价画像聚合                                                                 */
/* -------------------------------------------------------------------------- */

const MONEY_ORDER: Readonly<Record<CostProfile['moneyCost'], number>> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * 由一组卡聚合代价画像。
 *
 * **缺项就是 null，不是 0**：把「没人提到钱」当成「不需要钱」
 * 是证据类产品最容易犯也最致命的错误（方案 §6.1 明确禁止）。
 */
export function costProfileOf(cards: readonly PathCard[]): CostProfile {
  const monthRanges = cards
    .map((card) => durationToMonths(card.shape.duration))
    .filter((range): range is { readonly min: number; readonly max: number } => range !== null);

  const timeCostMonths =
    monthRanges.length === 0
      ? null
      : {
          min: Math.min(...monthRanges.map((range) => range.min)),
          max: Math.max(...monthRanges.map((range) => range.max)),
        };

  // 资金档位取最高的那条 —— 一条「负债」的样本就足以说明这条路可能很贵
  const moneyLevels = cards.map((card) => moneyLevelOf(card));
  const topMoney = moneyLevels.reduce(
    (best, current) => (MONEY_ORDER[current] > MONEY_ORDER[best] ? current : best),
    'unknown' as CostProfile['moneyCost'],
  );

  const irreversibleVotes = cards.map((card) => irreversibleOf(card));
  const irreversible = irreversibleVotes.some((vote) => vote === true)
    ? true
    : irreversibleVotes.every((vote) => vote === false)
      ? false
      : null;

  const allyVotes = cards.map((card) => requiresAllyOf(card));
  const requiresAlly = allyVotes.some((vote) => vote === true)
    ? true
    : allyVotes.every((vote) => vote === false)
      ? false
      : null;

  return { timeCostMonths, moneyCost: topMoney, irreversible, requiresAlly };
}

const MONEY_HIGH = /(负债|借钱|贷款|刷信用卡|透支|花光|掏空|家底)/;
const MONEY_MEDIUM = /(存款|积蓄|生活费|兼职|打零工|省吃俭用|自费)/;
const MONEY_LOW = /(不花钱|免费|白嫖|零成本)/;
const IRREVERSIBLE = /(退学|没.?回头|回不来|错过|来不及|没有退路|一条道走到黑|死磕)/;
const ALLY_NEEDED = /(家里人支持|父母支持|家人支持|对象支持|有人带|导师|抱团|组队|战友)/;
const SOLO = /(一个人|独自|没人帮|无人支持|孤军|全靠自己)/;

function moneyLevelOf(card: PathCard): CostProfile['moneyCost'] {
  const text = `${card.quote} ${card.shape.cost.join(' ')}`;
  if (MONEY_HIGH.test(text)) return 'high';
  if (MONEY_MEDIUM.test(text)) return 'medium';
  if (MONEY_LOW.test(text)) return 'low';
  return 'unknown';
}

function irreversibleOf(card: PathCard): boolean | null {
  const text = `${card.quote} ${card.shape.cost.join(' ')}`;
  if (IRREVERSIBLE.test(text)) return true;
  return null; // 没提到 ≠ 可逆，只能是「不知道」
}

function requiresAllyOf(card: PathCard): boolean | null {
  const text = `${card.quote} ${card.shape.cost.join(' ')}`;
  if (ALLY_NEEDED.test(text)) return true;
  if (SOLO.test(text)) return false;
  return null;
}

/* -------------------------------------------------------------------------- */
/* 组装                                                                        */
/* -------------------------------------------------------------------------- */

/** 由一组卡构造一条决策路径。 */
export function buildPath(input: {
  readonly pathId: string;
  readonly label: string;
  readonly summary: string;
  readonly cards: readonly PathCard[];
  readonly now: number;
}): DecisionPath {
  const breakdown = strengthOf(input.cards, input.now);
  const grade: EvidenceGrade = gradeOf({
    strength: breakdown.strength,
    sampleSize: input.cards.length,
  });

  return {
    pathId: input.pathId,
    label: input.label,
    summary: input.summary,
    cards: input.cards,
    sampleSize: input.cards.length,
    grade,
    evidenceStrength: breakdown.strength,
    costProfile: costProfileOf(input.cards),
  };
}

/**
 * 把一组卡编译成证据网格。
 *
 * 排序刻意用「证据强度降序 → pathId 字典序」，因此**输出与输入顺序无关**：
 * 换一个 query 顺序、换一批结果的排列，网格依然稳定。
 */
export function buildMesh(input: {
  readonly goal: string;
  readonly cards: readonly PathCard[];
  readonly queries: readonly string[];
  readonly provenance: EvidenceMesh['provenance'];
  readonly axes: EvidenceMesh['axes'];
  /** 固定时间戳，用于让网格可复现（测试与挑战链接需要）。 */
  readonly now: number;
  /**
   * 路径集。默认是产品级的七条职业路径。
   *
   * 之所以做成参数：路径**必须属于当前问题**。用七条职业路径去回答
   * 「大二要不要参加比赛」，会给出「在职转型 / 平级跳板」这类
   * 与问题无关的标签（实测踩到过）。黄金案例改用**问题专属路径集**
   * 之后，标签才对得上问题。
   */
  readonly archetypes?: readonly PathArchetype[];
}): EvidenceMesh {
  const archetypes = input.archetypes ?? PATH_ARCHETYPES;
  const byPath = new Map<string, PathCard[]>();

  for (const card of input.cards) {
    /**
     * 归档优先级（这是让真实样本不变成孤儿卡的关键）：
     * 1. `pathHint`：人工确认过的锚点路线（落盘快照的 `anchorPaths`）；
     * 2. 关键词匹配：覆盖未声明路线的锚点（如运行时实时检索的结果）。
     *
     * 只取一条：保证「互斥路线」这个前提成立，代价是一条卡只被算一次样本。
     */
    const target = card.pathHint ?? matchArchetypes(card, archetypes)[0];
    if (!target || !archetypes.some((archetype) => archetype.pathId === target)) {
      continue;
    }
    const bucket = byPath.get(target) ?? [];
    bucket.push(card);
    byPath.set(target, bucket);
  }

  const paths = archetypes.map((archetype) =>
    buildPath({
      pathId: archetype.pathId,
      label: archetype.label,
      summary: archetype.summary,
      cards: byPath.get(archetype.pathId) ?? [],
      now: input.now,
    }),
  )
    .sort((left, right) => {
      if (right.evidenceStrength !== left.evidenceStrength) {
        return right.evidenceStrength - left.evidenceStrength;
      }
      if (right.sampleSize !== left.sampleSize) {
        return right.sampleSize - left.sampleSize;
      }
      return left.pathId < right.pathId ? -1 : left.pathId > right.pathId ? 1 : 0;
    });

  const meshHash = stableHash(
    JSON.stringify({
      goal: input.goal,
      provenance: input.provenance,
      paths: paths.map((path) => ({ pathId: path.pathId, sampleSize: path.sampleSize })),
    }),
  );

  return {
    meshId: `mesh-${meshHash.slice(0, 12)}`,
    goal: input.goal,
    queries: input.queries,
    paths,
    axes: input.axes,
    meshHash,
    generatedAt: new Date(input.now).toISOString(),
    provenance: input.provenance,
  };
}

/** 有样本的路线（界面只渲染这些；`thin` 的会被单独提示，而不是丢掉）。 */
export function evidencedPaths(mesh: EvidenceMesh): readonly DecisionPath[] {
  return mesh.paths.filter((path) => path.sampleSize > 0);
}

/** 没有任何一条路线有样本 —— 界面必须走「证据不足」而不是编内容。 */
export function isEmptyMesh(mesh: EvidenceMesh): boolean {
  return mesh.paths.every((path) => path.sampleSize === 0);
}
