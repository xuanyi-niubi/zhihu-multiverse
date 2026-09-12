'use client';

import * as React from 'react';

import { getAxis } from '@/core/decision/axis';

import type { CriticalPoint } from '@/types/evidence';

/**
 * 临界点卡片（方案 §6.3 · 冲刺蓝图 §3「绝杀时刻」）。
 *
 * 这是整个产品最值钱的一个元素：它把「你失败了」翻译成
 * 「你哪个假设最脆弱、改哪个变量会让结论翻转」。
 *
 * 视觉上刻意做成**一次性的全屏级事件**：只有一条轴、一句话、
 * 一个被红线切开的缺口。信息密度极低，情绪冲击极高。
 *
 * 诚实性约束（写在组件里，避免以后被改成夸大宣传）：
 * 文案只陈述「差额」与「需要垫到多少」，**不承诺「调整后必然成功」** ——
 * 约束满足只代表这条路可以走，不代表结果一定好。
 */

export interface CriticalPointCardProps {
  readonly point: CriticalPoint;
  /** 路线标签，用于标题（`point` 里只有 pathId）。 */
  readonly pathLabel: string;
  /** 是否处于「全屏演出」形态（终局前 3 秒）。 */
  readonly spotlight?: boolean;
}

export function CriticalPointCard({ point, pathLabel, spotlight = false }: CriticalPointCardProps) {
  const axis = getAxis(point.axis);
  const breached = point.verdict.kind === 'breached';
  const span = Math.max(1, axis.max - axis.min);

  const currentPercent = Math.min(100, Math.max(0, ((point.current - axis.min) / span) * 100));
  const requiredPercent = Math.min(100, Math.max(0, ((point.required - axis.min) / span) * 100));
  const cutLeft = Math.min(currentPercent, requiredPercent);
  const cutWidth = Math.abs(requiredPercent - currentPercent);

  return (
    <section
      aria-label="临界点"
      className={[
        'relative overflow-hidden rounded-2xl border border-relic-danger/35 bg-ink-950/90 backdrop-blur-md',
        spotlight
          ? 'shadow-[0_0_60px_-12px_rgba(255,77,109,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]'
          : 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]',
      ].join(' ')}
    >
      {/* 左上角的一次性标记：让评委知道这是「结论翻转点」而不是普通提示 */}
      <div className="flex items-center justify-between gap-3 border-b border-relic-danger/25 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.22em] text-rose-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v10" strokeLinecap="round" />
            <circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none" />
          </svg>
          临界点
        </span>
        <span className="font-mono text-[10px] text-slate-500">{pathLabel}</span>
      </div>

      <div className="px-4 py-4">
        <p className="text-[11px] font-semibold tracking-wide text-slate-400">
          {breached ? '这条路唯一的硬伤' : '这条路最脆弱的假设'}
        </p>
        <p className="mt-1 text-base font-bold text-slate-100">{axis.label}</p>

        {/* 被切开的轴：缺口段用玫红，示意「差的就是这一段」 */}
        <div className="relative mt-4 h-8">
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-white/15" style={{ width: `${currentPercent}%` }} />
            <div
              className="absolute top-0 h-full bg-gradient-to-r from-relic-danger to-rose-400"
              style={{ left: `${cutLeft}%`, width: `${cutWidth}%` }}
            />
          </div>

          {/* 需求刻度 */}
          <div
            className="absolute top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(245,184,65,0.9)]"
            style={{ left: `${requiredPercent}%` }}
            aria-hidden="true"
          />

          <span
            className="absolute -translate-x-1/2 font-mono text-[10px] font-bold text-slate-200"
            style={{ left: `${currentPercent}%`, top: '-2px' }}
          >
            {point.current}
            <span className="font-normal text-slate-500">{axis.unit}</span>
          </span>
          <span
            className="absolute -translate-x-1/2 font-mono text-[10px] font-bold text-amber-300"
            style={{ left: `${requiredPercent}%`, bottom: '-2px' }}
          >
            需要 {point.required}
            {axis.unit}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-300">{point.narrative}</p>

        {/* 动作句：祈使句 + 一个量（与破壁清单同一口径） */}
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <span className="mt-0.5 font-mono text-[10px] font-bold text-amber-300">
            {breached ? '要翻转' : '要稳住'}
          </span>
          <p className="text-xs leading-relaxed text-slate-300">
            把「{axis.label}」从 {point.current}
            {axis.unit} 调到 {point.required}
            {axis.unit}（差 {Math.abs(point.delta)}
            {axis.unit}）。
            <span className="text-slate-500">
              {' '}
              满足约束只代表这条路走得通，不代表结果一定好 —— 它只是把「不可行」变成「可以试」。
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

export default CriticalPointCard;
