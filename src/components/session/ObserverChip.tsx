'use client';

import * as React from 'react';

import { observerChipState, observerDisplayName } from '@/features/run/observer';
import { useObserver } from '@/features/run/useObserver';

/**
 * 观测者徽标：把「登录了没有」这件事显示在界面上。
 *
 * ## 为什么需要一个可见的徽标
 *
 * 两个理由，都不是装饰：
 *
 * 1. **已登录的人要看到自己被记住了。** 头像 + 昵称是「这个宇宙认得你」
 *    唯一的即时反馈。没有它，登录与否在体验上毫无差别 ——
 *    用户会合理地怀疑登录根本没生效。
 * 2. **拒绝过的人要有回头路。** 选了「随便逛逛」之后，登录门就不再出现。
 *    如果界面上没有任何入口，这个选择就变成了不可逆的 ——
 *    想改主意的人只能去清浏览器存储。所以访客态会显示一个「登录」按钮。
 *
 * ## 显示规则都在 `observerChipState()`
 *
 * 这里只负责画。三个分支：已登录（头像+昵称）/ 访客（+登录入口）/
 * 什么都不显示（OAuth 没配齐时：给一个通向不存在动作的入口更糟）。
 */
export default function ObserverChip({ className = '' }: { readonly className?: string }) {
  const { session, choice, requestLogin } = useObserver();
  const state = observerChipState(session, choice);

  if (!state) {
    return null;
  }

  if (state.kind === 'member') {
    const name = observerDisplayName(state.profile);
    const headline = state.profile?.headline?.trim() || null;

    return (
      <span className={['flex items-center gap-2', className].filter(Boolean).join(' ')}>
        {state.profile?.avatarUrl ? (
          /*
            用原生 <img> 而不是 next/image：头像是知乎 CDN 的外链，
            走 next/image 需要在 config 里为每个第三方域名开白名单，
            而这里只是一张 20px 的方图，优化收益为零。
            referrerPolicy 必须给：知乎 CDN 会拒绝带 referrer 的请求。
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/api/oauth/avatar"
            alt=""
            width={20}
            height={20}
            referrerPolicy="no-referrer"
            className="h-5 w-5 rounded-full border border-[color:var(--sil-rule-strong)] object-cover"
          />
        ) : (
          <span className="h-5 w-5 rounded-full border border-[color:var(--sil-rule-strong)] bg-[color:var(--sil-void-600)]" />
        )}
        <span
          className="max-w-[9rem] truncate text-[12px] text-[color:var(--sil-ink-200)]"
          title={headline ? `${name} · ${headline}` : name}
        >
          {name}
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={requestLogin}
      className={[
        'flex min-h-11 items-center gap-1.5 text-[12px] text-[color:var(--sil-ink-400)]',
        'transition-colors hover:text-[color:var(--sil-ink-200)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title="使用知乎登录，让这个宇宙记得你"
    >
      <span className="h-5 w-5 rounded-full border border-[color:var(--sil-rule)]" />
      <span>访客 · 登录</span>
    </button>
  );
}
