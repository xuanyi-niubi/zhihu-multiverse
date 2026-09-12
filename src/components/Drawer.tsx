'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * 右侧滑出抽屉。
 *
 * 命途树与遗物栏共用同一个容器：把常驻的「仪表盘」收进按需展开的面板，
 * 让主舞台独占视线。遮罩点击关闭，Esc 关闭，焦点在打开时移入面板。
 */

export interface DrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

export function Drawer({ open, title, subtitle, onClose, children }: DrawerProps) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKey);
    panelRef.current?.focus();

    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[65]">
      <button
        type="button"
        aria-label="关闭面板"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-ink-950/60 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="scrollbar-thin absolute right-0 top-0 flex h-full w-full animate-slide-in-right flex-col border-l border-white/10 bg-ink-900/96 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.95)] sm:w-[400px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{subtitle}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.04] text-slate-400 transition-colors duration-150 hover:border-white/25 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default Drawer;
