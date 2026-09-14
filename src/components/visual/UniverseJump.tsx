'use client';

import * as React from 'react';

import { usePrefersReducedMotion } from '@/components/visual/ReducedMotion';

/**
 * 穿越平行宇宙 —— 进入主链的那一下（04_AGENT §15 的升级版）。
 *
 * ## 它是什么
 *
 * 点击 CTA 之后，观象厅不是一个「跳转」，而是一次**空间转场**：
 *
 * ```text
 * 0ms     控制台收缩、输入文字淡出、中心信号脉冲（charge）
 * 240ms   光环开始向外加速、24 条光轨拉长、问题被拉向观者、整体转亮（warp）
 * 900ms   全部收束为白，覆盖层淡出；调用方此时 router.push
 * 落点     会话页一次环收 + 闪白（ArrivalFlash）
 * ```
 *
 * ## 为什么不是「加载页」
 *
 * 真实请求（`POST /api/sessions`）从 0ms 就并行开始，转场不增加任何等待 ——
 * 它只是把「请求正在路上」这段时间变成体验的一部分。
 *
 * ## 性能（§36）
 *
 * ```text
 * 24 条光轨   = decorative particles <= 24（上限）
 * 5 个光环    = div + border-radius，不是 SVG path
 * 0 个新 keyframes：全部由 transition 承担（orbit-drift 负责外环自转）
 * 唯一同时出现的 blur：问题文字被拉走的那 5px
 * ```
 */

const RING_COUNT = 5;
const STREAK_COUNT = 24;
/** charge → warp 的切换点：让用户先看清「被吸入」再加速。 */
const WARP_AT_MS = 240;

export interface UniverseJumpProps {
  /** 转场是否开始。由首页在提交的那一刻置为 true。 */
  readonly active: boolean;
  /** 被拉进宇宙的那句话。 */
  readonly question: string;
  readonly className?: string;
}

export function UniverseJump({ active, question, className = '' }: UniverseJumpProps) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = React.useState<'idle' | 'charge' | 'warp'>('idle');

  React.useEffect(() => {
    if (!active) {
      setPhase('idle');
      return;
    }
    setPhase('charge');
    if (reduced) {
      // §35：降级成一次简单的淡出，不做加速与拉长
      setPhase('warp');
      return;
    }
    const timer = window.setTimeout(() => setPhase('warp'), WARP_AT_MS);
    return () => window.clearTimeout(timer);
  }, [active, reduced]);

  if (phase === 'idle') {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      data-phase={phase}
      className={['obs-jump', className].filter(Boolean).join(' ')}
    >
      <span className="obs-jump__veil" />

      <div className="obs-jump__tunnel">
        {Array.from({ length: RING_COUNT }, (_, index) => (
          <span
            key={`ring-${index}`}
            className="obs-jump__ring"
            style={{
              transitionDelay: `${index * 46}ms`,
              borderColor:
                index % 2 === 0
                  ? 'rgb(var(--obs-rgb-path) / 0.5)'
                  : 'rgb(var(--obs-rgb-zhihu) / 0.42)',
            }}
          />
        ))}

        {Array.from({ length: STREAK_COUNT }, (_, index) => (
          <span
            key={`streak-${index}`}
            className="obs-jump__streak"
            style={
              {
                '--obs-streak-angle': `${(360 / STREAK_COUNT) * index}deg`,
                transitionDelay: `${(index % 6) * 28}ms`,
              } as React.CSSProperties
            }
          />
        ))}

        <span className="obs-jump__core" />
      </div>

      <div className="obs-jump__text">
        <p className="obs-kicker">Entering the multiverse</p>
        <p className="obs-jump__question">{question}</p>
        <p className="obs-jump__note">正在去找真正走过这条路的人</p>
      </div>
    </div>
  );
}

/** 落点：会话页挂载后的第一次环收 + 闪白。 */
export function ArrivalFlash({ className = '' }: { readonly className?: string }) {
  const [settled, setSettled] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      aria-hidden="true"
      data-phase={settled ? 'settled' : 'arriving'}
      className={['obs-arrive', className].filter(Boolean).join(' ')}
    >
      <span className="obs-arrive__flash" />
      <span className="obs-arrive__ring" />
    </div>
  );
}

export default UniverseJump;
