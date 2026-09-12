import { NextResponse } from 'next/server';

import {
  USER_INTERFACES,
  credentialDiagnostics,
  credentialWarnings,
  isPublicHttpsRedirect,
  resolveOAuthConfig,
  resolveOAuthCredentials,
} from '@/core/oauth/zhihu';

/**
 * OAuth 授权状态与脱敏诊断。
 *
 * 契约与项目其余接口一致：**永远返回 200**，前端不需要错误分支。
 *
 * 真实登录必须满足：公网 HTTPS 回调 + App ID + OAuth App Key + Access Secret。
 * 未部署时 `localPreviewOnly` 为 true——本地只能预览页面，这一事实必须如实上报，
 * 不得声称可以完成登录（skill 硬性要求）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const config = resolveOAuthConfig();
  const credentials = resolveOAuthCredentials();
  const diagnostics = credentialDiagnostics(credentials);
  const callbackConfigured = isPublicHttpsRedirect(config.redirectUri);

  return NextResponse.json(
    {
      ok: true,
      enabled: true,
      appId: config.appId || null,
      redirectUri: config.redirectUri,
      callbackConfigured,
      localPreviewOnly: !callbackConfigured,
      configured:
        callbackConfigured && Boolean(config.appId) && diagnostics.appKey.configured,
      /** 会话级授权状态由 /api/oauth/session 提供（需读 Cookie）。 */
      credentialDiagnostics: diagnostics,
      credentialWarnings: credentialWarnings(config, diagnostics),
      /** Access Secret 单独标注，因为它由官方 zhihu Skill 管理。 */
      accessSecretConfigured: diagnostics.accessSecret.configured,
      interfaces: USER_INTERFACES,
      note: callbackConfigured
        ? null
        : '尚未配置公网 HTTPS 回调地址，本地地址无法完成知乎登录。',
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
