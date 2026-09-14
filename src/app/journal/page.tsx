'use client';

import * as React from 'react';
import Link from 'next/link';

/**
 * 选择日志（重构方案 §3.2 / §7.1 / 收口方案 P1-4）。
 *
 * > 历史记忆，改名为「选择日志」。
 *
 * ## 它回答六个问题（按发生顺序）
 *
 * 1. 当时我在纠结什么
 * 2. 我看见了哪些真实经历
 * 3. 我真正不知道什么
 * 4. 我决定验证什么
 * 5. 现实发生了什么
 * 6. 我现在怎么看
 *
 * ## 与旧「命运档案馆」的区别
 *
 * 旧的是**战绩**（走了几幕、拿了几分、什么结局）；
 * 新的是**成长**（当时怎么想、看见了什么、做了什么、结果如何）。
 * 因此这里刻意**不展示** SAN / SKILL / BOND / D20 / 世界线数值 ——
 * 那些属于游戏过程，而日志属于成长。
 *
 * 没有数据的步骤**不渲染**：没看见就是没看见，不留一个空标签凑格式。
 */

interface JournalEntry {
  readonly id: string;
  readonly question: string;
  readonly status: string;
  readonly pathCount: number;
  readonly createdAt: string;
  readonly provenance: string;
  /** 经验引擎合成出的真实走法（P1-4）。 */
  readonly experiencePathCount?: number;
  readonly pathLabels?: readonly string[];
  /** 这一局真正不知道的那个变量。 */
  readonly keyUnknown?: string | null;
  readonly experiment: {
    readonly action: string;
    readonly timebox?: string;
    readonly successSignal?: string;
  } | null;
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

/** 跨会话的现实记忆（P1-3）：现实里验证过的事实。 */
interface MemoryEntry {
  readonly id: string;
  readonly claim: string;
  readonly source: 'user-stated' | 'experiment-observed';
  readonly confidence: 'stated' | 'observed-once' | 'observed-repeatedly';
  readonly sessionId: string;
}

const CONFIDENCE_LABEL: Readonly<Record<MemoryEntry['confidence'], string>> = {
  stated: '你自己说的',
  'observed-once': '验证过一次',
  'observed-repeatedly': '反复验证过',
};

function dayOf(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  const date = new Date(parsed);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 日志里的一条「成长步骤」。
 *
 * 步骤标签刻意用**第一人称**：这份日志是给用户自己看的回溯，
 * 不是系统对他的评估。没有数据的步骤由调用方直接不渲染。
 */
function JournalStep({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed">
      <span className="shrink-0 font-mono text-[10px] text-slate-600">{label}</span>
      <span className="min-w-0 text-slate-400">{children}</span>
    </p>
  );
}

export default function JournalPage() {
  const [entries, setEntries] = React.useState<readonly JournalEntry[] | null>(null);
  const [memory, setMemory] = React.useState<readonly MemoryEntry[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * 卡册（GAME-DESIGN §4.4）：借来过的世界。
   *
   * 跨局去重所有「真实走法」标签，走过的路一张卡；卡册尾部永远留两个
   * 未显影空槽「还没走过的世界」—— 它不是进度条（没有 0/10），
   * 是提醒：世界比你看过的大。没有走过任何世界时整个卡册不渲染
   * （本页纪律：没有数据的步骤不渲染）。
   */
  const walkedWorlds = React.useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries ?? []) {
      for (const label of entry.pathLabels ?? []) {
        const trimmed = label.trim();
        if (trimmed.length > 0) {
          seen.add(trimmed);
        }
      }
    }
    return [...seen].slice(0, 6);
  }, [entries]);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/sessions', { signal: controller.signal });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { sessions?: JournalEntry[]; realityMemory?: MemoryEntry[] };
        };
        if (controller.signal.aborted) {
          return;
        }
        setEntries(payload.ok ? (payload.data?.sessions ?? []) : []);
        setMemory(payload.ok ? (payload.data?.realityMemory ?? []) : []);
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

      {/*
        跨会话记忆（P1-3）：现实里验证过的事。
        它与下面的会话记录刻意分开 —— 会话是「我当时怎么想」，
        记忆是「现实已经告诉过我什么」。后者在下一局会被当成硬条件。
      */}
      {memory.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3.5">
          <h2 className="text-[12px] font-semibold text-emerald-100">现实已经告诉过我的</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {memory.slice(-6).map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-relaxed">
                <span className="min-w-0 text-slate-200">{item.claim}</span>
                <span className="shrink-0 font-mono text-[10px] text-emerald-300/80">
                  {CONFIDENCE_LABEL[item.confidence]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            这些来自你做过的实验，不是我们的判断。下一次提问时，它们会被当成已知条件。
          </p>
        </section>
      ) : null}

      {entries === null && !error ? (
        <p className="mt-6 font-mono text-[11px] text-slate-500">正在读取…</p>
      ) : null}

      {/*
        卡册（GAME-DESIGN §4.4）：借来过的世界 + 未显影空槽。
        空槽不可点、永不补全 —— 「还没走过的世界」只有一个状态。
      */}
      {walkedWorlds.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-white/10 bg-ink-800/50 p-3.5">
          <h2 className="text-[12px] font-semibold text-slate-200">借来过的世界</h2>
          <div className="gd-album mt-3">
            {walkedWorlds.map((label, index) => (
              <div key={label} className="gd-album__slot">
                <span className="gd-album__slot-kicker">
                  World · {String(index + 1).padStart(3, '0')}
                </span>
                <span className="gd-album__slot-title">{label}</span>
              </div>
            ))}
            {[0, 1].map((slot) => (
              <div key={`undev-${slot}`} className="gd-album__slot gd-album__slot--undev" aria-label="还没走过的世界">
                <span className="gd-album__slot-kicker">Undeveloped</span>
                <span className="gd-album__slot-title">还没走过的世界</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            每一张都是某个知乎答主真实走过的一段路。空着的不是待解锁，是世界本来就比你看过的大。
          </p>
        </section>
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
          {entries.map((entry) => {
            const pathLabels = entry.pathLabels ?? [];
            const reviewedAt = entry.followUp?.answeredAt ?? entry.followUp?.dueAt;
            return (
              <li key={entry.id}>
                <Link
                  href={`/session/${entry.id}`}
                  className="block rounded-2xl border border-white/10 bg-ink-800/50 p-3.5 transition-colors duration-150 hover:border-zhihu-500/40"
                >
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] text-slate-500">{dayOf(entry.createdAt)}</span>
                    <span className="font-mono text-[10px] text-slate-600">
                      {(entry.experiencePathCount ?? 0) > 0
                        ? `${entry.experiencePathCount} 条真实走法`
                        : `${entry.pathCount} 条路径`}
                    </span>
                  </header>

                  {/* 1. 当时我在纠结什么 */}
                  <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100">
                    {entry.question}
                  </p>

                  {/* 2. 我看见了哪些真实经历 */}
                  {pathLabels.length > 0 ? (
                    <JournalStep label="我看见了真实经历">{pathLabels.join('；')}</JournalStep>
                  ) : null}

                  {/* 3. 我真正不知道什么 */}
                  {entry.keyUnknown ? (
                    <JournalStep label="我真正不知道">{entry.keyUnknown}</JournalStep>
                  ) : null}

                  {/* 4. 我决定验证什么 */}
                  {entry.experiment ? (
                    <JournalStep label="我决定验证">
                      {entry.experiment.action}
                      {entry.experiment.timebox ? `（${entry.experiment.timebox}）` : ''}
                    </JournalStep>
                  ) : null}

                  {/*
                    5 & 6：现实发生了什么 / 我现在怎么看。
                    `outcome` 是事实（做到了 / 做了一部分 / 改了计划），
                    `note` 是用户自己写下的判断 —— 我们不替他总结。
                  */}
                  {entry.followUp ? (
                    entry.followUp.outcome ? (
                      <>
                        <JournalStep label="现实发生了什么">
                          <span className="rounded-md border border-white/14 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                            {OUTCOME_LABEL[entry.followUp.outcome] ?? entry.followUp.outcome}
                          </span>
                          {reviewedAt ? (
                            <span className="ml-2 font-mono text-[10px] text-slate-600">
                              {dayOf(reviewedAt)}
                            </span>
                          ) : null}
                        </JournalStep>
                        {entry.followUp.note ? (
                          <JournalStep label="我现在怎么看">{entry.followUp.note}</JournalStep>
                        ) : null}
                      </>
                    ) : (
                      <JournalStep label="现实验证中">
                        <span className="font-mono text-[10px] text-amber-200/90">
                          待回访 · {dayOf(entry.followUp.dueAt)}
                        </span>
                      </JournalStep>
                    )
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}
    </main>
  );
}
