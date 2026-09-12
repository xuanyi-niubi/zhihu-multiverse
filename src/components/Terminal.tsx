'use client';

import * as React from 'react';

/**
 * 打字机动效。
 *
 * 设计约束：
 * - 尊重 `prefers-reduced-motion`，命中时直接整段呈现，不做逐字动画；
 * - 文本变化时自动重播；
 * - 支持「跳过」：跳过标志写入 ref，正在跑的 interval 会在下一帧停止切片，
 *   不会把已经补全的文本又覆盖回短前缀；
 * - 组件卸载时清理 timeout / interval。
 */

export interface TypewriterOptions {
  /** 每个 tick 的间隔（毫秒）。 */
  readonly speed?: number;
  /** 每个 tick 推进的字符数。 */
  readonly chunkSize?: number;
  /** 开始前的延迟（毫秒）。 */
  readonly startDelay?: number;
  /** 传 false 可暂停；用于「等玩家看完上一段再开始」。 */
  readonly enabled?: boolean;
}

export interface TypewriterState {
  readonly visible: string;
  readonly done: boolean;
  readonly progress: number;
  readonly skip: () => void;
}

/** 监听系统「减少动态效果」设置。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);

    update();
    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function useTypewriter(text: string, options: TypewriterOptions = {}): TypewriterState {
  const { speed = 24, chunkSize = 1, startDelay = 0, enabled = true } = options;

  const [visible, setVisible] = React.useState('');
  const [done, setDone] = React.useState(false);
  const skipRef = React.useRef(false);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    skipRef.current = false;

    if (!enabled || reduced || text.length === 0) {
      setVisible(text);
      setDone(true);
      return;
    }

    setVisible('');
    setDone(false);

    let index = 0;
    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const finish = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      setDone(true);
    };

    timeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        if (skipRef.current) {
          finish();
          return;
        }

        index = Math.min(text.length, index + Math.max(1, chunkSize));
        setVisible(text.slice(0, index));

        if (index >= text.length) {
          finish();
        }
      }, Math.max(8, speed));
    }, Math.max(0, startDelay));

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [text, speed, chunkSize, startDelay, enabled, reduced]);

  const skip = React.useCallback(() => {
    skipRef.current = true;
    setVisible(text);
    setDone(true);
  }, [text]);

  return {
    visible,
    done,
    progress: text.length === 0 ? 1 : Math.min(1, visible.length / text.length),
    skip,
  };
}

export type TerminalTone = 'story' | 'system' | 'danger';

export interface TerminalProps {
  /** 要逐字呈现的正文。用 `\n\n` 分段即可，组件按 pre-line 渲染。 */
  readonly text: string;
  readonly title?: string;
  readonly tone?: TerminalTone;
  readonly speed?: number;
  readonly chunkSize?: number;
  readonly startDelay?: number;
  readonly enabled?: boolean;
  /** 打完最后一个字时触发一次（同一段文本只触发一次）。 */
  readonly onComplete?: () => void;
  readonly className?: string;
}

const TONE_HEADER: Record<TerminalTone, string> = {
  story: 'text-zhihu-300',
  system: 'text-slate-300',
  danger: 'text-rose-300',
};

const TONE_BORDER: Record<TerminalTone, string> = {
  story: 'border-zhihu-500/30',
  system: 'border-white/10',
  danger: 'border-relic-danger/40',
};

const TONE_TEXT: Record<TerminalTone, string> = {
  story: 'text-slate-200',
  system: 'text-slate-300',
  danger: 'text-rose-100',
};

export function Terminal({
  text,
  title = '推演终端',
  tone = 'story',
  speed = 24,
  chunkSize = 1,
  startDelay = 0,
  enabled = true,
  onComplete,
  className,
}: TerminalProps) {
  const { visible, done, skip } = useTypewriter(text, { speed, chunkSize, startDelay, enabled });
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const notifiedRef = React.useRef<string | null>(null);

  // 文本增长时把视口钉在底部，长段落不会把新字挤到看不见的地方。
  React.useEffect(() => {
    const node = bodyRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [visible]);

  React.useEffect(() => {
    if (!done || notifiedRef.current === text) {
      return;
    }

    notifiedRef.current = text;
    onComplete?.();
  }, [done, text, onComplete]);

  const handleSkip = React.useCallback(() => {
    if (!done) {
      skip();
    }
  }, [done, skip]);

  return (
    <section className={['panel flex flex-col', TONE_BORDER[tone], className].filter(Boolean).join(' ')}>
      <header className="panel-header">
        <h3 className={['panel-title font-mono', TONE_HEADER[tone]].join(' ')}>
          <span aria-hidden="true" className="text-zhihu-500">
            ▍
          </span>
          {title}
        </h3>

        <div className="flex items-center gap-2">
          <span className={done ? 'chip' : 'chip-zhihu'}>{done ? '已输出' : '推演中'}</span>
          {!done ? (
            <button
              type="button"
              onClick={handleSkip}
              className="rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400 transition-colors duration-150 hover:border-white/25 hover:text-white"
            >
              跳过
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={bodyRef}
        role="log"
        aria-live="polite"
        aria-label={title}
        tabIndex={0}
        onClick={handleSkip}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleSkip();
          }
        }}
        className={[
          'scrollbar-thin max-h-[280px] min-h-[148px] overflow-y-auto px-4 py-4 font-mono text-sm leading-loose',
          TONE_TEXT[tone],
          done ? 'cursor-default' : 'cursor-pointer',
        ].join(' ')}
      >
        {/* 屏幕阅读器直接读完整文本，避免逐字播报的噪音 */}
        <span className="sr-only">{text}</span>

        <p aria-hidden="true" className="whitespace-pre-line">
          {visible}
          {!done ? (
            <span className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-caret-blink bg-zhihu-400 align-middle" />
          ) : null}
        </p>
      </div>
    </section>
  );
}

export default Terminal;
