'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import type { ExperienceFact, SearchPurpose } from '@/features/experience/domain';

/**
 * 经验解锁的来源弹层（P0-9 的 WOW Point；外观 04_AGENT §26 / §27）。
 *
 * ## 它要回答的问题
 *
 * 玩家在推演里会看到一个**原本不存在的选项**。如果不解释它从哪来，
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
 *
 * ## 颜色语义（04_AGENT §5）
 *
 * 知乎蓝 = 真实来源；青蓝 = 新路径；琥珀 = 反例 / 冲突；灰蓝 = 未知。
 * 所以「反例（我们主动去找的）」是**琥珀**，不是红色警报。
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

const RELATION_CLASS: Readonly<Record<'same' | 'different' | 'unknown', string>> = {
  same: 'text-[color:var(--obs-path-soft)]',
  different: 'text-[color:var(--obs-counter-soft)]',
  unknown: 'text-[color:var(--obs-text-2)]',
};

/**
 * 检索意图的中文名（P0-3）。
 *
 * 三条纪律里「我们**主动**去找反例」是最容易被忽略、也最该被看见的一条 ——
 * 所以反例/失败使用琥珀并如实写出「我们主动去找的」。
 */
const PURPOSE_LABEL: Readonly<Record<SearchPurpose, string>> = {
  'similar-person': '相似经历',
  alternative: '另一种走法',
  failure: '失败经历',
  counterexample: '反例（我们主动去找的）',
  cost: '代价',
  outcome: '结果',
};

const NEGATIVE_PURPOSES: ReadonlySet<SearchPurpose> = new Set<SearchPurpose>([
  'failure',
  'counterexample',
]);

const FACT_TYPE_LABEL: Readonly<Record<ExperienceFact['type'], string>> = {
  condition: '当时条件',
  action: '做了什么',
  cost: '付出的代价',
  outcome: '结果',
  reflection: '后来的反思',
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
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[color:rgb(var(--obs-rgb-bg-0)/0.88)] p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="这条选择的来源"
        onClick={(event) => event.stopPropagation()}
        className="obs-glass obs-brackets obs-brackets--path relative max-h-[82vh] w-full max-w-md overflow-y-auto px-5 py-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="obs-kicker">Real Life / Zhihu</p>
            <h3 className="mt-1.5 text-sm font-bold text-[color:var(--obs-text-0)]">
              这条选择来自
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 border border-[color:rgb(var(--obs-rgb-text-0)/0.16)] px-2 py-0.5 text-[11px] text-[color:var(--obs-text-2)] transition-colors duration-200 hover:border-[color:rgb(var(--obs-rgb-text-0)/0.32)] hover:text-[color:var(--obs-text-0)]"
          >
            ✕
          </button>
        </header>

        {facts.length === 0 ? (
          <p className="mt-3 border border-[color:rgb(var(--obs-rgb-text-0)/0.1)] bg-[color:rgb(var(--obs-rgb-text-0)/0.02)] px-3 py-2 text-[11px] leading-relaxed text-[color:var(--obs-text-2)]">
            这条选择有一条经验片段，但它此刻不在本局蓝图里 —— 我们不会替你补一段原文。
          </p>
        ) : (
          <>
            {/* P0-3：把「AI 不许改一个字」这条纪律在评委眼前写死一次 */}
            <p className="mt-3 border border-[color:rgb(var(--obs-rgb-path-soft)/0.28)] bg-[color:rgb(var(--obs-rgb-path-soft)/0.06)] px-3 py-2 text-[11px] leading-relaxed text-[color:var(--obs-text-1)]">
              这段话<strong className="font-semibold text-[color:var(--obs-text-0)]">逐字</strong>
              来自知乎原文 —— AI 只负责挑选，不负责改写。
              <span className="mt-1 block font-mono text-[10px] text-[color:var(--obs-path-soft)]">
                校验：exactQuote ∈ source.quote ✓
              </span>
            </p>

            <ul className="mt-3 flex flex-col gap-3">
              {facts.map((fact) => (
                <li
                  key={fact.id}
                  className="border-l border-[color:rgb(var(--obs-rgb-zhihu)/0.5)] pl-3"
                >
                  {/* 逐字片段：引号包裹，视作证物 */}
                  <blockquote className="text-[12px] leading-relaxed text-[color:var(--obs-text-1)]">
                    <span className="mr-0.5 text-[color:var(--obs-text-2)]">“</span>
                    {fact.exactQuote}
                    <span className="ml-0.5 text-[color:var(--obs-text-2)]">”</span>
                  </blockquote>

                  {/* 检索意图：让「反例是我们主动去找的」可见 */}
                  {fact.purposes.length > 0 ? (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {[...new Set(fact.purposes)].map((purpose) => (
                        <span
                          key={purpose}
                          className={
                            NEGATIVE_PURPOSES.has(purpose)
                              ? 'border border-[color:rgb(var(--obs-rgb-counter)/0.42)] bg-[color:rgb(var(--obs-rgb-counter)/0.08)] px-2 py-0.5 text-[9px] tracking-[0.06em] text-[color:var(--obs-counter-soft)]'
                              : 'border border-[color:rgb(var(--obs-rgb-text-0)/0.14)] bg-[color:rgb(var(--obs-rgb-text-0)/0.03)] px-2 py-0.5 text-[9px] tracking-[0.06em] text-[color:var(--obs-text-2)]'
                          }
                        >
                          {PURPOSE_LABEL[purpose]}
                        </span>
                      ))}
                    </p>
                  ) : null}

                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[10px] text-[color:var(--obs-text-2)]">
                    <span>{fact.author}</span>
                    <span>·</span>
                    <span>{FACT_TYPE_LABEL[fact.type]}</span>
                    {fact.sourceUrl ? (
                      <>
                        <span>·</span>
                        <a
                          href={fact.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-semibold text-[color:var(--obs-zhihu-soft)] transition-opacity duration-200 hover:opacity-80"
                        >
                          知乎原文 ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        {differences.length > 0 ? (
          <div className="mt-4 border-t border-[color:rgb(var(--obs-rgb-text-0)/0.08)] pt-3">
            <p className="obs-kicker">与你的差异</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {differences.slice(0, 4).map((item) => (
                <li key={item.variable} className="text-[11px] leading-relaxed text-[color:var(--obs-text-1)]">
                  <span className="text-[color:var(--obs-text-0)]">{item.variable}</span>
                  <span className="mx-1 text-[color:var(--obs-text-2)]">·</span>
                  <span className={RELATION_CLASS[item.relation]}>
                    {RELATION_LABEL[item.relation]}
                  </span>
                  {item.experienceValue ? (
                    <span className="ml-1.5 text-[color:var(--obs-text-2)]">
                      他们：{item.experienceValue}
                    </span>
                  ) : null}
                  {item.userValue ? (
                    <span className="ml-1.5 text-[color:var(--obs-text-2)]">你：{item.userValue}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 border-t border-[color:rgb(var(--obs-rgb-text-0)/0.08)] pt-2.5 text-[10px] leading-relaxed text-[color:var(--obs-text-2)]">
          以上是<strong className="font-semibold text-[color:var(--obs-text-1)]">原文逐字片段</strong>
          ，没有改写、没有概括。它说明有人这样做过，
          不说明这样做会得到什么结果 —— 那需要你自己去验证。
        </p>
      </div>
    </div>,
    document.body,
  );
}

export default ExperienceSourceModal;
