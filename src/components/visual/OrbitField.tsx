'use client';

import * as React from 'react';

/**
 * Orbit Field —— 人生轨道（04_AGENT §12）。
 *
 * ## 硬限制（§12）
 *
 * ```text
 * Desktop <= 10 条
 * Mobile  <= 6 条
 * opacity 0.08 ~ 0.32
 * stroke  0.5 ~ 1.25
 * ```
 *
 * ## 为什么形状是确定的
 *
 * 轨道由 `(index, total)` 直接算出，没有任何随机数：消费者刷新十次看到的
 * 是同一片天区。这也让「ACT I 轨道稀疏 / ACT III 略密」可以由调用方
 * 只改一个 count 表达，而不是换一套形状。
 *
 * 「不要像电路板」是硬要求：所以每条轨道都是一整条**闭合椭圆弧**，
 * 没有折线、没有直角、没有连接点的网格。
 *
 * 视觉组件不得 fetch API（§7）。
 */

/** 窄屏阈值：与 §37 的验收宽度（375 / 390 / 430）一致。 */
const COMPACT_QUERY = '(max-width: 640px)';

/** 移动端上限（§12）。 */
export const ORBIT_COMPACT_MAX = 6;
/** 桌面端上限（§12）。 */
export const ORBIT_DESKTOP_MAX = 10;

/** 视口是否窄屏。SSR 首帧按桌面处理，挂载后立即对齐。 */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(COMPACT_QUERY);
    setCompact(query.matches);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return compact;
}

export type OrbitAccent = 'path' | 'counter' | 'mixed';

export interface OrbitFieldProps {
  /** 想要的轨道数量；会被 §12 的上下限夹住。 */
  readonly count?: number;
  readonly accent?: OrbitAccent;
  /** 聚焦时「附近」的轨道更亮（§14：opacity +10%），不是全部变亮。 */
  readonly near?: boolean;
  /** 整体基调；`amber` 用于第三幕的琥珀反例轨道。 */
  readonly className?: string;
  /** 是否缓慢漂移（默认是；reduced motion 由 CSS 关掉）。 */
  readonly drift?: boolean;
}

/**
 * 几何常量。
 *
 * ⚠️ 改动任何一个都必须重新核对 `VIEWBOX` —— 它由下面推导而来，
 * 而不是手写的。原因见 `rotationRadius` 的说明。
 */
const GEO = {
  /** 椭圆中心 x（= viewBox 的水平中心）。 */
  cx: 50,
  /** 最内层椭圆的中心 y。 */
  cyBase: 46,
  /** 每隔一条轨道的中心 y 偏移，形成三层微错落。 */
  cyStep: 3,
  /** 最内层椭圆的长半轴。 */
  rxMin: 30,
  /** 长半轴随 spread 的增长量（最外层 = rxMin + rxSpan）。 */
  rxSpan: 32,
  /** 最内层椭圆的短半轴。 */
  ryMin: 9,
  /** 短半轴随 spread 的增长量。 */
  rySpan: 15,
  /** 最内层椭圆的旋转角（度）。 */
  rotMin: -14,
  /** 每条轨道的旋转角增量。 */
  rotStep: 3.4,
} as const;

/**
 * 轨道组绕 viewBox 中心旋转一周所扫出的**圆盘半径**。
 *
 * ## 为什么需要这个概念
 *
 * `sil-orbit__drift` 是 `rotate(0deg) → rotate(360deg)` 的整圈自转，
 * 不是轻微的摆动。所以真正必须被 viewBox 容纳的，不是「某一条椭圆」，
 * 而是**整族椭圆绕中心转一圈扫过的圆盘**。
 *
 * 任一椭圆的中心到旋转中心的最大距离是 `max|cy - cx|`；
 * 再叠加它的长半轴，就是该椭圆的最远点。取全族最大值即为圆盘半径。
 *
 * ## 写死 viewBox 造成的实际 bug
 *
 * 这里原本是 `viewBox="0 0 100 100"`。而最外层椭圆 rx = 30 + 32 = 62、
 * 中心 x = 50，横向跨度是 `-12 .. 112` —— 两侧各超出 viewBox 12 个单位。
 * SVG 会把 viewBox 之外的内容裁掉（`overflow: hidden` 是 svg 元素的
 * 默认值），于是首页那个正方形观象仪里，**最外面两三条轨道被竖直切断**，
 * 看起来像画面被裁坏了。
 *
 * 改成由常量推导后，只要有人调整 rxSpan / cyStep，viewBox 会自动跟上。
 */
const rotationRadius =
  Math.max(Math.abs(GEO.cyBase - GEO.cx), Math.abs(GEO.cyBase + 2 * GEO.cyStep - GEO.cx)) +
  (GEO.rxMin + GEO.rxSpan);

/** viewBox 四周留的余量（容纳 non-scaling-stroke 的描边宽度）。 */
const VIEW_PAD = 2;

const VIEW_R = rotationRadius + VIEW_PAD;

/**
 * 正方形 viewBox —— 必须是正方形。
 *
 * `preserveAspectRatio="xMidYMid slice"` 在对局页是有意为之（那是个
 * 全幅背景，容器不是正方形，靠 slice 裁成满屏）。但首页的容器是
 * `aspect-square`，只有 viewBox 也是正方形时才不会被 slice 二次裁剪。
 */
const VIEWBOX = `${GEO.cx - VIEW_R} ${GEO.cx - VIEW_R} ${VIEW_R * 2} ${VIEW_R * 2}`;

/** 一条轨道：整条闭合椭圆，1 条 path。 */
function orbitPath(index: number, total: number): string {
  const spread = total <= 1 ? 0 : index / (total - 1);
  const cx = GEO.cx;
  const cy = GEO.cyBase + (index % 3) * GEO.cyStep;
  const rx = GEO.rxMin + spread * GEO.rxSpan;
  const ry = GEO.ryMin + spread * GEO.rySpan;
  const rotation = GEO.rotMin + index * GEO.rotStep;
  return [
    `M ${cx - rx} ${cy}`,
    `A ${rx} ${ry} ${rotation} 0 1 ${cx + rx} ${cy}`,
    `A ${rx} ${ry} ${rotation} 0 1 ${cx - rx} ${cy}`,
  ].join(' ');
}

function accentOf(index: number, total: number, accent: OrbitAccent): 'zhihu' | 'path' | 'counter' {
  if (accent === 'counter') {
    return 'counter';
  }
  if (accent === 'mixed') {
    // 第三幕：每隔两条插入一条琥珀反例轨道，其余仍是主路径
    return index % 3 === 2 ? 'counter' : 'path';
  }
  return index % 4 === 0 ? 'zhihu' : 'path';
}

const STROKE_OF: Readonly<Record<'zhihu' | 'path' | 'counter', string>> = {
  zhihu: 'var(--sil-zhihu)',
  path: 'var(--sil-alternate)',
  counter: 'var(--sil-counter)',
};

export function OrbitField({
  count = ORBIT_DESKTOP_MAX,
  accent = 'path',
  near = false,
  className = '',
  drift = true,
}: OrbitFieldProps) {
  const compact = useCompactViewport();
  const ceiling = compact ? ORBIT_COMPACT_MAX : ORBIT_DESKTOP_MAX;
  const total = Math.max(0, Math.min(ceiling, Math.floor(count)));
  const orbits = Array.from({ length: total }, (_, index) => {
    const spread = total <= 1 ? 1 : index / (total - 1);
    return {
      index,
      d: orbitPath(index, total),
      // §12：opacity 严格落在 0.08 ~ 0.32
      opacity: Number((0.08 + spread * 0.24).toFixed(3)),
      // §12：stroke 严格落在 0.5 ~ 1.25
      width: Number((0.5 + spread * 0.75).toFixed(2)),
      tone: accentOf(index, total, accent),
    };
  });

  return (
    <div
      aria-hidden="true"
      className={['sil-orbit', near ? 'sil-orbit--near' : '', className].filter(Boolean).join(' ')}
    >
      <svg
        viewBox={VIEWBOX}
        preserveAspectRatio="xMidYMid slice"
        className="sil-orbit__svg"
      >
        <g className={drift ? 'sil-orbit__drift' : undefined}>
          {orbits.map((orbit) => (
            <path
              key={orbit.index}
              d={orbit.d}
              // viewBox 只有 100×100，会被拉伸到整个视口：不加 non-scaling-stroke
              // 时 strokeWidth 会被放大十几倍，变成「土星环」而不是人生轨道（§12）。
              vectorEffect="non-scaling-stroke"
              className={[
                'sil-orbit__path',
                orbit.tone === 'counter' ? 'sil-orbit__path--counter' : '',
                // §14：只有「附近」的轨道参与变亮
                orbit.index % 3 === 0 ? 'sil-orbit__path--near' : 'sil-orbit__path--far',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                stroke: STROKE_OF[orbit.tone],
                strokeWidth: orbit.width,
                opacity: orbit.opacity,
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

export default OrbitField;
