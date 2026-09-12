'use client';

import * as React from 'react';
import Link from 'next/link';

import { NeuralLoader } from '@/components/effects/NeuralLoader';
import { WorldlinePierce } from '@/components/worldline/Worldline';
import {
  fetchCommitments,
  removeCommitmentById,
  submitReceipt,
  type CommitmentView,
} from '@/core/evidence/meshClient';

import type { CommitmentOutcome } from '@/types/evidence';

/**
 * 赛博契约页（方案 §7.2 · 冲刺蓝图 §4）。
 *
 * 这是「建议 → 数据」的转折点：产品在这里第一次**不是输出建议，
 * 而是回收结果**。回收到的完成率是唯一能自证有用的证据，
 * 也是答评委「有人用吗」时手里唯一拿得出的东西。
 *
 * 三条纪律：
 * 1. **不催不骗**：逾期只如实说「已经过了 N 天」，不制造愧疚感；
 * 2. **可以说没做到**：`missed` 与 `partial` 是一等公民，
 *    因为只有真话才能变成下一局的参数；
 * 3. **可以删**：不想要的承诺真删，不留痕。
 */

const OUTCOME_LABEL: Readonly<Record<CommitmentOutcome, { text: string; tone: string }>> = {
  done: { text: '做到了', tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' },
  partial: { text: '做了一部分', tone: 'border-amber-400/40 bg-amber-400/10 text-amber-200' },
  missed: { text: '没做成', tone: 'border-relic-danger/40 bg-relic-danger/10 text-rose-200' },
};

function daysLeft(dueAt: string): number {
  return Math.ceil((Date.parse(dueAt) - Date.now()) / 86_400_000);
}

function ReceiptForm({
  commitmentId,
  onDone,
}: {
  readonly commitmentId: string;
  readonly onDone: () => void;
}) {
  const [outcome, setOutcome] = React.useState<CommitmentOutcome>('done');
  const [note, setNote] = React.useState('');
  const [blocker, setBlocker] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await submitReceipt({ commitmentId, outcome, note, blocker });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold text-slate-300">结果怎么样？</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
        说真话才有用 —— 「没做成」会直接变成下一局的约束建议，比一个好看的完成率值钱。
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {(Object.keys(OUTCOME_LABEL) as CommitmentOutcome[]).map((key) => {
          const meta = OUTCOME_LABEL[key];
          const active = outcome === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setOutcome(key)}
              aria-pressed={active}
              className={[
                'rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all duration-150',
                active ? meta.tone : 'border-white/12 bg-white/[0.03] text-slate-400 hover:border-white/25',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60',
              ].join(' ')}
            >
              {meta.text}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={200}
        placeholder="一句话说明（可选）"
        className="field mt-2.5 text-xs"
      />

      {outcome !== 'done' ? (
        <input
          type="text"
          value={blocker}
          onChange={(event) => setBlocker(event.target.value)}
          maxLength={80}
          placeholder="卡在哪了？（会变成下一局的约束建议）"
          className="field mt-2 text-xs"
        />
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="btn-primary mt-2.5 text-xs disabled:opacity-60"
      >
        {saving ? '正在记录…' : '提交回执'}
      </button>
    </div>
  );
}

function CommitmentRow({
  commitment,
  onChanged,
}: {
  readonly commitment: CommitmentView['commitments'][number];
  readonly onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = React.useState(false);
  const pending = commitment.status === 'committed';
  const left = daysLeft(commitment.dueAt);
  const overdue = left <= 0;

  return (
    <li
      className={[
        'rounded-2xl border bg-ink-800/60 p-4 transition-colors duration-200',
        pending && overdue ? 'border-relic-gold/40' : 'border-white/12',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-slate-100">{commitment.action}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono">{commitment.timeBox}</span>
            <span className="text-slate-400">算成：{commitment.signal}</span>
          </p>
        </div>

        {pending ? (
          <span
            className={[
              'shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ring-1 ring-inset',
              overdue
                ? 'bg-relic-gold/15 text-amber-200 ring-relic-gold/35'
                : 'bg-white/[0.05] text-slate-400 ring-white/12',
            ].join(' ')}
          >
            {overdue ? (left === 0 ? '今天到期' : `已过 ${Math.abs(left)} 天`) : `还有 ${left} 天`}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-slate-400 ring-1 ring-inset ring-white/12">
            {commitment.receipt ? OUTCOME_LABEL[commitment.receipt.outcome].text : '已回执'}
          </span>
        )}
      </div>

      {commitment.receipt ? (
        <div className="mt-2.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
          <p className="text-[11px] text-slate-300">
            回执：{OUTCOME_LABEL[commitment.receipt.outcome].text}
            {commitment.receipt.note ? ` · ${commitment.receipt.note}` : ''}
          </p>
          {commitment.receipt.blocker ? (
            <p className="mt-1 text-[10px] text-amber-200/90">
              卡点：{commitment.receipt.blocker}（下一局会把「可投入月数」算得更保守）
            </p>
          ) : null}
          <p className="mt-1 font-mono text-[9px] text-slate-600">
            {commitment.receipt.reportedAt.slice(0, 10)}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pending ? (
          <button
            type="button"
            onClick={() => setFormOpen((value) => !value)}
            className="rounded-lg border border-zhihu-500/40 bg-zhihu-500/10 px-3 py-1.5 text-[11px] font-semibold text-zhihu-200 transition-colors duration-150 hover:bg-zhihu-500/20"
            aria-expanded={formOpen}
          >
            {formOpen ? '收起' : '填回执'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            void removeCommitmentById(commitment.commitmentId).then(onChanged);
          }}
          className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-500 transition-colors duration-150 hover:border-relic-danger/40 hover:text-rose-300"
        >
          删除
        </button>
      </div>

      {formOpen && pending ? (
        <ReceiptForm commitmentId={commitment.commitmentId} onDone={onChanged} />
      ) : null}
    </li>
  );
}

function ContractScreen() {
  const [view, setView] = React.useState<CommitmentView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchCommitments({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      setView(result);
      setLoading(false);
    });
    return () => controller.abort();
  }, [reloadKey]);

  const pending = view?.commitments.filter((item) => item.status === 'committed') ?? [];
  const resolved = view?.commitments.filter((item) => item.status !== 'committed') ?? [];
  const doneCount = view?.commitments.filter((item) => item.status === 'done').length ?? 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[820px] flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">赛博契约</p>
          <h1 className="mt-1 text-lg font-bold text-slate-100 sm:text-xl">你认下的事，和它们的结果</h1>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
            这个产品不假装能给你答案。它只做一件事：把你认下的动作记下来，
            到期回来问结果，再把结果变成下一局的参数。
          </p>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          返回发令台
        </Link>
      </header>

      {/*
        v3 §9.4：世界线延伸到「现实」。
        这条线是全站唯一一处置为**穿过第四面墙**的世界线 ——
        它表达「这一局的结果会走出游戏，变成七天后要回收的一件事」。
      */}
      <WorldlinePierce
        state={view && view.resolvedCount > 0 ? 'stable' : 'unstable'}
        realityLabel="七天现实实验"
        className="rounded-2xl border border-white/10 bg-ink-800/40 px-4 pb-4 pt-2"
      />

      {loading ? <NeuralLoader hint="正在读回你的契约" /> : null}

      {!loading && view && !view.authenticated ? (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-slate-200">还没有登录</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            承诺会绑定你的知乎账号 —— 换设备也能看到，但只有登录之后才存在的契约。
            未登录时认下的动作不会被记住，也不会有人来问你。
          </p>
          <Link href="/oauth" className="btn-primary mt-4 inline-flex text-xs">
            去接入知乎账号
          </Link>
        </section>
      ) : null}

      {!loading && view?.authenticated ? (
        <>
          <section className="grid grid-cols-3 gap-3">
            <div className="panel px-3.5 py-3">
              <p className="font-mono text-[10px] text-slate-600">待回收</p>
              <p className="mt-1 font-mono text-xl font-bold text-slate-100">{pending.length}</p>
            </div>
            <div className="panel px-3.5 py-3">
              <p className="font-mono text-[10px] text-slate-600">已回执</p>
              <p className="mt-1 font-mono text-xl font-bold text-slate-100">{resolved.length}</p>
            </div>
            <div className="panel px-3.5 py-3">
              <p className="font-mono text-[10px] text-slate-600">做到</p>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-300">{doneCount}</p>
            </div>
          </section>

          {view.hint ? (
            <p className="rounded-2xl border border-zhihu-500/30 bg-zhihu-500/[0.08] px-4 py-3 text-[11px] leading-relaxed text-zhihu-100">
              下一局它会这样问你：{view.hint}
            </p>
          ) : null}

          <section>
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-slate-400">待回收</h2>
            {pending.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] text-slate-500">
                没有待回收的承诺。去推演一局，最后认下一条。
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pending.map((item) => (
                  <CommitmentRow key={item.commitmentId} commitment={item} onChanged={() => setReloadKey((k) => k + 1)} />
                ))}
              </ul>
            )}
          </section>

          {resolved.length > 0 ? (
            <section>
              <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-slate-400">已回执</h2>
              <ul className="flex flex-col gap-3">
                {resolved.map((item) => (
                  <CommitmentRow key={item.commitmentId} commitment={item} onChanged={() => setReloadKey((k) => k + 1)} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

export default function CommitmentPage() {
  return <ContractScreen />;
}
