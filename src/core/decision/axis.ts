import { clampUnit } from '@/core/run/worldState';

import type {
  AxisId,
  ConstraintProfile,
  CostProfile,
  DecisionPath,
  MechanicalAxis,
} from '@/types/evidence';

/**
 * 四条刚性轴（方案 §6.1）。
 *
 * 设计要点：**轴不是随便定的四个数字**，它们一一对应四类真实约束，
 * 且每条路线的「承受上限」都从该路线的证据聚合（`CostProfile`）里推出来 ——
 * 玩家拨动的是自己的条件，不是难度旋钮。
 *
 * 两条纪律：
 * - **有界**：所有取值都钳在轴区间内，NaN 一律退回下限，不污染裁决。
 * - **可解释**：每个轴都带 `hint`，玩家必须能看懂自己在拨什么。
 */

export const AXES: readonly MechanicalAxis[] = [
  {
    id: 'runway',
    label: '可投入月数',
    min: 0,
    max: 24,
    unit: '个月',
    hard: true,
    hint: '还能不赚钱地撑几个月。这是纯消耗量，不因为努力而变多。',
  },
  {
    id: 'drawdown',
    label: '可承受亏损',
    min: 0,
    max: 100,
    unit: '',
    hard: true,
    hint: '能承受的最大损失幅度（钱、心智、关系的综合承受力）。',
  },
  {
    id: 'reversibility',
    label: '退路余量',
    min: 0,
    max: 100,
    unit: '',
    hard: false,
    hint: '这条路走错之后能不能回头。由前人的经历决定，不由你自陈。',
  },
  {
    id: 'ally',
    label: '并肩程度',
    min: 0,
    max: 100,
    unit: '',
    hard: false,
    hint: '有没有人并肩：家人支持、同行的伙伴、愿意听你说的人。',
  },
];

const AXIS_BY_ID: Readonly<Record<AxisId, MechanicalAxis>> = AXES.reduce(
  (acc, axis) => ({ ...acc, [axis.id]: axis }),
  {} as Record<AxisId, MechanicalAxis>,
);

export function getAxis(id: AxisId): MechanicalAxis {
  return AXIS_BY_ID[id];
}

/** 把任意数值钳进某条轴的区间；非有限数退回下限。 */
export function clampAxis(id: AxisId, value: unknown): number {
  const axis = AXIS_BY_ID[id];
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : axis.min;
  return Math.min(Math.max(parsed, axis.min), axis.max);
}

/** 约束画像的默认值：一个「普通毕业生」的处境，用于无输入时的兜底。 */
export const DEFAULT_CONSTRAINTS: ConstraintProfile = {
  runwayMonths: 6,
  drawdown: 50,
  ally: 40,
};

/**
 * 规范化玩家约束画像。
 *
 * 越界钳制、缺字段补默认 —— 与 `/api/dm` 的容错口径一致：
 * 宁可给一份可用的约束，也不要因为一个字段缺失让整局打不开。
 */
export function normalizeConstraints(raw: unknown): ConstraintProfile {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    runwayMonths: clampAxis('runway', record.runwayMonths ?? DEFAULT_CONSTRAINTS.runwayMonths),
    drawdown: clampAxis('drawdown', record.drawdown ?? DEFAULT_CONSTRAINTS.drawdown),
    ally: clampAxis('ally', record.ally ?? DEFAULT_CONSTRAINTS.ally),
  };
}

/* -------------------------------------------------------------------------- */
/* 路线的轴上界：从代价画像推出「这条路要求你具备什么」                          */
/* -------------------------------------------------------------------------- */

export interface AxisCap {
  readonly axis: AxisId;
  /** 该路线要求玩家至少具备的条件（越高越难达成）。 */
  readonly requirement: number;
  /** 需求是从哪来的（可解释性，答评委用）。 */
  readonly reason: string;
}

/**
 * 由一条路线的代价画像推导出它压在你身上的四条轴上界。
 *
 * **这是「机制裁决」的输入侧**：路线的要求来自前人真实付过的代价，
 * 而不是设计者拍的一个 DC 数字。
 *
 * 缺项（`null` / `unknown`）一律**不产生需求**，而不是当成 0 ——
 * 把「不知道」当成「不需要」会系统性低估风险，这是证据产品最容易犯的错。
 */
export function axisCapsFor(path: DecisionPath): readonly AxisCap[] {
  const cost: CostProfile = path.costProfile;
  const caps: AxisCap[] = [];

  if (cost.timeCostMonths) {
    /*
      时间轴的门槛取自样本，但**措辞必须是「样本里是这样」而不是「你需要这样」**。
      
      旧文案写「前人在这条路上花了 X–Y 个月」，读起来像是对玩家的预测；
      界面再把上沿变成「还差 7 个月」，就把一个有限轶事包装成了个人门槛。
      改成「样本里明确提到的投入是 X–Y 个月」之后，它陈述的是样本事实，
      玩家与它的差距是**对比**，不是裁决。
    */
    caps.push({
      axis: 'runway',
      requirement: clampAxis('runway', cost.timeCostMonths.max),
      reason: `样本里明确提到的投入是 ${cost.timeCostMonths.min}–${cost.timeCostMonths.max} 个月`,
    });
  }

  const moneyRequirement: Record<CostProfile['moneyCost'], number | null> = {
    low: 20,
    medium: 55,
    high: 85,
    unknown: null,
  };
  const money = moneyRequirement[cost.moneyCost];
  if (money !== null) {
    caps.push({
      axis: 'drawdown',
      requirement: clampAxis('drawdown', money),
      reason: `样本里这条路的资金代价${cost.moneyCost === 'high' ? '很高' : cost.moneyCost === 'medium' ? '中等' : '较低'}`,
    });
  }

  if (cost.irreversible === true) {
    // 不可逆 = 要求玩家有厚退路余量（软轴：越线不判死，但会显著降低余量）
    caps.push({
      axis: 'reversibility',
      requirement: clampAxis('reversibility', 70),
      reason: '样本里有人明确提到这条路退不回来',
    });
  }

  if (cost.requiresAlly === true) {
    caps.push({
      axis: 'ally',
      requirement: clampAxis('ally', 60),
      reason: '样本里有人是靠着同伴才走通的',
    });
  }

  return caps;
}

/** 玩家在四条轴上的实际值。`reversibility` 取玩家约束之外的默认值（见下）。 */
export interface AxisValues {
  readonly runway: number;
  readonly drawdown: number;
  readonly reversibility: number;
  readonly ally: number;
}

/**
 * 把约束画像展开成四条轴的当前值。
 *
 * `reversibility`（退路余量）不由玩家自陈 —— 它是**处境**的属性：
 * 保守起见取「你有多少可回头的空间」，默认与 drawdown 同源但不恒等，
 * 避免同一个数字被用两次而虚增余量。
 */
export function axisValuesFor(constraints: ConstraintProfile): AxisValues {
  return {
    runway: clampAxis('runway', constraints.runwayMonths),
    drawdown: clampAxis('drawdown', constraints.drawdown),
    reversibility: clampAxis('reversibility', Math.round(constraints.drawdown * 0.8)),
    ally: clampAxis('ally', constraints.ally),
  };
}

/** 四维终局结算用：把 0..100 收敛成合法刻度（复用 worldState 的钳制纪律）。 */
export function clampScore(value: number): number {
  return clampUnit(value);
}
