import type { AxisId } from '@/types/evidence';

/**
 * 命运事件牌组 · 类型契约（v3 §6）。
 *
 * ## 它在世界观里的位置
 *
 * v3 §2.2 原则 D：**随机决定遭遇，不决定真相。**
 *
 * 在这个项目里，「随机」有两处，职责必须分开：
 *
 * | 随机源 | 决定什么 | 代码 |
 * |---|---|---|
 * | Event Deck（本模块） | **遭遇**：遇到谁、撞上什么、机会还是事故 | `eventSelector.ts` |
 * | Fate Roll（命运掷骰） | 单次遭遇的**品质**：贵人 / 平常 / 灾难 | `decision/choiceResolution.ts` |
 * | ~~D20 检定~~ | ~~这条人生路能不能成~~ ← **v3 已拆除** | 改为 `verdictFor` |
 *
 * 事件**只修改 `WorldState` 与四轴**，永远不参与 `verdictFor` 的输入 ——
 * 这条由 `tests/eventDeterminism.test.ts` 与 `verdictIsolation.test.ts` 双重锁定。
 */

/** 事件稀有度。越是稀有的事件，越少出现，但影响越大。 */
export type EventRarity = 'common' | 'rare' | 'critical';

/**
 * 事件类别（v3 §6.2 的四类）。
 *
 * - `opportunity` 机会事件：学长推荐、导师带项目、实习内推、合作者出现
 * - `pressure` 压力事件：课程集中、比赛撞期、项目延期、队友退出、家庭预期
 * - `reality` 现实事件：预算减少、设备损坏、时间碎片化、考试临近、实习冲突
 * - `rare` 稀有事件：爆款项目、大厂面试、高质量导师、意外失败、关键证据推翻假设
 */
export type EventCategory = 'opportunity' | 'pressure' | 'reality' | 'rare';

/**
 * 领域标签：与 Query Planner 的 `domainConfidence` 共用同一套词表，
 * 因此「事件是否与玩家处境相关」用的是同一把尺子。
 */
export type EventDomain = '学业' | '职业' | '转行' | '城市' | '创业' | '生活';

/** 一次事件对四轴的改动。正数=变好，负数=变差。 */
export interface AxisDelta {
  readonly runway?: number;
  readonly drawdown?: number;
  readonly reversibility?: number;
  readonly ally?: number;
}

/** 事件生效条件。缺项即无条件。 */
export interface EventCondition {
  readonly kind: 'axisAtMost' | 'axisAtLeast' | 'hasFlag' | 'lacksFlag';
  readonly axis?: AxisId;
  readonly value?: number;
  readonly flag?: string;
}

export interface FateEvent {
  readonly id: string;
  readonly title: string;
  readonly rarity: EventRarity;
  readonly category: EventCategory;
  readonly domains: readonly EventDomain[];
  readonly conditions?: readonly EventCondition[];
  /** 对四轴的影响。**只改轴，不改裁决。** */
  readonly effects: AxisDelta;
  /** 写进叙事的钩子（引用具体处境，而不是泛泛而谈）。 */
  readonly narrativeHook: string;
  /**
   * 事件来源。
   *
   * - `system`：规则写死的通用遭遇；
   * - `evidence-inspired`：由知乎证据里归纳出的遭遇（例如「前人有 4 条样本提到队友退出」）。
   *
   * 后者永远**不改变证据强度或裁决**，只是让遭遇更贴近这一局的真实处境。
   */
  readonly sourceType: 'system' | 'evidence-inspired';
}

/** 抽中的事件 + 本次的轴改动（可能被命运掷骰放大或削弱）。 */
export interface DrawnEvent {
  readonly event: FateEvent;
  /** 实际生效的轴改动（已按品质调整）。 */
  readonly applied: AxisDelta;
  /** 品质对事件基调的影响说明，供界面展示。 */
  readonly tone: 'mishap' | 'ordinary' | 'fortunate' | 'breakthrough';
}
