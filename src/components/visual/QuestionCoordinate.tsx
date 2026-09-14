'use client';

import * as React from 'react';

/**
 * Question Coordinate —— 坐标输入器（报告 §5 / §6）。
 *
 * ## 不是 textarea，是一次「设定坐标」
 *
 * 报告 §5 要求把输入框做成 `QUESTION / 001` 这样的档案坐标：
 * 左上角编号、右下角一句「你的问题将成为这一局的坐标」、聚焦时
 * 边缘轻微变亮并有一条扫描线缓慢掠过 —— 但**不要强烈 glow**。
 *
 * ## 提交是一次空间转场
 *
 * 点击后输入框**压缩成一条光线**（报告 §6）。组件只负责这一帧的表演，
 * 真正的跳转由父组件在动画时间窗内完成，因此这里不写任何路由逻辑。
 */

export interface QuestionCoordinateProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly busy?: boolean;
  /** 提交中：输入框压缩成光线（报告 §6）。 */
  readonly collapsing?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly className?: string;
  /** 聚焦状态外泄，供背景世界线收束使用（报告 §4）。 */
  readonly onFocusChange?: (focused: boolean) => void;
}

export function QuestionCoordinate({
  value,
  onChange,
  onSubmit,
  busy = false,
  collapsing = false,
  maxLength = 200,
  placeholder = '例如：大三法学，想转计算机，但怕脱产找不到工作',
  className = '',
  onFocusChange,
}: QuestionCoordinateProps) {
  const [focused, setFocused] = React.useState(false);
  const locked = busy || collapsing;

  const setFocus = React.useCallback(
    (next: boolean) => {
      setFocused(next);
      onFocusChange?.(next);
    },
    [onFocusChange],
  );

  return (
    <div className={['relative', className].filter(Boolean).join(' ')}>
      <div
        className="sil-coordinate-frame relative overflow-hidden rounded-2xl border border-white/12 bg-archive-850/70 p-4"
        style={
          collapsing
            ? { animation: 'sil-collapse 620ms var(--sil-ease) both', transformOrigin: '50% 50%' }
            : undefined
        }
      >
        {/* 聚焦扫描线：缓慢掠过，不刺眼（报告 §5） */}
        {focused && !collapsing ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-2/5">
            <span className="sil-scan block h-full w-full bg-gradient-to-r from-transparent via-zhihu-400/12 to-transparent" />
          </span>
        ) : null}

        <div className="relative flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.3em] text-archive-600">
            QUESTION / 001
          </span>
          <span className="font-mono text-[10px] text-archive-600">{maxLength} 字以内</span>
        </div>

        <label htmlFor="goal" className="sr-only">
          你最近真正纠结什么？
        </label>
        <textarea
          id="goal"
          value={value}
          disabled={locked}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(event) => {
            // Enter 提交，Shift+Enter 换行 —— 长句子也能写得下
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          className="relative mt-3 w-full resize-none bg-transparent text-[15px] leading-relaxed text-archive-100 placeholder:text-archive-600 focus:outline-none disabled:opacity-60"
        />

        <div className="relative mt-2 flex items-end justify-between gap-3">
          <span className="text-[12px] leading-relaxed text-archive-400">
            你最近真正纠结什么？
          </span>
          <span className="shrink-0 text-right text-[11px] leading-relaxed text-archive-600">
            你的问题将成为
            <br />
            这一局的坐标
          </span>
        </div>
      </div>

      {/* 压缩后残留的一条光线（报告 §6） */}
      {collapsing ? (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-1/2 mx-auto block h-px max-w-[280px] bg-zhihu-300"
          style={{
            boxShadow: '0 0 18px 3px rgba(0,132,255,0.6)',
            animation: 'sil-beam-in 620ms var(--sil-ease) both',
          }}
        />
      ) : null}

      <button type="button" onClick={onSubmit} disabled={locked || value.trim().length === 0} className="door-btn mt-3">
        {busy ? '正在为你找路…' : '进入我的平行宇宙'}
      </button>
    </div>
  );
}

export default QuestionCoordinate;
