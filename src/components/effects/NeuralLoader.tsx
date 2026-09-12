'use client';

import * as React from 'react';

/**
 * CRT 神经信号加载动效。
 *
 * 真实 LLM 调用通常要 2–4 秒，这段时间舞台绝不能看起来「死了」。
 * 这里用滚动扫描条 + 轮换状态行 + CRT 扫描线，让等待本身成为演出的一部分。
 *
 * `prefers-reduced-motion` 下退化为静态文案，不做动画。
 */

const DEFAULT_LINES = [
  '正在建立神经链路 …',
  '检索知乎站内高赞讨论 …',
  '抽取矛盾点与沉没成本 …',
  '构建事件背景与检定难度 …',
  '校准刘看山情绪传感器 …',
] as const;

/** 处境解析阶段：输出很短，所以文案聚焦「读懂你」。 */
const PROFILE_LINES = [
  '正在读取你的处境 …',
  '识别背景与目标 …',
  '提取约束与恐惧 …',
  '规划四幕冲突 …',
] as const;

export interface NeuralLoaderProps {
  readonly phase?: 'profile' | 'turn';
  readonly lines?: readonly string[];
  readonly hint?: string;
  readonly className?: string;
}

export function NeuralLoader({
  phase = 'turn',
  lines,
  hint,
  className,
}: NeuralLoaderProps) {
  const activeLines = lines ?? (phase === 'profile' ? PROFILE_LINES : DEFAULT_LINES);
  const activeHint = hint ?? (phase === 'profile' ? 'AI 正在读懂你的处境' : 'AI 地下城主正在为你生成这一幕');
  const [index, setIndex] = React.useState(0);
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  React.useEffect(() => {
    if (reduced) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % activeLines.length);
    }, 1400);

    return () => window.clearInterval(timer);
  }, [activeLines.length, reduced]);

  return (
    <div
      className={[
        'relative overflow-hidden rounded-2xl border border-zhihu-500/25 bg-ink-900/85 px-4 py-3.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
    >
      {/* CRT 扫描线 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-scanline opacity-[0.18]" />

      {/* 滚动扫描条 */}
      {!reduced ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan-sweep bg-gradient-to-r from-transparent via-zhihu-400 to-transparent"
        />
      ) : null}

      <div className="relative flex items-center gap-3">
        <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zhihu-400 opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zhihu-500" />
        </span>

        <p className="font-mono text-xs text-zhihu-200">{activeLines[index]}</p>
      </div>

      {/* 进度条 */}
      <div className="relative mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
        {!reduced ? (
          <span className="absolute inset-y-0 w-1/3 animate-scan-sweep rounded-full bg-zhihu-500" />
        ) : (
          <span className="absolute inset-y-0 w-2/3 rounded-full bg-zhihu-500" />
        )}
      </div>

      <p className="relative mt-2 text-[10px] text-slate-500">{activeHint}</p>
    </div>
  );
}

export default NeuralLoader;
