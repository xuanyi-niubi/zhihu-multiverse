'use client';

import * as React from 'react';
import Link from 'next/link';

import { KanshanSprite } from '@/components/characters/KanshanSprite';

/**
 * 路由级错误边界。
 *
 * 和 404 同一个理由：不能把用户直接甩给 Next 的默认英文报错页。
 * 但这里有一条额外的纪律 —— **不假装没事**。
 *
 * - 不显示 `error.message`：那是给人排障的，不是给玩家读的；
 *   真正的错误信息留在 console（含 digest），服务端日志能对上。
 * - 不自动重试：重试由玩家决定，不替他做主张（和产品「AI 不替你做决定」一致）。
 */
export default function RouteError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  React.useEffect(() => {
    // digest 是服务端日志里的关联 id，出问题时照着它去查。
    console.error('[zhihu-multiverse] route error', error.digest ?? error.message);
  }, [error]);

  return (
    <main
      id="main-content"
      className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col justify-center px-5 py-16 sm:px-8"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="sil-label">Observation Interrupted</p>
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
        >
          回到观测台
        </Link>
      </header>

      <section className="mt-8">
        <h1 className="sil-title sil-title--act">这一局没能算完</h1>
        <p className="sil-prose mt-4">观测中途断了。你的问题还在，可以再来一次。</p>
      </section>

      <section className="sil-panel mt-8 flex items-center gap-4 px-5 py-5">
        <KanshanSprite
          characterId="kanshan"
          action="sway"
          className="h-[64px] w-[64px] shrink-0"
          alt="刘看山"
        />
        <p className="sil-prose text-[13px] leading-relaxed text-[color:var(--sil-ink-300)]">
          ……刚才那一下，不算数。
        </p>
      </section>

      <section className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={reset} className="sil-btn sm:w-[200px]">
          再观测一次
        </button>
        <Link href="/" className="sil-btn sil-btn--ghost sm:w-[200px]">
          回到观测台
        </Link>
      </section>

      {error.digest ? (
        <p className="sil-label sil-label--sm sil-num mt-8 opacity-70">
          诊断编号 {error.digest}
        </p>
      ) : null}
    </main>
  );
}
