'use client';

import * as React from 'react';

import { WORLDLINE_TONE, WorldlineTrack, type WorldlineState } from '@/components/worldline/Worldline';

/**
 * 临界翻转演出（v3 §8.3「Flip Moment」/ §23 P1-3）。
 *
 * ## 为什么它必须是「一次演出」而不是「颜色变化」
 *
 * v3 §17 明确禁止：**只是把红色文字变绿色**。
 * 因为这个作品的核心主张是「你改变的不是答案，而是答案成立的条件」——
 * 如果翻转只表现为换个颜色，玩家读到的就是「我换了个选项」，
 * 而不是「我亲手把一条路从不可能变成了可能」。
 *
 * ## 演出序列（v3 §8.3 的七步，总时长 2.6s）
 *
 * | 时刻 | 画面 |
 * |---|---|
 * | 0ms | 屏幕微暗（80ms）—— 呼吸一顿 |
 * | 80ms | 红色世界线**收缩**（断裂的线被收回） |
 * | 620ms | `BREACHED` 字样碎裂 |
 * | 900ms | 一条新的稳定线**从中心生长** |
 * | 1700ms | `VIABLE` 重新构成 |
 * | 2200ms | 出现「世界线已翻转」 |
 *
 * ## 三条工程纪律
 *
 * 1. **3 秒内完成**（§23 P1-3 的 DoD）：实测 2600ms；
 * 2. **低性能设备不受影响**：只用 `transform` / `opacity` 做动画
 *    （不碰 `filter: blur`、不做持续重绘）；`prefers-reduced-motion` 下
 *    直接跳到终态，不做序列；
 * 3. **只播一次**：由 `flipKey` 驱动，父组件负责在真正发生翻转时 +1。
 */

export interface CriticalFlipProps {
  /** 每次真正发生 breached → viable 时递增；变化即触发演出。 */
  readonly flipKey: number;
  /** 演出结束后回调（父组件据此隐藏全屏层）。 */
  readonly onDone?: () => void;
  /** 翻转后的世界线状态（通常是 `stable`；余量紧时可能是 `unstable`）。 */
  readonly resultState?: WorldlineState;
  readonly className?: string;
}

type Phase = 'idle' | 'dim' | 'retract' | 'shatter' | 'grow' | 'label' | 'done';

/** 各阶段起始时刻（ms）。总和即演出长度。 */
const TIMELINE: readonly { readonly phase: Phase; readonly at: number }[] = [
  { phase: 'dim', at: 0 },
  { phase: 'retract', at: 80 },
  { phase: 'shatter', at: 620 },
  { phase: 'grow', at: 900 },
  { phase: 'label', at: 1700 },
  { phase: 'done', at: 2600 },
];

export function CriticalFlip({ flipKey, onDone, resultState = 'stable', className = '' }: CriticalFlipProps) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  /**
   * 是否降低了动效。`null` 表示尚未测出（首帧）——
   * 用 null 而不是 false，避免首帧误播一次完整动画。
   */
  const [reduced, setReduced] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  React.useEffect(() => {
    // flipKey 为 0 表示还没发生过翻转：不播
    if (flipKey <= 0 || reduced === null) {
      return;
    }

    // 降级：直接到终态，不做序列（v3 §8 的性能纪律）
    if (reduced) {
      setPhase('done');
      onDone?.();
      return;
    }

    setPhase('dim');
    const timers = TIMELINE.map((step) =>
      window.setTimeout(() => setPhase(step.phase), step.at),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [flipKey, onDone, reduced]);

  if (flipKey <= 0 || phase === 'idle') {
    return null;
  }

  const tone = WORLDLINE_TONE[resultState];
  const showShatter = phase === 'shatter';
  const showGrow = phase === 'grow' || phase === 'label' || phase === 'done';
  const showLabel = phase === 'label' || phase === 'done';
  const stillBreached = phase === 'dim' || phase === 'retract';

  return (
    <div
      // 全屏演出层：z 高于常规 UI，但仍低于 DiceModal（z-[70]）
      className={['pointer-events-none fixed inset-0 z-[64] flex items-center justify-center', className].join(' ')}
      aria-live="polite"
      aria-label="世界线已翻转"
    >
      {/* ① 屏幕微暗：80ms 的一顿呼吸 */}
      <div
        className="absolute inset-0 bg-ink-950 transition-opacity duration-200"
        style={{ opacity: phase === 'dim' ? 0.82 : stillBreached ? 0.55 : 0 }}
      />

      <div className="relative w-full max-w-3xl px-6">
        {/* ② 断裂的红线收缩 / ④ 新线从中心生长 */}
        <div className="relative h-24">
          {stillBreached ? (
            <WorldlineTrack
              state="breached"
              broken
              progress={phase === 'retract' ? 0.35 : 1}
              height={96}
              className="absolute inset-0 h-full w-full transition-[opacity] duration-300"
            />
          ) : null}

          {showGrow ? (
            <WorldlineTrack
              state={resultState}
              progress={phase === 'grow' ? 0.72 : 1}
              height={96}
              className="absolute inset-0 h-full w-full animate-wl-grow"
            />
          ) : null}
        </div>

        {/* ③ BREACHED 碎裂 → ⑤ VIABLE 重新构成 */}
        <div className="relative mt-4 h-24 text-center">
          {showShatter ? (
            <p className="animate-wl-shatter font-mono text-3xl font-black tracking-[0.3em] text-rose-400 sm:text-4xl">
              BREACHED
            </p>
          ) : null}

          {showGrow && !showLabel ? (
            <p className="animate-wl-grow font-mono text-3xl font-black tracking-[0.3em] text-slate-300 sm:text-4xl">
              VIABLE
            </p>
          ) : null}

          {showLabel ? (
            <div>
              <p
                className={`animate-stamp-in font-mono text-3xl font-black tracking-[0.3em] sm:text-4xl ${tone.text}`}
                style={{ textShadow: `0 0 24px ${tone.glow}` }}
              >
                VIABLE
              </p>
              <p className="mt-4 animate-rise-in text-lg font-bold text-white sm:text-xl">
                世界线已翻转。
              </p>
              <p className="mt-1.5 animate-rise-in text-[13px] leading-relaxed text-slate-400">
                你刚刚没有改变选择。你改变的是选择成立的条件。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default CriticalFlip;
