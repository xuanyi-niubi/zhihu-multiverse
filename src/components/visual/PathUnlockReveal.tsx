'use client';

import * as React from 'react';

/**
 * Path Unlock Reveal —— 全产品最大的 WOW Point（报告 §14 / §15 / §16 / §26.4）。
 *
 * ## 它必须被演出来，而不是「多一个选项」
 *
 * 普通游戏加选项就是列表多一行。但这里发生的事不一样：
 *
 * > 一段别人的真实经历，撕开了一条你原本看不见的世界线。
 *
 * 所以视觉顺序是固定的 —— 停顿 → NEW PATH FOUND → 裂缝展开 → 新路径升起。
 * **不用爆炸、不用金卡、不用稀有度**：这是一个安静的发现，不是抽卡。
 *
 * 组件只负责这一刻的表演；真正的选项内容作为 `children` 传入，
 * 因此它不需要知道选项长什么样，也不需要理解经验数据。
 */

export interface PathUnlockRevealProps {
  readonly active: boolean;
  readonly headline?: string;
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function PathUnlockReveal({
  active,
  headline = '你多看见了一种做法。',
  children,
  className = '',
}: PathUnlockRevealProps) {
  if (!active) {
    return null;
  }

  return (
    <section
      className={['flex flex-col items-stretch', className].filter(Boolean).join(' ')}
      aria-live="polite"
      aria-label="一条新的行动路径出现了"
    >
      <p
        className="font-mono text-[10px] tracking-[0.34em] text-unlock"
        style={{ animation: 'arc-fragment-arrive 520ms var(--arc-ease) both' }}
      >
        NEW PATH FOUND
      </p>
      <p
        className="mt-1.5 text-[13px] font-semibold leading-relaxed text-unlock-soft"
        style={{ animation: 'arc-fragment-arrive 560ms var(--arc-ease) both', animationDelay: '160ms' }}
      >
        {headline}
      </p>

      {/* 原本空白的地方：一条裂缝撕开 */}
      <div className="relative mt-3 flex h-9 items-center justify-center">
        <span aria-hidden="true" className="absolute left-0 right-0 h-px bg-white/[0.06]" />
        <span
          aria-hidden="true"
          className="relative block w-px rounded-full bg-zhihu-300"
          style={{
            height: '36px',
            transformOrigin: '50% 50%',
            boxShadow: '0 0 12px 2px rgba(0,132,255,0.55)',
            animation: 'arc-crack-open 720ms var(--arc-ease) both',
            animationDelay: '260ms',
          }}
        />
      </div>

      <div
        style={{
          animation: 'arc-path-emerge 640ms var(--arc-ease) both',
          animationDelay: '560ms',
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default PathUnlockReveal;
