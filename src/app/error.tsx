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
    <main className="obs-shell mx-auto flex min-h-[100dvh] w-full max-w-[720px] flex-col justify-center px-5 py-16 sm:py-20">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="obs-kicker">Observation Interrupted</p>
        <Link
          href="/"
          className="text-[11px] text-[color:var(--obs-text-2)] transition-opacity duration-200 hover:opacity-80"
        >
          回到观测台 →
        </Link>
      </header>

      <section className="mt-6">
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-[color:var(--obs-text-0)] sm:text-[30px]">
          这一局没能算完
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--obs-text-1)]">
          观测中途断了。你的问题还在，可以再来一次。
        </p>
      </section>

      <section className="obs-glass mt-8 flex items-center gap-3 px-5 py-5">
        <span className="gd-guide__base shrink-0">
          <KanshanSprite
            characterId="kanshan"
            action="sway"
            className="gd-guide__sprite gd-guide__sprite--sm"
            alt="刘看山"
          />
        </span>
        <p className="gd-guide__line">……刚才那一下，不算数。</p>
      </section>

      <section className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="session-choice session-choice--unlocked justify-center sm:max-w-[200px]"
        >
          <span className="session-choice__title">再观测一次</span>
        </button>
        <Link href="/" className="session-choice justify-center sm:max-w-[200px]">
          <span className="session-choice__title">回到观测台</span>
        </Link>
      </section>

      {error.digest ? (
        <p className="mt-6 font-mono text-[11px] text-[color:var(--obs-text-2)] opacity-70">
          诊断编号 {error.digest}
        </p>
      ) : null}
    </main>
  );
}
