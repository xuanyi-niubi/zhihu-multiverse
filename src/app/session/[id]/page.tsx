'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { ClarificationStep } from '@/components/session/ClarificationStep';
import { WorldCompiling, type CompileStage } from '@/components/session/WorldCompiling';

import type { ClarifyQuestion } from '@/features/decision-session/clarify';
import type { DecisionSession } from '@/features/decision-session/domain';

/**
 * 会话页（产品化方案 §6 / §14 / §15 / §16 / §46）。
 *
 * ## 它不是页面，是一段连续转场
 *
 * ```text
 * 必要时一题一屏的澄清
 * ↓  刘看山第一次出现（§35）
 * 「我去找找，有没有人活过你正在纠结的这几种人生。」
 * ↓  真实阶段（检索三类经历 → 编译世界），只有真的找到才打勾
 * ↓  自动进入游戏 —— 用户不需要理解 Session / prepare-world 这些词
 * ```
 *
 * ## 三条纪律
 *
 * 1. **一题一屏**：不在一个面板里堆所有问题（§15）。
 * 2. **状态必须真实**：✓ 只出现在真的找到来源的那一类上（§16）。
 * 3. **失败可退可重试**：没找到就如实说，给「换个说法」与「仍然进入」两条路，
 *    不把用户困在一个转圈页上（§40 的 fallback 链终点是「明确失败」）。
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
  readonly experienceFacts?: DecisionSession['experienceFacts'];
}

const INTENT_LABELS: readonly { readonly id: CompileStage['id']; readonly label: string }[] = [
  { id: 'similar-person', label: '找到与你处境相近的经历' },
  { id: 'alternative', label: '找到另一种走法' },
  { id: 'counterexample', label: '找到一条结果相反的经历' },
];

/** 从**真实检索结果**派生三类经历的命中数（没找到就是 0，不假装）。 */
function stagesFrom(view: SessionView | null): readonly CompileStage[] {
  const facts = view?.experienceFacts ?? [];
  return INTENT_LABELS.map((intent) => ({
    id: intent.id,
    label: intent.label,
    found:
      view === null
        ? null
        : facts.filter((fact) => {
            if (intent.id === 'counterexample') {
              // 反例这一类把失败经历也算上（与 compileWorld 的四轮优先级同一口径）
              return fact.purposes.includes('counterexample') || fact.purposes.includes('failure');
            }
            return fact.purposes.includes(intent.id);
          }).length,
  }));
}

/** 编译完成后，让用户看一眼真实结果再进入游戏 —— 不留白，也不拖延。 */
const ENTER_DELAY_MS = 1400;

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();

  const [view, setView] = React.useState<SessionView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [compileFailed, setCompileFailed] = React.useState(false);

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

  /** 统一派发：动作只有一个入口，错误处理只有一份。 */
  const act = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!id) {
        return;
      }
      setBusy(true);
      setError(null);
      setCompileFailed(false);
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
          return;
        }
        // 编译失败要能被用户看见并重试，而不是静默停在转圈页上
        setError(payload.error?.message ?? '这一步没有成功。');
        if (body.action === 'prepare-world') {
          setCompileFailed(true);
        }
      } catch {
        setError('网络没有响应，请再试一次。');
        if (body.action === 'prepare-world') {
          setCompileFailed(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const status = view?.status ?? null;

  /** 澄清答完（或本来就不需要澄清）→ 自动编译。 */
  const autoPreparedRef = React.useRef(false);
  React.useEffect(() => {
    if (!view || busy || autoPreparedRef.current || compileFailed) {
      return;
    }
    if (view.status === 'comparing' || view.status === 'choosing_unknown') {
      autoPreparedRef.current = true;
      void act({ action: 'prepare-world' });
    }
  }, [act, busy, compileFailed, view]);

  /** 世界就绪 → 让用户看清真实检索结果，再自动进入游戏。 */
  const autoEnteredRef = React.useRef(false);
  React.useEffect(() => {
    if (!view || view.status !== 'ready_to_play' || autoEnteredRef.current) {
      return;
    }
    autoEnteredRef.current = true;
    const timer = window.setTimeout(() => {
      router.replace(`/play?session=${encodeURIComponent(view.id)}`);
    }, ENTER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [router, view]);

  if (loading) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-20">
        <p className="font-mono text-[11px] text-slate-600">正在读取这次梳理…</p>
      </main>
    );
  }

  if (error && !view) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-20">
        <p role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.05] px-4 py-3 text-[13px] text-rose-200">
          {error}
        </p>
        <Link href="/" className="btn-ghost mt-5 inline-flex text-xs">
          回到首页
        </Link>
      </main>
    );
  }

  if (!view) {
    return null;
  }

  const showClarify = status === 'clarifying';
  const worldReady = status === 'ready_to_play';
  const stages = stagesFrom(worldReady ? view : null);
  const foundTotal = stages.reduce((sum, stage) => sum + (stage.found ?? 0), 0);
  /**
   * 只有两个真实状态：`searching`（等着）与 `done`（服务端已经给出结果）。
   *
   * 刻意不做「编译中」这一档 —— 没有流式接口之前，我们**看不见**它，
   * 而编一个中间态就是假动画（§16 明确禁止）。
   */
  const phase: 'searching' | 'done' = worldReady ? 'done' : 'searching';

  return (
    <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="act-label">你问的是</p>
          <h1 className="mt-1.5 text-[16px] font-semibold leading-relaxed text-slate-100">
            {view.question}
          </h1>
        </div>
        <Link href="/" className="shrink-0 font-mono text-[11px] text-slate-600 transition-colors duration-200 hover:text-slate-300">
          换个问题
        </Link>
      </header>

      {/* 刘看山第一次出现（§35：全局只出现三次） */}
      <p className="mt-6 text-[14px] leading-relaxed text-slate-300">
        我去找找，有没有人活过你正在纠结的这几种人生。
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/[0.05] px-3 py-2 text-[12px] text-rose-200">
          {error}
        </p>
      ) : null}

      {showClarify ? (
        <ClarificationStep
          questions={view.questions}
          busy={busy}
          onSubmit={(answers) => void act({ action: 'clarify', answers })}
        />
      ) : (
        <>
          <WorldCompiling stages={stages} phase={phase} />

          {worldReady ? (
            <div className="mt-6">
              {foundTotal === 0 ? (
                /**
                 * 一条都没找到：§40 的 fallback 链终点是「明确失败」，
                 * 所以这里如实说，并给两条出路 —— 不假装、也不困住用户。
                 */
                <div className="quiet-panel">
                  <p className="text-[13px] leading-relaxed text-slate-300">
                    这一次没有找到可核对的真实经历 —— 我们不会用编造的内容把世界填满。
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                    换一种说法再试（例如补上你的年级、专业、能投入的时间），通常就能找到人。
                  </p>
                  <div className="mt-3.5 flex flex-wrap gap-3">
                    <Link href="/" className="door-btn max-w-[240px]">
                      换一种说法再试
                    </Link>
                    <Link
                      href={`/play?session=${encodeURIComponent(id)}`}
                      data-destination="play-session"
                      className="btn-ghost text-xs"
                    >
                      仍然进入（这一局没有别人的经验）
                    </Link>
                  </div>
                </div>
              ) : (
                <Link
                  href={`/play?session=${encodeURIComponent(id)}`}
                  data-destination="play-session"
                  className="door-btn"
                >
                  进入我的平行宇宙
                </Link>
              )}
            </div>
          ) : compileFailed ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                data-action="prepare-world"
                disabled={busy}
                onClick={() => void act({ action: 'prepare-world' })}
                className="door-btn max-w-[240px] disabled:opacity-50"
              >
                {busy ? '正在重试…' : '重试一次'}
              </button>
              <Link href="/" className="btn-ghost text-xs">
                换个问题
              </Link>
            </div>
          ) : (
            /* 兜底入口：自动跳转被拦时，用户仍有明确的一步可走 */
            <div className="mt-6">
              <button
                type="button"
                data-action="prepare-world"
                disabled={busy}
                onClick={() => void act({ action: 'prepare-world' })}
                className="door-btn disabled:opacity-50"
              >
                {busy ? '正在找…' : '进入我的平行宇宙'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
