'use client';

import * as React from 'react';

import type { Understanding } from '@/features/decision-session/understood';

/**
 * 「我听懂的是」面板（重构方案 §3.1 第四步）。
 *
 * ## 它为什么排在三路径之上
 *
 * 用户要先确认「你有没有理解错」，再看别人走过的路。
 * 顺序反过来，他读完三条路径才发现答非所问 —— 那是白读。
 *
 * ## 两种状态，都很重要
 *
 * - **已澄清**：逐条列出他自己说过的约束（原话，不改写）；
 * - **未澄清**：明说我们**还不知道**什么，并给出「补充一句」的入口。
 *
 * 第二种状态不是空态提示，而是产品的诚实性展示：
 * 它证明了「缺信息时我们不猜」。
 */

export function UnderstandingPanel({
  understanding,
  className = '',
  onClarify,
}: {
  readonly understanding: Understanding;
  readonly className?: string;
  /** 「补充一句」入口（未澄清时显示）。 */
  readonly onClarify?: () => void;
}) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-ink-900/50 px-3.5 py-3 ${className}`}>
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">我听懂的是</p>

      {/* 复述用户原话：原样引用，不加润色 */}
      <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100">
        {understanding.restated}
      </p>

      {understanding.constraints.length > 0 ? (
        <dl className="mt-2.5 flex flex-col gap-1.5 border-t border-white/8 pt-2.5">
          {understanding.constraints.map((line) => (
            <div key={line.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <dt className="font-mono text-[10px] text-slate-600">{line.label}</dt>
              <dd className="text-[12px] leading-relaxed text-slate-300">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {understanding.missing.length > 0 ? (
        <div className="mt-2.5 border-t border-white/8 pt-2.5">
          <p className="text-[11px] leading-relaxed text-slate-500">
            你还没说这些，<strong className="font-semibold text-amber-200/90">我们就不会猜</strong>：
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {understanding.missing.map((item) => (
              <li key={item} className="text-[11px] leading-relaxed text-slate-500">
                · {item}
              </li>
            ))}
          </ul>
          {onClarify ? (
            <button
              type="button"
              onClick={onClarify}
              className="mt-2 rounded-lg border border-zhihu-500/40 bg-zhihu-500/10 px-2.5 py-1 text-[11px] font-semibold text-zhihu-100 transition-colors duration-150 hover:bg-zhihu-500/20"
            >
              补充这三件事
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-600">
        这一段是把你说过的话原样列出来，没有改写、没有推测 ——
        如果哪里理解错了，请直接改上面的问题。
      </p>
    </section>
  );
}

export default UnderstandingPanel;
