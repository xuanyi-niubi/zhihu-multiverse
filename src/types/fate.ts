import type { TargetStat } from '@/types/game';

/**
 * 命运树（DAG）的展示层类型。
 *
 * 与 `types/game.ts` 的职责边界：
 * - `game.ts` 描述可持久化的玩法契约（属性、遗物、D20 检定）。
 * - 本文件只描述「如何把一局推演画成一张图」，不参与任何数值计算，
 *   也不应被写入存档。
 */

/** 节点语义：稳妥选项 / 高风险检定选项 / 终局成败。 */
export type FateNodeKind = 'root' | 'safe' | 'risk' | 'success' | 'fail';

/**
 * 节点状态：
 * - locked：本回合未选择的兄弟节点，永久灰化；
 * - available：当前回合可点选；
 * - current：正在被选中的节点（模态框期间）；
 * - visited：无检定的普通经过；
 * - succeeded / failed：经过检定后的结果态。
 */
export type FateNodeStatus =
  | 'locked'
  | 'available'
  | 'current'
  | 'visited'
  | 'succeeded'
  | 'failed';

/** 连线状态：available 虚线、taken 流动实线、failed 红色、locked 灰化。 */
export type FateEdgeStatus = 'locked' | 'available' | 'taken' | 'failed';

export interface FateNode {
  /** 图内唯一 id，建议 `n{turn}-{choiceId}`。 */
  readonly id: string;

  /** 节点主文案，建议 4–10 个汉字，过长会被截断。 */
  readonly label: string;

  /** 可选副文案，例如结局摘要。 */
  readonly sublabel?: string;

  /** 所属回合，决定列位置。根节点为 0。 */
  readonly turnIndex: number;

  readonly kind: FateNodeKind;

  readonly status: FateNodeStatus;

  /** 右上角徽标，例如 `D20 DC 16` 或 `遗物 +1`。 */
  readonly badge?: string;

  /** 该节点掉落/继承的遗物 id，用于渲染金色标记。 */
  readonly relicId?: string;

  /** 该节点造成的属性变化，用于节点内的小箭头提示。 */
  readonly statDelta?: Partial<Record<TargetStat, number>>;
}

export interface FateEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly status: FateEdgeStatus;
  /** 可选连线文案，例如 `检定通过`。 */
  readonly label?: string;
}

export interface FateTreeGraph {
  readonly nodes: readonly FateNode[];
  readonly edges: readonly FateEdge[];
}

/** 布局后的节点：x/y 为 0..100 的百分比坐标，直接用于绝对定位。 */
export interface PositionedFateNode extends FateNode {
  readonly xPercent: number;
  readonly yPercent: number;
}
