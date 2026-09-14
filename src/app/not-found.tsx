import Link from 'next/link';

import { KanshanSprite } from '@/components/characters/KanshanSprite';

/**
 * 404。
 *
 * 不用 Next 的默认英文页：那会在一屏深空叙事里突然插进一个系统错误页，
 * 质感当场断裂（而且评委只要点错一次链接就会看到）。
 *
 * 这里沿用产品自己的语言 —— 走错的地址 = 一条**还没被观测**的走廊。
 * 用 `ghost` 虚影皮肤，因为「不存在」正对应设计系统里的虚影语义；
 * 台词仍然是「…」「。」收尾，不出现感叹号（GAME-DESIGN §3 剂量表）。
 */
export default function NotFound() {
  return (
    <main className="obs-shell mx-auto flex min-h-[100dvh] w-full max-w-[720px] flex-col justify-center px-5 py-16 sm:py-20">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="obs-kicker">Worldline Not Observed</p>
        <Link
          href="/"
          className="text-[11px] text-[color:var(--obs-text-2)] transition-opacity duration-200 hover:opacity-80"
        >
          回到观测台 →
        </Link>
      </header>

      <section className="mt-6">
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-[color:var(--obs-text-0)] sm:text-[30px]">
          这条走廊，还没有人走过
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--obs-text-1)]">
          你打开的这一页不在世界线上。它可能从未被写下，
          <br className="hidden sm:block" />
          也可能只是链接少了几个字符。
        </p>
      </section>

      <section className="obs-glass mt-8 flex items-center gap-3 px-5 py-5">
        <span className="gd-guide__base shrink-0">
          <KanshanSprite
            characterId="ghost"
            action="sway"
            className="gd-guide__sprite gd-guide__sprite--sm"
            alt="刘看山的虚影"
          />
        </span>
        <p className="gd-guide__line">……这里没有人走过。</p>
      </section>

      <section className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/" className="session-choice session-choice--unlocked justify-center sm:max-w-[230px]">
          <span className="session-choice__title">说一个真实的困惑</span>
        </Link>
        <Link href="/archive" className="session-choice justify-center sm:max-w-[210px]">
          <span className="session-choice__title">看看别人的平行人生</span>
        </Link>
      </section>
    </main>
  );
}
