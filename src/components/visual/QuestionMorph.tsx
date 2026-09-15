'use client';

import * as React from 'react';

/**
 * Question Morph —— 「问题变清楚」的视觉化（报告 §23 / §24 / §26.6）。
 *
 * ## 这是整局的最终余味
 *
 * 报告 §23 说，结局要让人理解：「我的问题比进来时更具体了。」
 * 所以这里不做 fade，而是做一次**形变**：原问题逐渐退到背景，
 * 新的、可验证的问题从下方浮现。中间那句「现在真正值得验证的是：」
 * 是把两次提问连起来的一座桥。
 *
 * ## 一条不可违反的诚实性约束
 *
 * 新问题只能来自 `keyUnknown`。没有收敛出未知时，**必须如实说没有**，
 * 不能为了让结局好看而编一个更精确的问题 —— 那正是产品最反对的事。
 */

export interface QuestionMorphProps {
  readonly original: string;
  readonly rewritten: string | null;
  /** false 时直接呈现最终态，不播动画（用于无动画/低动效场景）。 */
  readonly active?: boolean;
  readonly className?: string;
}

export function QuestionMorph({
  original,
  rewritten,
  active = true,
  className = '',
}: QuestionMorphProps) {
  const changed = typeof rewritten === 'string' && rewritten.trim().length > 0 && rewritten.trim() !== original.trim();
  const next = changed ? (rewritten as string).trim() : null;

  return (
    <section className={['flex flex-col', className].filter(Boolean).join(' ')} aria-label="问题重写">
      <p className="font-mono text-micro tracking-[0.28em] text-archive-600">你进来时问：</p>
      <p
        className="mt-1.5 text-body leading-relaxed text-archive-400"
        style={
          changed && active
            ? { animation: 'sil-morph-fade 900ms var(--sil-ease) both', animationDelay: '320ms' }
            : undefined
        }
      >
        {original}
      </p>

      {next ? (
        <div
          style={
            active
              ? { animation: 'sil-morph-rise 1000ms var(--sil-ease) both', animationDelay: '1100ms' }
              : undefined
          }
        >
          <p className="mt-5 font-mono text-micro tracking-[0.28em] text-zhihu-300">
            现在真正值得验证的是：
          </p>
          <p className="mt-2 text-[18px] font-bold leading-[1.7] text-archive-100 sm:text-[21px]">
            {next}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-meta leading-relaxed text-archive-600">
          这一局没有收敛出一个更精确的问题 —— 我们不会替你编一个。
        </p>
      )}
    </section>
  );
}

export default QuestionMorph;
