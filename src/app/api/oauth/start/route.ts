import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import {
  buildAuthorizeUrl,
  getSession,
  publicUrl,
  resolveOAuthConfig,
  resolveOAuthCredentials,
} from '@/core/oauth/zhihu';

/**
 * 发起知乎授权：302 跳转到开放平台授权页。
 *
 * 失败时不返回 500，而是带上脱敏错误码跳回首页，让用户看到「为什么还不能登录」
 * （最常见就是尚未部署、没有公网回调）。这与 skill 的行为一致。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(request: Request, path: string, cookie: string | null): Response {
  /*
    成功分支传进来的是知乎授权页的**绝对** URL，`publicUrl` 会原样保留它；
    失败分支传的是 `/?oauth=error...` 这种相对路径 —— 那一支才是真正需要
    对外来源的（否则会把用户跳到容器自己的 0.0.0.0:3000）。
  */
  const response = NextResponse.redirect(publicUrl(request, path), 302);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  if (cookie) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const { session, cookie } = getSession(request);

  try {
    const url = buildAuthorizeUrl(
      { config: resolveOAuthConfig(), credentials: resolveOAuthCredentials() },
      (session.state = randomBytes(24).toString('base64url')),
    );

    session.error = null;
    return redirectTo(request, url, cookie);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'OAUTH_FAILED';
    session.error = {
      code,
      message: error instanceof Error ? error.message : '发起授权失败',
    };

    return redirectTo(request, `/?oauth=error&reason=${encodeURIComponent(code)}`, cookie);
  }
}
