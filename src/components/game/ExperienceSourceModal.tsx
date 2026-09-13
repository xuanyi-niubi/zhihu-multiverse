'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 经验解锁的来源弹层（P0-9 的 WOW Point）。
 *
 * ## 它要回答的问题
 *
 * 玩家在推演舱里会看到一个**原本不存在的选项**。如果不解释它从哪来，
 * 那个选项就只是「AI 又编了一个」——WOW 就消失了。
 *
 * 所以这里把来源摊开：
 *
 * ```text
 * 这条选择来自：答主 + 原文逐字片段 + 与你的差异 + 知乎原文链接
 * ```
 *
 * ## 三条纪律
 *
 * 1. **只显示逐字片段**。`exactQuote` 在抽取阶段已经过校验，
 *    不是来源原文子串的片段根本进不来（见 `experience/invariants.ts`）。
 *    这里不再做任何改写或摘要。
 * 2. **必须能点回原文**。没有链接的经验等于传说。
 * 3. **不显示任何聚合指标**。没有「多少人这么做」「成功率」——
 *    那类数字在本产品里被明令禁止。
 */

export interface ExperienceSourceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 解锁这条选择的片段（按 `sourceFactIds` 从蓝图里取出）。 */
  readonly facts: readonly ExperienceFact[];
  /** 与你的差异（来自蓝图路径的 `differencesFromUser`），可为空。 */
  readonly differences?: readonly {
    readonly variable: string;
    readonly relation: 'same' | 'different' | 'unknown';
    readonly userValue?: string;
    readonly experienceValue?: string;
  }[];
}

const RELATION_LABEL: Readonly<Record<'same' | 'different' | 'unknown', string>> = {
  same: '和你一样',
  different: '和你不同',
  unknown: '还不知道',
};

export function ExperienceSourceModal({
  open,
  onClose,
  facts,
  differences = [],
}: ExperienceSourceModalProps) {
  /** 只挂载后才允许 portal（SSR 阶段没有 document）。 */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  /** Esc 关闭：键盘可达性，不是装饰。 */
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-ink-900/85 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="这条选择的来源"
        onClick={(event) => event.stopPropagation()}
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl border border-zhihu-500/40 bg-ink-800/95 p-5 shadow-[0_0_80px_-24px_rgba(0,132,255,0.6)]"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.25em] text-zhihu-300">REAL EXPERIENCE</p>
            <h3 className="mt-1 text-sm font-bold text-white">这条选择来自</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg border border-white/12 px-2 py-0.5 font-mono text-[11px] text-slate-400 transition-colors duration-150 hover:border-white/30 hover:text-white"
          >
            ✕
          </button>
        </header>

        {facts.length === 0 ? (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
            这条选择有一条经验片段，但它此刻不在本局蓝图里 —— 我们不会替你补一段原文。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {facts.map((fact) => (
              <li key={fact.id} className="border-l-2 border-zhihu-500/40 pl-3">
                {/* 逐字片段：引号包裹，视作证物 */}
                <blockquote className="text-[12px] leading-relaxed text-slate-200">
                  <span className="mr-0.5 text-slate-600">“</span>
                  {fact.exactQuote}
                  <span className="ml-0.5 text-slate-600">”</span>
                </blockquote>

                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-slate-500">
                  <span>{fact.author}</span>
                  <span className="text-slate-600">·</span>
                  <span>{FACT_TYPE_LABEL[fact.type]}</span>
                  {fact.sourceUrl ? (
                    <>
                      <span className="text-slate-600">·</span>
                      <a
                        href={fact.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-semibold text-zhihu-300 hover:text-zhihu-100"
                      >
                        知乎原文 ↗
                      </a>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}

        {differences.length > 0 ? (
          <div className="mt-4 border-t border-white/8 pt-3">
            <p className="font-mono text-[10px] tracking-wider text-slate-500">与你的差异</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {differences.slice(0, 4).map((item) => (
                <li key={item.variable} className="text-[11px] leading-relaxed text-slate-400">
                  <span className="text-slate-200">{item.variable}</span>
                  <span className="mx-1 text-slate-600">·</span>
                  <span
                    className={
                      item.relation === 'different'
                        ? 'text-amber-300'
                        : item.relation === 'unknown'
                          ? 'text-slate-500'
                          : 'text-emerald-300'
                    }
                  >
                    {RELATION_LABEL[item.relation]}
                  </span>
                  {item.experienceValue ? (
                    <span className="ml-1.5 text-slate-500">他们：{item.experienceValue}</span>
                  ) : null}
                  {item.userValue ? (
                    <span className="ml-1.5 text-slate-500">你：{item.userValue}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 border-t border-white/8 pt-2.5 text-[10px] leading-relaxed text-slate-600">
          以上是<strong className="font-semibold text-slate-500">原文逐字片段</strong>
          ，没有改写、没有概括。它说明有人这样做过，
          不说明这样做会得到什么结果 —— 那需要你自己去验证。
        </p>
      </div>
    </div>,
    document.body,
  );
}

const FACT_TYPE_LABEL: Readonly<Record<ExperienceFact['type'], string>> = {
  condition: '当时条件',
  action: '做了什么',
  cost: '付出的代价',
  outcome: '结果',
  reflection: '后来的反思',
};

export default ExperienceSourceModal;
