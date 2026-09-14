import { NextResponse } from 'next/server';

import {
  OAuthError,
  getSession,
  resolveOAuthConfig,
  resolveOAuthCredentials,
  runUserInterfaces,
} from '@/core/oauth/zhihu';

/**
 * 五项用户接口验收：创作 / 关注 / 收藏夹 / 收藏夹内容 / 近期收藏。
 *
 * 无论成功失败都返回 200 与逐条结果——每一项各自记 `success` / `empty` / `error`，
 * 便于黑客松现场如实汇报「哪些通了、哪些是空数据、哪些失败」。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const { session, cookie } = getSession(request);

  const respond = (body: unknown, status = 200): Response => {
    const response = NextResponse.json(body, {
      status,
      headers: { 'cache-control': 'no-store' },
    });
    if (cookie) {
      response.headers.append('set-cookie', cookie);
    }
    return response;
  };

  if (!session.token) {
    return respond(
      {
        ok: false,
        error: { code: 'LOGIN_REQUIRED', message: '请先完成知乎账号授权' },
        results: [],
      },
      401,
    );
  }

  try {
    const results = await runUserInterfaces(
      {
        config: resolveOAuthConfig(),
        credentials: resolveOAuthCredentials(),
      },
      session.token,
    );

    return respond({ ok: true, results });
  } catch (error) {
    const oauthError =
      error instanceof OAuthError ? error : new OAuthError('用户接口调用失败');

    return respond(
      {
        ok: false,
        error: { code: oauthError.code, message: oauthError.message },
        results: [],
      },
      200,
    );
  }
}
