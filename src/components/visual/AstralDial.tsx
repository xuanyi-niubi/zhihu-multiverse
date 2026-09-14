'use client';

import * as React from 'react';

import { usePrefersReducedMotion } from '@/components/visual/ReducedMotion';

/**
 * Astral Dial —— 命运观象仪（04_AGENT §11）。
 *
 * ## 它是什么
 *
 * 未来天文仪器的**主刻度盘**：仪器在缓慢自转，用户在它前面说出一句话。
 * 它不是「星座壁纸」——没有闪烁星点、没有流星、没有随机粒子，
 * 只有环、刻度、节点和一条主焦点。全部由确定性常量生成，
 * 所以每台设备、每一次刷新看到的是同一台仪器。
 *
 * ## 硬限制（§11）
 *
 * ```text
 * 3~5 个主环      → 4
 * 8~16 个刻度     → 12
 * <= 10 个节点    → 7
 * 1 个主焦点      → 1（顶部那颗亮节点）
 * 40~90s rotation → 88s / 61s（反向）
 * 鼠标视差        → 最多 1~2°，不做追踪
 * ```
 *
 * 视觉组件不得 fetch API（§7）：这里是纯展示，指针视差也只读本地几何。
 */

/** 主环半径（viewBox 760×760，中心 380,380）。 */
const RING_RADII: readonly number[] = [356, 306, 250, 190];

/** 刻度：12 条，落在 r=306 的环上，向内外各 5px。 */
const TICK_COUNT = 12;

/** 节点：7 个，确定性角度与半径。 */
const NODES: readonly { readonly angle: number; readonly radius: number; readonly size: number }[] = [
  { angle: -148, radius: 250, size: 2.6 },
  { angle: -96, radius: 306, size: 2 },
  { angle: -34, radius: 250, size: 3.2 },
  { angle: 24, radius: 190, size: 1.8 },
  { angle: 88, radius: 306, size: 2.4 },
  { angle: 152, radius: 250, size: 2.2 },
  { angle: 206, radius: 356, size: 1.6 },
];

const CENTER = 380;
/** 主焦点：内环正上方那一点。 */
const FOCUS = { angle: -90, radius: 250 } as const;

/**
 * 把浮点坐标压到 3 位小数。
 *
 * 为什么必须这么做：SSR 跑在 Node、水合跑在浏览器，两者对 `Math.cos/sin`
 * 的实现可能差 1 ULP，原始浮点直接序列化成 SVG 属性就会出现
 * `Prop y1 did not match. Server: "120.19237886466846" Client: "120.19237886466851"`。
 * React 遇到 hydration mismatch 会**丢弃整棵子树重新渲染** —— 视觉上就是一次闪烁，
 * 而且会连带把已经开始的关键帧动画重置。压到 3 位小数后两边逐字节一致。
 *
 * 精度代价可忽略：viewBox 760 下 1 单位 ≈ 1 像素，3 位小数的误差 ≤ 0.0005。
 */
function snap(value: number): number {
  return Number(value.toFixed(3));
}

function polar(angle: number, radius: number): { readonly x: number; readonly y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: snap(CENTER + Math.cos(rad) * radius),
    y: snap(CENTER + Math.sin(rad) * radius),
  };
}

export interface AstralDialProps {
  /** 主焦点是否点亮（输入被聚焦 / 正在进入）。 */
  readonly focus?: boolean;
  /** 是否允许指针视差（§11 只允许 1~2°）；reduced motion 下自动关闭。 */
  readonly parallax?: boolean;
  readonly className?: string;
}

export function AstralDial({ focus = false, parallax = true, className = '' }: AstralDialProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const reduced = usePrefersReducedMotion();

  /**
   * 视差直接写 CSS 变量，**不经过 React state**。
   *
   * 为什么不能用 setState：`pointermove` 挂在 window 上，鼠标每动一帧都会触发。
   * 用 state 就意味着每次移动都要重渲染整台仪器 —— 4 个环 + 12 条刻度 + 7 个节点
   * + 2 条准线 + 主焦点，约 27 个 SVG 元素，而且每个都带一个新造的内联 style 对象。
   * 实测在 500px 窄屏下，120 次指针移动会产生 237 次 style 写入；用户侧的感受是
   * 「随便点一下、动一下鼠标，整个盘子就闪一下」。
   *
   * 改成 setProperty 之后：React 只在 `focus` 真正翻转时重渲染，
   * 鼠标怎么动都只改两个 CSS 变量，SVG 结构一个节点都不动。
   */
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const reset = () => {
      svg.style.setProperty('--sil-tilt-y', '0deg');
      svg.style.setProperty('--sil-tilt-x', '0px');
    };
    if (!parallax || reduced || typeof window === 'undefined') {
      reset();
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    // 首帧就把变量落在 0 上：与 CSS 的 var(--sil-tilt-y, 0deg) 回落值一致，
    // 因此挂载瞬间不产生任何视觉跳变。
    reset();
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const apply = () => {
      frame = 0;
      const rect = root.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const nx = Math.max(-1, Math.min(1, (pointerX - (rect.left + rect.width / 2)) / (rect.width / 2)));
      const ny = Math.max(-1, Math.min(1, (pointerY - (rect.top + rect.height / 2)) / (rect.height / 2)));
      // §11：最多 2°，且**不追踪** —— 只是仪器被轻轻碰了一下
      svg.style.setProperty('--sil-tilt-y', `${Number((nx * 2).toFixed(2))}deg`);
      svg.style.setProperty('--sil-tilt-x', `${Number((ny * -4).toFixed(2))}px`);
    };
    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      reset();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [parallax, reduced]);

  const focusPoint = polar(FOCUS.angle, FOCUS.radius);
  const hair = 'rgb(var(--sil-rgb-ink-100) / 0.16)';
  const hairSoft = 'rgb(var(--sil-rgb-ink-100) / 0.09)';
  const tickStroke = 'rgb(var(--sil-rgb-ink-100) / 0.22)';

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-dial-focus={focus ? 'on' : 'off'}
      className={['sil-dial', focus ? 'sil-dial--focus' : '', className].filter(Boolean).join(' ')}
    >
      {/*
        视差变量由上面的 effect 直接 setProperty 写入，不参与 React 渲染，
        因此这里没有受控的 style —— SSR 与首帧水合的输出逐字节一致。
      */}
      <svg ref={svgRef} viewBox="0 0 760 760" className="sil-dial__svg">
        {/* 慢环：外环刻度 + 内环 */}
        <g className="sil-dial__spin">
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RING_RADII[0]}
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: hairSoft }}
            strokeWidth={1}
            strokeDasharray="2 9"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RING_RADII[2]}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className="sil-dial__ring sil-dial__ring--near"
            style={{ stroke: hair }}
            strokeWidth={1.1}
          />
          {NODES.map((node) => {
            const point = polar(node.angle, node.radius);
            return (
              <circle
                key={`${node.angle}-${node.radius}`}
                cx={point.x}
                cy={point.y}
                r={node.size}
                style={{ fill: 'rgb(var(--sil-rgb-ink-100) / 0.32)' }}
              />
            );
          })}
        </g>

        {/* 反向环：12 条刻度 + 最内环 */}
        <g className="sil-dial__spin-rev">
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RING_RADII[1]}
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: hairSoft }}
            strokeWidth={0.9}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RING_RADII[3]}
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: hairSoft }}
            strokeWidth={0.9}
            strokeDasharray="1 6"
          />
          {Array.from({ length: TICK_COUNT }, (_, index) => {
            const angle = (360 / TICK_COUNT) * index;
            const inner = polar(angle, RING_RADII[1] - 6);
            const outer = polar(angle, RING_RADII[1] + 6);
            const major = index % 3 === 0;
            return (
              <line
                key={`tick-${index}`}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: tickStroke }}
                strokeWidth={major ? 1.2 : 0.7}
              />
            );
          })}
        </g>

        {/* 十字准线：仪器感来自极细的定位线，而不是发光 */}
        <line
          x1={24}
          y1={CENTER}
          x2={736}
          y2={CENTER}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: hairSoft }}
          strokeWidth={0.7}
        />
        <line
          x1={CENTER}
          y1={24}
          x2={CENTER}
          y2={736}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: hairSoft }}
          strokeWidth={0.7}
        />

        {/* 唯一的 1 个主焦点 */}
        <g className="sil-dial__focus">
          <circle
            cx={focusPoint.x}
            cy={focusPoint.y}
            r={9}
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: 'rgb(var(--sil-rgb-alternate) / 0.55)' }}
            strokeWidth={1}
          />
          <circle
            cx={focusPoint.x}
            cy={focusPoint.y}
            r={2.4}
            style={{ fill: 'var(--sil-alternate)' }}
          />
        </g>
      </svg>
    </div>
  );
}

export default AstralDial;
