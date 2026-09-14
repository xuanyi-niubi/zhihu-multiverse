/**
 * 「刚穿越过来」这一件小事的状态（04_AGENT §15 升级版）。
 *
 * 首页在 `router.push` 之前标记一次；会话页挂载时消费它，播一次环收 + 闪白。
 *
 * 为什么用模块级变量而不是 sessionStorage：
 *
 * ```text
 * 它只在一个客户端的两次渲染之间有效，刷新后不再重播（这是想要的行为）；
 * 它不参与序列化，也就不会把「动画播过没有」写进用户档案。
 * ```
 *
 * 注意：只在客户端模块里调用；服务端渲染时这个变量永远是 false。
 */

let pendingArrival = false;

/**
 * 穿越时带着的那句话（只用于会话页的首屏骨架）。
 *
 * 为什么连问题一起带：会话页在拿到数据之前有一段**真实的网络等待**。
 * 如果这段只有一行 kicker，页面几乎是空的，然后内容「啪」地整屏出现 ——
 * 观感上就是一次闪烁。把问题原文带过去，编译骨架就能在数据到达前
 * 把中央那句话先显示出来，让转场是连续的而不是断裂的。
 *
 * 同样不落盘：它只是两次渲染之间的一点上下文，不进任何持久化。
 */
let pendingQuestion = '';

/** 首页：马上要穿越了。 */
export function markJumpArrival(): void {
  pendingArrival = true;
}

/** 首页：把用户那句话一起交给会话页。 */
export function setJumpQuestion(question: string): void {
  pendingQuestion = question.slice(0, 200);
}

/** 会话页：消费一次（读过就清掉，因此同一个会话刷新不会再闪）。 */
export function consumeJumpArrival(): boolean {
  const value = pendingArrival;
  pendingArrival = false;
  return value;
}

/**
 * 会话页：读一次穿越带过来的问题原文。
 *
 * 与 `consumeJumpArrival` 各自独立消费 —— 落点动画和首屏骨架是两件事。
 * **只能在 effect 里调用**：服务端渲染时它永远是空串，直接在渲染期读会让
 * 服务端与客户端的首帧文本不一致。
 */
export function peekJumpQuestion(): string {
  return pendingQuestion;
}
