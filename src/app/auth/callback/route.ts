import { NextResponse } from 'next/server';

import {
  OAuthError,
  buildDiagnostics,
  exchangeToken,
  fetchProfile,
  getSession,
  resolveOAuthConfig,
  resolveOAuthCredentials,
  safeEqual,
} from '@/core/oauth/zhihu';

/**
 * OAuth 回调：接收 authorization_code → 换 token → 拉账号资料。
 *
 * 协议细节（对齐 skill 的 oauth-boundary.md）：
 * - 回调参数实测是 `authorization_code`，但为兼容也接受 `code`。
 * - 实测回调**可能不返回 `state`**。此时按 skill 要求标记
 *   「仅适合临时联调」，不得声称通过标准 CSRF 校验——所以 `stateVerified`
 *   如实记录「有没有校验过」，而不是假装通过。
 * - 不返回 500：任何失败都带脱敏诊断跳回首页。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(request: Request, path: string, cookie: string | null): Response {
  const response = NextResponse.redirect(new URL(path, request.url), 302);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  if (cookie) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const { session, cookie } = getSession(request);
  const url = new URL(request.url);

  const code = url.searchParams.get('authorization_code') ?? url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  const deps = {
    config: resolveOAuthConfig(),
    credentials: resolveOAuthCredentials(),
  };

  try {
    // 诊断先落，便于失败时定位在哪一步断的
    session.debug = buildDiagnostics(deps, code);

    if (!code) {
      throw new OAuthError('回调缺少 authorization_code', 'CODE_MISSING');
    }

    // 只有回调带了 state 才校验；没带就如实记 false
    if (returnedState && !safeEqual(returnedState, session.state)) {
      throw new OAuthError('state 校验失败', 'STATE_MISMATCH');
    }

    session.stateVerified = Boolean(returnedState);

    const { token, expiresAt } = await exchangeToken(deps, code);
    session.token = token;
    session.expiresAt = expiresAt;
    session.state = null;
    session.error = null;
    session.debug.stage = 'token_exchange_succeeded';
    session.debug.tokenReceived = true;

    // 账号资料读取失败不阻断授权；/user 无正式 schema，不伪造字段
    try {
      session.debug.stage = 'profile_fetch_started';
      session.profile = await fetchProfile(deps, token);
      session.debug.profileFetched = Boolean(session.profile);
    } catch {
      session.profile = null;
      session.debug.profileFetched = false;
    }

    session.debug.stage = 'authorized';
    return redirectTo(request, '/oauth?oauth=success', cookie);
  } catch (error) {
    const oauthError =
      error instanceof OAuthError
        ? error
        : new OAuthError(error instanceof Error ? error.message : '授权失败');

    if (session.debug) {
      session.debug.failedStage = session.debug.stage;
    }
    session.error = { code: oauthError.code, message: oauthError.message };

    return redirectTo(
      request,
      `/oauth?oauth=error&reason=${encodeURIComponent(oauthError.code)}`,
      cookie,
    );
  }
}
