'use client';

import * as React from 'react';

/**
 * Counterline Reveal —— 第三幕反例分屏（报告 §20 / §21）。
 *
 * ## 为什么必须分屏、且只比三件事
 *
 * 反例的价值不是「另一个人更惨 / 更成功」，而是让玩家看见
 * **相同条件、不同条件、以及还不知道的事**这三类边界。
 * 报告 §21 明确禁止出现匹配度、百分比、评分 —— 所以这里只有三样：
 *
 * ```text
 * 相同 · 不同 · 未知
 * ```
 *
 * 「未知」是刻意的第三档：他的课程压力是不是和你一样，原文没说，
 * 就不能默认「一样」。这一条与产品「未知就是未知」的底层纪律同源。
 */

export type CounterlineKind = 'same' | 'different' | 'unknown';

export interface CounterlineRow {
  readonly kind: CounterlineKind;
  readonly text: string;
}

export interface CounterlineRevealProps {
  readonly active: boolean;
  /** 左：前一条经验。 */
  readonly previousLabel: string;
  /** 右：结果完全相反的那个人。 */
  readonly counterLabel: string;
  readonly rows: readonly CounterlineRow[];
  readonly className?: string;
}

const KIND_META: Readonly<Record<CounterlineKind, { readonly label: string; readonly className: string }>> = {
  same: { label: '相同', className: 'text-zhihu-300 border-zhihu-500/35 bg-zhihu-500/[0.06]' },
  different: { label: '不同', className: 'text-counter-soft border-counter/35 bg-counter/[0.06]' },
  unknown: { label: '未知', className: 'text-archive-400 border-white/12 bg-white/[0.02]' },
};

export function CounterlineReveal({
  active,
  previousLabel,
  counterLabel,
  rows,
  className = '',
}: CounterlineRevealProps) {
  if (!active) {
    return null;
  }

  return (
    <section
      className={['relative', className].filter(Boolean).join(' ')}
      aria-label="一条结果相反的经历进入了这一局"
    >
      {/* 反例从相反方向进入（报告 §20） */}
      <div className="relative flex items-center">
        <span aria-hidden="true" className="h-px flex-1 bg-white/[0.07]" />
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-counter/60"
          style={{ animation: 'arc-counter-in 760ms var(--arc-ease) both' }}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-0 sm:grid-cols-2">
        <div className="pr-0 sm:pr-4">
          <p className="font-mono text-[10px] tracking-[0.22em] text-archive-600">前一条经验</p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-archive-200">
            {previousLabel}
          </p>
        </div>
        <div
          className="mt-3 border-l-0 border-white/10 pl-0 sm:mt-0 sm:border-l sm:pl-4"
          style={{ animation: 'arc-counter-in 860ms var(--arc-ease) both', animationDelay: '120ms' }}
        >
          <p className="font-mono text-[10px] tracking-[0.22em] text-counter-deep">结果完全相反的人</p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-counter-soft">
            {counterLabel}
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((row, index) => {
            const meta = KIND_META[row.kind];
            return (
              <li
                key={`${row.kind}-${index}`}
                className="flex items-start gap-2.5"
                style={{ animation: 'arc-path-emerge 480ms var(--arc-ease) both', animationDelay: `${index * 120}ms` }}
              >
                <span
                  className={`mt-px shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider ${meta.className}`}
                >
                  {meta.label}
                </span>
                <span className="text-[12px] leading-relaxed text-archive-200">{row.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-archive-600">
        只比较这三件事 —— 不显示匹配度、百分比或评分。他的课程压力是否和你一样，
        原文没说，就是未知。
      </p>
    </section>
  );
}

export default CounterlineReveal;
