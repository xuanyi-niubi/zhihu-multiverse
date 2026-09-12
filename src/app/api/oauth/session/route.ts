import { NextResponse } from 'next/server';

import {
  USER_INTERFACES,
  credentialDiagnostics,
  credentialWarnings,
  isPublicHttpsRedirect,
  resolveOAuthConfig,
  resolveOAuthCredentials,
} from '@/core/oauth/zhihu';
import { getSession } from '@/core/oauth/zhihu';

/**
 * 会话级授权状态。
 *
 * 与 `/api/oauth/status` 的区别：这个接口要读会话 Cookie，返回「当前这个人
 * 是否已授权、授权是否过期、以及失败时的脱敏诊断」。
 *
 * Token 只存进程内存，因此这里**不回传 token 本身**，只回传是否存在与过期时间。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const { session, cookie } = getSession(request);
  const config = resolveOAuthConfig();
  const credentials = resolveOAuthCredentials();
  const diagnostics = credentialDiagnostics(credentials);

  // 过期即视为未授权，并给出明确原因
  if (session.expiresAt !== null && session.expiresAt <= Date.now()) {
    session.token = null;
    session.profile = null;
    session.error = { code: 'TOKEN_EXPIRED', message: '授权已过期，请重新连接。' };
  }

  const callbackConfigured = isPublicHttpsRedirect(config.redirectUri);

  const response = NextResponse.json(
    {
      ok: true,
      authorized: Boolean(session.token),
      profile: session.profile,
      /** 回调是否带了 state；null 表示尚未回调过。 */
      stateVerified: session.stateVerified,
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      error: session.error,
      debug: session.debug,
      appId: config.appId || null,
      redirectUri: config.redirectUri,
      callbackConfigured,
      localPreviewOnly: !callbackConfigured,
      configured: callbackConfigured && Boolean(config.appId) && diagnostics.appKey.configured,
      credentialDiagnostics: diagnostics,
      credentialWarnings: credentialWarnings(config, diagnostics),
      accessSecretConfigured: diagnostics.accessSecret.configured,
      interfaces: USER_INTERFACES,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );

  if (cookie) {
    response.headers.append('set-cookie', cookie);
  }

  return response;
}
