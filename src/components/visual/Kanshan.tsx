'use client';

import * as React from 'react';

/**
 * 刘看山 · 观象厅版（04_AGENT §33）。
 *
 * ## 为什么不用现成的 GIF
 *
 * §33 写得很清楚：
 *
 * ```text
 * 不常驻。
 * 三次出现时：小型投影 / 图章式存在。不要占屏幕 30%。
 * 已有 GIF 可以谨慎使用，但如果 GIF 美术和新风格冲突：
 *   宁愿用极简静态 silhouette。
 * ```
 *
 * 官方 GIF 是「白色 3D 黏土北极狐 + 红围巾」的可爱立体风格，和「未来天文仪器 /
 * 低饱和金属 / 透明观测玻璃」放在一起会立刻掉档次 —— 所以这里用**同一只狐狸的
 * 极简发丝线剪影**，并且融进三种观象厅里本来就存在的东西：
 *
 * ```text
 * constellation  天空里的一个星座（首页背景，极淡，融进仪器）
 * projection     观测台上的一个小型全息投影（会话页 / 第三幕反例）
 * stamp          终局盖在票据上的一枚图章（不常驻，出场即收）
 * ```
 *
 * 三种形态都只用 SVG 描边 + 一个柔光底座：没有 new keyframes（底座呼吸用既有的
 * `signal-pulse`），没有图片资源，没有网络请求（§7）。
 */

export type KanshanTone = 'path' | 'zhihu' | 'counter' | 'end';

export type KanshanVariant = 'constellation' | 'projection' | 'stamp';

export interface KanshanProps {
  readonly variant?: KanshanVariant;
  readonly tone?: KanshanTone;
  /** 边长（px）。投影 44~64、图章 48~72、星座可以更大。 */
  readonly size?: number;
  /** 无障碍：默认对读屏隐藏；传 label 时作为有意义的装饰暴露一次。 */
  readonly label?: string;
  readonly className?: string;
}

const TONE_VAR: Readonly<Record<KanshanTone, string>> = {
  path: '--sil-alternate',
  zhihu: '--sil-zhihu',
  counter: '--sil-counter',
  end: '--sil-counter',
};

const TONE_SOFT_VAR: Readonly<Record<KanshanTone, string>> = {
  path: '--sil-alternate-soft',
  zhihu: '--sil-zhihu-soft',
  counter: '--sil-counter-soft',
  end: '--sil-counter',
};

/** 剪影的几何：一只坐着的北极狐。所有形态共用，只是描边/节点不同。 */
const FOX_PATHS: readonly string[] = [
  // 左耳
  'M32 34 L27 14 L44 27',
  // 右耳
  'M64 34 L69 14 L52 27',
  // 头
  'M32 34 C32 46 39 52 48 52 C57 52 64 46 64 34 C64 25 57 20 48 20 C39 20 32 25 32 34 Z',
  // 坐着的身体
  'M36 52 C29 61 28 75 34 85 L62 85 C68 75 67 61 60 52',
  // 卷起来的尾巴
  'M62 81 C74 81 82 72 77 63 C74 57 67 57 65 62',
];

/** 围巾（刘看山的标志）单独一组：星座形态不画它，否则像一团噪点。 */
const SCARF_PATHS: readonly string[] = ['M34 50 C41 55 55 55 62 50', 'M57 53 L60 64'];

/** 星座形态的节点：耳朵尖 / 头顶 / 身体 / 尾尖。 */
const CONSTELLATION_NODES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 27, y: 14 },
  { x: 69, y: 14 },
  { x: 48, y: 20 },
  { x: 34, y: 85 },
  { x: 77, y: 63 },
];

const CONSTELLATION_LINKS: readonly string[] = [
  'M27 14 L48 20 L69 14',
  'M34 85 L44 60',
];

export function Kanshan({
  variant = 'projection',
  tone = 'path',
  size = 56,
  label,
  className = '',
}: KanshanProps) {
  const edge = `var(${TONE_VAR[tone]})`;
  const soft = `var(${TONE_SOFT_VAR[tone]})`;
  const dimension = Math.max(32, Math.min(220, size));
  const dashed = variant === 'constellation';

  return (
    <span
      className={['sil-guide', `sil-guide--${variant}`, className].filter(Boolean).join(' ')}
      style={{ width: dimension, height: dimension }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {variant === 'projection' ? (
        <>
          <span aria-hidden="true" className="sil-guide__cone" />
          <span aria-hidden="true" className="sil-guide__pad" />
        </>
      ) : null}

      <svg viewBox="0 0 96 96" className="sil-guide__svg" style={{ width: '100%', height: '100%' }}>
        {/* 底座准线：小型投影站在一条刻度线上 */}
        {variant === 'projection' ? (
          <line
            x1={14}
            y1={88}
            x2={82}
            y2={88}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: soft, opacity: 0.45 }}
            strokeWidth={1}
          />
        ) : null}

        {FOX_PATHS.map((d, index) => (
          <path
            key={`fox-${index}`}
            d={d}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={dashed ? '3 5' : undefined}
            style={{ stroke: edge, opacity: dashed ? 0.5 : 0.92 }}
            strokeWidth={variant === 'stamp' ? 1.5 : 1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* 围巾只出现在投影与图章上 */}
        {dashed
          ? null
          : SCARF_PATHS.map((d, index) => (
              <path
                key={`scarf-${index}`}
                d={d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: soft, opacity: 0.95 }}
                strokeWidth={variant === 'stamp' ? 2 : 1.8}
                strokeLinecap="round"
              />
            ))}

        {/* 眼睛：只留两点，剪影立刻有表情 */}
        <circle cx={41} cy={34} r={1.5} style={{ fill: edge, opacity: 0.85 }} />
        <circle cx={55} cy={34} r={1.5} style={{ fill: edge, opacity: 0.85 }} />

        {dashed ? (
          <>
            {CONSTELLATION_LINKS.map((d, index) => (
              <path
                key={`link-${index}`}
                d={d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: soft, opacity: 0.28 }}
                strokeWidth={0.6}
              />
            ))}
            {CONSTELLATION_NODES.map((node) => (
              <circle
                key={`node-${node.x}-${node.y}`}
                cx={node.x}
                cy={node.y}
                r={1.1}
                style={{ fill: soft, opacity: 0.7 }}
              />
            ))}
          </>
        ) : null}
      </svg>
    </span>
  );
}

export default Kanshan;
