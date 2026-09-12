'use client';

import * as React from 'react';

/**
 * 人生裂缝卡片（v2 §5.1 首页「人生裂缝大厅」的入口）。
 *
 * 设计克制原则（用户明确要求「不要一股脑添加和拉长」）：
 * 一张卡只给三件事 —— **标题**、**这一局的抉择分野**、**它的证据来自多少条真实经历**。
 * 不放摘要、不放标签墙、不放两根按钮。点击即进入该裂缝。
 *
 * 为什么把「真实来源数」放在卡上而不是藏进详情页：
 * 它是这个作品与普通 AI 文字游戏的分界点 ——
 * 玩家在点进去之前就该知道「这一局不是编的」，而不是玩完才发现。
 */

export interface DemoCaseMeta {
  readonly caseId: string;
  readonly title: string;
  readonly goal: string;
  /** 世界线 A / B 的分野，例如「先补基础再参赛 vs 直接参赛边做边学」。 */
  readonly fork: string;
  /** 真实来源条数（分母必须可见）。 */
  readonly sources: number;
  readonly anchors: number;
}

export interface DemoCaseCardsProps {
  readonly cases: readonly DemoCaseMeta[];
  readonly onPick: (meta: DemoCaseMeta) => void;
  readonly loading?: boolean;
  readonly className?: string;
}

export function DemoCaseCards({ cases, onPick, loading = false, className = '' }: DemoCaseCardsProps) {
  if (loading) {
    return (
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${className}`}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-[104px] animate-pulse rounded-2xl border border-white/8 bg-white/[0.02]"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  // 没有真实样本的 Case 不渲染：宁可不给入口，也不做一个点进去空转的裂缝
  const usable = cases.filter((item) => item.sources > 0);
  if (usable.length === 0) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${className}`}>
      {usable.map((meta, index) => {
        const [left, right] = meta.fork.split(/\s+vs\s+/);
        return (
          <button
            key={meta.caseId}
            type="button"
            onClick={() => onPick(meta)}
            className="evidence-card group relative min-h-[136px] overflow-hidden rounded-xl border border-white/10 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-zhihu-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-mono text-[9px] tracking-[0.22em] text-zhihu-300/65">
                  ARCHIVE / {String(index + 1).padStart(2, '0')}
                </span>
                <span className="mt-1 block font-serif text-[16px] font-semibold text-slate-100 transition-colors group-hover:text-white">
                  {meta.title}
                </span>
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-xs text-slate-500 transition-colors group-hover:border-zhihu-500/45 group-hover:text-zhihu-300">
                ↗
              </span>
            </span>

            <span className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] leading-snug text-slate-400">
              <span>{left ?? meta.fork}</span>
              <span aria-hidden="true" className="font-mono text-[9px] text-slate-600">/</span>
              <span>{right ?? '另一条路'}</span>
            </span>

            <span className="absolute inset-x-3.5 bottom-3 flex items-center gap-1.5 border-t border-white/8 pt-2">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/80"
              />
              <span className="font-mono text-[9px] text-slate-500">
                {meta.sources} 条真实经历 · 可追溯
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default DemoCaseCards;
