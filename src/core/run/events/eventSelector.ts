import { EVENT_POOL } from '@/core/run/events/eventPool';
import { rngFor } from '@/core/run/deterministic';

import type {
  AxisDelta,
  DrawnEvent,
  EventCondition,
  FateEvent,
} from '@/core/run/events/eventTypes';
import type { AxisId, ConstraintProfile } from '@/types/evidence';

/**
 * 事件抽取（v3 §6 / §23 P0-2）。
 *
 * ## 三条不变量（由 `tests/eventDeterminism.test.ts` 锁定）
 *
 * 1. **纯函数**：同 `(seed, act, 状态)` 必得同一事件 —— 不用 `Math.random`，
 *    随机因子全部来自 `rngFor`（复用 `core/run/deterministic`，与骰面同一套 PRNG）。
 * 2. **条件不外溢**：不满足 `conditions` 的事件**永不出现**，
 *    包括「无 ally 时不该遇到需要同伴的机会」这类语义。
 * 3. **只改轴**：`applied` 只含四轴字段，不含任何能影响 `verdictFor` 的输入。
 *    —— 这条是 v3 §2.2 原则 D 在代码里的落点。
 */

/** 稀有度权重：越稀有越少见（但不会绝迹）。 */
const RARITY_WEIGHT: Readonly<Record<FateEvent['rarity'], number>> = {
  common: 10,
  rare: 4,
  critical: 1,
};

/** 条件判定所需的当前状态（刻意做窄，避免事件系统知道太多）。 */
export interface EventContext {
  readonly constraints: ConstraintProfile;
  /** 已获得的 flag（与 `WorldState.flags` 同一套）。 */
  readonly flags?: readonly string[];
  /** 本局想要聚焦的领域（来自 Query Planner 的 domainConfidence）。 */
  readonly domain?: string | null;
}

/** 单条件判定。缺字段一律视为不满足（宁可漏事件，不可越界）。 */
export function meetsCondition(condition: EventCondition, context: EventContext): boolean {
  const flags = context.flags ?? [];

  switch (condition.kind) {
    case 'hasFlag':
      return condition.flag !== undefined && flags.includes(condition.flag);
    case 'lacksFlag':
      return condition.flag !== undefined && !flags.includes(condition.flag);
    case 'axisAtLeast': {
      if (!condition.axis || condition.value === undefined) {
        return false;
      }
      return axisValue(context, condition.axis) >= condition.value;
    }
    case 'axisAtMost': {
      if (!condition.axis || condition.value === undefined) {
        return false;
      }
      return axisValue(context, condition.axis) <= condition.value;
    }
  }
}

function axisValue(context: EventContext, axis: AxisId): number {
  const { constraints } = context;
  switch (axis) {
    case 'runway':
      return constraints.runwayMonths;
    case 'drawdown':
      return constraints.drawdown;
    case 'reversibility':
      // 与 axis.ts 的 axisValuesFor 同口径：处境派生的退路余量
      return Math.round(constraints.drawdown * 0.8);
    case 'ally':
      return constraints.ally;
  }
}

/** 事件是否可参与本次抽取。 */
export function isEligible(event: FateEvent, context: EventContext): boolean {
  if (event.conditions && !event.conditions.every((condition) => meetsCondition(condition, context))) {
    return false;
  }
  return true;
}

/**
 * 领域加权：与玩家处境同领域的事件权重更高。
 *
 * 这是「遭遇与你的处境相关」的唯一实现点 ——
 * 它只影响**抽取概率**，不影响任何判定。
 */
function domainWeight(event: FateEvent, domain: string | null | undefined): number {
  if (!domain) {
    return 1;
  }
  return event.domains.includes(domain as FateEvent['domains'][number]) ? 3 : 1;
}

/**
 * 抽取本幕的命运事件。
 *
 * @param seed 局种子（与骰面、事件计划同一颗）
 * @param actIndex 第几幕（让同一局的不同幕抽到不同事件）
 * @param context 当前状态（用于条件过滤与领域加权）
 * @param excludeIds 已出现过的事件（避免同一局重复同一个遭遇）
 * @returns 抽中的事件，或 null（无合法候选时——调用方应照常推进，不能卡住）
 */
export function selectEvent(input: {
  readonly seed: string;
  readonly actIndex: number;
  readonly context: EventContext;
  readonly excludeIds?: readonly string[];
}): FateEvent | null {
  const excluded = new Set(input.excludeIds ?? []);
  const candidates = EVENT_POOL.filter(
    (event) => !excluded.has(event.id) && isEligible(event, input.context),
  );

  if (candidates.length === 0) {
    return null;
  }

  const weights = candidates.map(
    (event) => RARITY_WEIGHT[event.rarity] * domainWeight(event, input.context.domain),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // 随机因子：seed + 幕次（不含时间、不含 Math.random）
  const rng = rngFor(input.seed, 'event-deck', input.actIndex);
  let point = rng() * total;

  for (let index = 0; index < candidates.length; index += 1) {
    point -= weights[index];
    if (point <= 0) {
      return candidates[index];
    }
  }

  // 浮点误差兜底
  return candidates[candidates.length - 1];
}

/**
 * 把命运掷骰的品质应用到事件效果上（v3 §5.2：骰子决定遭遇品质）。
 *
 * 品质**只缩放事件影响**，不改变裁决：
 * - `mishap`：负向影响放大 1.5 倍，正向影响减半
 * - `ordinary`：原样
 * - `fortunate`：正向放大 1.3 倍
 * - `breakthrough`：正向放大 1.6 倍，负向影响完全抵消
 *
 * 注意：这里改的是**四轴数值**，而四轴是 `verdictFor` 的**输入之一**。
 * 这不是「骰子决定真相」—— 它决定的是「你遇到什么，因此你的条件被改变了多少」，
 * 而条件改变后**是否可行仍然由纯函数判定**。这条区分是本项目的核心。
 */
export function applyFateTone(
  effects: AxisDelta,
  tone: DrawnEvent['tone'],
): AxisDelta {
  const scale = (value: number, positiveFactor: number, negativeFactor: number): number => {
    const factor = value >= 0 ? positiveFactor : negativeFactor;
    return Math.round(value * factor);
  };

  const out: Record<string, number> = {};
  for (const [axis, value] of Object.entries(effects)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    switch (tone) {
      case 'mishap':
        out[axis] = scale(value, 0.5, 1.5);
        break;
      case 'fortunate':
        out[axis] = scale(value, 1.3, 1);
        break;
      case 'breakthrough':
        // 突破性遭遇：负向完全抵消，正向强化
        out[axis] = value < 0 ? 0 : scale(value, 1.6, 1);
        break;
      default:
        out[axis] = value;
    }
  }

  return out as AxisDelta;
}

/** 抽取 + 应用品质，得到本幕真正生效的遭遇。 */
export function drawEvent(input: {
  readonly seed: string;
  readonly actIndex: number;
  readonly context: EventContext;
  readonly tone: DrawnEvent['tone'];
  readonly excludeIds?: readonly string[];
}): DrawnEvent | null {
  const event = selectEvent(input);
  if (!event) {
    return null;
  }
  return {
    event,
    applied: applyFateTone(event.effects, input.tone),
    tone: input.tone,
  };
}

/**
 * 把事件效果落到约束画像上（**这是事件改变世界的唯一出口**）。
 *
 * 与 `constraintHintFrom`（认知账本建议）不同：那是「建议玩家调整」，
 * 这是「遭遇已经发生，条件被真实改变」。
 *
 * 钳制复用各轴区间，因此事件不会造出越界状态。
 */
export function applyEventToConstraints(
  constraints: ConstraintProfile,
  applied: AxisDelta,
): ConstraintProfile {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.round(value)));

  return {
    runwayMonths: clamp(constraints.runwayMonths + (applied.runway ?? 0), 0, 24),
    drawdown: clamp(constraints.drawdown + (applied.drawdown ?? 0), 0, 100),
    ally: clamp(constraints.ally + (applied.ally ?? 0), 0, 100),
  };
}
