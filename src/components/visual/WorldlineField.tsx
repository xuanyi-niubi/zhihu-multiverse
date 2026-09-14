'use client';

import * as React from 'react';

/**
 * Worldline Field —— 首页背景的世界线（报告 §4 / §26.1 / §31）。
 *
 * ## 它要表达的只有一件事
 *
 * 用户还没有提问时，世界里漂着几条互不相干的人生线；一旦他开始输入，
 * 这些线**向他收束** —— 表达「你的问题正在成为这次宇宙的坐标」。
 *
 * ## 为什么用 SVG + CSS，而不是 WebGL（报告 §31）
 *
 * 需要的只是曲线、模糊、位移与透明度；用 SVG 就能画清楚，且更轻、更清晰、
 * 手机性能更好、没有新依赖。报告明确不希望为一个背景引入 WebGL。
 *
 * 组件是**纯装饰**：`aria-hidden`、`pointer-events-none`，不接收任何业务数据。
 */

export type WorldlineFieldState = 'idle' | 'focused' | 'selected';

export interface WorldlineFieldProps {
  /** `idle` 漂移 / `focused` 提亮 / `selected` 收束后残留。 */
  readonly state?: WorldlineFieldState;
  /** 是否向中心收束（用户开始输入 / 提交时）。 */
  readonly converge?: boolean;
  readonly className?: string;
}

interface WorldlineSpec {
  readonly id: string;
  readonly d: string;
  readonly baseY: number;
  readonly opacity: number;
  readonly durationMs: number;
  readonly delayMs: number;
}

/**
 * 五条线，五个不同高度、曲率与漂移速度 —— 速度差就是「深度」。
 * 数值是 viewBox（1000×600）坐标，与真实像素无关。
 */
const LINES: readonly WorldlineSpec[] = [
  { id: 'wl-1', d: 'M -20 96 C 260 44, 720 156, 1020 74', baseY: 96, opacity: 0.32, durationMs: 13000, delayMs: 0 },
  { id: 'wl-2', d: 'M -20 224 C 300 306, 700 122, 1020 256', baseY: 224, opacity: 0.26, durationMs: 17000, delayMs: 1400 },
  { id: 'wl-3', d: 'M -20 306 C 360 196, 640 414, 1020 186', baseY: 306, opacity: 0.2, durationMs: 15000, delayMs: 600 },
  { id: 'wl-4', d: 'M -20 386 C 240 300, 760 474, 1020 366', baseY: 386, opacity: 0.28, durationMs: 14000, delayMs: 2200 },
  { id: 'wl-5', d: 'M -20 508 C 320 436, 680 566, 1020 524', baseY: 508, opacity: 0.22, durationMs: 19000, delayMs: 900 },
];

const CENTER_Y = 300;

export function WorldlineField({
  state = 'idle',
  converge = false,
  className = '',
}: WorldlineFieldProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number | null>(null);

  /**
   * 鼠标产生一点「引力」：整组线随指针极轻微地偏折（报告 §4）。
   * rAF 节流 + 只在 hover 设备启用 —— 触摸设备上没有指针，强行监听只会掉帧。
   */
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: hover)').matches) {
      return;
    }

    const onMove = (event: PointerEvent): void => {
      if (frameRef.current !== null) {
        return;
      }
      const { clientX, clientY } = event;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const rect = host.getBoundingClientRect();
        const nx = (clientX - rect.left) / Math.max(1, rect.width) - 0.5;
        const ny = (clientY - rect.top) / Math.max(1, rect.height) - 0.5;
        host.style.setProperty('--wl-px', `${(-nx * 16).toFixed(2)}px`);
        host.style.setProperty('--wl-py', `${(-ny * 12).toFixed(2)}px`);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  const lit = state !== 'idle' || converge;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={['pointer-events-none absolute inset-0 overflow-hidden', className].filter(Boolean).join(' ')}
    >
      <svg
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        className="h-full w-full transition-transform duration-[900ms] ease-out"
        style={{ transform: 'translate3d(var(--wl-px, 0px), var(--wl-py, 0px), 0)' }}
      >
        <defs>
          <linearGradient id="arc-wl-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(133,194,255,0)" />
            <stop offset="22%" stopColor="rgba(133,194,255,0.9)" />
            <stop offset="78%" stopColor="rgba(90,174,255,0.9)" />
            <stop offset="100%" stopColor="rgba(133,194,255,0)" />
          </linearGradient>
          <filter id="arc-wl-blur" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        {LINES.map((line) => {
          // 收束：每条线向中心高度平移 86%，散乱的多条线坍缩成一条窄带
          const offset = (CENTER_Y - line.baseY) * 0.86;
          return (
            <g
              key={line.id}
              style={{
                transformBox: 'view-box',
                transformOrigin: '50% 50%',
                transform: `translateY(${converge ? offset : 0}px)`,
                transition: 'transform 1100ms var(--arc-ease), opacity 1100ms var(--arc-ease)',
                opacity: converge ? Math.min(1, line.opacity + 0.3) : lit ? Math.min(1, line.opacity + 0.12) : line.opacity,
              }}
            >
              <g
                style={{
                  animation: `arc-drift ${line.durationMs}ms var(--arc-ease) infinite`,
                  animationDelay: `${line.delayMs}ms`,
                }}
              >
                <path
                  d={line.d}
                  fill="none"
                  stroke="url(#arc-wl-grad)"
                  strokeWidth={lit ? 1.5 : 1.1}
                  strokeLinecap="round"
                  filter="url(#arc-wl-blur)"
                />
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default WorldlineField;
