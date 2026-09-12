'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * 知乎账号接入页。
 *
 * 设计上服从 DESIGN.md：这不是一个「设置页」，而是推演舱的一个控制面板——
 * CRT 终端日志 + 斜切状态条 + 系统化标签。
 *
 * 只呈现用户需要知道的事：登录状态、账号信息、接口连通性。
 * 应用凭证（App ID / App Key）与回调地址属于服务端配置，不在前端展示。
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

const STATUS_LABEL: Record<InterfaceResult['status'], { text: string; cls: string }> = {
  success: { text: '通过', cls: 'text-relic-jade' },
  empty: { text: '空数据', cls: 'text-relic-gold' },
  error: { text: '失败', cls: 'text-relic-danger' },
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
    <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.4em] text-zhihu-400">AUTH BRIDGE</p>
          <h1 className="mt-1.5 text-2xl font-black text-white sm:text-3xl">知乎账号接入</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            让推演机读到真实的知乎身份与内容，而不只是你手打的一句目标。
          </p>
        </div>
        <Link href="/" className="btn-ghost shrink-0 px-3 py-2 text-xs">
          返回发令台
        </Link>
      </header>

      {oauthResult === 'success' ? (
        <div className="rounded-2xl border border-relic-jade/40 bg-relic-jade/[0.07] px-4 py-3">
          <p className="font-mono text-[11px] tracking-widest text-relic-jade">AUTHORIZED</p>
          <p className="mt-1 text-sm text-slate-300">授权成功，已拿到访问令牌。</p>
        </div>
      ) : null}

      {oauthResult === 'error' ? (
        <div className="rounded-2xl border border-relic-danger/45 bg-relic-danger/[0.07] px-4 py-3">
          <p className="font-mono text-[11px] tracking-widest text-relic-danger">AUTH FAILED</p>
          <p className="mt-1 text-sm text-slate-300">
            {session?.error?.message ?? '授权未完成。'}
            {reason ? <span className="ml-2 font-mono text-[11px] text-slate-500">{reason}</span> : null}
          </p>
        </div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="font-mono text-[11px] tracking-widest text-slate-500">ACCOUNT</p>

        {session?.authorized ? (
          <div className="mt-3 flex items-center gap-3">
            {session.profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.profile.avatarUrl}
                alt=""
                className="h-11 w-11 rounded-full border border-white/15 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-11 w-11 rounded-full border border-white/15 bg-white/[0.06]" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                {session.profile?.name ?? '已授权（账号资料未返回）'}
              </p>
              <p className="truncate text-[11px] text-slate-400">
                {session.profile?.headline ?? '—'}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                过期时间 {session.expiresAt ?? '未知'}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            尚未连接知乎账号。连接后，你的推演记忆与密钥配置会跟着账号走。
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/api/oauth/start"
            aria-disabled={!canLogin}
            onClick={(event) => {
              if (!canLogin) {
                event.preventDefault();
              }
            }}
            className={[
              'arcade-btn px-4 py-2 text-sm',
              canLogin ? 'bg-zhihu-500 text-white' : 'cursor-not-allowed bg-white/10 text-slate-500',
            ].join(' ')}
          >
            {session?.authorized ? '重新授权知乎账号' : '授权知乎账号'}
          </a>

          {session?.authorized ? (
            <>
              <button
                type="button"
                onClick={runAll}
                disabled={busy}
                className="btn-ghost px-4 py-2 text-sm disabled:opacity-45"
              >
                自检知乎接口连通性
              </button>
              <button
                type="button"
                onClick={logout}
                disabled={busy}
                className="btn-ghost px-4 py-2 text-sm disabled:opacity-45"
              >
                断开连接
              </button>
            </>
          ) : null}
        </div>

        {!canLogin ? (
          <p className="mt-2.5 text-[11px] text-slate-500">
            登录当前未开放。可以先用游客身份体验推演。
          </p>
        ) : null}
      </section>

      {results ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-[11px] tracking-widest text-slate-500">
            ZHIHU API · 连通性自检
          </p>

          <div className="mt-2">
            {results.map((result) => {
              const status = STATUS_LABEL[result.status];
              return (
                <div
                  key={result.id}
                  className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2 last:border-b-0"
                >
                  <span className="shrink-0 text-xs text-slate-300">{result.name}</span>
                  <span className="flex items-baseline gap-3 truncate">
                    <span className="truncate font-mono text-[10px] text-slate-500">
                      {result.message ?? result.endpoint}
                    </span>
                    <span className={`shrink-0 font-mono text-[11px] ${status.cls}`}>
                      {status.text}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            收藏内容依赖第一个收藏夹的 UrlToken；账号没有收藏夹算空数据，不算失败。
          </p>
        </section>
      ) : null}

      <footer className="pb-2 text-[11px] leading-relaxed text-slate-600">
        登录能力为黑客松演示级别：尚未接入 PKCE、scope、refresh token 与解绑能力，
        请勿用于生产环境。
      </footer>
    </main>
  );
}

export default function OAuthPage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="animate-flicker font-mono text-sm text-slate-500">正在读取授权状态…</p>
        </main>
      }
    >
      <OAuthPanel />
    </React.Suspense>
  );
}
