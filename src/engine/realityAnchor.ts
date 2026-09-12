import { stableHash } from '@/core/run/deterministic';

/**
 * 现实锚点（v2 §3.2.3 / 重构计划 §6.2）。
 *
 * 规范定义：
 * - 每个周目有一个现实锚点值（0–100%）
 * - 玩家行为越「偏离现实」，锚点下降
 * - 锚点 < 30% → 世界开始出现异常信号（驱动 HiddenSignalStrip）
 * - 锚点 = 0% → 触发结局事件（平行宇宙坍缩）
 * - **Boss 评估结果影响锚点变化**
 *
 * 这补上了规范里点名的缺口：**Boss 评价过去只给分、没有游戏性后果**。
 * 现在判卷结果会真的改变世界的稳定性，锚点归零则直接收束这一局。
 */

/** 锚点用 0..1 存（重构计划的口径），对外展示时换算成百分比。 */
export interface RealityAnchor {
  readonly value: number;
  /** 已触发的异常信号（确定性生成，不含随机）。 */
  readonly anomalies: readonly string[];
}

export const ANCHOR_WARNING = 0.3;

export type AnchorEventKind =
  | 'grounded-action' // 脚踏实地的一步
  | 'risky-gamble' // 豪赌
  | 'dark-choice' // 走了暗路
  | 'ally-support' // 有人托住
  | 'boss-success' // 终局判卷通过
  | 'boss-failure' // 终局判卷未通过
  | 'breakdown'; // 精神崩溃

const ANCHOR_DELTA: Record<AnchorEventKind, number> = {
  'grounded-action': 0.06,
  'ally-support': 0.08,
  'risky-gamble': -0.1,
  'dark-choice': -0.14,
  'boss-success': 0.12,
  'boss-failure': -0.18,
  breakdown: -0.2,
};

const ANOMALY_POOL: readonly string[] = [
  '时间偶尔会跳针',
  '镜子里的人比你慢半拍',
  '有人在叫一个不属于你的名字',
  '手机相册多出没拍过的照片',
  '走廊尽头的那扇门重复出现',
];

export function createAnchor(seed: string): RealityAnchor {
  const hash = stableHash(`anchor:${seed}`);
  // 开局不是满值：留出可见的波动空间
  const value = 0.78 + (parseInt(hash.slice(0, 2), 16) % 12) / 100; // 0.78..0.89
  return { value: Math.min(0.95, value), anomalies: [] };
}

/** 应用一次锚点事件：数值钳制、异常信号按阈值确定性添加。 */
export function applyAnchorEvent(anchor: RealityAnchor, kind: AnchorEventKind, act: number): RealityAnchor {
  const value = Math.max(0, Math.min(1, anchor.value + ANCHOR_DELTA[kind]));
  return syncAnomalies({ ...anchor, value }, act);
}

/**
 * 按当前锚点补齐异常信号。
 *
 * 确定性：同一锚点值 + 同一幕次 → 同一批异常（不用随机数），
 * 所以"锚点低会看到怪事"这件事在复现时完全一致。
 */
export function syncAnomalies(anchor: RealityAnchor, act: number): RealityAnchor {
  if (anchor.value >= ANCHOR_WARNING) {
    return { ...anchor, anomalies: [] };
  }

  // 越低越多：每 0.1 一条，最多 3 条
  const count = Math.min(3, Math.max(1, Math.ceil((ANCHOR_WARNING - anchor.value) * 10) + 1));
  const anomalies: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const hash = stableHash(`anomaly:${act}:${index}:${Math.round(anchor.value * 100)}`);
    anomalies.push(ANOMALY_POOL[parseInt(hash.slice(0, 2), 16) % ANOMALY_POOL.length]);
  }
  return { ...anchor, anomalies };
}

/** 世界是否已经开始异常（UI 用它决定是否点亮异常信号条）。 */
export function isAnomalous(anchor: RealityAnchor): boolean {
  return anchor.value < ANCHOR_WARNING;
}

/** 是否坍缩（终局收束条件）。 */
export function isCollapsed(anchor: RealityAnchor): boolean {
  return anchor.value <= 0;
}

/** 展示用百分比（四舍五入到整数，但 UI 应优先用定性文案）。 */
export function anchorPercent(anchor: RealityAnchor): number {
  return Math.round(anchor.value * 100);
}

/** 定性描述：给玩家看的是说法，不是百分数。 */
export function anchorSignals(anchor: RealityAnchor): readonly string[] {
  const signals: string[] = [];
  if (isCollapsed(anchor)) {
    signals.push('这个宇宙已经撑不住了');
    return signals;
  }
  if (anchor.value < 0.15) {
    signals.push('世界开始碎边');
  } else if (anchor.value < ANCHOR_WARNING) {
    signals.push('现实感在变薄');
  } else if (anchor.value < 0.55) {
    signals.push('有点飘');
  } else {
    signals.push('脚踏实地');
  }
  return [...signals, ...anchor.anomalies];
}

/** 由选项语义与结果推导锚点事件（引擎侧规则，AI 不参与）。 */
export function anchorEventFor(input: {
  readonly risky?: boolean;
  readonly dark?: boolean;
  readonly allied?: boolean;
  readonly outcome: 'success' | 'failure' | 'none';
  readonly breakdown?: boolean;
}): AnchorEventKind {
  if (input.breakdown) {
    return 'breakdown';
  }
  if (input.dark) {
    return 'dark-choice';
  }
  if (input.risky) {
    return 'risky-gamble';
  }
  if (input.allied || input.outcome === 'success') {
    return input.allied ? 'ally-support' : 'grounded-action';
  }
  return 'grounded-action';
}
