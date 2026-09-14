import Link from 'next/link';

import { KanshanSprite } from '@/components/characters/KanshanSprite';

/**
 * 404 · 未被观测的走廊
 *
 * 不用 Next 的默认英文页：那会在一屏暗房叙事里突然插进一个系统错误页，
 * 质感当场断裂（而且评委只要点错一次链接就会看到）。
 *
 * 沿用产品自己的语言 —— 走错的地址 = 一条**还没被观测**的走廊。
 * 用 `ghost` 虚影皮肤，因为「不存在」正对应设计系统里的虚影语义；
 * 台词仍然是「…」「。」收尾，不出现感叹号（GAME-DESIGN §3 剂量表）。
 *
 * ## 本次修掉的一个真问题
 *
 * 旧版第二个按钮指向 `/archive` —— 那是已被删除的 legacy 页面。
 * 也就是说：用户在 404 页点「看看别人的平行人生」，会**再吃一个 404**。
 * 现在改成真实存在的 `/journal`（我的经历）。
 */
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col justify-center px-5 py-16 sm:px-8"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="sil-label">Worldline Not Observed</p>
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
        >
          回到观测台
        </Link>
      </header>

      <section className="mt-8">
        <h1 className="sil-title sil-title--act">这条走廊，还没有人走过</h1>
        <p className="sil-prose mt-4">
          你打开的这一页不在世界线上。它可能从未被写下，
          <br className="hidden sm:block" />
          也可能只是链接少了几个字符。
        </p>
      </section>

      <section className="sil-panel mt-8 flex items-center gap-4 px-5 py-5">
        <KanshanSprite
          characterId="ghost"
          action="sway"
          ghost
          className="h-[64px] w-[64px] shrink-0"
          alt="刘看山的虚影"
        />
        <p className="sil-prose text-[13px] leading-relaxed text-[color:var(--sil-ink-300)]">
          ……这里没有人走过。
        </p>
      </section>

      <section className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link href="/" className="sil-btn sm:w-[230px]">
          说一个真实的困惑
        </Link>
        <Link href="/journal" className="sil-btn sil-btn--ghost sm:w-[210px]">
          看看我的经历
        </Link>
      </section>
    </main>
  );
}
