'use client';

import * as React from 'react';

import type { ClarifyQuestion } from '@/features/decision-session/clarify';

/**
 * 澄清：**一题一屏**（产品化方案 §15 / §46）。
 *
 * ## 为什么改成一题一屏
 *
 * 旧版把所有澄清问题一次性铺在一个面板里，还要在问题外层再套 panel ——
 * 「panel 套 panel」在手机上会变成一屏三四个框，用户不知道先看哪个。
 *
 * 现在：
 *
 * ```text
 * 先一句话说明为什么要问
 * → 一次只显示一个问题
 * → 选完（或跳过）后淡出，下一题淡入
 * → 最后一题答完才提交
 * ```
 *
 * ## 两条纪律
 *
 * 1. **能跳过**：跳过是明确动作（再点一次取消选择），跳过的地方系统写
 *    「待验证」，不替用户猜。
 * 2. **不造第二题**：只有服务端真的返回了第二题才显示 —— 方案 §7 的原则是
 *    「能不问就不问」，而服务端只会在答案会改变检索 / 世界 / 实验时才问。
 */

export interface ClarificationStepProps {
  readonly questions: readonly ClarifyQuestion[];
  readonly busy: boolean;
  readonly onSubmit: (answers: Record<string, string | undefined>) => void;
}

export function ClarificationStep({ questions, busy, onSubmit }: ClarificationStepProps) {
  const [answers, setAnswers] = React.useState<Record<string, string | undefined>>({});
  const [index, setIndex] = React.useState(0);
  /** 正在做淡出动画：下一题在动画结束后再挂载，避免两题同时在场。 */
  const [leaving, setLeaving] = React.useState(false);

  const question = questions[index];
  const isLast = index >= questions.length - 1;

  const goNext = React.useCallback(() => {
    if (isLast) {
      onSubmit(answers);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => {
      setIndex((current) => current + 1);
      setLeaving(false);
    }, 220);
  }, [answers, isLast, onSubmit]);

  if (!question) {
    return null;
  }

  return (
    <section className="mt-8">
      <p className="text-[13px] leading-relaxed text-slate-400">
        {questions.length > 1
          ? `我还差一点信息。一共 ${questions.length} 个问题，都可以跳过。`
          : '我还差一点信息。可以跳过。'}
      </p>

      <div
        key={question.id}
        className={[
          'quiet-panel mt-4 transition-opacity duration-200',
          leaving ? 'opacity-0' : 'fade-in opacity-100',
        ].join(' ')}
      >
        <p className="text-[16px] font-semibold leading-relaxed text-slate-100">
          {question.question}
        </p>
        {question.hint ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{question.hint}</p>
        ) : null}

        <div className="mt-3.5 flex flex-wrap gap-2">
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
                  'rounded-xl border px-3 py-2 text-[13px] transition-colors duration-150',
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
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-slate-600">
          {questions.length > 1 ? `${index + 1} / ${questions.length}` : ''}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={goNext}
          className="door-btn max-w-[220px] disabled:opacity-50"
        >
          {busy ? '正在整理…' : isLast ? '继续' : '下一题'}
        </button>
      </div>
    </section>
  );
}

export default ClarificationStep;
