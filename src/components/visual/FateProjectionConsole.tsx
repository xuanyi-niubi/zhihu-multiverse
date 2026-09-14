'use client';

import * as React from 'react';

import { SignalPulse } from '@/components/visual/SignalPulse';

/**
 * Fate Projection Console —— 命运投影台（04_AGENT §13 / §14 / §15）。
 *
 * ## 材质（§13）
 *
 * ```text
 * dark glass
 * 0.5~1px hairline
 * corner brackets
 * inner highlight
 * subtle scan line
 * ```
 *
 * 明确**不要**：强 glow、大 blur、街机 3D button。所以这里没有 `shadow-glow`、
 * 没有 `backdrop-blur`、没有下沿立体边 —— 玻璃的质感来自发丝线与内高光。
 *
 * ## 交互（§14）
 *
 * 聚焦时：Console 微亮 → 附近轨道 opacity +10%（父级通过 `onFocusChange` 收到
 * 信号）→ 主焦点出现 Signal Pulse。输入过程中**不**逐字触发夸张动画。
 *
 * ## 进入（§15）
 *
 * 点击 CTA：Console 轻微收缩 → 输入文字 opacity 0 → 中心 Signal Pulse →
 * 由调用方 `router.push`。总时长 600~800ms，不超过 1 秒。
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
      className={['obs-console relative', collapsing ? 'obs-console--collapsing' : '', className]
        .filter(Boolean)
        .join(' ')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) {
          onSubmit();
        }
      }}
    >
      <div
        className={[
          'obs-glass obs-brackets obs-brackets--path relative px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5',
          focused || collapsing ? 'obs-glass--focus' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* 静态细扫描线：材质，不动画 */}
        <span aria-hidden="true" className="obs-scanline" />
        {/* 左侧读数尺 + 聚焦时才亮起的一条光边 */}
        <span aria-hidden="true" className="obs-console__ruler" />
        <span aria-hidden="true" className="obs-console__edge" />

        <div className="flex items-baseline justify-between gap-3">
          <label className="obs-kicker block" htmlFor="fate-projection-input">
            {title}
          </label>
          <span aria-hidden="true" className="obs-console__coords">
            Input · 001
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
          className="ds-input obs-console__text mt-3 disabled:opacity-60"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="ds-btn-primary obs-console__cta group flex-1"
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

        <p className="mt-2.5 text-[11px] leading-relaxed text-[color:var(--obs-text-2)]">{hint}</p>
      </div>
    </form>
  );
}

export default FateProjectionConsole;
