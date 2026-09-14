'use client';

import * as React from 'react';

/**
 * 极光带 Aurora Band（DESIGN-SYSTEM.md §4.7 / §0 机制 2）。
 *
 * ## 它是全站唯一的情绪指示器
 *
 * 这一代产品不再用数值条告诉玩家「你处在什么状态」，而是用一条 2px 的
 * 斜向渐变带：
 *
 * ```text
 * seek     检索 / 推演中    蓝 → 青
 * counter  反例进场         琥珀
 * end      终局 / 现实重写   紫银
 * ```
 *
 * 它只做 2.4s 的**透明度呼吸**，不位移、不流动 —— 情绪在，噪音不在。
 * 一屏最多一个，位置固定在页面顶部（`fixed`）或关键卡片顶部（`inline`）。
 *
 * 视觉组件不得 fetch API（04_AGENT §7）。
 */

export type AuroraTone = 'seek' | 'counter' | 'end';

export interface AuroraBandProps {
  readonly tone?: AuroraTone;
  /** `fixed` = 页面顶部 2px；`inline` = 卡片顶部。 */
  readonly variant?: 'fixed' | 'inline';
  readonly className?: string;
}

export function AuroraBand({ tone = 'seek', variant = 'fixed', className = '' }: AuroraBandProps) {
  return (
    <span
      aria-hidden="true"
      data-aurora-tone={tone}
      className={[
        'sil-aurora',
        tone === 'seek' ? '' : `sil-aurora--${tone}`,
        variant === 'fixed' ? 'sil-aurora--fixed' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}

export default AuroraBand;
