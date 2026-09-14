'use client';

import * as React from 'react';

import type { SessionPlayView } from '@/components/game/session/types';

/**
 * 幕头（Agent 03 §十二 / §二十七）。
 *
 * ## 两层结构
 *
 * ```text
 * .session-act-header   ← 顶栏：ACT 罗马数字 + 右侧插槽（借来的经验 / 换一个问题）
 * 幕标题块              ← 走进去 / 代价出现 / 另一个答案 + blueprint subtitle
 * ```
 *
 * 顶栏用的是 Agent 04 在 `globals.css` 里发布的那组语义 class
 * （`.session-act-header` / `.session-choice` / `.session-story` …）——
 * 视觉归他们，结构与数据归这里。
 *
 * ## 三幕文案是固定的，事实源却不是它
 *
 * ```text
 * ACT I    走进去
 * ACT II   代价出现
 * ACT III  另一个答案
 * ```
 *
 * 这三句是**皮**：真正的判断在 `blueprint.acts[].objective` 里，组件只把
 * ViewModel 算好的 `heading` 画出来。所以换 blueprint 不会出现
 * 「文案说第三幕、数据是第二幕」的错位。
 *
 * 幕号显示 `01 / 03` 用的是 `act.display` —— ViewModel 里唯一的 +1 落点（§十三）。
 */
export interface SessionActHeaderProps {
  readonly act: SessionPlayView['act'];
  /** 顶栏右侧插槽（借来的经验 / 换一个问题）。 */
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function SessionActHeader({ act, children, className = '' }: SessionActHeaderProps) {
  return (
    <div className={['session-act-header-block', className].filter(Boolean).join(' ')} data-act-index={act.index}>
      <header className="session-act-header">
        <span className="obs-kicker">
          {act.heading.roman} · {act.heading.number}
        </span>
        {children ? <div className="flex items-center gap-4">{children}</div> : null}
      </header>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-bold leading-snug text-archive-100">{act.heading.label}</h1>
          <span className="font-mono text-[10px] tracking-[0.2em] text-archive-600">
            {String(act.display).padStart(2, '0')} / {String(act.total).padStart(2, '0')}
          </span>
        </div>

        {/* 副标题来自 blueprint 的 titleHint；没有就不写一句编的。 */}
        {act.subtitle ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-archive-600">{act.subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

export default SessionActHeader;
