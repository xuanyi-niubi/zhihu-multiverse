'use client';

import * as React from 'react';

import { clarityVerdict } from '@/core/decision/clarity';

import type { ClarityScore } from '@/types/evidence';

/**
 * 四维结算雷达（方案 §9）。
 *
 * 判定标准重构的可见部分：**赢 ≠ 走完四幕**。
 * 四个维度都回答一个「你知不知道自己处在什么位置」的问题，
 * 因此这里刻意不叫「得分」，也不给星级 —— 它是一份能力画像，不是奖状。
 *
 * 视觉纪律（沿用 `DESIGN.md`）：中文衬线体承担结语、等宽字体承担维度名、
 * 不用 Emoji、不出裸分数恐吓。
 */

export interface ClarityRadarProps {
  readonly score: ClarityScore;
  readonly className?: string;
}

interface Dimension {
  readonly key: keyof Omit<ClarityScore, 'total'>;
  readonly label: string;
  readonly question: string;
}

const DIMENSIONS: readonly Dimension[] = [
  { key: 'clarity', label: '清晰度', question: '你知不知道自己在哪条轴上最紧' },
  { key: 'evidenceCoverage', label: '证据覆盖', question: '你考虑的路里有多少是有据可依的' },
  { key: 'costAwareness', label: '代价认知', question: '你对要付出多少时间的预判准不准' },
  { key: 'reversibility', label: '可逆性管理', question: '你有没有给自己留退路' },
];

/** 四维落在四个象限上；半径按分值缩放。 */
function polar(index: number, value: number): { readonly x: number; readonly y: number } {
  const angle = (Math.PI * 2 * index) / DIMENSIONS.length - Math.PI / 2;
  const radius = (Math.max(0, Math.min(100, value)) / 100) * 46;
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
}

export function ClarityRadar({ score, className = '' }: ClarityRadarProps) {
  const points = DIMENSIONS.map((dimension, index) => polar(index, score[dimension.key]));
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <section
      aria-label="四维结算"
      className={`rounded-2xl border border-white/12 bg-ink-800/60 p-4 backdrop-blur-sm ${className}`}
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold tracking-wide text-slate-200">这一局你带走了什么</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          结算的不是「走了几幕」，而是你对这个决定的理解深度。
        </p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <svg viewBox="0 0 100 100" className="mx-auto h-44 w-44 shrink-0" role="img" aria-label="四维雷达图">
          {rings.map((ring) => (
            <polygon
              key={ring}
              points={DIMENSIONS.map((_, index) => {
                const point = polar(index, ring * 100);
                return `${point.x},${point.y}`;
              }).join(' ')}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="0.6"
            />
          ))}

          {DIMENSIONS.map((dimension, index) => {
            const outer = polar(index, 100);
            return (
              <line
                key={dimension.key}
                x1="50"
                y1="50"
                x2={outer.x}
                y2={outer.y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="0.6"
              />
            );
          })}

          <polygon
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="rgba(0,132,255,0.22)"
            stroke="rgba(61,155,255,0.9)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />

          {points.map((point, index) => (
            <circle key={DIMENSIONS[index].key} cx={point.x} cy={point.y} r="1.8" fill="#CFE8FF" />
          ))}
        </svg>

        <ul className="flex min-w-0 flex-1 flex-col gap-2">
          {DIMENSIONS.map((dimension) => {
            const value = score[dimension.key];
            const tone = value >= 70 ? 'text-emerald-300' : value >= 40 ? 'text-amber-300' : 'text-rose-300';
            const bar = value >= 70 ? 'from-emerald-400 to-emerald-300' : value >= 40 ? 'from-amber-400 to-amber-300' : 'from-relic-danger to-rose-400';

            return (
              <li key={dimension.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{dimension.label}</span>
                  <span className={`font-mono text-[10px] ${tone}`}>{value}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${bar} transition-[width] duration-500 ease-out`}
                    style={{ width: `${Math.max(2, value)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-slate-600">{dimension.question}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-3.5 border-t border-white/8 pt-3 text-sm leading-relaxed text-slate-300">
        {clarityVerdict(score)}
      </p>
    </section>
  );
}

export default ClarityRadar;
