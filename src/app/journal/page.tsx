'use client';

import * as React from 'react';
import Link from 'next/link';

/**
 * 选择日志（重构方案 §3.2 / §7.1）。
 *
 * > 历史记忆，改名为「选择日志」。
 *
 * ## 它回答四个问题
 *
 * 1. 我曾经纠结什么
 * 2. 我做了什么实验
 * 3. 得到了什么真实结果
 * 4. 现在的判断如何变化
 *
 * ## 与旧「命运档案馆」的区别
 *
 * 旧的是**战绩**（走了几幕、拿了几分、什么结局）；
 * 新的是**决策记录**（当时怎么想、做了什么、结果如何）。
 * 前者让人回味，后者让人复用 —— 而「真的帮到人」需要后者。
 */

interface JournalEntry {
  readonly id: string;
  readonly question: string;
  readonly status: string;
  readonly pathCount: number;
  readonly createdAt: string;
  readonly provenance: string;
  readonly experiment: { readonly action: string } | null;
  readonly followUp: {
    readonly dueAt: string;
    readonly answeredAt?: string;
    readonly outcome?: 'done' | 'partial' | 'changed-plan';
    readonly note?: string;
  } | null;
}

const OUTCOME_LABEL: Readonly<Record<NonNullable<JournalEntry['followUp']>['outcome'] & string, string>> = {
  done: '做到了',
  partial: '做了一部分',
  'changed-plan': '改了计划',
};

function dayOf(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  const date = new Date(parsed);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function JournalPage() {
  const [entries, setEntries] = React.useState<readonly JournalEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/sessions', { signal: controller.signal });
        const payload = (await response.json()) as { ok?: boolean; data?: { sessions?: JournalEntry[] } };
        if (controller.signal.aborted) {
          return;
        }
        setEntries(payload.ok ? (payload.data?.sessions ?? []) : []);
      } catch {
        if (!controller.signal.aborted) {
          setError('读取日志失败，请刷新重试。');
        }
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <main id="main-content" className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">选择日志</p>
          <h1 className="mt-1 text-lg font-bold text-slate-100">我曾经卡住的选择</h1>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          新的问题
        </Link>
      </header>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-200">
          {error}
        </p>
      ) : null}

      {entries === null && !error ? (
        <p className="mt-6 font-mono text-[11px] text-slate-500">正在读取…</p>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <section className="mt-6 panel p-5 text-center">
          <p className="text-[13px] font-semibold text-slate-200">还没有记录</p>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[12px] leading-relaxed text-slate-500">
            把你现在卡住的那个选择写下来，走一次完整流程，它就会出现在这里。
          </p>
          <Link href="/" className="btn-primary mt-4 inline-flex text-xs">
            去写下它
          </Link>
        </section>
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <ol className="mt-5 flex flex-col gap-2.5">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/session/${entry.id}`}
                className="block rounded-2xl border border-white/10 bg-ink-800/50 p-3.5 transition-colors duration-150 hover:border-zhihu-500/40"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] text-slate-500">{dayOf(entry.createdAt)}</span>
                  <span className="font-mono text-[10px] text-slate-600">
                    {entry.pathCount} 条路径
                  </span>
                </header>

                <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100">
                  {entry.question}
                </p>

                {entry.experiment ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                    <span className="font-mono text-slate-600">我做了：</span>
                    {entry.experiment.action.slice(0, 80)}
                    {entry.experiment.action.length > 80 ? '…' : ''}
                  </p>
                ) : null}

                {entry.followUp ? (
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    {entry.followUp.outcome ? (
                      <>
                        <span className="rounded-md border border-white/14 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                          {OUTCOME_LABEL[entry.followUp.outcome] ?? entry.followUp.outcome}
                        </span>
                        {entry.followUp.note ? (
                          <span className="text-slate-400">{entry.followUp.note}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="font-mono text-[10px] text-amber-200/90">
                        待回访 · {dayOf(entry.followUp.dueAt)}
                      </span>
                    )}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </main>
  );
}
