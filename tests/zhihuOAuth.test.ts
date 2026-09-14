import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OAuthError,
  SESSION_COOKIE,
  USER_INTERFACES,
  __resetSessions,
  buildAuthorizeUrl,
  buildDiagnostics,
  credentialWarnings,
  describeCredential,
  fetchProfile,
  fingerprint,
  getSession,
  isPublicHttpsRedirect,
  normalizeAvatarUrl,
  resolveOAuthConfig,
  resolveOAuthCredentials,
  safeEqual,
} from '@/core/oauth/zhihu';

/**
 * 知乎 OAuth 协议核心单测。
 *
 * 覆盖重点（对齐 skill 的 oauth-boundary.md 硬性要求）：
 * - 三类凭证严格分离，串位必须被拦
 * - 本地地址绝不能当作可调通的真实回调
 * - 授权 URL 与 token 表单的字段名不可漂移
 * - 诊断输出绝不泄露明文凭证
 */

const deps = (overrides: Partial<Parameters<typeof buildAuthorizeUrl>[0]> = {}) => ({
  config: { appId: '1234567890', redirectUri: 'https://demo.example.com/auth/callback' },
  credentials: { appKey: 'a'.repeat(32), accessSecret: 'b'.repeat(64) },
  ...overrides,
});

describe('本地地址不可作为真实回调', () => {
  const localUris = [
    'http://127.0.0.1:3000/auth/callback',
    'https://localhost/auth/callback',
    'https://127.0.0.1/auth/callback',
    'https://192.168.1.10/auth/callback',
    'https://10.0.0.5/auth/callback',
    'https://172.16.0.1/auth/callback',
    'https://172.31.255.1/auth/callback',
    'https://0.0.0.0/auth/callback',
  ];

  it.each(localUris)('%s 判为不可用', (uri) => {
    expect(isPublicHttpsRedirect(uri)).toBe(false);
  });

  it('公网 HTTPS 且路径正确的地址才放行', () => {
    expect(isPublicHttpsRedirect('https://demo.example.com/auth/callback')).toBe(true);
  });

  it('172.32 已超出内网段，应放行', () => {
    expect(isPublicHttpsRedirect('https://172.32.0.1/auth/callback')).toBe(true);
  });

  it('非 https 一律拒绝', () => {
    expect(isPublicHttpsRedirect('http://demo.example.com/auth/callback')).toBe(false);
  });

  it('路径不以 /auth/callback 结尾一律拒绝', () => {
    expect(isPublicHttpsRedirect('https://demo.example.com/callback')).toBe(false);
    expect(isPublicHttpsRedirect('https://demo.example.com/auth/callback/extra')).toBe(false);
  });

  it('null 与空值安全返回 false', () => {
    expect(isPublicHttpsRedirect(null)).toBe(false);
    expect(isPublicHttpsRedirect(undefined)).toBe(false);
    expect(isPublicHttpsRedirect('')).toBe(false);
    expect(isPublicHttpsRedirect('不是 URL')).toBe(false);
  });
});

describe('授权 URL 构造', () => {
  it('包含协议要求的四个查询参数', () => {
    const url = new URL(buildAuthorizeUrl(deps(), 'STATE123'));

    expect(url.origin + url.pathname).toBe('https://openapi.zhihu.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://demo.example.com/auth/callback');
    expect(url.searchParams.get('app_id')).toBe('1234567890');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('STATE123');
  });

  it('本地回调时抛出 DEPLOYMENT_REQUIRED，而不是生成死链接', () => {
    expect(() =>
      buildAuthorizeUrl(
        deps({
          config: { appId: '123', redirectUri: 'http://127.0.0.1:3000/auth/callback' },
        }),
        'S',
      ),
    ).toThrowError(/部署/);

    try {
      buildAuthorizeUrl(
        deps({ config: { appId: '123', redirectUri: 'http://127.0.0.1:3000/auth/callback' } }),
        'S',
      );
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe('DEPLOYMENT_REQUIRED');
    }
  });

  it('缺 redirectUri 时同样拒绝', () => {
    expect(() =>
      buildAuthorizeUrl(deps({ config: { appId: '123', redirectUri: null } }), 'S'),
    ).toThrowError();
  });

  it('缺 App ID 时抛出 APP_ID_REQUIRED', () => {
    try {
      buildAuthorizeUrl(deps({ config: { appId: '', redirectUri: 'https://a.com/auth/callback' } }), 'S');
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as OAuthError).code).toBe('APP_ID_REQUIRED');
    }
  });

  it('缺 App Key 时抛出 APP_KEY_REQUIRED', () => {
    try {
      buildAuthorizeUrl(
        deps({
          config: { appId: '123', redirectUri: 'https://a.com/auth/callback' },
          credentials: { appKey: '', accessSecret: 'x' },
        }),
        'S',
      );
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as OAuthError).code).toBe('APP_KEY_REQUIRED');
    }
  });
});

describe('凭证串位检查', () => {
  const config = { appId: '1234567890', redirectUri: 'https://a.com/auth/callback' };

  it('App Key 过短触发 APP_KEY_TOO_SHORT', () => {
    const warnings = credentialWarnings(config, {
      appKey: describeCredential('12345', 'ZHIHU_OAUTH_APP_KEY'),
      accessSecret: describeCredential('b'.repeat(64), 'ZHIHU_ACCESS_SECRET'),
    });

    expect(warnings.map((w) => w.code)).toContain('APP_KEY_TOO_SHORT');
  });

  it('App ID 填进 App Key 触发 APP_ID_USED_AS_APP_KEY', () => {
    const warnings = credentialWarnings(config, {
      appKey: describeCredential('1234567890', 'ZHIHU_OAUTH_APP_KEY'),
      accessSecret: describeCredential('b'.repeat(64), 'ZHIHU_ACCESS_SECRET'),
    });

    expect(warnings.map((w) => w.code)).toContain('APP_ID_USED_AS_APP_KEY');
  });

  it('两个 Secret 相同触发 APP_KEY_USED_AS_ACCESS_SECRET', () => {
    const same = 'c'.repeat(40);
    const warnings = credentialWarnings(config, {
      appKey: describeCredential(same, 'ZHIHU_OAUTH_APP_KEY'),
      accessSecret: describeCredential(same, 'ZHIHU_ACCESS_SECRET'),
    });

    expect(warnings.map((w) => w.code)).toContain('APP_KEY_USED_AS_ACCESS_SECRET');
  });

  it('凭证正确分离时无告警', () => {
    const warnings = credentialWarnings(config, {
      appKey: describeCredential('a'.repeat(32), 'ZHIHU_OAUTH_APP_KEY'),
      accessSecret: describeCredential('b'.repeat(64), 'ZHIHU_ACCESS_SECRET'),
    });

    expect(warnings).toEqual([]);
  });
});

describe('诊断输出不含明文', () => {
  it('只暴露长度与 sha256 前缀', () => {
    const appKey = 'super-secret-app-key-value';
    const accessSecret = 'another-secret-access-value';

    const diagnostics = buildDiagnostics(
      { config: { appId: '123', redirectUri: 'https://a.com/auth/callback' }, credentials: { appKey, accessSecret } },
      'AUTHCODE123',
    );

    const serialized = JSON.stringify(diagnostics);

    expect(serialized).not.toContain(appKey);
    expect(serialized).not.toContain(accessSecret);
    expect(serialized).not.toContain('AUTHCODE123');

    const tokenExchange = diagnostics.tokenExchange as Record<string, unknown>;
    expect(tokenExchange.appKeyLength).toBe(appKey.length);
    expect(tokenExchange.appKeySha256Prefix).toBe(fingerprint(appKey));
    // grant_type 必须是固定枚举值，不从回调读取
    expect(tokenExchange.grantType).toBe('authorization_code');
    expect(tokenExchange.codeField).toBe('code');
    expect(tokenExchange.url).toBe('https://openapi.zhihu.com/access_token');
  });

  it('fingerprint 对空值返回 null', () => {
    expect(fingerprint(null)).toBeNull();
    expect(fingerprint('')).toBeNull();
    expect(fingerprint('x')).toHaveLength(12);
  });
});

describe('OAuth 用户资料', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('用 OAuth access token 作为 /user 的 Bearer，而不是 Access Secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: '测试用户',
        avatar_url: 'https://pic.example.com/avatar.jpg',
        headline: '一句签名',
        url_token: 'test-user',
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const profile = await fetchProfile(deps(), 'oauth-access-token');

    expect(profile).toEqual({
      name: '测试用户',
      avatarUrl: 'https://pic.example.com/avatar.jpg',
      headline: '一句签名',
      url: 'https://www.zhihu.com/people/test-user',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('https://openapi.zhihu.com/user');
    expect(headers.authorization).toBe('Bearer oauth-access-token');
    expect(headers.authorization).not.toContain('b'.repeat(64));
    expect(headers).not.toHaveProperty('x-oauth-token');
  });

  it('兼容 data.user 中的昵称与知乎头像模板字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            nickname: '嵌套用户',
            avatar_url_template: '//picx.zhimg.com/avatar_{size}.jpg',
            profile_url: 'https://www.zhihu.com/people/nested-user',
          },
        },
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProfile(deps(), 'oauth-access-token')).resolves.toEqual({
      name: '嵌套用户',
      avatarUrl: 'https://picx.zhimg.com/avatar_xl.jpg',
      headline: null,
      url: 'https://www.zhihu.com/people/nested-user',
    });
  });

  it('兼容嵌套头像对象并拒绝非 HTTP 地址', () => {
    expect(normalizeAvatarUrl('http://pic1.zhimg.com/avatar.jpg')).toBe(
      'https://pic1.zhimg.com/avatar.jpg',
    );
    expect(normalizeAvatarUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('资料接口失败时抛出脱敏错误，不泄露 OAuth token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'unauthorized' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const token = 'oauth-token-that-must-not-leak';
    await expect(fetchProfile(deps(), token)).rejects.toThrow('unauthorized');

    try {
      await fetchProfile(deps(), token);
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});

describe('环境变量解析', () => {
  it('缺省时 appId 为空串、redirectUri 为 null', () => {
    const config = resolveOAuthConfig({});
    expect(config.appId).toBe('');
    expect(config.redirectUri).toBeNull();
  });

  it('空白字符视为未配置', () => {
    const config = resolveOAuthConfig({
      ZHIHU_OAUTH_APP_ID: '   ',
      ZHIHU_OAUTH_REDIRECT_URI: '  ',
    });
    expect(config.appId).toBe('');
    expect(config.redirectUri).toBeNull();
  });

  it('凭证分别从对应变量读取，不串位', () => {
    const credentials = resolveOAuthCredentials({
      ZHIHU_OAUTH_APP_KEY: 'the-app-key',
      ZHIHU_ACCESS_SECRET: 'the-access-secret',
    });

    expect(credentials.appKey).toBe('the-app-key');
    expect(credentials.accessSecret).toBe('the-access-secret');
  });

  it('App ID 不会被当成 App Key', () => {
    const credentials = resolveOAuthCredentials({ ZHIHU_OAUTH_APP_ID: '1234567890' });
    expect(credentials.appKey).toBe('');
  });
});

describe('state 比较', () => {
  it('相同值通过', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('不同值失败', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('长度不同失败且不抛异常', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('空值一律失败（回调没带 state 时不能误判为已校验）', () => {
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, 'abc')).toBe(false);
  });
});

describe('会话 Cookie', () => {
  it('HTTP 请求不加 Secure，否则本地预览时浏览器会丢弃 Cookie', () => {
    __resetSessions();
    const { cookie } = getSession(new Request('http://127.0.0.1:3199/api/oauth/session'));
    expect(cookie).not.toBeNull();
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('HTTPS 请求加 Secure', () => {
    __resetSessions();
    const { cookie } = getSession(new Request('https://demo.example.com/api/oauth/session'));
    expect(cookie).toContain('Secure');
  });

  it('反向代理下以 x-forwarded-proto 为准', () => {
    __resetSessions();
    const { cookie } = getSession(
      new Request('http://internal:3000/api/oauth/session', {
        headers: { 'x-forwarded-proto': 'https' },
      }),
    );
    expect(cookie).toContain('Secure');
  });

  it('x-forwarded-proto 为多段时取第一段', () => {
    __resetSessions();
    const { cookie } = getSession(
      new Request('http://internal:3000/api/oauth/session', {
        headers: { 'x-forwarded-proto': 'https, http' },
      }),
    );
    expect(cookie).toContain('Secure');
  });

  it('携带已有 Cookie 时复用会话，不再下发新 Cookie', () => {
    __resetSessions();
    const first = getSession(new Request('http://127.0.0.1:3199/api/oauth/session'));
    expect(first.cookie).not.toBeNull();

    const second = getSession(
      new Request('http://127.0.0.1:3199/api/oauth/session', {
        headers: { cookie: `${SESSION_COOKIE}=${first.id}` },
      }),
    );

    expect(second.cookie).toBeNull();
    expect(second.id).toBe(first.id);
    expect(second.session).toBe(first.session);
  });

  it('未携带 Cookie 时新建独立会话', () => {
    __resetSessions();
    const a = getSession(new Request('http://127.0.0.1:3199/api/oauth/session'));
    const b = getSession(new Request('http://127.0.0.1:3199/api/oauth/session'));
    expect(a.id).not.toBe(b.id);
  });
});

describe('五项用户接口定义', () => {
  it('恰好五项且 id 唯一', () => {
    expect(USER_INTERFACES).toHaveLength(5);
    expect(new Set(USER_INTERFACES.map((i) => i.id)).size).toBe(5);
  });

  it('端点路径符合开放平台约定', () => {
    USER_INTERFACES.forEach((definition) => {
      expect(definition.endpoint).toMatch(/^\/api\/v1\/user\//);
    });
  });

  it('顺序为创作 → 关注 → 收藏夹 → 收藏内容 → 近期收藏', () => {
    expect(USER_INTERFACES.map((i) => i.id)).toEqual([
      'contents',
      'followees',
      'favlists',
      'favlist_contents',
      'collections',
    ]);
  });
});
