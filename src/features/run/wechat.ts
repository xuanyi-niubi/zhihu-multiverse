/**
 * 微信内置浏览器的识别（纯函数，便于单测）。
 *
 * 放在 `features/run/` 而不是组件里：它是**判断逻辑**，与渲染无关 ——
 * 和 `appearance.ts`（减少动画偏好）同一类。组件只负责把结果画出来。
 *
 * 用途：线上入口长期是 `https://<host>:8443`，非标准端口在微信内置浏览器
 * 与企业网/校园网里经常直接打不开。识别出来之后给用户一句
 * 「点右上角 → 在浏览器打开」，比让他面对白屏有用。
 */
export function isWechatUserAgent(userAgent: string): boolean {
  return /MicroMessenger|WeChat/i.test(userAgent);
}
