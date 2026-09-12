'use client';

import * as React from 'react';
import Link from 'next/link';

import { NeuralLoader } from '@/components/effects/NeuralLoader';
import { WorldlinePierce, type WorldlineState } from '@/components/worldline/Worldline';

import type { Commitment } from '@/types/evidence';

/**
 * 命运档案馆（v3 §15 / §23 P2-6）。
 *
 * ## 这个页面存在的唯一理由
 *
 * v3 §15.2：
 *
 * > 让玩家理解：「我的过去，会影响我的未来。」
 *
 * 所以它**不是一个战绩列表**。列表回答「我玩过几局」，
 * 而档案馆要回答「上一局的我，怎样改变了这一局的我」。
 *
 * 因此页面只有两件事：
 * 1. **时间线**：把推演记录与承诺回执按时间交错排开（这是「过去」）；
 * 2. **回响**：把上一局留下的建议与约束，明确连到「这一局会怎么变」（这是「影响未来」）。
 *
 * ## 一条诚实性纪律
 *
 * 推演记录**只认知乎账号**（那是「你的宇宙记得你」的产品承诺），
 * 而承诺回执匿名身份也有。因此未登录时 runs 为空 ——
 * 界面必须如实说明「记录需要登录」，而不是装作你还没玩过。
 */

interface ArchiveRun {
  readonly goal: string;
  readonly originId: string;
  readonly lastAct: number;
  readonly status: 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED';
  readonly causeOfDeath: string;
  readonly finalWords: string;
  readonly personalityTags: readonly string[];
  readonly finishedAt: string;
}

interface ArchiveView {
  readonly authenticated: boolean;
  readonly totalRuns: number;
  readonly runs: readonly ArchiveRun[];
  readonly commitments: readonly Commitment[];
  readonly resolvedCount: number;
  readonly dueCount: number;
  readonly overdueDays: number;
  readonly hint: string | null;
}

const EMPTY: ArchiveView = {
  authenticated: false,
  totalRuns: 0,
  runs: [],
  commitments: [],
  resolvedCount: 0,
  dueCount: 0,
  overdueDays: 0,
  hint: null,
};

/** 时间线上的一个节点：推演 or 承诺。 */
type Node =
  | { readonly kind: 'run'; readonly at: string; readonly run: ArchiveRun }
  | { readonly kind: 'commitment'; readonly at: string; readonly commitment: Commitment };

function dayOf(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '时间未知';
  }
  const date = new Date(parsed);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function originLabel(originId: string): string {
  // 只做展示用映射，缺失时如实显示 id（不编一个更好听的名字）
  const labels: Record<string, string> = {
    assassin: '文科刺客',
    berserker: '工科狂战士',
    ranger: '保研边缘游侠',
  };
  return labels[originId] ?? originId;
}

/** 世界线状态：通关=成立，中断=断裂。**不用「成功/失败」二字**（§17.2 的语气纪律）。 */
function stateOf(run: ArchiveRun): WorldlineState {
  return run.status === 'OVER_SUCCESS' ? 'stable' : 'breached';
}

function RunNode({ run }: { readonly run: ArchiveRun }) {
  const state = stateOf(run);
  const tone =
    state === 'stable'
      ? { border: 'border-zhihu-500/35', text: 'text-zhihu-200', label: '世界线成立' }
      : { border: 'border-rose-500/35', text: 'text-rose-200', label: '世界线断裂' };

  return (
    <article className={`rounded-2xl border bg-ink-800/50 p-3.5 ${tone.border}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-[0.15em] text-slate-500">推演</span>
          <span className={`font-mono text-[11px] font-semibold ${tone.text}`}>{tone.label}</span>
        </span>
        <span className="font-mono text-[10px] text-slate-600">{dayOf(run.finishedAt)}</span>
      </header>

      <p className="mt-2 text-[13px] font-semibold leading-snug text-slate-100">{run.goal}</p>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-slate-500">
        <span>{originLabel(run.originId)}</span>
        <span className="text-slate-600">·</span>
        <span>走到第 {run.lastAct} 幕</span>
        {run.personalityTags.length > 0 ? (
          <>
            <span className="text-slate-600">·</span>
            <span>{run.personalityTags.join(' / ')}</span>
          </>
        ) : null}
      </p>

      {run.finalWords ? (
        <p className="mt-2 border-l-2 border-relic-gold/40 pl-2.5 text-[12px] leading-relaxed text-amber-100/90">
          “{run.finalWords}”
        </p>
      ) : null}

      {state === 'breached' && run.causeOfDeath ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">{run.causeOfDeath}</p>
      ) : null}
    </article>
  );
}

function CommitmentNode({ commitment }: { readonly commitment: Commitment }) {
  const receipt = commitment.receipt;
  const label =
    receipt?.outcome === 'done'
      ? { text: '做到了', tone: 'border-emerald-400/35 text-emerald-200' }
      : receipt?.outcome === 'partial'
        ? { text: '做了一部分', tone: 'border-amber-400/35 text-amber-200' }
        : receipt?.outcome === 'missed'
          ? { text: '没做成', tone: 'border-rose-500/35 text-rose-200' }
          : { text: '待回收', tone: 'border-white/12 text-slate-300' };

  return (
    <article className={`rounded-2xl border bg-ink-800/40 p-3.5 ${label.tone.split(' ')[0]}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-[0.15em] text-slate-500">承诺</span>
          <span className={`font-mono text-[11px] font-semibold ${label.tone.split(' ')[1]}`}>
            {label.text}
          </span>
        </span>
        <span className="font-mono text-[10px] text-slate-600">
          {dayOf(receipt?.reportedAt ?? commitment.committedAt)}
        </span>
      </header>

      <p className="mt-2 text-[13px] font-semibold leading-snug text-slate-100">{commitment.action}</p>

      {receipt?.blocker ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/90">
          卡点：{receipt.blocker}
        </p>
      ) : null}
    </article>
  );
}

function ArchiveScreen() {
  const [view, setView] = React.useState<ArchiveView | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/archive', { signal: controller.signal });
        const payload: unknown = await response.json();
        if (controller.signal.aborted) {
          return;
        }
        const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
        setView({
          authenticated: record.authenticated === true,
          totalRuns: typeof record.totalRuns === 'number' ? record.totalRuns : 0,
          runs: Array.isArray(record.runs) ? (record.runs as ArchiveRun[]) : [],
          commitments: Array.isArray(record.commitments) ? (record.commitments as Commitment[]) : [],
          resolvedCount: typeof record.resolvedCount === 'number' ? record.resolvedCount : 0,
          dueCount: typeof record.dueCount === 'number' ? record.dueCount : 0,
          overdueDays: typeof record.overdueDays === 'number' ? record.overdueDays : 0,
          hint: typeof record.hint === 'string' ? record.hint : null,
        });
      } catch {
        setView(EMPTY);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const data = view ?? EMPTY;

  /** 时间线：推演与承诺按时间降序交错（最新的在最前）。 */
  const nodes: Node[] = React.useMemo(() => {
    const merged: Node[] = [
      ...data.runs.map<Node>((run) => ({ kind: 'run', at: run.finishedAt, run })),
      ...data.commitments.map<Node>((commitment) => ({
        kind: 'commitment',
        at: commitment.receipt?.reportedAt ?? commitment.committedAt,
        commitment,
      })),
    ];
    return merged.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  }, [data.commitments, data.runs]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[860px] flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">命运档案馆</p>
          <h1 className="mt-1 text-lg font-bold text-slate-100 sm:text-xl">
            你走过的路，和它们留下的东西
          </h1>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
            这里不记分数。只记两件事：你当时面对的是什么，以及那些选择留下了什么。
          </p>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          返回发令台
        </Link>
      </header>

      {/* 世界线穿过第四面墙：档案馆里的东西已经不在游戏里了 */}
      <WorldlinePierce
        state={data.totalRuns > 0 ? 'stable' : 'unstable'}
        realityLabel={`${data.totalRuns} 局推演 · ${data.resolvedCount} 条回执`}
        className="rounded-2xl border border-white/10 bg-ink-800/40 px-4 pb-4 pt-2"
      />

      {loading ? <NeuralLoader hint="正在读取你的档案" /> : null}

      {!loading && data.hint ? (
        <p className="rounded-2xl border border-zhihu-500/30 bg-zhihu-500/[0.08] px-4 py-3 text-[11px] leading-relaxed text-zhihu-100">
          上一局留下的回响：{data.hint}
        </p>
      ) : null}

      {!loading && !data.authenticated ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-slate-400">
          当前未连接知乎账号，因此**推演记录不会保留**（那需要账号身份）。
          承诺回执仍然会被记在这里。
          <Link href="/oauth" className="ml-1 font-semibold text-zhihu-300 hover:text-zhihu-100">
            连接知乎账号
          </Link>
        </p>
      ) : null}

      {!loading && nodes.length === 0 ? (
        <section className="panel p-5 text-center">
          <p className="text-sm font-semibold text-slate-200">档案还是空的</p>
          <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-relaxed text-slate-500">
            去推演一局，或者先认下一条七天实验 —— 只要你做过一次，这里就会有第一条记录。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn-primary text-xs">
              开始一局推演
            </Link>
            <Link href="/commitment" className="btn-ghost text-xs">
              去看赛博契约
            </Link>
          </div>
        </section>
      ) : null}

      {!loading && nodes.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {nodes.map((node) =>
            node.kind === 'run' ? (
              <li key={`run-${node.run.finishedAt}-${node.run.goal}`}>
                <RunNode run={node.run} />
              </li>
            ) : (
              <li key={`cm-${node.commitment.commitmentId}`}>
                <CommitmentNode commitment={node.commitment} />
              </li>
            ),
          )}
        </ol>
      ) : null}
    </main>
  );
}

export default function ArchivePage() {
  return <ArchiveScreen />;
}
