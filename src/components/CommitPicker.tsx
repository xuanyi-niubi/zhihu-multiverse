'use client';

import * as React from 'react';

/**
 * 承诺勾选（方案 §7.2 · 冲刺蓝图 §4「赛博契约」）。
 *
 * 这不是一个按钮，而是一次**可撤回的公开承诺**：勾下之后，
 * 七天后它会回来问结果，并把结果回灌下一局的约束建议。
 *
 * 三条交互纪律：
 * 1. **可以什么都不认**：不强迫玩家为了一次试玩背上责任，
 *    但会如实告诉他「这一局不会被记住」（沿用现有产品的损失感驱动策略）。
 * 2. **未登录是正常态**：提示「登录后才会提醒你」，而不是弹错误框。
 * 3. **可以删**：认下的每一条都能撤（真删），否则承诺变成负担。
 */

export interface CommitCandidate {
  readonly id: string;
  /** 祈使句动作。 */
  readonly action: string;
  readonly timeBox: string;
  /** 可验证信号。 */
  readonly signal: string;
  readonly verifyHint?: string;
  readonly pathId?: string | null;
}

export interface CommitPickerProps {
  readonly candidates: readonly CommitCandidate[];
  readonly authenticated: boolean;
  /** 已认下的候选 id → 到期时间。 */
  readonly committed: Readonly<Record<string, string>>;
  readonly onSubmit: (candidate: CommitCandidate) => void | Promise<void>;
  readonly onRemove?: (candidateId: string) => void | Promise<void>;
  readonly pendingId?: string | null;
  readonly className?: string;
}

function dueLabel(iso: string): string {
  const due = Date.parse(iso);
  if (!Number.isFinite(due)) {
    return '已排期';
  }
  const days = Math.max(0, Math.ceil((due - Date.now()) / 86_400_000));
  return days === 0 ? '今天到期' : `${days} 天后回访`;
}

export function CommitPicker({
  candidates,
  authenticated,
  committed,
  onSubmit,
  onRemove,
  pendingId = null,
  className = '',
}: CommitPickerProps) {
  const committedCount = Object.keys(committed).length;

  return (
    <section
      aria-label="赛博契约"
      className={`rounded-2xl border border-relic-gold/30 bg-ink-800/60 backdrop-blur-sm ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-relic-gold/20 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 12.5l2 2 4-4.5" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
            赛博契约
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            认下一条，七天后它会回来问结果 —— 结果会影响下一局的约束建议。
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-slate-500">
          已认下 {committedCount} / {candidates.length}
        </span>
      </header>

      {!authenticated ? (
        <p className="border-b border-white/8 px-4 py-2 text-[11px] text-amber-200/90">
          未登录：可以看，但认下之后**不会被记住**，七天后也不会有人来问你。
        </p>
      ) : null}

      <ul className="flex flex-col gap-2 p-3.5">
        {candidates.map((candidate) => {
          const dueAt = committed[candidate.id];
          const isCommitted = typeof dueAt === 'string';
          const busy = pendingId === candidate.id;

          return (
            <li
              key={candidate.id}
              className={[
                'rounded-xl border px-3 py-2.5 transition-colors duration-200',
                isCommitted ? 'border-emerald-400/35 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.02]',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={isCommitted}
                  onClick={() => {
                    if (isCommitted) {
                      void onRemove?.(candidate.id);
                      return;
                    }
                    void onSubmit(candidate);
                  }}
                  className={[
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150',
                    isCommitted
                      ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-200'
                      : 'border-white/25 bg-white/[0.04] text-transparent hover:border-zhihu-500/60',
                    busy ? 'opacity-50' : '',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60',
                  ].join(' ')}
                  aria-label={isCommitted ? `撤回：${candidate.action}` : `认下：${candidate.action}`}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-slate-100">{candidate.action}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                    <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono">{candidate.timeBox}</span>
                    <span className="text-slate-400">算成：{candidate.signal}</span>
                  </p>
                </div>

                {isCommitted ? (
                  <span className="shrink-0 rounded-full bg-emerald-400/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                    {dueLabel(dueAt)}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}

        {candidates.length === 0 ? (
          <li className="px-1 py-3 text-center text-[11px] text-slate-500">
            本局没有生成可认下的动作（判卷没有点出缺口）。这本身是一条信息：说明这一局的方案已经足够具体。
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export default CommitPicker;
