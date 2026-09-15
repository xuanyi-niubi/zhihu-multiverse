'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { KanshanSprite } from '@/components/characters/KanshanSprite';
import { shouldShowObserverGate } from '@/features/run/observer';
import { useObserver } from '@/features/run/useObserver';

/**
 * 观测者登录引导（入口）。
 *
 * ## 它解决什么问题
 *
 * 之前 OAuth 只活在一个独立面板 `/oauth` 里。用户必须先想到「去设置页看看」，
 * 才可能发现这个站点支持知乎登录 —— 能力在，但**体验上不存在**。
 *
 * 所以进门先问一次：要不要用知乎账号登录。同时明确给出「随便逛逛」。
 * 问一次就够了，回答记在 localStorage（见 `features/run/observer.ts`）。
 *
 * ## 为什么不做成硬门
 *
 * 这一局的核心（检索 → 三幕 → 终局）对访客完全可用，登录换来的是
 * 「这个宇宙记得你」。把可用功能锁在登录后面，是拿功能当人质换注册量 ——
 * 对一个要证明「知乎内容真的改变了选择」的作品来说，那是本末倒置。
 * 所以这是**邀请**，不是关卡：两个按钮视觉权重接近，且都能立刻继续。
 *
 * ## 哪些情况不出现
 *
 * 判据集中在 `shouldShowObserverGate()`：已登录 / 已选过随便逛逛 /
 * OAuth 没配齐 / 回调还是本地地址 / 正在 OAuth 回调页 —— 都不弹。
 * 最后一条尤其重要：回调落点如果是 `/oauth?oauth=success`，
 * 在自己身上再叠一层登录门会让人以为「登录没成功」。
 */
export default function ObserverGate() {
  const pathname = usePathname();
  const { session, choice, continueAsGuest } = useObserver();

  /*
    这些路径上不弹：
      /oauth        —— 那本身就是登录流程的页面，在它上面叠门是自相矛盾
      /auth/...     —— 回调处理中
  */
  const suppressed =
    pathname === '/oauth' || pathname.startsWith('/oauth/') || pathname.startsWith('/auth/');

  const open = shouldShowObserverGate({ session, choice, suppressed });

  /* 门开着时锁住背景滚动：否则手机上能滑动背后那一屏，很怪 */
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /* Esc = 随便逛逛：不想登录的人不该被一个弹层困住 */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        continueAsGuest();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, continueAsGuest]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="observer-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8"
      /*
        遮罩用 0.95。
        实测 0.8 时背景那行大标题仍清晰可读（白字在黑底上，8 折后还是浅灰），
        整块面板看起来像「浮在页面上的一个框」而不是一次登录；
        0.9 仍能在面板上看到背景文字的浅带。0.95 之后背景退成纯轮廓。

        这里**不用 backdrop-filter: blur** —— 设计纪律里 blur 有并发预算
        （同时最多 3 处），要留给推演演出；一个静态弹层靠不透明度就够了。
      */
      style={{ background: 'rgb(4 5 10 / 0.95)' }}
    >
      <div className="sil-panel w-full max-w-[520px] p-6 sm:p-8">
        <p className="sil-label">OBSERVER LOGIN</p>

        <h2
          id="observer-gate-title"
          className="sil-title mt-3 text-[26px] leading-tight sm:text-[30px]"
        >
          登录你的观测者身份
        </h2>

        {/*
          刘看山 + 两段文案。
          左图标右文字的横排在这里是对的：它把「谁在跟你说话」和
          「说了什么」放进同一行，比图标独占一行更省纵向空间 ——
          弹层越高，在小屏上越容易顶到浏览器边界。
        */}
        <div className="mt-6 flex items-start gap-4">
          <span className="flex h-[64px] w-[64px] shrink-0 items-center justify-center">
            <KanshanSprite
              characterId="kanshan"
              action="wave"
              className="h-full w-full object-contain"
              alt=""
            />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-body leading-relaxed text-[color:var(--sil-ink-200)]">
              知乎是这里的一种登录方式。登录后，这个宇宙会记得你的推演，
              并在最后那张暖色报告纸上写下你的头像与昵称。
            </p>
            <p className="mt-2.5 text-meta leading-relaxed text-[color:var(--sil-ink-300)]">
              不登录也能完整体验，登录不会改变推演结果。
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row-reverse sm:gap-3">
          {/*
            主行动放右边（`sm:flex-row-reverse`）——
            中文界面里「主要动作在右」更符合习惯，且与设置页的按钮序一致。
          */}
          <a href="/api/oauth/start" className="sil-btn sil-btn--block sm:flex-1">
            使用知乎登录
          </a>
          <button
            type="button"
            onClick={continueAsGuest}
            className="sil-btn sil-btn--ghost sil-btn--block sm:flex-1"
          >
            随便逛逛
          </button>
        </div>

        <p className="mt-5 text-label leading-relaxed text-[color:var(--sil-ink-400)]">
          不登录也能完整走完一局 —— 只是这一局不会被记住。
          之后想登录，点页面底部的「访客 · 登录」即可。
        </p>
      </div>
    </div>
  );
}
