'use client';

import * as React from 'react';

import type { ArchivePhase, FragmentTrack } from '@/features/visual/archive';

/**
 * World Compile Scene —— 世界正在被汇编（报告 §7 / §9 / §26.3）。
 *
 * ## 它只画真的发生了的事
 *
 * 三条轨道分别对应三类真实经历（与你相似 / 另一种走法 / 相反结果）。
 * `count === null` 表示**还在找**，此时画等待中的呼吸点；
 * 找到几条就画几个亮点 —— 不出现任何「假进度条」或百分比。
 *
 * ## 汇聚的隐喻
 *
 * 报告 §9：所有切片从四周进入三条轨道 → 亮点之间出现连接 →
 * 组成 Blueprint 图形 → **折叠成一个点** → WORLD READY。
 * 这里用一个汇点（hub）表达「这些人生被折叠进你的世界」。
 */

export interface WorldCompileTrack {
  readonly id: FragmentTrack;
  readonly label: string;
  /** 真实命中数；null = 还在找。 */
  readonly count: number | null;
}

export interface WorldCompileSceneProps {
  readonly tracks: readonly WorldCompileTrack[];
  readonly phase: ArchivePhase;
  readonly className?: string;
}

const MAX_DOTS = 6;

const TRACK_Y: Readonly<Record<FragmentTrack, number>> = {
  similar: 70,
  alternative: 160,
  counter: 250,
};

const TRACK_COLOR: Readonly<Record<FragmentTrack, string>> = {
  similar: '#3D9BFF',
  alternative: '#85C2FF',
  counter: '#C9A05A',
};

const HUB_X = 872;
const HUB_Y = 160;
const TRACK_START_X = 208;
const TRACK_END_X = 748;

export function WorldCompileScene({ tracks, phase, className = '' }: WorldCompileSceneProps) {
  const settled = phase === 'ready';
  const assembling = phase === 'assembling' || settled;

  return (
    <div className={['relative', className].filter(Boolean).join(' ')}>
      <svg
        viewBox="0 0 1000 320"
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="三条真实经历轨道正在汇聚成这一局的世界"
      >
        <defs>
          <radialGradient id="sil-hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(207,232,255,0.9)" />
            <stop offset="100%" stopColor="rgba(207,232,255,0)" />
          </radialGradient>
        </defs>

        {tracks.map((track) => {
          const y = TRACK_Y[track.id];
          const color = TRACK_COLOR[track.id];
          const count = track.count;
          const dots = count === null ? 3 : Math.min(MAX_DOTS, count);

          return (
            <g key={track.id}>
              {/* 轨道根线 */}
              <line
                x1={TRACK_START_X}
                y1={y}
                x2={TRACK_END_X}
                y2={y}
                stroke={color}
                strokeWidth="1"
                opacity={count === null ? 0.18 : 0.42}
              />

              {/* 轨道名 */}
              <text
                x={0}
                y={y + 5}
                fill={color}
                fontSize="21"
                fontFamily="ui-monospace, Consolas, monospace"
                letterSpacing="2"
                opacity={count === null ? 0.45 : 0.9}
              >
                {track.label}
              </text>

              {/* 命中数：真实数字，不是进度 */}
              <text
                x={TRACK_END_X + 18}
                y={y + 5}
                fill="rgba(145,160,183,0.85)"
                fontSize="17"
                fontFamily="ui-monospace, Consolas, monospace"
              >
                {count === null ? '…' : `${count}`}
              </text>

              {/* 亮点 / 等待点 */}
              {Array.from({ length: dots }, (_, index) => {
                const ratio = dots === 1 ? 0 : index / Math.max(1, dots - 1);
                const x = TRACK_START_X + ratio * (TRACK_END_X - TRACK_START_X);
                return (
                  <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r={count === null ? 2 : 4}
                    fill={color}
                    opacity={count === null ? 0.4 : 0.95}
                    style={{
                      transformBox: 'view-box',
                      transformOrigin: `${x}px ${y}px`,
                      animation:
                        count === null
                          ? 'sil-node-pulse 2.2s ease-in-out infinite'
                          : 'sil-node-pulse 3.4s ease-in-out infinite',
                      animationDelay: `${index * 220}ms`,
                    }}
                  />
                );
              })}

              {/* 汇聚连线：检索完成后才画 */}
              {assembling && count !== null && count > 0 ? (
                <path
                  d={`M ${TRACK_END_X} ${y} C ${TRACK_END_X + 46} ${y}, ${HUB_X - 44} ${HUB_Y}, ${HUB_X} ${HUB_Y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.2"
                  opacity="0.7"
                  pathLength={1}
                  strokeDasharray={1}
                  style={{
                    strokeDashoffset: 0,
                    animation: 'sil-link-draw 900ms var(--sil-ease) both',
                  }}
                />
              ) : null}
            </g>
          );
        })}

        {/* 汇点：这些人生被折叠进这一局 */}
        <circle cx={HUB_X} cy={HUB_Y} r={46} fill="url(#sil-hub-glow)" opacity={settled ? 0.5 : 0.24} />
        <circle
          cx={HUB_X}
          cy={HUB_Y}
          r={settled ? 7 : 5}
          fill="#CFE8FF"
          style={
            assembling
              ? { animation: 'sil-node-pulse 2.6s ease-in-out infinite' }
              : undefined
          }
        />
        {settled ? (
          <circle
            cx={HUB_X}
            cy={HUB_Y}
            r={18}
            fill="none"
            stroke="rgba(207,232,255,0.5)"
            strokeWidth="1"
            style={{ animation: 'sil-node-pulse 3.2s ease-in-out infinite' }}
          />
        ) : null}
      </svg>
    </div>
  );
}

export default WorldCompileScene;
