import type { UserContext } from '@/features/decision-session/domain';

/**
 * 「我听懂的是」（重构方案 §3.1 第四步的指定输出块）。
 *
 * ## 它出现在哪里、为什么重要
 *
 * 方案给出的结果页格式里，第一块就是它：
 *
 * ```text
 * 我听懂的是
 * 你想积累一次完整项目经历，但担心基础不足拖累课程。
 * ```
 *
 * 它排在三路径之前，作用不是总结，而是**让用户确认我们有没有理解错**。
 * 如果这一步就偏了，后面三条路径再漂亮也是答非所问。
 *
 * ## 一条硬纪律：**不用 AI 生成**
 *
 * 这是本模块唯一重要的实现决定。理由：
 *
 * > 「我听懂的是」如果由模型重写，它就不再是「我听懂了什么」，
 * > 而是「模型说我听懂了什么」—— 那正是方案 §4.2 禁止的
 * > 「把一段流畅文案伪装为事实结论」。
 *
 * 因此这里**只做确定性复述**：
 * - 复述用户的原话（原样，不改写、不润色）；
 * - 逐条列出用户**自己说过**的约束；
 * - 明确列出用户**没说过**的东西，并声明不猜。
 *
 * 于是「我听懂的是」永远不可能比用户说的更多 —— 这正是它可信的原因。
 */

export interface UnderstandingLine {
  readonly label: string;
  /** 用户自己说过的原话（不做单位换算、不做改写）。 */
  readonly value: string;
}

export interface Understanding {
  /** 复述用户的问题。**原样引用**，不加解释。 */
  readonly restated: string;
  /** 用户说过的约束（逐条来源可指回他的选择）。 */
  readonly constraints: readonly UnderstandingLine[];
  /** 用户**没说过**的东西 —— 我们不猜，也不假装知道。 */
  readonly missing: readonly string[];
  /** 是否已经问过澄清（false 时说明这是初步理解）。 */
  readonly clarified: boolean;
}

/**
 * 由问题与约束合成「我听懂的是」。
 *
 * 刻意做成纯函数、无 I/O、无模型调用：这样它可以在测试里被穷举，
 * 也可以保证「同一句话永远得到同一段复述」。
 */
export function understoodFrom(input: {
  readonly question: string;
  readonly context: UserContext;
}): Understanding {
  const { question, context } = input;

  const constraints: UnderstandingLine[] = [];
  if (context.availableTime) {
    constraints.push({ label: '你能拿出的时间', value: context.availableTime });
  }
  if (context.wantToVerify) {
    constraints.push({ label: '你最想先弄清', value: context.wantToVerify });
  }
  for (const item of context.nonNegotiables) {
    constraints.push({ label: '你不能接受的损失', value: item });
  }

  /**
   * 缺失项如实列出。
   *
   * 这三句是固定文案而不是动态拼装：它们是**产品承诺**
   * （「缺信息就不猜」），措辞应当稳定、可被测试断言。
   */
  const missing: string[] = [];
  if (!context.availableTime) {
    missing.push('你能稳定拿出多少时间 —— 这决定后面那个实验做多大');
  }
  if (!context.wantToVerify) {
    missing.push('你最想先弄清哪一个问题 —— 这决定我们优先去找哪类经历');
  }
  if (context.nonNegotiables.length === 0) {
    missing.push('哪种损失是你不愿意接受的 —— 它会成为实验的停止信号');
  }

  return {
    restated: question.trim(),
    constraints,
    missing,
    clarified: constraints.length > 0,
  };
}
