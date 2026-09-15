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
        <span className="sil-label">
          {act.heading.roman} · {act.heading.number}
        </span>
        {children ? <div className="flex items-center gap-4">{children}</div> : null}
      </header>

      {/*
        幕标题随换幕显影（GAME-DESIGN §4.7）：扫描线（sil-act-sweep）扫过的同时，
        标题块用 fragment-materialize 重新显影一次 —— key 按幕号切换触发重挂载，
        同一幕内的重渲染不会重播。零新增 keyframes。
      */}
      <div
        key={`act-heading-${act.display}`}
        className="mt-5"
        style={{ animation: 'fragment-materialize 560ms var(--sil-ease) both' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="sil-title sil-title--act text-[22px] sm:text-[28px]">{act.heading.label}</h1>
          {/* 幕进度：三条刻度，走过的暗亮、当前的一条发青蓝光 */}
          <span className="sil-acthead__progress" aria-label={`第 ${act.display} 幕，共 ${act.total} 幕`}>
            {Array.from({ length: Math.max(1, act.total) }, (_, index) => {
              const step = index + 1;
              return (
                <span
                  key={`act-seg-${step}`}
                  className={[
                    'sil-acthead__index',
                    step === act.display
                      ? 'sil-acthead__index--on'
                      : step < act.display
                        ? 'sil-acthead__index--done'
                        : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              );
            })}
            <span className="sil-acthead__index-label">
              {String(act.display).padStart(2, '0')} / {String(act.total).padStart(2, '0')}
            </span>
          </span>
        </div>

        {/* 副标题来自 blueprint 的 titleHint；没有就不写一句编的。 */}
        {act.subtitle ? (
          <p className="mt-1.5 text-meta leading-relaxed text-archive-600">{act.subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

export default SessionActHeader;
