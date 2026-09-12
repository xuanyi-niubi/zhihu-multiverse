'use client';

import * as React from 'react';

import { AXES } from '@/core/decision/axis';

import type { ConstraintProfile } from '@/types/evidence';

/**
 * 常驻四轴状态（v2 §5.3「右侧现实状态面板」/ §16 `AxisHUD`）。
 *
 * 为什么它必须常驻而不是藏在抽屉里：v2 §16 的验收标准要求
 * 「**30 秒理解四轴**」。四轴如果只在对比页出现，玩家就不知道
 * 自己在推演舱里被什么约束着 —— 而那正是本作与传统文字 AVG 的分野。
 *
 * 三条设计纪律（对齐 DESIGN.md）：
 * 1. **斜切血条**：沿用 HUD 已有的游戏感语言，不做 SaaS 进度条；
 * 2. **只给方向，不给 Excel**：轴值用「充裕 / 吃紧 / 见底」三档语义 + 条长表达；
 * 3. **越线才变红**：硬轴跌破需求刻度时整条转玫红 —— 这是 v2 §7「临界 BOSS」
 *    在常态下的一致视觉预兆，而不是等到 Boss 才第一次变色。
 */

export interface AxisHUDProps {
  readonly constraints: ConstraintProfile;
  /** 各轴最紧需求（来自证据网格）；有值时会画出需求刻度。 */
  readonly requirements?: Partial<Record<'runway' | 'drawdown' | 'reversibility' | 'ally', number>>;
  /** 余量提示（来自 actEngine，定性文案）。 */
  readonly pressureLabel?: string | null;
  readonly onOpenEvidence?: () => void;
  /** 紧凑模式用于 HUD 行内；默认竖排面板。 */
  readonly layout?: 'stack' | 'inline';
  readonly className?: string;
}

const PLAYER_KEYS: Readonly<Record<string, keyof ConstraintProfile>> = {
  runway: 'runwayMonths',
  drawdown: 'drawdown',
  reversibility: 'reversibility' as keyof ConstraintProfile,
  ally: 'ally',
};

/** 轴图标：内联 SVG（DESIGN.md 禁止 Emoji 当图标）。 */
const ICONS: Readonly<Record<string, React.ReactNode>> = {
  runway: (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" />
    </svg>
  ),
  drawdown: (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h16M4 16h10" strokeLinecap="round" />
      <path d="M15 13l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  reversibility: (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 7H16a4 4 0 010 8H8" strokeLinecap="round" />
      <path d="M11 12l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ally: (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="10" r="3" />
      <circle cx="16" cy="11" r="2.4" />
      <path d="M4 19c.8-3 2.6-4.4 5-4.4S13.2 16 14 19" strokeLinecap="round" />
    </svg>
  ),
};

function toneOf(percent: number, breached: boolean): { readonly bar: string; readonly text: string } {
  if (breached) {
    return { bar: 'from-relic-danger to-rose-400', text: 'text-rose-300' };
  }
  if (percent <= 25) {
    return { bar: 'from-amber-400 to-amber-300', text: 'text-amber-300' };
  }
  return { bar: 'from-zhihu-500 to-zhihu-300', text: 'text-zhihu-200' };
}

/** 三档定性语义：不给玩家看裸数字焦虑（数字仍在，但语气是定性的）。 */
function levelWord(percent: number, breached: boolean): string {
  if (breached) return '见底';
  if (percent <= 25) return '吃紧';
  if (percent <= 60) return '一般';
  return '充裕';
}

export function AxisHUD({
  constraints,
  requirements = {},
  pressureLabel = null,
  onOpenEvidence,
  layout = 'stack',
  className = '',
}: AxisHUDProps) {
  // 四轴全部展示：`reversibility` 由证据决定而非玩家自陈，
  // 但它同样是玩家必须看见的约束（v2 §6.3）
  const rows = AXES.filter((axis) => PLAYER_KEYS[axis.id] !== undefined).map((axis) => {
    const key = PLAYER_KEYS[axis.id];
    const value = constraints[key] as number;
    const requirement = requirements[axis.id as 'runway' | 'drawdown' | 'reversibility' | 'ally'];
    const span = Math.max(1, axis.max - axis.min);
    const percent = Math.min(100, Math.max(0, ((value - axis.min) / span) * 100));
    const breached = axis.hard && requirement !== undefined && value < requirement;
    const reqPercent =
      requirement === undefined ? null : Math.min(100, Math.max(0, ((requirement - axis.min) / span) * 100));

    return { axis, value, percent, breached, reqPercent, tone: toneOf(percent, breached) };
  });

  return (
    <section
      aria-label="现实状态四轴"
      className={[
        'rounded-2xl border border-white/12 bg-ink-800/60 backdrop-blur-sm',
        layout === 'inline' ? 'px-3 py-2' : 'px-3.5 py-3',
        className,
      ].join(' ')}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-300">现实状态</h3>
        {onOpenEvidence ? (
          <button
            type="button"
            onClick={onOpenEvidence}
            className="rounded-md border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400 transition-colors duration-150 hover:border-zhihu-500/50 hover:text-zhihu-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60"
          >
            为什么是这个数
          </button>
        ) : null}
      </header>

      <ul className="flex flex-col gap-2">
        {rows.map(({ axis, value, percent, breached, reqPercent, tone }) => (
          <li key={axis.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <span className={tone.text}>{ICONS[axis.id]}</span>
                {axis.label}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className={`font-mono text-[10px] ${tone.text}`}>
                  {levelWord(percent, breached)}
                </span>
                <span className="font-mono text-[11px] font-bold tabular-nums text-slate-200">
                  {value}
                </span>
              </span>
            </div>

            {/* 斜切轨道：游戏感来源，同时承载「需求刻度」与「越线」两个信息 */}
            <div className="relative mt-1 h-2.5 -skew-x-[14deg] overflow-hidden rounded-sm border border-white/8 bg-white/[0.05]">
              <div
                className={`h-full bg-gradient-to-r ${tone.bar} transition-[width] duration-500 ease-out`}
                style={{ width: `${Math.max(2, percent)}%` }}
              />
              {reqPercent !== null ? (
                <div
                  className="absolute top-0 h-full w-[2px] bg-amber-300/90"
                  style={{ left: `${reqPercent}%` }}
                  aria-hidden="true"
                  title={`这条路需要 ${axis.label} ≥ ${requirements[axis.id as 'runway' | 'drawdown' | 'reversibility' | 'ally']}`}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pressureLabel ? (
        <p className="mt-2 border-t border-white/8 pt-2 font-mono text-[10px] text-slate-500">
          {pressureLabel}
        </p>
      ) : null}
    </section>
  );
}

export default AxisHUD;
