'use client';

import * as React from 'react';

/**
 * Sentence Reforge —— 问题重塑（04_AGENT §31）。
 *
 * ## 终局第一视觉
 *
 * 这一局结束时，屏幕上只剩两句话：
 *
 * ```text
 * 原问题    小号（他一个月前问的那句话）
 * 新问题    Hero（他真正值得验证的那句话）
 * ```
 *
 * ## 动画（1200~1600ms）
 *
 * ```text
 * 旧关键词淡散  →  .obs-reforged__old（sentence-reforge 反向，800ms）
 * 新条件向上浮现 →  .obs-reforged__new（sentence-reforge，1000ms，延迟 500ms）
 * 新句子定型
 * ```
 *
 * 新问题**必须**来自本局的 `keyUnknown`：没有就如实说没有，不允许为了动画
 * 好看编一个问题出来（§21 与全局纪律同源）。
 *
 * 视觉组件不得 fetch API（§7）。
 */

export interface SentenceReforgeProps {
  /** 玩家开始时问的那句话（来自 DecisionSession，未被润色覆盖）。 */
  readonly original: string;
  /** 这一局真正值得验证的问题（来自 keyUnknown）；没有就是 null。 */
  readonly rewritten: string | null;
  readonly className?: string;
}

export function SentenceReforge({ original, rewritten, className = '' }: SentenceReforgeProps) {
  const next = typeof rewritten === 'string' ? rewritten.trim() : '';

  return (
    <section
      className={['relative', className].filter(Boolean).join(' ')}
      aria-label="问题重写"
    >
      {/* 原问题：小号，并渐渐淡下去（它是背景，不是结论） */}
      <p className="sil-reforged__old max-w-[42ch] text-meta leading-relaxed text-[color:var(--sil-ink-300)]">
        {original}
      </p>

      {next.length > 0 ? (
        <p
          key={next}
          className="sil-reforged__new mt-4 max-w-[24ch] text-[26px] font-semibold leading-[1.35] tracking-tight text-[color:var(--sil-ink-100)] sm:text-[32px]"
        >
          {next}
        </p>
      ) : (
        /*
         * 没有收敛出未知：如实说，并保留原问题。
         * 这里刻意不给一个「更好听的问题」——那会是编造。
         */
        <p className="mt-4 max-w-[34ch] text-body leading-relaxed text-[color:var(--sil-ink-200)]">
          这一局没有收敛出一个新的问题 —— 但你已经看见了别人怎么走过它。
        </p>
      )}
    </section>
  );
}

export default SentenceReforge;
