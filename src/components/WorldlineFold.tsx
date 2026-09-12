'use client';

import * as React from 'react';

import type { GhostLine } from '@/core/run/scenarioCompiler';

/**
 * 世界线折叠仪（V3 唯一新增的强视觉符号）。
 *
 * 玩家每做出一次选择，屏幕短暂展示「收束」：**走的那条**实线点亮，
 * **没走的那条**以虚线、模糊轮廓留在旁边 —— 只给标签，不给结果。
 * 这是整款产品对「平行宇宙」最直接的一次可视化：你不是没得选，你是选了其中之一。
 *
 * 设计约束（对齐 DESIGN.md）：
 * - 不引入第二套动画语言：只用既有的 `animate-rise-in`，并对 reduced motion 关闭位移。
 * - 不显示后台数值：幽灵线只有文案与模糊标记。
 * - 375px 不横向溢出：整体 flex-wrap，标签 `truncate`。
 */

export interface WorldlineFoldProps {
  /** 第几幕（1-4），用于标题。 */
  readonly act: number;
  readonly chosen: { readonly id: string; readonly text: string };
  readonly ghosts: readonly GhostLine[];
  readonly className?: string;
}

export function WorldlineFold({ act, chosen, ghosts, className }: WorldlineFoldProps) {
  if (ghosts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={`第 ${act} 幕世界线折叠`}
      className={[
        'animate-rise-in motion-reduce:animate-none rounded-2xl border border-white/10 bg-ink-900/60 p-2.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="font-mono text-[9px] tracking-[0.3em] text-slate-500">
        WORLDLINE FOLD · 第 {act} 幕
      </p>

      {/* 走过的线：实心、点亮 */}
      <div className="mt-1.5 flex items-start gap-2">
        <span aria-hidden="true" className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-zhihu-400" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{chosen.text}</p>
      </div>

      {/* 未走的线：虚线 + 模糊轮廓，绝不展开结果 */}
      <ul className="mt-1.5 space-y-1">
        {ghosts.map((ghost) => (
          <li key={ghost.id} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-[7px] h-px w-2 shrink-0 border-t border-dashed border-slate-600"
            />
            <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500 blur-[0.4px]">
              {ghost.label}
            </p>
            <span className="shrink-0 font-mono text-[9px] text-slate-600">未展开</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default WorldlineFold;
