'use client';

import * as React from 'react';

import { usePrefersReducedMotion } from '@/components/visual/ReducedMotion';

/**
 * Hidden Path Reveal —— 新路径出现（04_AGENT §25）。
 *
 * > 整个产品最高优先级的动画。
 * > 最重要的记忆点：一条原本不存在的轨道突然亮起来，新行动出现。
 *
 * ## 时间线（总计 900~1100ms）
 *
 * ```text
 * 0ms    普通 Gate 稍暗        ← 由调用方负责（.session-choice--dimmed，150ms）
 * 150ms  空白处出现一条极细轨迹
 * 400ms  轨迹向两端生长
 * 550ms  新 Gate 从 opacity 0 / translateY 16px 出现
 * 900ms  标签 ANOTHER PATH REVEALED / 你多看见了一种做法
 * ```
 *
 * 延迟写在 CSS（`.obs-reveal__line` / `__gate` / `__label`）里，组件只推进
 * 「播放 → 定居」两态：**只播一次**，播完之后不再参与动画预算。
 *
 * reduced motion 下直接进 `settled`：内容是淡入出现的，不生长、不位移（§35）。
 *
 * 视觉组件不得 fetch API（§7）。
 */

export interface HiddenPathRevealProps {
  readonly active: boolean;
  /** 新出现的 Fate Gate（通常是经验解锁的那个行动）。 */
  readonly children: React.ReactNode;
  readonly label?: string;
  readonly subLabel?: string;
  readonly className?: string;
}

/**
 * 与 CSS 里最长的那条延迟对齐：轨迹 150ms 起、Gate 400ms 起、标签 620ms 起，
 * 最后一段 320ms ⇒ 940ms。取 1000ms 作为「播放结束、定居」的时刻。
 */
const REVEAL_MS = 1000;

export function HiddenPathReveal({
  active,
  children,
  label = 'ANOTHER PATH REVEALED',
  subLabel = '你多看见了一种做法',
  className = '',
}: HiddenPathRevealProps) {
  const reduced = usePrefersReducedMotion();
  const playedRef = React.useRef(false);
  const [phase, setPhase] = React.useState<'idle' | 'playing' | 'settled'>('idle');

  React.useEffect(() => {
    if (!active || playedRef.current) {
      return;
    }
    playedRef.current = true;
    setPhase('playing');
    const timer = window.setTimeout(() => setPhase('settled'), reduced ? 0 : REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, reduced]);

  if (!active && phase === 'idle') {
    return null;
  }

  return (
    <section
      className={[
        'sil-reveal sil-unlock-rail relative',
        phase === 'settled' ? 'sil-reveal--settled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-reveal-phase={phase}
      aria-label="你多看见了一种做法"
    >
      {/* §4.8 解锁轨道：一条 1px 青蓝虚线从证据层画向选项，620ms */}
      <div aria-hidden="true" className="relative">
        <span className="sil-unlock-rail__line" />
        <span className="sil-unlock-rail__drop" />
      </div>

      <div className="sil-reveal__gate mt-3 flex flex-col gap-3">{children}</div>

      <p className="sil-reveal__label mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="sil-label text-[color:var(--sil-alternate-soft)]">{label}</span>
        <span className="sil-label sil-label--sm">{subLabel}</span>
      </p>
    </section>
  );
}

export default HiddenPathReveal;
