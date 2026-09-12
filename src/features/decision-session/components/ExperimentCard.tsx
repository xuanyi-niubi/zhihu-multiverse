'use client';

import * as React from 'react';
import Link from 'next/link';

import type { FollowUp, RealityExperiment } from '@/features/decision-session/domain';

/**
 * 现实实验卡（重构方案 §3.1 第五步 / §8 P1-4）。
 *
 * > 系统输出的不是「选 A」，而是：
 * > **用 3 小时做出最小原型，并找一名潜在队友做 15 分钟评审。
 * > 若能列出剩余任务且预估总投入不超过 8 小时/周，再报名。**
 *
 * ## 六要素必须全部可见
 *
 * 假设 / 动作 / 时间盒 / 产物 / 成功信号 / **停止信号**。
 *
 * 把停止信号放在和成功信号**同等醒目**的位置，是有意的：
 * 只有成功信号的建议会让人在沉没成本里越陷越深，
 * 而「什么情况下该停」正是本产品与「励志内容」的区别。
 */

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] tracking-wider text-slate-600">{label}</dt>
      <dd className="text-[12px] leading-relaxed text-slate-300">{children}</dd>
    </div>
  );
}

export function ExperimentCard({
  experiment,
  followUp,
  busy,
  onCommit,
  className = '',
}: {
  readonly experiment: RealityExperiment;
  readonly followUp: FollowUp | null;
  readonly busy: boolean;
  readonly onCommit: () => void;
  readonly className?: string;
}) {
  const committed = followUp !== null;
  const dueText = committed && followUp ? followUp.dueAt.slice(0, 10) : null;

  return (
    <section className={`panel p-4 ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-bold text-slate-100">这一周可以验证的一件事</h2>
        <span className="font-mono text-[10px] text-slate-600">7 天实验</span>
      </header>

      <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-slate-300">
        {experiment.hypothesis}
      </p>

      <dl className="mt-3 flex flex-col gap-3">
        <Row label="要做的动作">{experiment.action}</Row>
        <Row label="时间盒">{experiment.timebox}</Row>
        <Row label="做完会得到">{experiment.artifact}</Row>
      </dl>

      {/* 成功信号与停止信号并列 —— 地位相同 */}
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-400/35 bg-emerald-400/[0.07] px-3 py-2.5">
          <p className="font-mono text-[10px] tracking-wider text-emerald-200">成立信号</p>
          <p className="mt-1 text-[12px] leading-relaxed text-emerald-50/90">{experiment.successSignal}</p>
        </div>
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/[0.07] px-3 py-2.5">
          <p className="font-mono text-[10px] tracking-wider text-rose-200">停止信号</p>
          <p className="mt-1 text-[12px] leading-relaxed text-rose-50/90">{experiment.stopSignal}</p>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        <span className="font-mono text-slate-600">它降低了哪个未知：</span>
        {experiment.reducesUnknown}
      </p>

      {/* 保存 / 回访：登录只在这里出现（方案 §3.1 第五步） */}
      <div className="mt-4 border-t border-white/8 pt-3">
        {committed ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] leading-relaxed text-emerald-200">
              已记下。{dueText} 我们会回来问你结果 —— 不是问「成功了吗」，而是问「你做了什么、结果如何」。
            </p>
            <Link href="/journal" className="btn-ghost shrink-0 text-xs">
              选择日志
            </Link>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onCommit}
              className="arcade-btn w-full bg-zhihu-500 text-white disabled:opacity-50"
            >
              {busy ? '正在记下…' : '保存这个实验，七天后提醒我'}
            </button>
            <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
              保存后我们会在七天后回来问你结果。**不需要现在注册账号**，
              它只是一个提醒。
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export default ExperimentCard;
