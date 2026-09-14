'use client';

import * as React from 'react';

import type { SessionChoiceView } from '@/components/game/session/types';

/**
 * 一条选项（Agent 03 §九 / §十 / §十一 / §二十七）。
 *
 * ## 三种状态，三种待遇
 *
 * ```text
 * available  一条人生路径：title + hint，别的什么都不给
 * unlocked   真实经验撕开的路：必须标出来源，且能点回原文
 * locked     还在，但做不了：必须说清为什么
 * ```
 *
 * ## 为什么这里看不到 DC / 骰面 / 属性
 *
 * 不是因为「记得不要渲染」，而是因为 `SessionChoiceView` 里**根本没有**
 * 这些字段（§九）。底层 legacy 选项仍然带 `check` / `difficulty`，
 * 但它们在 ViewModel 就被丢掉了。
 *
 * ## 锁定不是 `disabled opacity-50`
 *
 * §十一 明确反对那种做法：一条路为什么关闭，是这一版产品最想让人看见的
 * 信息之一。所以锁定的选项用 `session-choice__reason` 渲染原因，
 * 并且整块不可点。
 *
 * ## 结构与视觉的分工
 *
 * 这里只铺 `session-choice` / `__badge` / `__title` / `__hint` / `__reason`
 * 这组语义 class（04_AGENT §21 / §23 / §24 负责它们的样式）。
 * 移动端整块 `min-height: 44px`（`.session-choice` 已写死，§二十七）。
 */
export interface SessionChoiceCardProps {
  readonly choice: SessionChoiceView;
  readonly onChoose: (choiceId: string) => void;
  readonly onOpenSource: (choiceId: string) => void;
  readonly className?: string;
}

/** 选项左侧的世界线：hover 时向该选项偏移（报告 §13）。 */
function ChoiceWorldline({ accent }: { readonly accent: 'unlock' | 'normal' }) {
  const stroke = accent === 'unlock' ? 'var(--obs-path-soft)' : 'var(--obs-zhihu-soft)';
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 24"
      preserveAspectRatio="none"
      className="h-6 w-[64px] shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-1"
    >
      <line x1="2" y1="12" x2="112" y2="12" stroke={stroke} strokeWidth="1.2" opacity="0.6" />
      <circle cx="112" cy="12" r="2.4" fill={stroke} />
    </svg>
  );
}

export function SessionChoiceCard({
  choice,
  onChoose,
  onOpenSource,
  className = '',
}: SessionChoiceCardProps) {
  /* ---------- 锁定：不可选，但必须说清原因（§十一） ---------- */
  if (choice.state === 'locked') {
    return (
      <div
        className={['session-choice session-choice--locked', className].filter(Boolean).join(' ')}
        data-choice-state="locked"
        aria-disabled="true"
        role="group"
        aria-label={`暂时关闭的选择：${choice.title}`}
      >
        <span className="min-w-0 flex-1">
          <span className="ds-badge ds-badge--unknown">这条路暂时关闭</span>
          <span className="session-choice__title mt-2">{choice.title}</span>
          {choice.description ? (
            <span className="session-choice__hint">{choice.description}</span>
          ) : null}
          {/* 原因必须在场：没有原因也要给人话，绝不静默置灰。 */}
          <span className="session-choice__reason">{choice.lockedReason}</span>
        </span>
      </div>
    );
  }

  const isUnlock = choice.state === 'unlocked';

  return (
    <div
      className={[
        'session-choice group',
        isUnlock ? 'session-choice--unlocked' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-choice-state={choice.state}
    >
      {/*
        选择本身是一个独立按钮；「查看原文」是它的**兄弟**按钮。
        刻意不做嵌套 button —— 那会让键盘与读屏拿到两个互相打架的可点区域。
      */}
      <button
        type="button"
        onClick={() => onChoose(choice.id)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
      >
        {/* 序号由 CSS counter 生成：观象厅的每一条路都有编号 */}
        <span aria-hidden="true" className="session-choice__index" />
        <ChoiceWorldline accent={isUnlock ? 'unlock' : 'normal'} />
        <span className="min-w-0 flex-1">
          {isUnlock ? <span className="ds-badge ds-badge--unlock">经验解锁</span> : null}
          <span className="session-choice__title">{choice.title}</span>
          {choice.description ? (
            <span className="session-choice__hint">{choice.description}</span>
          ) : null}
        </span>
        {/* 箭头一律内联 SVG，不用 `→` 字符（DESIGN-SYSTEM §7 Don't #6） */}
        <span aria-hidden="true" className="session-choice__chevron">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M2.8 7h7.4M7.4 3.6 10.8 7l-3.4 3.4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* 解锁项必须有来源，并且能点回原文（§十 / §二十三）。 */}
      {isUnlock ? (
        <button
          type="button"
          onClick={() => onOpenSource(choice.id)}
          className="source-link shrink-0 self-end"
        >
          {choice.sourceLabel ?? '来自真实经历'} · 查看原文 ↗
        </button>
      ) : null}

      {isUnlock ? <span aria-hidden="true" className="session-choice__pulse" /> : null}
    </div>
  );
}

export default SessionChoiceCard;
