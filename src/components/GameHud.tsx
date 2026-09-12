'use client';

import * as React from 'react';

import type { TargetStat } from '@/types/game';

/**
 * 顶部 HUD。
 *
 * 与网页版「三栏仪表盘」的关键差异：属性以斜切血条呈现、受击时抖动、
 * 元信息（种子 / 来源）压到最右侧且字号最小——主视觉留给舞台。
 */

const STAT_META: Record<
  TargetStat,
  { label: string; short: string; bar: 'san' | 'skill' | 'bond'; text: string }
> = {
  san: { label: '心智 SAN', short: 'SAN', bar: 'san', text: 'text-emerald-300' },
  skill: { label: '专业力', short: 'SKILL', bar: 'skill', text: 'text-zhihu-300' },
  bond: { label: '社区羁绊', short: 'BOND', bar: 'bond', text: 'text-violet-300' },
};

function StatBar({
  stat,
  value,
  hitKey,
}: {
  readonly stat: TargetStat;
  readonly value: number;
  readonly hitKey: number;
}) {
  const meta = STAT_META[stat];
  const critical = stat === 'san' && value < 30;

  return (
    <div className="min-w-[96px] flex-1 sm:min-w-[132px]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.18em] text-slate-500">
          {meta.short}
        </span>
        <span
          className={[
            'font-mono text-sm font-bold tabular-nums transition-transform duration-200',
            meta.text,
            critical ? 'animate-pulse' : '',
          ].join(' ')}
        >
          {value}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={meta.label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className={['gmv-bar', `gmv-bar--${meta.bar}`, critical ? 'gmv-bar--critical' : ''].join(' ')}
      >
        <div
          key={hitKey}
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            // SAN 用「健康度」语义：绿 → 琥珀 → 红，而不是一条彩虹渐变
            ...(stat === 'san'
              ? {
                  background:
                    value >= 60
                      ? 'var(--gmv-jade-400)'
                      : value >= 30
                        ? 'var(--gmv-amber-400)'
                        : 'var(--gmv-rose-500)',
                }
              : {}),
          }}
          className={['gmv-bar__fill', hitKey > 0 ? 'animate-bar-hit' : ''].join(' ')}
        />
      </div>
    </div>
  );
}

export interface GameHudProps {
  readonly stats: { readonly san: number; readonly skill: number; readonly bond: number };
  readonly turnIndex: number;
  readonly totalTurns: number;
  readonly seed: string;
  readonly sceneName: string;
  readonly timeLabel: string;
  readonly dmSource?: 'model' | 'model-repaired' | 'fallback' | null;
  readonly equippedCount: number;
  readonly pendingCount: number;
  readonly hitKey: number;
  readonly onOpenFate: () => void;
  readonly onOpenInventory: () => void;
  /** 打开证据网格（只有拿到网格的局才会传；预置剧本不传）。 */
  readonly onOpenEvidence?: () => void;
  readonly onQuit: () => void;
}

function IconButton({
  label,
  onClick,
  children,
  badge,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-slate-300 transition-all duration-150 hover:border-zhihu-500/60 hover:text-white active:scale-95"
    >
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-relic-gold px-1 font-mono text-[9px] font-bold text-ink-900">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function GameHud({
  stats,
  turnIndex,
  totalTurns,
  seed,
  sceneName,
  timeLabel,
  dmSource = null,
  equippedCount,
  pendingCount,
  hitKey,
  onOpenFate,
  onOpenInventory,
  onOpenEvidence,
  onQuit,
}: GameHudProps) {
  return (
    <header className="hud-shell relative z-30 border-b border-white/10 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        {/* 左：退出 + 场景名 */}
        <div className="flex min-w-0 items-center gap-2.5">
          <IconButton label="返回命运发令台" onClick={onQuit}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>

          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-200">
              第 {turnIndex} / {totalTurns} 幕 · {sceneName}
            </p>
            <p className="truncate font-mono text-[10px] text-slate-500">{timeLabel}</p>
          </div>
        </div>

        {/* 中：三条血条 */}
        <div className="order-3 flex w-full items-center gap-3 sm:order-none sm:w-auto sm:flex-1">
          <StatBar stat="san" value={stats.san} hitKey={hitKey} />
          <StatBar stat="skill" value={stats.skill} hitKey={hitKey} />
          <StatBar stat="bond" value={stats.bond} hitKey={hitKey} />
        </div>

        {/* 右：抽屉入口 + 元信息 */}
        <div className="ml-auto flex items-center gap-2">
          {dmSource ? (
            <span
              className={
                dmSource === 'fallback'
                  ? 'hidden rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-400 sm:inline-flex'
                  : 'hidden rounded-full bg-relic-gold/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-relic-gold/30 sm:inline-flex'
              }
            >
              {dmSource === 'model' ? 'AI 生成' : dmSource === 'model-repaired' ? 'AI 修复' : '离线兜底'}
            </span>
          ) : null}

          <IconButton label="打开命途树" onClick={onOpenFate}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="6" cy="12" r="2.4" />
              <circle cx="17" cy="6" r="2.4" />
              <circle cx="17" cy="18" r="2.4" />
              <path d="M8.2 11l6.6-3.6M8.2 13l6.6 3.6" strokeLinecap="round" />
            </svg>
          </IconButton>

          {onOpenEvidence ? (
            <IconButton label="打开证据网格" onClick={onOpenEvidence}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M11 7.5v7M7.5 11h7" strokeLinecap="round" />
                <path d="M16 16l4 4" strokeLinecap="round" />
              </svg>
            </IconButton>
          ) : null}

          <IconButton label="打开遗物装备栏" onClick={onOpenInventory} badge={equippedCount}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="7" width="16" height="12" rx="2.5" />
              <path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7" strokeLinecap="round" />
            </svg>
          </IconButton>

          <span className="hidden font-mono text-[10px] text-slate-600 lg:inline">{seed}</span>
        </div>
      </div>

      {pendingCount > 0 ? (
        <div className="mx-auto w-full max-w-[1440px] px-3 pb-2 sm:px-5">
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1 text-[10px] text-amber-200">
            已激活 {pendingCount} 件主动遗物，下一次 D20 检定结算
          </p>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex h-[2px]" aria-hidden="true">
        {Array.from({ length: totalTurns }, (_, index) => (
          <span
            key={index}
            className={[
              'h-full flex-1 border-r border-black/70 transition-colors duration-300 last:border-r-0',
              index < turnIndex ? 'bg-zhihu-500' : 'bg-white/10',
            ].join(' ')}
          />
        ))}
      </div>
    </header>
  );
}

export default GameHud;
