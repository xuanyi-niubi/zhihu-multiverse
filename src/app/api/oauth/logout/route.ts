import { NextResponse } from 'next/server';

import { getSession } from '@/core/oauth/zhihu';

/**
 * 断开知乎账号连接。
 *
 * 只清空当前会话内存里的 token 与资料；不涉及开放平台侧的撤销——
 * 因为当前协议**没有撤销与解绑能力**（见 oauth-boundary.md 的已知缺口），
 * 所以这里如实叫「断开连接」，不叫「解除授权」。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const { session, cookie } = getSession(request);

  session.token = null;
  session.expiresAt = null;
  session.profile = null;
  session.state = null;
  session.stateVerified = null;
  session.error = null;
  session.debug = null;

  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );

  if (cookie) {
    response.headers.append('set-cookie', cookie);
  }

  return response;
}
