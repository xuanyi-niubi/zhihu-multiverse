import { verdictForCaps } from '@/core/decision/verdict';

import type { AxisCap } from '@/core/decision/axis';
import type { ConstraintProfile } from '@/types/evidence';
import type { ChoiceResolution, FateRoll, PathCost, Verdict } from '@/types/evidence';
import type { TargetStat } from '@/types/game';

/**
 * 选择裁决桥接层（v3 §5.1「删除随机决定真相」）。
 *
 * ## 为什么要这一层
 *
 * 旧实现：选项带 `check` → 掷 D20 → `outcome` 决定 `isSuccess` → 套 `onSuccess/onFail`。
 * 于是**骰子决定了「你这条人生路能不能成功」** —— 与 v3 §5.1 直接冲突。
 *
 * 新实现：选项表达**需求**（它要求你具备什么），`verdictFor` 用玩家条件判它是否成立。
 * 骰子留下来做 Fate Roll，只决定遭遇品质（是否遇贵人、事件稀有度），**不碰成败**。
 *
 * ## 需求从哪里来
 *
 * 不新增剧本字段，而是从既有语义**确定性换算**（旧数据零改动即可迁移）：
 *
 * | 既有字段 | 含义 | 换算为轴需求 |
 * |---|---|---|
 * | `check.difficulty`（1..30） | 这条路的现实门槛 | `drawdown`（承压需求）：DC 越高越需要扛得住 |
 * | `tags.efficiency: 'risky'` | 高风险投入 | `drawdown` 追加 + `runway` 需求 |
 * | `tags.social: 'antagonize'` | 与人交恶 | `requiresAlly: false`（不依赖同伴） |
 * | `tags.social: 'ally'` | 依赖同伴 | `requiresAlly: true` |
 * | 无 `check` | 稳妥选项 | **不产生任何硬需求** → 必然可行 |
 *
 * 这张表是刻意的：**它不发明新数值，只把剧本里已经写好的语义翻译成轴需求**，
 * 因此 12 个场景骨架与所有 AI 生成的关卡都能直接迁移，不需要重写内容。
 *
 * ## 刻意的设计取舍
 *
 * `difficulty` 主要映射到 `drawdown`（承压能力）而不是 `runway`（时间余量）：
 * **时间余量的需求应当来自知乎证据**（「前人在这条路上花了 9–12 个月」），
 * 而不是来自剧本作者拍的 DC。如果让 DC 决定时间需求，
 * 就把「真实数据驱动」悄悄换回了「作者手写」。
 */

/** DC → 承压需求（`drawdown` 0..100）的映射。 */
const DC_MIN = 8;
const DC_MAX = 30;
const DRAWDOWN_AT_DC_MIN = 10;
const DRAWDOWN_AT_DC_MAX = 80;

/**
 * DC → 承压需求。
 *
 * 线性且单调：**越难的选项越要求你能扛**。
 * DC ≤ 8 时给最低需求（10），DC ≥ 30 时给最高（80），中间线性插值。
 */
export function drawdownDemandFor(difficulty: number): number {
  const dc = Number.isFinite(difficulty) ? difficulty : DC_MIN;
  if (dc <= DC_MIN) {
    return DRAWDOWN_AT_DC_MIN;
  }
  if (dc >= DC_MAX) {
    return DRAWDOWN_AT_DC_MAX;
  }
  const ratio = (dc - DC_MIN) / (DC_MAX - DC_MIN);
  return Math.round(DRAWDOWN_AT_DC_MIN + ratio * (DRAWDOWN_AT_DC_MAX - DRAWDOWN_AT_DC_MIN));
}

/** 高风险选项额外要求的时间余量（月）。 */
const RISKY_RUNWAY_DEMAND = 6;

export interface ChoiceLike {
  readonly id: string;
  readonly text: string;
  readonly check?: { readonly targetStat: TargetStat; readonly difficulty: number } | undefined;
  readonly tags?: {
    readonly moral?: 'good' | 'neutral' | 'dark';
    readonly efficiency?: 'direct' | 'indirect' | 'risky';
    readonly social?: 'ally' | 'neutral' | 'antagonize';
  } | undefined;
}

/**
 * 由选项推导路径需求。
 *
 * 稳妥选项（无 `check`）**不产生任何硬需求** —— 它必然可行。
 * 这是有意的：稳妥选项的价值不在于「能过检定」，而在于它不消耗你的余地。
 */
export function costForChoice(choice: ChoiceLike): PathCost {
  const risky = choice.tags?.efficiency === 'risky';
  const social = choice.tags?.social;

  /**
   * `social` 语义与 `check` 无关，因此**必须在提前返回之前算好**。
   *
   * 曾经的写法是「无 check 就立刻返回一个全 null 的代价」，
   * 结果把「这一步需要同伴」（social: ally）这条信息丢掉了 ——
   * 于是无检定的选项永远不会要求 ally，需求推导静默失真。
   * 由 `tests/verdictIsolation.test.ts` 的 social 用例钉住。
   */
  const requiresAlly: boolean | null =
    social === 'ally' ? true : social === 'antagonize' ? false : null;

  if (!choice.check) {
    return {
      id: choice.id,
      label: choice.text,
      timeCostMonths: null,
      moneyCost: 'unknown',
      irreversible: null,
      requiresAlly,
    };
  }

  // 高风险选项额外吃时间余量：它把「时间不够」变成真问题
  const riskyRunway: { readonly min: number; readonly max: number } | null = risky
    ? { min: RISKY_RUNWAY_DEMAND - 2, max: RISKY_RUNWAY_DEMAND + 2 }
    : null;

  return {
    id: choice.id,
    label: choice.text,
    timeCostMonths: riskyRunway,
    // 高风险 = 更可能烧钱；其余按未知处理（不猜）
    moneyCost: risky ? 'high' : 'unknown',
    irreversible: risky ? true : null,
    requiresAlly,
  };
}

/** 路径需求 → 轴需求列表。与 `axisCapsFor(path)` 同构，因此共用判定核心。 */
export function capsForCost(cost: PathCost): readonly AxisCap[] {
  const caps: AxisCap[] = [];

  if (cost.timeCostMonths) {
    caps.push({
      axis: 'runway',
      requirement: cost.timeCostMonths.max,
      reason: `这条路至少要求你能撑 ${cost.timeCostMonths.max} 个月`,
    });
  }

  if (cost.moneyCost === 'high') {
    // 高风险路线要求承受力；给一个与 DC 无关的下限，DC 的部分由下面补
    caps.push({ axis: 'drawdown', requirement: 55, reason: '高风险路线需要扛得住亏损' });
  }

  if (cost.irreversible === true) {
    caps.push({ axis: 'reversibility', requirement: 70, reason: '这一步不可逆' });
  }

  if (cost.requiresAlly === true) {
    caps.push({ axis: 'ally', requirement: 60, reason: '这条路需要有人并肩' });
  }

  return caps;
}

/**
 * 由选项推导轴需求（**含 DC → drawdown 的映射**，这是 `capsForCost` 之外的部分）。
 *
 * 之所以拆成两个函数：`capsForCost` 与证据网格路线保持同构，
 * 而 DC 映射是「选项特有」的语义，不该混进通用的代价推导里。
 */
export function demandCapsForChoice(choice: ChoiceLike): readonly AxisCap[] {
  const caps = [...capsForCost(costForChoice(choice))];

  if (choice.check) {
    const requirement = drawdownDemandFor(choice.check.difficulty);
    const existing = caps.findIndex((cap) => cap.axis === 'drawdown');
    const cap: AxisCap = {
      axis: 'drawdown',
      requirement,
      reason: `这一步要求承压能力 ≥ ${requirement}`,
    };
    if (existing >= 0) {
      // 取更高的那条：DC 需求与「高风险」需求叠加时不能互相抵消
      caps[existing] = caps[existing].requirement >= requirement ? caps[existing] : cap;
    } else {
      caps.push(cap);
    }
  }

  return caps;
}

/** 命运掷骰的品质分档（v3 §5.2）。 */
export function fateQualityOf(face: number): FateRoll['quality'] {
  if (face <= 3) return 'mishap';
  if (face <= 14) return 'ordinary';
  if (face <= 19) return 'fortunate';
  return 'breakthrough';
}

const FATE_LABEL: Readonly<Record<FateRoll['quality'], string>> = {
  mishap: '遭遇不顺：事情比预想的更麻烦',
  ordinary: '遭遇平常：按部就班',
  fortunate: '遇到助力：有人愿意搭把手',
  breakthrough: '意外机会：一个不常出现的机会出现了',
};

export function makeFateRoll(face: number): FateRoll {
  const quality = fateQualityOf(face);
  return { face, quality, label: FATE_LABEL[quality] };
}

/**
 * 裁决一幕里的选择。**纯函数，无 I/O、无随机源注入。**
 *
 * @param fateFace 由**调用方**用确定性 PRNG 生成（`createCheckRng`），
 *                 本函数自身不含随机 —— 因此同一局重放必然同结果。
 *
 * 判定顺序（与证据网格路径一致）：先算需求 → 再看硬轴是否越线。
 * `fate` 只用于叙事与遭遇，**不参与 `isSuccess` 的计算**。
 */
export function resolveChoice(input: {
  readonly choice: ChoiceLike;
  readonly constraints: ConstraintProfile;
  /** 命运掷骰面（1..20）；省略则不产生 Fate Roll。 */
  readonly fateFace?: number | null;
}): ChoiceResolution {
  const { choice, constraints } = input;
  const demand = costForChoice(choice);
  const caps = demandCapsForChoice(choice);

  // grade 传 null：选项没有「站内样本数」这回事，不该因证据不足而拒判
  const verdict: Verdict = verdictForCaps({ caps, constraints, grade: null });

  return {
    verdict,
    fate: typeof input.fateFace === 'number' ? makeFateRoll(input.fateFace) : null,
    // breached → 这条走不通；viable / unknown → 走得动
    // （unknown 视为可行：不知道门槛不等于有门槛，见 DESIGN.md「缺项不产生需求」）
    isSuccess: verdict.kind !== 'breached',
    demand,
  };
}

/**
 * 给界面用的一句话需求说明（「你 6 / 需求 9」）。
 *
 * 不含恐吓，只陈述对照关系 —— 这是 §13 要求的「需求 vs 当前值」。
 */
export function demandLine(
  demand: PathCost,
  constraints: ConstraintProfile,
): { readonly label: string; readonly current: number; readonly required: number; readonly gap: number } | null {
  const runway = demand.timeCostMonths;
  if (runway && runway.max > 0) {
    const gap = runway.max - constraints.runwayMonths;
    return {
      label: '时间余量',
      current: constraints.runwayMonths,
      required: runway.max,
      gap: Math.max(0, gap),
    };
  }
  return null;
}
