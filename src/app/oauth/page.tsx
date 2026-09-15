'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ObserverAvatar } from '@/components/session/ObserverAvatar';

/**
 * 知乎登录面板。
 *
 * ## 它为什么在 `/oauth` 而不是塞进设置页
 *
 * 设置页承担的是「应用怎么跑」（当前使用 / 减少动画 / 自带模型 / 自托管），
 * 而这里是**一次带外跳转的授权流程**：点授权 → 离开本站 → 知乎授权页 →
 * 带 `?oauth=success` 回来。把它做成独立页面，回调落点才有明确语义，
 * 授权结果也不会和设置项的草稿状态混在一起。
 *
 * 设置页只放一个入口链接（`登录知乎`）指向这里。
 *
 * ## 只呈现用户需要知道的事
 *
 * 登录状态、账号信息、接口连通性。应用凭证（App ID / App Key）与回调地址
 * 属于服务端配置，不在前端展示 —— 前端能看到的只有「配置好了没有」。
 */

interface ProfileView {
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly headline: string | null;
  readonly url: string | null;
}

interface SessionView {
  readonly authorized: boolean;
  readonly profile: ProfileView | null;
  readonly expiresAt: string | null;
  readonly error: { code: string; message: string } | null;
  readonly debug: Record<string, unknown> | null;
  readonly configured: boolean;
  readonly localPreviewOnly: boolean;
}

interface InterfaceResult {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly status: 'success' | 'empty' | 'error';
  readonly item: unknown;
  readonly message: string | null;
}

/**
 * 三种结果的配色。
 *
 * 沿用银盐的语义：`alternate` 青绿 = 通了，`counter` 琥珀 = 反例/异常。
 * 「空数据」刻意用中性灰而不是黄色 —— 它不是错误，只是那个账号没有这项内容，
 * 用警示色会让人以为接口坏了。
 */
const STATUS_LABEL: Record<InterfaceResult['status'], { text: string; cls: string }> = {
  success: { text: '通过', cls: 'text-[color:var(--sil-alternate)]' },
  empty: { text: '空数据', cls: 'text-[color:var(--sil-ink-400)]' },
  error: { text: '失败', cls: 'text-[color:var(--sil-counter)]' },
};

function OAuthPanel() {
  const params = useSearchParams();
  const oauthResult = params.get('oauth');
  const reason = params.get('reason');

  const [session, setSession] = React.useState<SessionView | null>(null);
  const [results, setResults] = React.useState<InterfaceResult[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadSession = React.useCallback(async () => {
    try {
      const response = await fetch('/api/oauth/session', { cache: 'no-store' });
      setSession((await response.json()) as SessionView);
    } catch {
      setSession(null);
    }
  }, []);

  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const runAll = React.useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/oauth/run-all', { method: 'POST' });
      const payload = (await response.json()) as { results?: InterfaceResult[] };
      setResults(payload.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
      void loadSession();
    }
  }, [loadSession]);

  const logout = React.useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/oauth/logout', { method: 'POST' });
      setResults(null);
    } finally {
      setBusy(false);
      void loadSession();
    }
  }, [loadSession]);

  const canLogin = Boolean(session?.configured) && !session?.localPreviewOnly;

  return (
    <main className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col gap-5 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="sil-label">AUTH BRIDGE</p>
          <h1 className="sil-title mt-3 text-[26px] sm:text-[32px]">观测者登录</h1>
          <p className="mt-3 max-w-[46ch] text-body leading-relaxed text-[color:var(--sil-ink-200)]">
            知乎是本站的一种登录方式。登录后可显示头像昵称、保存推演记忆，并在终局报告上署名。
          </p>
        </div>
        <Link href="/" className="sil-btn sil-btn--ghost shrink-0">
          返回发令台
        </Link>
      </header>

      {oauthResult === 'success' ? (
        <div
          className="sil-panel px-4 py-3"
          style={{ borderColor: 'color-mix(in srgb, var(--sil-alternate) 42%, transparent)' }}
        >
          <p className="sil-label--sm font-mono text-[color:var(--sil-alternate)]">AUTHORIZED</p>
          <p className="mt-1.5 text-body text-[color:var(--sil-ink-200)]">
            登录成功，已获取知乎身份。
          </p>
        </div>
      ) : null}

      {oauthResult === 'error' ? (
        <div
          className="sil-panel px-4 py-3"
          style={{ borderColor: 'color-mix(in srgb, var(--sil-counter) 45%, transparent)' }}
        >
          <p className="sil-label--sm font-mono text-[color:var(--sil-counter)]">AUTH FAILED</p>
          <p className="mt-1.5 text-body text-[color:var(--sil-ink-200)]">
            {session?.error?.message ?? '授权未完成。'}
            {reason ? (
              <span className="ml-2 font-mono text-label text-[color:var(--sil-ink-400)]">
                {reason}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <section className="sil-panel p-4 sm:p-5">
        <p className="sil-label">ACCOUNT</p>

        {session?.authorized ? (
          <div className="mt-4 flex items-center gap-3">
            <ObserverAvatar
              name={session.profile?.name ?? '知乎用户'}
              avatarUrl={session.profile?.avatarUrl ?? null}
              className="h-11 w-11 border-[color:var(--sil-rule-strong)] bg-[color:var(--sil-void-600)] text-body text-[color:var(--sil-ink-200)]"
            />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-[color:var(--sil-ink-100)]">
                {session.profile?.name ?? '已授权（账号资料未返回）'}
              </p>
              <p className="truncate text-meta text-[color:var(--sil-ink-300)]">
                {session.profile?.headline ?? '—'}
              </p>
              <p className="mt-0.5 font-mono text-micro text-[color:var(--sil-ink-400)]">
                过期时间 {session.expiresAt ?? '未知'}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-body leading-relaxed text-[color:var(--sil-ink-200)]">
            尚未登录知乎。登录后，你的推演记忆会跟着账号保留。
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="/api/oauth/start"
            aria-disabled={!canLogin}
            onClick={(event) => {
              if (!canLogin) {
                event.preventDefault();
              }
            }}
            className={canLogin ? 'sil-btn' : 'sil-btn sil-btn--ghost pointer-events-none opacity-45'}
          >
            {session?.authorized ? '重新登录知乎' : '使用知乎登录'}
          </a>

          {session?.authorized ? (
            <>
              <button
                type="button"
                onClick={runAll}
                disabled={busy}
                className="sil-btn sil-btn--ghost"
              >
                自检知乎接口连通性
              </button>
              <button
                type="button"
                onClick={logout}
                disabled={busy}
                className="sil-btn sil-btn--quiet"
              >
                退出登录
              </button>
            </>
          ) : null}
        </div>

        {!canLogin ? (
          <p className="mt-3 text-label text-[color:var(--sil-ink-400)]">
            登录当前未开放。可以先用游客身份体验推演。
          </p>
        ) : null}
      </section>

      {results ? (
        <section className="sil-panel p-4 sm:p-5">
          <p className="sil-label">ZHIHU API · 连通性自检</p>

          <div className="mt-3">
            {results.map((result) => {
              const status = STATUS_LABEL[result.status];
              return (
                <div
                  key={result.id}
                  className="flex items-baseline justify-between gap-4 border-b border-[color:var(--sil-rule)] py-2 last:border-b-0"
                >
                  <span className="shrink-0 text-meta text-[color:var(--sil-ink-200)]">
                    {result.name}
                  </span>
                  <span className="flex items-baseline gap-3 truncate">
                    <span className="truncate font-mono text-micro text-[color:var(--sil-ink-400)]">
                      {result.message ?? result.endpoint}
                    </span>
                    <span className={`shrink-0 font-mono text-label ${status.cls}`}>
                      {status.text}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-label leading-relaxed text-[color:var(--sil-ink-400)]">
            收藏内容依赖第一个收藏夹的 UrlToken；账号没有收藏夹算空数据，不算失败。
          </p>
        </section>
      ) : null}

      <footer className="pb-2 text-label leading-relaxed text-[color:var(--sil-ink-400)]">
        知乎登录为黑客松演示能力：尚未接入 PKCE、scope 与 refresh token，
        请勿直接用于生产环境。
      </footer>
    </main>
  );
}

export default function OAuthPage() {
  return (
    <React.Suspense
      fallback={
        <main className="sil-viewport flex items-center justify-center">
          <p className="sil-label">正在读取授权状态…</p>
        </main>
      }
    >
      <OAuthPanel />
    </React.Suspense>
  );
}
