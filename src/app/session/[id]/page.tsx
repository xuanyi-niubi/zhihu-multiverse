'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import type { ClarifyQuestion } from '@/features/decision-session/clarify';
import type { DecisionSession } from '@/features/decision-session/domain';

/**
 * 会话页（产品减法重构方案 §6 / §7 / §10）。
 *
 * ## 它不再是一份报告
 *
 * 旧版在这里先摊开「别人走过的 3 条路 + 支持证据 + 反对证据 + 未知」，
 * 再让用户点「生成我的世界」—— 那会把产品拉回 AI 咨询工具（§10），
 * 也会让用户以为「看报告」才是正事。
 *
 * ## 它现在是一条通道
 *
 * ```text
 * 必要时 1~2 个澄清问题
 * ↓  去问：会改变下面任一项才值得问 —— 搜什么 / 比较谁 / 冲突是什么 / 最后该验证什么
 * 「我去找找，有没有人活过你正在纠结的这几种人生。」   ← 刘看山第一次出现（§35）
 * ↓
 * 编译世界 → 直接进入游戏（/play?session=）
 * ```
 *
 * 路径与证据不再先给用户看：它们退到后台，由世界编译器消费（§10），
 * 玩家在游戏里通过**经验卡**遇见具体的人（§13/§23）。
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
  const router = useRouter();

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

  /** 统一派发：所有动作都走这里，错误处理只有一份。 */
  const act = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!id) {
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
    [id],
  );

  const status = view?.status ?? null;

  /**
   * 澄清答完就**自动**编译世界（§6）：用户不需要知道「prepare-world」这一步。
   * 用 ref 守住，避免状态回流导致的重复请求。
   */
  const autoPreparedRef = React.useRef(false);
  React.useEffect(() => {
    if (!view || busy || autoPreparedRef.current) {
      return;
    }
    if (view.status === 'comparing' || view.status === 'choosing_unknown') {
      autoPreparedRef.current = true;
      void act({ action: 'prepare-world' });
    }
  }, [act, busy, view]);

  /**
   * 世界就绪就**自动**进入游戏（§6）。做不到时（例如浏览器拦了跳转）
   * 页面上留一个兜底按钮，不让用户卡在一句「已就绪」上。
   */
  const autoEnteredRef = React.useRef(false);
  React.useEffect(() => {
    if (!view || view.status !== 'ready_to_play' || autoEnteredRef.current) {
      return;
    }
    autoEnteredRef.current = true;
    router.replace(`/play?session=${encodeURIComponent(view.id)}`);
  }, [router, view]);

  if (loading) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-16">
        <p className="font-mono text-[11px] text-slate-500">正在读取这次梳理…</p>
      </main>
    );
  }

  if (error && !view) {
    return (
      <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-16">
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

  const showClarify = status === 'clarifying';
  const worldReady = status === 'ready_to_play';

  return (
    <main id="main-content" className="mx-auto w-full max-w-[640px] flex-1 px-5 py-14">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">你问的是</p>
          <h1 className="mt-1 text-[15px] font-bold leading-snug text-slate-100">{view.question}</h1>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          换个问题
        </Link>
      </header>

      {/* 刘看山第一次出现（§35）：全局只出现三次，这是第一次 */}
      <p className="mt-5 text-[13px] leading-relaxed text-slate-300">
        我去找找，有没有人活过你正在纠结的这几种人生。
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-200">
          {error}
        </p>
      ) : null}

      {showClarify ? (
        <ClarifyStage
          questions={view.questions}
          busy={busy}
          onSubmit={(answers) => void act({ action: 'clarify', answers })}
        />
      ) : (
        <section className="mt-6">
          {worldReady ? (
            <Link
              href={`/play?session=${encodeURIComponent(id)}`}
              data-destination="play-session"
              className="arcade-btn flex w-full justify-center bg-zhihu-500 text-white"
            >
              进入我的平行宇宙
            </Link>
          ) : (
            <>
              <p className="font-mono text-[11px] leading-relaxed text-slate-500">
                {busy ? '正在知乎里找走过这条路的人…' : '正在编译这一局的世界…'}
              </p>
              <button
                type="button"
                data-action="prepare-world"
                disabled={busy}
                onClick={() => void act({ action: 'prepare-world' })}
                className="arcade-btn mt-4 w-full bg-zhihu-500 text-white disabled:opacity-50"
              >
                {busy ? '正在找…' : '进入我的平行宇宙'}
              </button>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                如果迟迟没有动静，点上面这个按钮重试一次。
              </p>
            </>
          )}
        </section>
      )}
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
    <section className="mt-6">
      <p className="text-[12px] leading-relaxed text-slate-500">
        先确认{questions.length > 1 ? ` ${questions.length} 件` : '一件'}会真正改变这个世界的事
        —— 每一问都能跳过，跳过的地方我们写「待验证」，不替你猜。
      </p>

      <div className="mt-3.5 flex flex-col gap-3">
        {questions.map((question) => (
          <fieldset key={question.id} className="panel p-3.5">
            <legend className="px-1 text-[12px] font-semibold text-slate-200">{question.question}</legend>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{question.hint}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {question.options?.map((option) => {
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
        {busy ? '正在整理…' : '继续'}
      </button>
    </section>
  );
}
