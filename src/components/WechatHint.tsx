'use client';

import * as React from 'react';

import { isWechatUserAgent } from '@/features/run/wechat';

/**
 * 微信内置浏览器的兜底提示。
 *
 * ## 为什么需要它
 *
 * 线上入口长期是 `https://<host>:8443` —— **非标准端口**在微信内置浏览器、
 * 企业网与校园网里经常直接打不开（微信只保证 80/443 的常规体验）。
 *
 * 换成标准 443 是根本解法（同一个应用、同一张有效证书早已在 443 上跑着）；
 * 但只要还有人从旧链接进来、或网络仍会拦非标端口，明确告诉他
 * 「点右上角 → 在浏览器打开」就比让他面对白屏有用得多。
 *
 * ## 纪律
 *
 * - 只在微信 UA 下出现，普通浏览器**零打扰**；
 * - 不弹窗、不遮内容，只是一行可以自己关掉的提示；
 * - 不做任何跳转、不伪装成微信授权，也不诱导「用微信登录」。
 */
export function WechatHint({ className = '' }: { readonly className?: string }) {
  const [visible, setVisible] = React.useState(false);

  /** 首屏是服务端渲染，UA 只能在挂载后读 —— 因此不会污染 SSR 输出。 */
  React.useEffect(() => {
    try {
      setVisible(isWechatUserAgent(window.navigator.userAgent));
    } catch {
      setVisible(false);
    }
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="微信内打开提示"
      className={[
        'flex items-start justify-between gap-3 border-b px-4 py-2 text-meta leading-relaxed',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        borderColor: 'var(--sil-rule)',
        background: 'rgb(255 255 255 / 0.04)',
        color: 'var(--sil-ink-200)',
      }}
    >
      <span>
        微信里可能打不开这一页：点右上角 <span aria-hidden="true">⋯</span> → 「在浏览器打开」。
      </span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="min-h-11 shrink-0 text-meta underline decoration-dotted underline-offset-4"
        style={{ color: 'var(--sil-ink-300)' }}
      >
        知道了
      </button>
    </div>
  );
}

export default WechatHint;
