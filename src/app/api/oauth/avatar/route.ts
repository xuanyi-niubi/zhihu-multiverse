import { getSession, normalizeAvatarUrl } from '@/core/oauth/zhihu';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isAllowedAvatarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'zhimg.com' ||
    host.endsWith('.zhimg.com') ||
    host === 'zhihu.com' ||
    host.endsWith('.zhihu.com')
  );
}

async function fetchAllowedAvatar(startUrl: string, signal: AbortSignal): Promise<Response> {
  let current = new URL(startUrl);

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (!isAllowedAvatarHost(current.hostname)) {
      throw new Error('AVATAR_HOST_NOT_ALLOWED');
    }

    const response = await fetch(current, {
      cache: 'no-store',
      redirect: 'manual',
      signal,
      headers: {
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        referer: 'https://www.zhihu.com/',
        'user-agent': 'Mozilla/5.0 Zhihu-Multiverse-Avatar-Proxy',
      },
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('AVATAR_REDIRECT_WITHOUT_LOCATION');
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new Error('AVATAR_TOO_MANY_REDIRECTS');
}

export async function GET(request: Request): Promise<Response> {
  const { session } = getSession(request);
  const avatarUrl = normalizeAvatarUrl(session.profile?.avatarUrl);

  if (!session.token || !avatarUrl) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  try {
    const upstream = await fetchAllowedAvatar(avatarUrl, controller.signal);
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) {
      return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_AVATAR_BYTES) {
      return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(body.byteLength),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  } finally {
    clearTimeout(timeoutId);
  }
}
