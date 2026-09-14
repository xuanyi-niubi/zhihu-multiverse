'use client';

import * as React from 'react';

/**
 * Signal Pulse（04_AGENT §14 / §15）。
 *
 * 全站只有一个「一点信号」：输入被聚焦时它出现在主焦点上，
 * 点击 CTA 时它是转场的中心，第三幕它是琥珀色的反例信号。
 *
 * 它刻意不是 loading spinner：没有旋转、没有进度、没有百分比 ——
 * 只是一个位置的亮，符合观象厅「仪器在观测」的语言。
 */

export type SignalTone = 'path' | 'zhihu' | 'counter' | 'end';

export interface SignalPulseProps {
  readonly tone?: SignalTone;
  /** 边长（px）。最小 12，最大 96 —— 它永远不是主视觉。 */
  readonly size?: number;
  /** 只播一轮（点击 CTA 的那一次中心脉冲）。 */
  readonly once?: boolean;
  readonly className?: string;
  /** 无障碍：默认对读屏隐藏；传 label 时作为状态文本暴露。 */
  readonly label?: string;
}

function toneClass(tone: SignalTone): string {
  return tone === 'path' ? '' : `obs-signal--${tone}`;
}

export function SignalPulse({
  tone = 'path',
  size = 22,
  once = false,
  className = '',
  label,
}: SignalPulseProps) {
  const dimension = Math.max(12, Math.min(96, size));

  return (
    <span
      className={['obs-signal', toneClass(tone), once ? 'obs-signal--once' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: dimension, height: dimension }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="obs-signal__ring" />
      <span className="obs-signal__ring" />
      <span className="obs-signal__ring" />
      <span className="obs-signal__core" />
    </span>
  );
}

export default SignalPulse;
