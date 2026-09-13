'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { EvidenceDrawer } from '@/features/decision-session/components/EvidenceDrawer';
import { ExperimentCard } from '@/features/decision-session/components/ExperimentCard';
import { PathCardView } from '@/features/decision-session/components/PathCardView';
import { ProvenanceNote } from '@/features/decision-session/components/ProvenanceNote';
import { UnderstandingPanel } from '@/features/decision-session/components/UnderstandingPanel';
import { understoodFrom } from '@/features/decision-session/understood';

import type { ClarifyQuestion } from '@/features/decision-session/clarify';
import type { DecisionSession } from '@/features/decision-session/domain';

/**
 * 决策会话页（重构方案 §3.2 / §3.3）。
 *
 * ```text
 * /session/[id]
 * ├─ clarify      三个澄清问题
 * ├─ paths        三条问题专属路径（含来源、分歧、未知）
 * ├─ evidence     来源原文抽屉（默认折叠，不挤压主任务）
 * └─ experiment   一个可验证行动 + 保存 / 回访
 * ```
 *
 * ## 页面只负责布局与路由（方案 §6.3）
 *
 * 每个 stage 是一个独立组件；这个文件不写业务逻辑，只做
 * 「读会话 → 按 status 渲染对应 stage → 派发动作」。
 */

interface SessionView {
  readonly id: string;
  readonly status: DecisionSession['status'];
  readonly question: string;
  readonly userContext: DecisionSession['userContext'];
  readonly retrievalRun: DecisionSession['retrievalRun'];
  readonly evidenceFacts: DecisionSession['evidenceFacts'];
  readonly pathClusters: DecisionSession['pathClusters'];
  readonly selectedUnknown: string | null;
  readonly experiment: DecisionSession['experiment'];
  readonly followUp: DecisionSession['followUp'];
  readonly questions: readonly ClarifyQuestion[];
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [view, setView] = React.useState<SessionView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!id) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${id}`, { signal: controller.signal });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: SessionView;
          error?: { message?: string };
        };
        if (controller.signal.aborted) {
          return;
        }
        if (payload.ok && payload.data) {
          setView(payload.data);
        } else {
          setError(payload.error?.message ?? '没有找到这个会话。');
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('读取会话失败，请刷新重试。');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [id]);

  /** 统一派发：所有 stage 的动作都走这里，保证错误处理只有一份。 */
  const act = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!id || busy) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: SessionView;
          error?: { message?: string };
        };
        if (payload.ok && payload.data) {
          setView(payload.data);
        } else {
          setError(payload.error?.message ?? '这一步没有成功。');
        }
      } catch {
        setError('网络没有响应，请再试一次。');
      } finally {
        setBusy(false);
      }
    },
    [busy, id],
  );

  if (loading) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[760px] flex-1 px-4 py-10">
        <p className="font-mono text-[11px] text-slate-500">正在读取这次梳理…</p>
      </main>
    );
  }

  if (error && !view) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[760px] flex-1 px-4 py-10">
        <p role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.08] px-4 py-3 text-[13px] text-rose-200">
          {error}
        </p>
        <Link href="/" className="btn-ghost mt-4 inline-flex text-xs">
          回到首页
        </Link>
      </main>
    );
  }

  if (!view) {
    return null;
  }

  const showClarify = view.status === 'clarifying';
  const showPaths = !showClarify;
  const worldReady = view.status === 'ready_to_play';
  const canPrepareWorld = view.status === 'comparing' || view.status === 'choosing_unknown';
  const showExperiment = view.status === 'designing_experiment' || view.status === 'committed';

  return (
    <main id="main-content" className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">选择预演</p>
          <h1 className="mt-1 text-base font-bold leading-snug text-slate-100 sm:text-lg">
            {view.question}
          </h1>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          换个问题
        </Link>
      </header>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-200">
          {error}
        </p>
      ) : null}

      {/* 来源状态：文案必须与事实一致（方案 §5.3） */}
      <ProvenanceNote run={view.retrievalRun} className="mt-4" />

      {/*
        「我听懂的是」（方案 §3.1 第四步）—— 排在三路径之前。
        用户要先确认没被理解错，再看别人走过的路；顺序反了他会白读三条。
      */}
      <UnderstandingPanel
        understanding={understoodFrom({ question: view.question, context: view.userContext })}
        className="mt-3"
        {...(view.status === 'clarifying' ? {} : {})}
      />

      {/* 第一步：澄清（三个问题） */}
      {showClarify ? (
        <ClarifyStage questions={view.questions} busy={busy} onSubmit={(answers) => void act({ action: 'clarify', answers })} />
      ) : null}

      {/* 第三步 + 第四步：路径与证据 */}
      {showPaths ? (
        <section className="mt-5">
          {view.pathClusters.length === 0 ? (
            <div className="panel p-4">
              <p className="text-[13px] font-semibold text-slate-200">这次没有可归纳的路径</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                {view.retrievalRun?.notes.join(' ') || '我们没找到足够的可核对经历。'}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                你可以补充一句更具体的处境（比如「大二、每周能拿出 8 小时」），我们再找一次。
              </p>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] tracking-widest text-slate-500">
                &gt; 别人走过的 {view.pathClusters.length} 条路
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {view.pathClusters.map((cluster) => (
                  <PathCardView
                    key={cluster.id}
                    cluster={cluster}
                    facts={view.evidenceFacts}
                    userContext={view.userContext}
                    selectedUnknown={view.selectedUnknown}
                    busy={busy}
                    onPickUnknown={(unknown) => void act({ action: 'select-unknown', unknown })}
                  />
                ))}
              </div>

              {/* 证据抽屉：默认折叠，不把元数据塞满主视图 */}
              <EvidenceDrawer
                facts={view.evidenceFacts}
                clusters={view.pathClusters}
                className="mt-3"
              />

              {/* 证据不足的走法：如实列出，不让用户以为世界上只有两种做法 */}
              {view.pathClusters.length < 3 ? (
                <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                  这个问题的其它可能走法，目前还没有找到可核对的经历，所以我们不列出它们 ——
                  不补齐看起来完整的答案。
                </p>
              ) : null}

              {canPrepareWorld ? (
                <button
                  type="button"
                  data-action="prepare-world"
                  disabled={busy}
                  onClick={() => void act({ action: 'prepare-world' })}
                  className="arcade-btn mt-4 w-full bg-zhihu-500 text-white disabled:opacity-50"
                >
                  {busy ? '正在生成你的世界…' : '生成我的世界'}
                </button>
              ) : null}

              {worldReady ? (
                <Link
                  href={`/play?session=${encodeURIComponent(id)}`}
                  data-destination="play-session"
                  className="arcade-btn mt-4 flex w-full justify-center bg-zhihu-500 text-white"
                >
                  进入这个世界
                </Link>
              ) : null}

              {!worldReady && !showExperiment ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: 'design-experiment' })}
                  className="btn-ghost mt-3 w-full text-xs disabled:opacity-50"
                >
                  {view.selectedUnknown ? '先把这个问题变成一个本周实验' : '先生成一个可验证的小实验'}
                </button>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* 第五步：现实实验 */}
      {showExperiment && view.experiment ? (
        <ExperimentCard
          experiment={view.experiment}
          followUp={view.followUp}
          busy={busy}
          onCommit={() => void act({ action: 'commit' })}
          className="mt-5"
        />
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* 澄清 stage                                                                  */
/* -------------------------------------------------------------------------- */

function ClarifyStage({
  questions,
  busy,
  onSubmit,
}: {
  readonly questions: readonly ClarifyQuestion[];
  readonly busy: boolean;
  readonly onSubmit: (answers: Record<string, string | undefined>) => void;
}) {
  const [answers, setAnswers] = React.useState<Record<string, string | undefined>>({});

  return (
    <section className="mt-5">
      <p className="font-mono text-[10px] tracking-widest text-slate-500">
        &gt; 先问三件事，它们会改变后面的结论
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
        每一问都可以跳过。跳过的地方我们会写「待验证」，而不是替你猜。
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {questions.map((question) => (
          <fieldset key={question.id} className="panel p-3.5">
            <legend className="px-1 text-[12px] font-semibold text-slate-200">{question.question}</legend>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{question.hint}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const active = answers[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setAnswers((prev) => ({
                        ...prev,
                        // 再点一次取消选择，让「跳过」是一个明确动作
                        [question.id]: active ? undefined : option.id,
                      }))
                    }
                    className={[
                      'rounded-xl border px-2.5 py-1.5 text-[11px] transition-colors duration-150',
                      active
                        ? 'border-zhihu-500/70 bg-zhihu-500/15 text-zhihu-100'
                        : 'border-white/12 bg-white/[0.02] text-slate-400 hover:border-white/25 hover:text-slate-200',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(answers)}
        className="arcade-btn mt-4 w-full bg-zhihu-500 text-white disabled:opacity-50"
      >
        {busy ? '正在整理…' : '看别人走过的路'}
      </button>
    </section>
  );
}
