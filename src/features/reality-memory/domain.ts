/**
 * 现实记忆的领域契约（迁移期新增，**不改变现有行为**）。
 *
 * ## 它解决什么
 *
 * 现在「用户做完实验之后发生了什么」只有一份七天后回访问卷，
 * 结果**没有回流到下一次会话**。于是产品的闭环是断的：
 * 它问你结果，但不因此变聪明。
 *
 * 这一层让「现实里验证过的东西」变成可持续使用的知识：
 *
 * ```text
 * 第一次会话：用户说「每周大概能挤出 8 小时」      → confidence: stated
 *   ↓ 做了一周实验
 * 数据回来：实际只用了 3 小时，还占了一个周末       → observed-once
 *   ↓ 再做一次
 * 再次验证 → observed-repeatedly
 *   ↓
 * 下一次会话：这条**观测到的**事实优先于用户的自我估计
 * ```
 *
 * ## 为什么置信度只有三档
 *
 * 因为只有三种**证据强度**在现实里可区分：
 * 「他自己说的」「观测到一次」「反复观测到」。
 * 任何更细的刻度（0.7、0.85）都会变成伪精确 ——
 * 而我们没有能力为它提供论据。
 */

/**
 * 一条现实记忆。
 *
 * `source` 与 `confidence` 的关系是刻意的：
 * `user-stated` 只能对应 `stated`；只有实验观测才能升级置信度。
 * 这保证「用户随口一说」不会被系统当成反复验证过的事实。
 */
export interface RealityMemoryEntry {
  readonly id: string;

  /** 记忆内容本身（一句可读的陈述）。 */
  readonly claim: string;

  readonly source:
    /** 用户自己说的（自我估计）。 */
    | 'user-stated'
    /** 实验观测到的（行为结果，比自我估计可信）。 */
    | 'experiment-observed';

  readonly confidence:
    /** 只是他自己说的。 */
    | 'stated'
    /** 观测到一次。 */
    | 'observed-once'
    /** 反复观测到。 */
    | 'observed-repeatedly';

  /** 来自哪次会话（可追溯）。 */
  readonly sessionId: string;

  readonly createdAt: string;
}

/**
 * 一次现实实验的结果。
 *
 * 与旧的 `FollowUp`（只有 done / partial / changed-plan）的区别：
 * 旧结构只记录**结论**，新结构记录**过程**——
 * 实际花了多久、产出了什么、有没有碰到成功/停止信号、以及
 * 这次实验**新暴露出来的未知**。
 *
 * 最后一项是关键：一次实验的价值不只是「成了没有」，
 * 更在于它把哪些猜测变成了已知、又把哪些新问题翻了出来。
 */
export interface ExperimentResult {
  readonly status:
    | 'completed'
    | 'partial'
    /** 主动按停止信号停下（这是**正确执行**，不是失败）。 */
    | 'stopped'
    | 'abandoned';

  /** 观察到的事实（逐条，不含解释）。 */
  readonly observations: readonly string[];

  /** 实际投入（用户自述原文，不做单位换算）。 */
  readonly actualTime?: string;
  /** 实际产出的东西。 */
  readonly producedArtifact?: string;

  /** 是否碰到成立信号；没说就是 null（不推断）。 */
  readonly hitSuccessSignal: boolean | null;
  /** 是否碰到停止信号。**命中停止信号同样是一次成功执行。** */
  readonly hitStopSignal: boolean | null;

  /** 这次实验之后，你对这件事的判断发生了什么变化。 */
  readonly whatChanged: string;

  /** 这次实验**新暴露**出来的未知。 */
  readonly newUnknowns: readonly string[];
}
