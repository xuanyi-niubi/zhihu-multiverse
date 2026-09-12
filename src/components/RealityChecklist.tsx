'use client';

import * as React from 'react';

import type { ChecklistItem } from '@/features/run/realityChecklist';

/**
 * 《现实破壁清单》面板。
 *
 * 终局的最后一件实事：把这一局的代价换成几条今天就能做的动作。
 *
 * **来源必须分清**：绑到站内真实来源的条目给出答主与链接；
 * 绑不上的明标「剧本模拟建议」——绝不能让玩家以为那是知乎某位答主说的。
 */

export interface RealityChecklistProps {
  readonly items: readonly ChecklistItem[];
  readonly hash: string;
  readonly className?: string;
}

function SourceLine({ item }: { readonly item: ChecklistItem }) {
  if (item.sourceStatus === 'verified' && item.sourceUrl) {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
        <span className="rounded border border-emerald-400/40 px-1 py-px font-mono text-[9px] text-emerald-300">
          站内来源
        </span>
        {item.sourceAuthor ? <span>@{item.sourceAuthor}</span> : null}
        {typeof item.sourceUpvotes === 'number' ? <span>赞同 {item.sourceUpvotes}</span> : null}
        {item.sourceRetrievedAt ? <span className="text-slate-500">抓取于 {item.sourceRetrievedAt.slice(0, 10)}</span> : null}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-zhihu-300 underline decoration-dotted hover:text-zhihu-200"
        >
          打开原回答 ↗
        </a>
      </p>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
      <span className="rounded border border-white/12 px-1 py-px font-mono text-[9px]">剧本模拟建议</span>
      <span>未绑定站内来源，请当作推演剧本的建议而非真实答主观点</span>
    </p>
  );
}

export function RealityChecklist({ items, hash, className }: RealityChecklistProps) {
  if (items.length === 0) {
    return null;
  }

  const verified = items.filter((item) => item.sourceStatus === 'verified').length;

  return (
    <section
      aria-label="现实破壁清单"
      className={['rounded-3xl border border-white/12 bg-ink-900/60 p-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.3em] text-zhihu-300">
          REALITY CHECKLIST · 现实破壁清单
        </h2>
        <span className="font-mono text-[9px] text-slate-600">#{hash.slice(0, 8)}</span>
      </header>

      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
        这几条不依赖运气：每条都有时间盒和可验证信号。
        {verified > 0
          ? `其中 ${verified} 条绑定了站内真实来源。`
          : '当前没有可绑定的站内来源，故全部标注为剧本模拟建议。'}
      </p>

      <ol className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-500">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-relaxed text-white">{item.action}</p>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-400">
                  <span className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[9px]">
                    {item.timeBox}
                  </span>
                  <span>算成：{item.verifySignal}</span>
                </p>

                {item.evidence ? (
                  <p className="mt-1.5 border-l-2 border-zhihu-500/50 pl-2 text-[10px] leading-relaxed text-slate-300">
                    「{item.evidence}」
                  </p>
                ) : null}

                <SourceLine item={item} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default RealityChecklist;
