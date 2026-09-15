'use client';

import * as React from 'react';

import { SignalPulse } from '@/components/visual/SignalPulse';

/**
 * Fate Projection Console —— 命运投影台
 *
 * ## 这是一张「待显影的相纸」，不是一块控制台
 *
 * 旧版把它做成深色玻璃面板 + 静态扫描线 + 左侧读数尺 + `Input · 001` 坐标。
 * 那些元素单独看都有理由，合起来的问题是：**它在扮演一台机器，而不是
 * 在邀请人写下自己的困惑**。而「扫描线 + 坐标 + 玻璃面板」恰好也是
 * AI 生成界面的常见套话。
 *
 * 新版的语言来自暗房：一张还没显影的相纸，四周是压暗的暗房环境。
 * 输入即「曝光」，提交即「显影」。
 *
 * ## 修掉的两个真实缺陷
 *
 * **1. 打字时字太小。** 旧版提示行 11px、标签 10px。移动端这两处
 * 都在可读性红线以下（<12px），实测被审计脚本抓到。
 *
 * **2. 焦点脉冲的尺寸跳变。** 旧版 `size={focused ? 24 : 16}` 让这颗
 * 带 14px 外发光的点在一次点击里**瞬间**变大 125%，没有过渡 ——
 * 这正是「首页随便点一下就闪蓝、像卡住」的根因（见
 * `.workbuddy/memory/2026-09-14.md`）。现在尺寸变化交给 CSS 过渡，
 * 并且**不再带外发光**（发光是旧代的装饰语言）。
 */

export interface FateProjectionConsoleProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly busy?: boolean;
  /** 点击 CTA 之后、真正的转场期间：Console 收缩、文字消失。 */
  readonly collapsing?: boolean;
  readonly onFocusChange?: (focused: boolean) => void;
  /** 输入标题（§9 固定文案：你最近真正纠结什么？）。 */
  readonly title?: string;
  readonly placeholder?: string;
  readonly ctaLabel?: string;
  /** 按钮下方小字（§9：我们不会替你决定。）。 */
  readonly hint?: string;
  readonly className?: string;
}

export function FateProjectionConsole({
  value,
  onChange,
  onSubmit,
  busy = false,
  collapsing = false,
  onFocusChange,
  title = '你最近真正纠结什么？',
  placeholder = '比如：我大二，想参加比赛，但怕课程跟不上……',
  ctaLabel = '进入我的平行宇宙',
  hint = '我们不会替你决定。',
  className = '',
}: FateProjectionConsoleProps) {
  const [focused, setFocused] = React.useState(false);
  const disabled = busy || value.trim().length === 0;

  const setFocus = React.useCallback(
    (next: boolean) => {
      setFocused(next);
      onFocusChange?.(next);
    },
    [onFocusChange],
  );

  return (
    <form
      className={['relative transition-[transform,opacity] duration-500', className]
        .filter(Boolean)
        .join(' ')}
      style={{
        transform: collapsing ? 'scale(0.985)' : undefined,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) {
          onSubmit();
        }
      }}
    >
      <div
        className={[
          'sil-panel relative px-4 pb-5 pt-4 transition-colors duration-300 sm:px-5 sm:pb-6 sm:pt-5',
          focused || collapsing ? 'border-[color:color-mix(in_srgb,var(--sil-alternate)_42%,transparent)]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex items-baseline justify-between gap-3">
          <label className="sil-label text-label" htmlFor="fate-projection-input">
            {title}
          </label>
          <span aria-hidden="true" className="sil-label sil-label--sm sil-num">
            待显影
          </span>
        </div>

        <textarea
          id="fate-projection-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled) {
                onSubmit();
              }
            }
          }}
          rows={4}
          disabled={busy}
          placeholder={placeholder}
          aria-label={title}
          className="sil-input mt-3 disabled:opacity-60"
          style={{
            opacity: collapsing ? 0 : undefined,
            transition: 'opacity 400ms var(--sil-ease)',
          }}
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="sil-btn group flex-1"
          >
            {busy ? '正在建立坐标…' : ctaLabel}
          </button>

          {/* 中心脉冲：聚焦时呼吸，点击后成为唯一一次转场信号 */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center">
            <SignalPulse
              once={collapsing}
              size={focused || collapsing ? 24 : 16}
              tone="path"
              label={collapsing ? '正在进入你的平行宇宙' : undefined}
            />
          </span>
        </div>

        <p className="mt-3 text-meta leading-relaxed text-[color:var(--sil-ink-300)]">{hint}</p>
      </div>
    </form>
  );
}

export default FateProjectionConsole;
