'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { similarityTierLabel } from '@/features/experience/similarityCopy';

/**
 * 编译页的来源详情（你截图那一屏的「点一下看详情 / 回原文」）。
 *
 * ## 为什么编译页也需要它
 *
 * 原先编译页只露两行碎片，纪律是「想看完整的、想点原文，进 Play 再说」。
 * 但自动跳转被去掉之后（见 `src/app/session/[id]/page.tsx` 的说明），
 * 编译页成了玩家**真正会停留**的一屏：他在这儿看见有人活过这条路，
 * 想知道这句话完整是什么、是谁说的、去哪看原文 —— 而那一屏此前
 * 一个可点的东西都没有，`sourceUrl` 甚至没被传下来。
 *
 * 这与 `ExperienceSourceModal`（Play 里解锁选项的来源弹层）同源：
 * 同一条纪律「**必须能点回原文**。没有链接的经验等于传说」，只是入口不同 ——
 * 那边是「这条选择从哪来」，这边是「这条切片从哪来」。
 *
 * ## 三条纪律
 *
 * 1. **逐字原文，不做加工**。这里显示的就是 `exactQuote`，不摘要、不改写。
 * 2. **原文链接一律新开标签**，`rel="noreferrer noopener"`。
 * 3. **不显示任何聚合指标**（没有「多少人这么做」「成功率」）。
 *
 * 视觉组件不得 fetch API（§7）：它只接收已经算好的一个字段集。
 */

export type SourceDialogTrack = 'similar' | 'alternative' | 'counter';

export interface SessionSourceDialogData {
  readonly id: string;
  /** 逐字原文（`ExperienceFact.exactQuote`）。 */
  readonly quote: string;
  readonly author: string;
  readonly title?: string | null;
  readonly sourceEditTime?: number | null;
  readonly qualification?: import('@/features/experience/domain').SourceQualification;
  /** 没有可点回的原链接时为 null —— 此时如实说明，不伪造一个入口。 */
  readonly sourceUrl: string | null;
  readonly track: SourceDialogTrack;
}

export interface SessionSourceDialogProps {
  readonly data: SessionSourceDialogData | null;
  readonly onClose: () => void;
}

/** 三条轨道在产品语言里的名字（与 `features/visual/archive.ts` 单一事实源一致）。 */
const TRACK_LABEL: Readonly<Record<SourceDialogTrack, string>> = {
  similar: '与你相似',
  alternative: '另一种走法',
  counter: '相反结果',
};

/**
 * 轨道 → 银盐设计系统的来源修饰符。
 *
 * 这里刻意**再写一张表**而不是 `sil-mark--${track}`：产品语言的
 * 「相似 / 另一种 / 相反」与设计系统的「zhihu / alternate / counter」
 * 是两套词汇，直接拼会得到不存在的类名（表现是三条轨道都不上色、不报错）。
 * 同一张映射在 `FragmentShard.tsx` 里有一份，两处必须同时改。
 */
const TRACK_MODIFIER: Readonly<Record<SourceDialogTrack, string>> = {
  similar: 'zhihu',
  alternative: 'alternate',
  counter: 'counter',
};

export function SessionSourceDialog({ data, onClose }: SessionSourceDialogProps) {
  /** 只挂载后才允许 portal（SSR 阶段没有 document）。 */
  const [mounted, setMounted] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => setMounted(true), []);

  const open = data !== null;

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
  }, [onClose, open]);

  /**
   * 打开时锁住页面滚动、把焦点交给关闭键。
   *
   * 编译页在它下面还会继续渲染轨道与 CTA，不锁滚动的话滚轮会穿透到背后；
   * 焦点不交过去的话 Esc / Tab 之后用户会迷失在背后的 DOM 里。
   */
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!mounted || !data) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[color:rgb(var(--sil-rgb-void-900)/0.88)] p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="这条真实经历"
        onClick={(event) => event.stopPropagation()}
        className="sil-panel sil-brackets relative max-h-[82vh] w-full max-w-md overflow-y-auto px-5 py-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="sil-label">Real Life / Zhihu</p>
            <h3 className="mt-1.5 text-sm font-bold text-[color:var(--sil-ink-100)]">
              这句话来自
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 border border-[color:rgb(var(--sil-rgb-ink-100)/0.16)] px-2 py-0.5 text-label text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:border-[color:rgb(var(--sil-rgb-ink-100)/0.32)] hover:text-[color:var(--sil-ink-100)]"
          >
            ✕
          </button>
        </header>

        {data.title ? (
          <h4 className="mt-3 text-body font-semibold leading-relaxed text-[color:var(--sil-ink-100)]">
            {data.title}
          </h4>
        ) : null}

        {data.qualification ? (
          <div className="mt-3 border-l border-[color:rgb(var(--sil-rgb-counter-soft)/0.45)] pl-3 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
            <p>相似层级：{similarityTierLabel(data.qualification.similarityTier)}</p>
            {data.qualification.matchedOriginTerms.length > 0 ? (
              <p>起点命中：{data.qualification.matchedOriginTerms.join('、')}</p>
            ) : null}
            {data.qualification.matchedTargetTerms.length > 0 ? (
              <p>目标命中：{data.qualification.matchedTargetTerms.join('、')}</p>
            ) : null}
            {data.qualification.matchedConstraints.length > 0 ? (
              <p>与你相同：{data.qualification.matchedConstraints.join('、')}</p>
            ) : (
              <p>没有确认到与你完全相同的条件。</p>
            )}
            {data.qualification.differentConstraints.length > 0 ? (
              <p>与你不同：{data.qualification.differentConstraints.join('、')}</p>
            ) : null}
            {data.qualification.unknownConstraints.length > 0 ? (
              <p>尚不确定：{data.qualification.unknownConstraints.slice(0, 3).join('、')}</p>
            ) : null}
          </div>
        ) : null}

        {/* 纪律写在界面上：「逐字」不是我们的润色，是校验过的事实 */}
        <p className="mt-3 border border-[color:rgb(var(--sil-rgb-alternate-soft)/0.28)] bg-[color:rgb(var(--sil-rgb-alternate-soft)/0.06)] px-3 py-2 text-label leading-relaxed text-[color:var(--sil-ink-200)]">
          这段话<strong className="font-semibold text-[color:var(--sil-ink-100)]">逐字</strong>
          来自知乎原文 —— AI 只负责挑选，不负责改写。
          <span className="mt-1 block font-mono text-micro text-[color:var(--sil-alternate-soft)]">
            校验：exactQuote ∈ source.quote ✓
          </span>
        </p>

        {/* 完整逐字片段：编译页上只露两行，这里给它应有的位置 */}
        <figure className="mt-4 border-l border-[color:rgb(var(--sil-rgb-zhihu)/0.5)] pl-3">
          <blockquote className="text-meta leading-relaxed text-[color:var(--sil-ink-200)]">
            <span className="mr-0.5 text-[color:var(--sil-ink-300)]">“</span>
            {data.quote}
            <span className="ml-0.5 text-[color:var(--sil-ink-300)]">”</span>
          </blockquote>
          <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 text-micro text-[color:var(--sil-ink-300)]">
            <span className={`sil-mark sil-mark--${TRACK_MODIFIER[data.track]}`}>
              {TRACK_LABEL[data.track]}
            </span>
            <span>{data.author}</span>
            {data.sourceEditTime ? (
              <span>{new Date(data.sourceEditTime * 1000).getUTCFullYear()}</span>
            ) : null}
          </figcaption>
        </figure>

        {/*
          出路只有一条，且它是真的：没有 `sourceUrl` 时不画一个假链接，
          如实说明「这条没有可点回的原链接」。
        */}
        {data.sourceUrl ? (
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="sil-btn mt-4 inline-flex w-full items-center justify-center"
          >
            去知乎看原回答 ↗
          </a>
        ) : (
          <p className="mt-4 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
            这一段没有带回可点开的原链接 —— 我们不会伪造一个。
          </p>
        )}

        <p className="mt-4 border-t border-[color:rgb(var(--sil-rgb-ink-100)/0.08)] pt-2.5 text-micro leading-relaxed text-[color:var(--sil-ink-300)]">
          它说明有人这样做过，不说明这样做会得到什么结果 —— 那需要你自己去验证。
        </p>
      </div>
    </div>,
    document.body,
  );
}

export default SessionSourceDialog;
