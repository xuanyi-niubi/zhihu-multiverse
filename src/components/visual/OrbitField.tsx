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

/** 一条轨道：整条闭合椭圆，1 条 path。 */
function orbitPath(index: number, total: number): string {
  const spread = total <= 1 ? 0 : index / (total - 1);
  const cx = 50;
  const cy = 46 + (index % 3) * 3;
  const rx = 30 + spread * 32;
  const ry = 9 + spread * 15;
  const rotation = -14 + index * 3.4;
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
  zhihu: 'var(--obs-zhihu)',
  path: 'var(--obs-path)',
  counter: 'var(--obs-counter)',
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
      className={['obs-orbit', near ? 'obs-orbit--near' : '', className].filter(Boolean).join(' ')}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="obs-orbit__svg">
        <g className={drift ? 'obs-orbit__drift' : undefined}>
          {orbits.map((orbit) => (
            <path
              key={orbit.index}
              d={orbit.d}
              // viewBox 只有 100×100，会被拉伸到整个视口：不加 non-scaling-stroke
              // 时 strokeWidth 会被放大十几倍，变成「土星环」而不是人生轨道（§12）。
              vectorEffect="non-scaling-stroke"
              className={[
                'obs-orbit__path',
                orbit.tone === 'counter' ? 'obs-orbit__path--amber' : '',
                // §14：只有「附近」的轨道参与变亮
                orbit.index % 3 === 0 ? 'obs-orbit__path--near' : 'obs-orbit__path--far',
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
