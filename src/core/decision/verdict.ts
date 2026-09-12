import { axisValuesFor, axisCapsFor, clampAxis, getAxis, type AxisCap, type AxisValues } from '@/core/decision/axis';

import type {
  AxisId,
  ConstraintProfile,
  CriticalPoint,
  DecisionPath,
  MechanicalAxis,
  Verdict,
} from '@/types/evidence';

/**
 * 机制裁决（方案 §6.2）：把「掷骰子判成败」换成「约束是否越线」。
 *
 * 三条不变量（由 `tests/decisionVerdict.test.ts` 锁定）：
 *
 * - **I-A 纯函数**：同输入必同输出，不读时间、不读随机、不读全局状态。
 * - **I-B 失败必须具体**：`breached` 必须给出越线的轴与超出量，
 *   不允许笼统的「这一幕失败了」。
 * - **I-C 无据不裁决**：`thin` 证据路线返回 `unknown`，
 *   不得返回 `viable` 或 `breached` —— 不知道就别装作知道。
 */

/** 证据强度低于这个值就不裁决。 */
export const THIN_EVIDENCE_THRESHOLD = 0.2;

/** 硬轴余量低于其区间的这个比例时，判定为「勉强可行」，值得提醒。 */
const TIGHT_MARGIN_RATIO = 0.15;

function requirementFor(caps: readonly AxisCap[], axis: AxisId): AxisCap | null {
  return caps.find((cap) => cap.axis === axis) ?? null;
}

/**
 * 裁决一条路线。
 *
 * 判定顺序刻意如此：**先看证据够不够，再看硬轴有没有越线**。
 * 反过来会让「证据不足」被一个碰巧通过的数字掩盖过去。
 */
export function verdictFor(input: {
  readonly path: DecisionPath;
  readonly constraints: ConstraintProfile;
  readonly axes?: readonly MechanicalAxis[];
}): Verdict {
  const { path, constraints } = input;

  return verdictForCaps({
    caps: axisCapsFor(path),
    constraints,
    grade: path.grade,
    evidenceStrength: path.evidenceStrength,
    sampleSize: path.sampleSize,
  });
}

/**
 * 裁决一组**已经推导好的**轴需求。**这是唯一的判定核心。**
 *
 * 抽出来是为了让两条路径共用同一套判定，而不是各写一套：
 * - `verdictFor(path)` —— 证据网格里的真实路线（v2 §15）；
 * - `verdictForCaps(cost)` —— 一幕里的具体选项（v3 §5.1「随机不决定真相」）。
 *
 * 为什么必须共用：如果选项与路线各有一套裁决，就会出现
 * 「网格说这条路可行，但选项掷骰子判它失败」的自相矛盾 ——
 * 那正是 v3 要拆掉的东西。
 */
export function verdictForCaps(input: {
  readonly caps: readonly AxisCap[];
  readonly constraints: ConstraintProfile;
  /** 证据档位；选项路径没有网格，传 null 表示不因证据不足而拒判。 */
  readonly grade?: DecisionPath['grade'] | null;
  readonly evidenceStrength?: number | null;
  readonly sampleSize?: number | null;
}): Verdict {
  const { caps, constraints } = input;

  // 证据不足则不裁决（只有证据网格路径会走到这里）
  if (input.grade === 'thin' || (input.evidenceStrength ?? 1) < THIN_EVIDENCE_THRESHOLD) {
    return {
      kind: 'unknown',
      reason: `这条路线只有 ${input.sampleSize ?? 0} 条站内样本，不足以判断你的条件够不够`,
    };
  }

  const values = axisValuesFor(constraints);

  // 1. 硬轴越线 → 确定失败（不是「运气不好」，是条件不够）
  for (const cap of caps) {
    const axis = getAxis(cap.axis);
    if (!axis.hard) {
      continue;
    }
    const current = values[cap.axis];
    if (current < cap.requirement) {
      return {
        kind: 'breached',
        breachedAxis: cap.axis,
        overBy: cap.requirement - current,
        /*
          措辞是**对比**，不是预测。
          
          旧文案「可投入月数还差 7个月」读起来像在宣告「你需要 7 个月」，
          而那个数字其实来自样本的上沿 —— 把有限轶事包装成了个人门槛。
          改成「与样本条件相比」之后，它陈述的是「你和那些人当时差多少」，
          机制完全不变，但主张是诚实的。
        */
        shortfallLabel: `与样本条件相比，${axis.label}差 ${cap.requirement - current}${axis.unit}`,
      };
    }
  }

  // 2. 全部硬轴通过 → 可行，余量取**缺口最小**的那条
  //
  // 刻意用绝对缺口而不是「占区间比例」：12 个月的缺口和 15 点亏损的缺口
  // 必须能直接比较。用比例会让区间大的轴（drawdown 0..100）永远看起来更紧，
  // 从而把真正的瓶颈（往往是 runway）藏起来 —— 这是本模块唯一一处
  // 「看起来更精细但会得出错误结论」的实现，已在测试里锁死不要改回去。
  let bindingAxis: AxisId | null = null;
  let smallestMargin = Number.POSITIVE_INFINITY;
  let margin = 0;

  for (const cap of caps) {
    const axis = getAxis(cap.axis);
    if (!axis.hard) {
      continue;
    }
    const surplus = values[cap.axis] - cap.requirement;
    if (surplus < smallestMargin) {
      smallestMargin = surplus;
      bindingAxis = cap.axis;
      margin = surplus;
    }
  }

  // 没有硬轴需求 = 这条路对你没有任何硬门槛
  if (bindingAxis === null) {
    return { kind: 'viable', margin: 0, bindingAxis: null };
  }

  return { kind: 'viable', margin, bindingAxis };
}

/** 一句话说清这条路现在的状态（界面直接用，不含恐吓）。 */
export function verdictHeadline(verdict: Verdict, pathLabel: string): string {
  switch (verdict.kind) {
    case 'viable':
      if (verdict.bindingAxis === null) {
        return `${pathLabel}：对你没有硬门槛`;
      }
      return verdict.margin <= 2
        ? `${pathLabel}：能走，但卡得很紧`
        : `${pathLabel}：能走，还有余地`;
    case 'breached':
      return `${pathLabel}：${verdict.shortfallLabel}`;
    case 'unknown':
      return `${pathLabel}：${verdict.reason}`;
  }
}

/**
 * 求解临界点（方案 §6.3）：让结论翻转的那**一个**最小改动。
 *
 * 这是整个方案最值钱的一个输出。它把「你失败了」翻译成
 * 「你哪个假设最脆弱、改哪个变量会让结论翻转」。
 *
 * 返回值可能为 null 的三种情况：
 * - 证据不足（`unknown`）→ 没有可干预的对象；
 * - 路线本来就没有硬轴需求 → 没有脆弱的假设；
 * - 路线可行且余量充裕 → 不需要干预。
 */
export function criticalPointFor(input: {
  readonly path: DecisionPath;
  readonly constraints: ConstraintProfile;
}): CriticalPoint | null {
  const { path, constraints } = input;
  const verdict = verdictFor(input);

  if (verdict.kind === 'unknown') {
    return null;
  }

  const values = axisValuesFor(constraints);
  const caps = axisCapsFor(path).filter((cap) => getAxis(cap.axis).hard);

  if (caps.length === 0) {
    return null;
  }

  if (verdict.kind === 'breached') {
    const cap = requirementFor(caps, verdict.breachedAxis);
    if (!cap) {
      return null;
    }
    const axis = getAxis(cap.axis);
    const current = values[cap.axis];
    const required = cap.requirement;
    return {
      pathId: path.pathId,
      verdict,
      axis: cap.axis,
      current,
      required,
      delta: required - current,
      narrative:
        `${path.label}这条路唯一的硬伤是${axis.label}：` +
        /*
          「样本门槛」而不是「它需要」。
          
          旧文案写「它需要 13 个月」——把样本的上沿说成了这条路对玩家的要求；
          而同一段末尾紧接着写「样本里明确提到的投入是 1–13 个月」，
          两句自相矛盾。现在统称为**样本门槛**，并把差距表述为对比。
        */
        `样本里这条路的门槛是 ${required}${axis.unit}，你有 ${current}${axis.unit}，` +
        `差 ${required - current}${axis.unit}。${cap.reason}。`,
    };
  }

  // 可行：只在「卡得很紧」时给临界点，否则不制造焦虑
  const axis = getAxis(verdict.bindingAxis as AxisId);
  const current = values[verdict.bindingAxis as AxisId];
  const required = axis.max;
  const tightThreshold = Math.max(1, Math.round((axis.max - axis.min) * TIGHT_MARGIN_RATIO));

  if (verdict.margin > tightThreshold) {
    return null;
  }

  return {
    pathId: path.pathId,
    verdict,
    axis: verdict.bindingAxis as AxisId,
    current,
    required,
    delta: required - current,
    narrative:
      `${path.label}现在能走，但${axis.label}只剩 ${verdict.margin}${axis.unit}余量 —— ` +
      `任何一次意外都会把这条路推成走不通。先把${axis.label}垫厚，比换路线更划算。`,
  };
}

/**
 * 一次算齐「所有路线的裁决 + 最该干预的那一个点」。
 *
 * 双牌对比与终局结算都走这个入口，避免两处各算一遍产生漂移。
 */
export function judgeMesh(input: {
  readonly paths: readonly DecisionPath[];
  readonly constraints: ConstraintProfile;
}): {
  readonly verdicts: ReadonlyArray<{ readonly pathId: string; readonly verdict: Verdict }>;
  readonly critical: CriticalPoint | null;
} {
  const verdicts = input.paths.map((path) => ({
    pathId: path.pathId,
    verdict: verdictFor({ path, constraints: input.constraints }),
  }));

  // 只取一个临界点：优先「越线的里缺口最小的」，其次「勉强可行的」
  const breached = input.paths
    .map((path) => ({ path, point: criticalPointFor({ path, constraints: input.constraints }) }))
    .filter(
      (item): item is { path: DecisionPath; point: CriticalPoint } =>
        item.point !== null && item.point.verdict.kind === 'breached',
    )
    .sort((left, right) => left.point.delta - right.point.delta);

  if (breached.length > 0) {
    return { verdicts, critical: breached[0].point };
  }

  const tight = input.paths
    .map((path) => criticalPointFor({ path, constraints: input.constraints }))
    .filter((point): point is CriticalPoint => point !== null && point.verdict.kind === 'viable');

  return { verdicts, critical: tight[0] ?? null };
}

/** 约束值是否落在轴区间内（供 UI 校验滑杆输入）。 */
export function constraintInRange(axis: MechanicalAxis, value: number): boolean {
  return clampAxis(axis.id, value) === value;
}

export type { AxisValues };
