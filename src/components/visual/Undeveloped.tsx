'use client';

import * as React from 'react';

/**
 * 未显影字段 Undeveloped（DESIGN-SYSTEM.md §4.3）—— 本代核心组件。
 *
 * ## 「未知」是一等公民
 *
 * 产品命题是「先有证据，再有想象」，视觉翻译就是：
 *
 * ```text
 * 有证据的内容 → 显影（ds-develop）
 * 无证据的内容 → 不显影（ds-undeveloped）
 * ```
 *
 * 所以「还不知道」不是一句灰字，而是一种**材质**：45° 斜线 + 0.5px 虚线边框 +
 * 不发光、不可点、不带任何强调色。它**只有一个状态** ——
 * 禁止 hover 高亮、禁止点击展开、禁止填一个「估算值」。
 *
 * 视觉组件不得 fetch API（04_AGENT §7）。
 */

export interface UndevelopedProps {
  /** 右下角的等宽小字（默认「还不知道」）。 */
  readonly label?: string;
  /** `inline` 让标注跟在同一行，而不是另起一行。 */
  readonly inline?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function Undeveloped({
  label = '还不知道',
  inline = false,
  children,
  className = '',
}: UndevelopedProps) {
  return (
    <span
      data-unknown-label={label}
      className={['sil-undev', inline ? 'sil-undev--inline' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

export default Undeveloped;
