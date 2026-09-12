'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { sourceBadgeLabel } from '@/features/run/knowledgeSource';

/**
 * 知乎知识溯源角标。
 *
 * 舞台上的每一句「知乎金句」都挂着这个角标：点开能看到答主、赞同数、
 * 原回答摘要，以及一个跳转知乎的链接。目的有两个——
 * 让 AI 生成的内容有据可查，以及把流量导回知乎生态。
 *
 * 浮层用 Portal 渲染到 body 并采用 fixed 定位：对话框本身是 `overflow-y-auto`
 * 的滚动容器，绝对定位的浮层会被它裁掉（实测过一次），Portal 是唯一干净的解法。
 *
 * 注意：**只有 `status === 'verified'` 的来源才允许出现赞同数**。
 * 预置剧本在未接入开放平台 key 时标记为 `scripted`，此时角标只说
 * 「剧本模拟引用」，绝不编一个数字冒充社区数据（详见 features/run/knowledgeSource.ts）。
 */

export interface SourceBadgeData {
  readonly author: string;
  readonly quote: string;
  readonly sourceUrl: string;
  readonly upvotes?: number;
  readonly answerId?: string;
  /** `verified` 仅在真数据（运行时检索或 sync 快照）时出现。 */
  readonly status?: 'verified' | 'scripted';
  /** 抓取时间，用于浮层里标注「数据是什么时候的」。 */
  readonly retrievedAt?: string | null;
}

const POPOVER_WIDTH = 290;
const GAP = 8;
const MARGIN = 8;

interface PopoverPosition {
  readonly top: number;
  readonly left: number;
}

export function SourceBadge({
  source,
  className,
}: {
  readonly source: SourceBadgeData;
  readonly className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState<PopoverPosition | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }

    const measure = () => {
      const anchor = triggerRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const height = popoverRef.current?.offsetHeight ?? 200;
      const spaceAbove = rect.top - MARGIN;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;

      const placement =
        spaceAbove >= height + GAP || spaceAbove >= spaceBelow ? 'top' : 'bottom';

      const top = placement === 'top' ? rect.top - height - GAP : rect.bottom + GAP;
      const left = Math.min(
        Math.max(MARGIN, rect.right - POPOVER_WIDTH),
        Math.max(MARGIN, window.innerWidth - POPOVER_WIDTH - MARGIN),
      );

      setPosition({ top, left });
    };

    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // 文案规则收在 features/run/knowledgeSource.ts：**scripted 分支永远不含数字**
  const { label, tone } = sourceBadgeLabel(source);

  return (
    <div ref={containerRef} className={['relative', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${label}，点击查看来源`}
        className={[
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors duration-150',
          open
            ? 'border-zhihu-500/70 bg-zhihu-500/15 text-zhihu-200'
            : 'border-white/12 bg-white/[0.04] text-slate-400 hover:border-zhihu-500/50 hover:text-zhihu-300',
        ].join(' ')}
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.1 6.1 20.2l1.2-6.6L2.5 9l6.6-.9L12 2z" />
        </svg>
        {label}
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="知乎来源"
              style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                width: POPOVER_WIDTH,
              }}
              className={[
                'fixed z-[80] rounded-2xl border border-white/12 bg-ink-800/97 p-3.5 shadow-[0_28px_70px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl transition-opacity duration-150',
                position ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">
                {tone === 'verified' ? 'ZHIHU SOURCE' : 'SCRIPTED REFERENCE'}
              </p>

              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-white">
                  @{source.author}
                  {tone === 'scripted' ? ' · 剧本模拟' : ''}
                </p>
                {tone === 'verified' && typeof source.upvotes === 'number' ? (
                  <span className="chip-zhihu shrink-0">
                    赞同 {source.upvotes.toLocaleString('zh-CN')}
                  </span>
                ) : (
                  <span className="shrink-0 rounded border border-white/12 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                    剧本模拟
                  </span>
                )}
              </div>

              {tone === 'verified' ? (
                source.retrievedAt ? (
                  <p className="mt-1 font-mono text-[9px] text-slate-600">
                    抓取于 {source.retrievedAt.slice(0, 10)}
                  </p>
                ) : null
              ) : (
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  这条引用是剧本模拟内容，**不是**检索到的真实回答。配置知乎开放平台
                  Access Secret 并运行 <span className="font-mono">npm run sync:zhihu</span> 后，
                  这里会换成带赞同数的真实来源。
                </p>
              )}

              <p className="mt-2 border-l-2 border-zhihu-500/50 pl-2.5 text-[11px] leading-relaxed text-slate-300">
                {source.quote}
              </p>

              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-zhihu-500 px-3 py-2 text-[11px] font-semibold text-white transition-colors duration-150 hover:bg-zhihu-600"
              >
                打开知乎原回答
                <span aria-hidden="true">↗</span>
              </a>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default SourceBadge;
