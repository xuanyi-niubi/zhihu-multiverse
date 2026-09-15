'use client';

import * as React from 'react';

import type { ClarifyQuestion } from '@/features/decision-session/clarify';

/**
 * 澄清：**一题一屏**（产品化方案 §15 / §46）。
 *
 * ## 为什么是一题一屏
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
 * 2. **不造第二题**：只有服务端真的返回了第二题才显示 —— 原则是
 *    「能不问就不问」，而服务端只会在答案会改变检索 / 世界 / 实验时才问。
 *
 * ## 本次的移动端修正
 *
 * 选项按钮旧版是 `min-h-11`（44px）但**没有 flex 换行时的最小宽度约束**，
 * 长选项文字在 360px 屏上会被压成两行且高度不齐。现在：
 * 选项在窄屏占满整行（`w-full sm:w-auto`），并统一到 44px 的触摸高度。
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
      <p className="sil-prose text-body">
        {questions.length > 1
          ? `我还差一点信息。一共 ${questions.length} 个问题，都可以跳过。`
          : '我还差一点信息。可以跳过。'}
      </p>

      <div
        key={question.id}
        className={[
          'sil-panel mt-4 px-4 py-5 transition-opacity duration-200 sm:px-5',
          leaving ? 'opacity-0' : 'opacity-100',
        ].join(' ')}
      >
        <p className="text-[17px] font-semibold leading-relaxed text-[color:var(--sil-ink-100)]">
          {question.question}
        </p>
        {question.hint ? (
          <p className="mt-2 text-meta leading-relaxed text-[color:var(--sil-ink-300)]">
            {question.hint}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
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
                  'min-h-11 w-full rounded-[3px] border px-4 py-2.5 text-left text-body transition-[border-color,background-color,color] duration-200 sm:w-auto sm:text-center',
                  active
                    ? 'border-[color:color-mix(in_srgb,var(--sil-alternate)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-alternate)_12%,transparent)] text-[color:var(--sil-ink-100)]'
                    : 'border-[color:var(--sil-rule)] bg-[color:rgb(242_244_248_/_0.02)] text-[color:var(--sil-ink-200)] hover:border-[color:var(--sil-rule-strong)]',
                ].join(' ')}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="sil-label sil-num">
          {questions.length > 1 ? `${index + 1} / ${questions.length}` : ''}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={goNext}
          className="sil-btn min-w-[132px]"
        >
          {busy ? '正在整理…' : isLast ? '继续' : '下一题'}
        </button>
      </div>
    </section>
  );
}

export default ClarificationStep;
