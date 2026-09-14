'use client';

import * as React from 'react';

/**
 * Signal Pulse —— 一点信号
 *
 * 全站只有一个「一点信号」：输入被聚焦时它出现在主焦点上，
 * 点击 CTA 时它是转场的中心，第三幕它是琥珀色的反例信号。
 *
 * 它刻意不是 loading spinner：没有旋转、没有进度、没有百分比 ——
 * 只是一个位置的亮，符合观象厅「仪器在观测」的语言。
 *
 * ## 本次修掉的两个缺陷
 *
 * **1. 尺寸跳变。** 旧实现的尺寸由 `style={{width,height}}` 直接写死，
 * CSS 里 `.obs-signal` 没有尺寸过渡 —— 于是 `size` 从 16 变成 24 时，
 * 这颗点会**瞬间**弹大 125%。实测（`.workbuddy/memory/2026-09-14.md`）
 * 这正是「首页随便点一下就闪一下蓝、观感像卡住」的根因。
 * 现在宽高走 CSS transition，尺寸变化被平滑吸收。
 *
 * **2. 霓虹外发光。** 旧版三圈 ring 各带 14px 外发光。发光是 AI 生成
 * 界面的常见指纹，且在暗房语汇里没有依据 —— 显影是**密度变化**，
 * 不是「往外射光」。现在 ring 只在透明度上呼吸。
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
  return tone === 'path' ? '' : `sil-signal--${tone}`;
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
      className={['sil-signal', toneClass(tone), once ? 'sil-signal--once' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: dimension, height: dimension }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="sil-signal__ring" />
      <span className="sil-signal__ring" />
      <span className="sil-signal__ring" />
      <span className="sil-signal__core" />
    </span>
  );
}

export default SignalPulse;
