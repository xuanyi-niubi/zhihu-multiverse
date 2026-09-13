'use client';

import * as React from 'react';

import type { RetrievalRun } from '@/features/decision-session/domain';

/**
 * 来源状态说明（重构方案 §5.3）。
 *
 * ## 它修的是一个具体的产品错误
 *
 * 旧版本在同一个面板上同时写着「落盘快照 · 12 条样本」和
 * 「本次没有可用的站内样本」—— 在用户眼里那就是产品错误（方案 §1.2 实测）。
 * 根因是 provenance 的内部细节被直接渲染，两处文案各说各话。
 *
 * ## 现在的规则
 *
 * | provenance | 文案 | 是否可点回原文 |
 * |---|---|---|
 * | `curated` | 演示案例的来源快照（已人工核验） | 可以 |
 * | `live` | 知乎实时检索 + 检索时间 | 可以 |
 * | `snapshot` | 知乎来源快照 | 可以 |
 * | `offline` | 当前没有可核对的来源 | 没有来源 |
 * | `deferred` | 检索还没开始（推迟到生成世界时） | 还没有来源 |
 *
 * **用快照时绝不说「没有样本」** —— 快照本身就是样本。
 * 同理，**推迟检索时绝不说「没有可核对的来源」** ——
 * 那是「查过了没有」，而这里只是「还没查」。两者混淆会让人
 * 以为证据真的不存在，从而低估这件事。
 */

const COPY: Readonly<Record<RetrievalRun['provenance'], { readonly label: string; readonly tone: string }>> = {
  curated: { label: '演示案例的来源快照', tone: 'border-zhihu-500/35 bg-zhihu-500/[0.07] text-zhihu-100' },
  live: { label: '知乎实时检索', tone: 'border-emerald-400/35 bg-emerald-400/[0.07] text-emerald-100' },
  snapshot: { label: '知乎来源快照', tone: 'border-zhihu-500/35 bg-zhihu-500/[0.07] text-zhihu-100' },
  offline: { label: '当前没有可核对的来源', tone: 'border-amber-400/35 bg-amber-400/[0.07] text-amber-100' },
  deferred: { label: '检索还没开始 · 生成世界时进行', tone: 'border-white/15 bg-white/[0.03] text-slate-300' },
};

export function ProvenanceNote({
  run,
  className = '',
}: {
  readonly run: RetrievalRun | null;
  readonly className?: string;
}) {
  if (!run) {
    return null;
  }

  const copy = COPY[run.provenance];
  const when = (() => {
    const parsed = Date.parse(run.retrievedAt);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const date = new Date(parsed);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();

  return (
    <aside className={`rounded-2xl border px-3.5 py-2.5 ${copy.tone} ${className}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px]">
        <span className="font-semibold">{copy.label}</span>
        {when ? <span className="opacity-70">· {when}</span> : null}
        <span className="opacity-70">· 来源 {run.sourceCount} 条</span>
        <span className="opacity-70">· 可用事实 {run.factCount} 条</span>
        {run.filteredCount > 0 ? <span className="opacity-70">· 已过滤 {run.filteredCount} 条</span> : null}
      </p>

      {run.notes.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {run.notes.map((note) => (
            <li key={note} className="text-[11px] leading-relaxed opacity-80">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

export default ProvenanceNote;
