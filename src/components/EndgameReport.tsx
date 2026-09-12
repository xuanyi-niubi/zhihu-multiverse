'use client';

import * as React from 'react';

/**
 * 终局《专属避坑指南》卡片。
 *
 * 由 `/api/report` 生成：模型读取玩家的处境档案 + 本局真实选择后写一段复盘，
 * 模型不可用时回落到确定性模板，因此这张卡片永远有内容。
 */

export interface EndgameReportProps {
  readonly text: string | null;
  readonly loading: boolean;
  /** 报告来源，用于小字标注。 */
  readonly source?: 'model' | 'fallback' | null;
  readonly className?: string;
}

const SKELETON_LINES = ['w-11/12', 'w-full', 'w-10/12', 'w-8/12'];

export function EndgameReport({ text, loading, source = null, className }: EndgameReportProps) {
  if (!loading && !text) {
    return null;
  }

  return (
    <section
      className={[
        'panel relative mt-4 overflow-hidden p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-live="polite"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-radial-halo opacity-40" />

      <header className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-zhihu-500" />
          <h3 className="text-sm font-semibold text-white">专属避坑指南</h3>
        </div>

        {source ? (
          <span
            className={
              source === 'model'
                ? 'chip-zhihu'
                : 'rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-400'
            }
          >
            {source === 'model' ? '知乎直答生成' : '离线模板'}
          </span>
        ) : null}
      </header>

      {loading ? (
        <div className="relative mt-4 space-y-2.5">
          <p className="font-mono text-[11px] text-zhihu-300">正在根据你走过的岔路撰写复盘…</p>
          {SKELETON_LINES.map((width) => (
            <span
              key={width}
              className={`block h-3 animate-pulse rounded bg-white/[0.07] ${width}`}
            />
          ))}
        </div>
      ) : (
        <div className="gmv-narrative relative mt-3 whitespace-pre-line text-slate-200">
          {text}
        </div>
      )}
    </section>
  );
}

export default EndgameReport;
