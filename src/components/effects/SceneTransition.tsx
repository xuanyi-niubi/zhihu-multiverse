'use client';

import * as React from 'react';

/**
 * 幕转场演出。
 *
 * 替代 web-design skill 的 L3 scroll-story：本产品是场景切换型叙事，
 * 转场比滚动更贴近体验。三种转场对应三种叙事时刻：
 * - glitch：回合推进（时间流逝）
 * - flash-white：高光 / 检定大成功
 * - flash-red：SAN 暴扣 / 检定大失败
 */

export type TransitionKind = 'glitch' | 'flash-white' | 'flash-red';

export interface SceneTransitionProps {
  readonly kind: TransitionKind | null;
  readonly label?: string;
  readonly onDone?: () => void;
  /** 递增的 key，用于重复触发同一转场。 */
  readonly triggerKey: number;
}

const DURATION: Record<TransitionKind, number> = {
  glitch: 900,
  'flash-white': 340,
  'flash-red': 520,
};

export function SceneTransition({ kind, label, onDone, triggerKey }: SceneTransitionProps) {
  const [active, setActive] = React.useState(false);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  React.useEffect(() => {
    if (!kind) {
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 120 : DURATION[kind];

    setActive(true);

    const timer = window.setTimeout(() => {
      setActive(false);
      onDoneRef.current?.();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [kind, triggerKey]);

  if (!kind || !active) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center"
    >
      {kind === 'glitch' ? (
        <div className="absolute inset-0 bg-ink-950/80">
          <div className="absolute inset-0 animate-glitch bg-scanline opacity-40" />
          {label ? (
            <p className="absolute inset-0 flex animate-glitch items-center justify-center font-mono text-xl font-black tracking-[0.3em] text-zhihu-400 sm:text-3xl">
              {label}
            </p>
          ) : null}
        </div>
      ) : null}

      {kind === 'flash-white' ? (
        <div className="absolute inset-0 animate-flash-white bg-white" />
      ) : null}

      {kind === 'flash-red' ? (
        <div className="absolute inset-0 animate-flash-red bg-relic-danger" />
      ) : null}
    </div>
  );
}

export default SceneTransition;
