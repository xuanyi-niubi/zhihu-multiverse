import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { extractUrlToken } from '@/core/memoryStore';
import { oauthCredentialsFromEnv } from '@/config/serverEnv';

/**
 * 知乎开放平台 OAuth 协议核心。
 *
 * 协议契约（严格对齐 zhihu-hackathon skill 的 references/oauth-boundary.md
 * 与 references/deployment-credentials.md）：
 *
 * - 授权页：`GET https://openapi.zhihu.com/authorize`
 *   `redirect_uri` / `app_id` / `response_type=code` / `state`
 * - 换 token：`POST https://openapi.zhihu.com/access_token`，表单编码
 *   `app_id` / `app_key` / `grant_type=authorization_code` / `redirect_uri` / `code`
 *   注意 `grant_type` 是**固定枚举值**，不从回调读取；`code` 字段承载回调里的
 *   `authorization_code`（回调参数名两版并存，本实现兼容 `authorization_code` 与 `code`）。
 * - OAuth 用户资料：`GET /user`，`Authorization: Bearer <OAuth access_token>`
 * - 五项用户数据接口：`Authorization: Bearer <Access Secret>` +
 *   `X-OAuth-Token: <OAuth access_token>`
 *
 * 三类凭证必须严格分离，不可串位：
 * | 凭证 | 用途 | 本实现的存放位置 |
 * |---|---|---|
 * | App ID（短数字） | 授权页标识应用 | 项目公开配置 |
 * | OAuth App Key | `/access_token` 换取 token | `ZHIHU_OAUTH_APP_KEY` 环境变量 |
 * | 开放平台 Access Secret | 用户数据接口 Bearer | `ZHIHU_ACCESS_SECRET` 环境变量 |
 *
 * 与原 skill 脚手架的两处刻意偏离（Windows 适配，理由见 OAuth 接入文档）：
 * 1. 原版 `app_key` 存 macOS 钥匙串（`/usr/bin/security`）；本实现走环境变量，
 *    因为 Windows 无该命令，且 skill 自身也规定部署端就用 `ZHIHU_OAUTH_APP_KEY`。
 * 2. 原版用 `spawn('/usr/bin/curl')` 发请求；本实现用原生 `fetch`，与项目内
 *    `core/zhihu/client.ts` 保持一致，也避免子进程依赖。
 *
 * 已知协议缺口（不得对外宣称生产级安全）：
 * - 实测回调可能不返回 `state`，因此本实现把「state 已校验」如实上报，不假装通过。
 * - 当前无 PKCE、scope、refresh token、撤销与解绑协议。
 * - `/user` 无正式响应 schema，读取失败不得伪造字段。
 */

export const ZHIHU_AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize';
export const ZHIHU_TOKEN_URL = 'https://openapi.zhihu.com/access_token';
export const ZHIHU_OPENAPI_BASE = 'https://openapi.zhihu.com';
export const ZHIHU_USERAPI_BASE = 'https://developer.zhihu.com';

/** 五项用户接口；顺序即验收顺序。 */
export const USER_INTERFACES = [
  { id: 'contents', name: '我的创作', endpoint: '/api/v1/user/contents' },
  { id: 'followees', name: '我的关注', endpoint: '/api/v1/user/followees' },
  { id: 'favlists', name: '收藏夹', endpoint: '/api/v1/user/favlists' },
  { id: 'favlist_contents', name: '收藏内容', endpoint: '/api/v1/user/favlist_contents' },
  { id: 'collections', name: '近期收藏', endpoint: '/api/v1/user/collections' },
] as const;

export type UserInterfaceId = (typeof USER_INTERFACES)[number]['id'];

export interface OAuthConfig {
  /** App ID：短数字。缺省时视为「等待部署配置」。 */
  readonly appId: string;
  /** 公网 HTTPS 回调；为 null 表示尚未部署，本地只能预览。 */
  readonly redirectUri: string | null;
}

/* -------------------------------------------------------------------------- */
/* 凭证与脱敏诊断                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 只输出长度与 sha256 前缀，**绝不输出明文**。
 * 这是 skill 的硬性要求：诊断信息不得包含完整 App Key / Access Secret /
 * authorization_code / access_token。
 */
export function fingerprint(value: string | null | undefined): string | null {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null;
}

export interface CredentialDetail {
  readonly source: string | null;
  readonly configured: boolean;
  readonly length: number;
  readonly sha256Prefix: string | null;
}

export interface CredentialDiagnostics {
  readonly appKey: CredentialDetail;
  readonly accessSecret: CredentialDetail;
}

export interface CredentialWarning {
  readonly code: string;
  readonly message: string;
}

function readEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** 从环境变量读三类凭证（只读，不落盘、不输出明文）。 */
export function resolveOAuthCredentials(
  env?: Record<string, string | undefined>,
): { appKey: string; accessSecret: string } {
  return env ? {
    appKey: readEnv(env, 'ZHIHU_OAUTH_APP_KEY'),
    accessSecret: readEnv(env, 'ZHIHU_ACCESS_SECRET'),
  } : oauthCredentialsFromEnv();
}

export function describeCredential(value: string, envName: string): CredentialDetail {
  return {
    source: value ? `env:${envName}` : 'missing',
    configured: Boolean(value),
    length: value.length,
    sha256Prefix: fingerprint(value),
  };
}

export function credentialDiagnostics(
  credentials: { appKey: string; accessSecret: string },
): CredentialDiagnostics {
  return {
    appKey: describeCredential(credentials.appKey, 'ZHIHU_OAUTH_APP_KEY'),
    accessSecret: describeCredential(credentials.accessSecret, 'ZHIHU_ACCESS_SECRET'),
  };
}

/**
 * 凭证串位检查。
 *
 * 这三条对应 skill 里最容易出错的三种误填，必须在部署前拦住：
 * App ID 当成 App Key、App Key 当成 Access Secret、两个 Secret 完全相同。
 */
export function credentialWarnings(
  config: OAuthConfig,
  diagnostics: CredentialDiagnostics,
): CredentialWarning[] {
  const warnings: CredentialWarning[] = [];
  const { appKey, accessSecret } = diagnostics;
  const appId = String(config.appId || '');

  if (appKey.configured && appKey.length <= 8) {
    warnings.push({
      code: 'APP_KEY_TOO_SHORT',
      message: 'ZHIHU_OAUTH_APP_KEY 看起来过短，请确认没有填成 App ID。',
    });
  }

  if (appKey.configured && appId && appKey.sha256Prefix === fingerprint(appId)) {
    warnings.push({
      code: 'APP_ID_USED_AS_APP_KEY',
      message: 'ZHIHU_OAUTH_APP_KEY 等于 App ID。App ID 应写入配置，不是 App Key。',
    });
  }

  if (
    appKey.configured &&
    accessSecret.configured &&
    appKey.sha256Prefix === accessSecret.sha256Prefix
  ) {
    warnings.push({
      code: 'APP_KEY_USED_AS_ACCESS_SECRET',
      message: 'ZHIHU_ACCESS_SECRET 等于 OAuth App Key。两者是不同凭证。',
    });
  }

  return warnings;
}

/* -------------------------------------------------------------------------- */
/* 配置解析                                                                    */
/* -------------------------------------------------------------------------- */

/** 公网 HTTPS 判定：本地/内网地址一律判为「不能完成真实登录」。 */
export function isPublicHttpsRedirect(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocal =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      (() => {
        const match = hostname.match(/^172\.(\d{1,3})\./);
        return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
      })();

    return url.protocol === 'https:' && !isLocal && url.pathname.endsWith('/auth/callback');
  } catch {
    return false;
  }
}

export function resolveOAuthConfig(
  env: Record<string, string | undefined> = process.env,
): OAuthConfig {
  const raw = readEnv(env, 'ZHIHU_OAUTH_REDIRECT_URI');
  return {
    appId: readEnv(env, 'ZHIHU_OAUTH_APP_ID') || readEnv(env, 'ZHIHU_OAUTH_APPID'),
    redirectUri: raw.length > 0 ? raw : null,
  };
}

export function oauthStatusSummary(
  config: OAuthConfig,
  credentials: { appKey: string; accessSecret: string },
) {
  const diagnostics = credentialDiagnostics(credentials);
  return {
    appId: config.appId || null,
    redirectUri: config.redirectUri,
    callbackConfigured: isPublicHttpsRedirect(config.redirectUri),
    /** 本地只能预览页面；为 true 时不得声称可以完成真实登录。 */
    localPreviewOnly: !isPublicHttpsRedirect(config.redirectUri),
    credentialDiagnostics: diagnostics,
    credentialWarnings: credentialWarnings(config, diagnostics),
    interfaces: USER_INTERFACES,
  };
}

/* -------------------------------------------------------------------------- */
/* 会话（仅进程内存，绝不落盘）                                                */
/* -------------------------------------------------------------------------- */

export interface OAuthSessionState {
  state: string | null;
  token: string | null;
  expiresAt: number | null;
  profile: ZhihuProfile | null;
  /** 回调是否带了 state；没带时为 false，必须如实上报而非假装通过。 */
  stateVerified: boolean | null;
  error: { code: string; message: string } | null;
  debug: Record<string, unknown> | null;
}

export interface ZhihuProfile {
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly headline: string | null;
  readonly url: string | null;
}

export const SESSION_COOKIE = 'zhihu_oauth_session';
const SESSION_TTL_MS = 8 * 3600 * 1000;

/**
 * 进程内会话表。
 *
 * 与 skill 一致：OAuth Token 只存本地 Node 进程内存，不写任何持久化存储。
 * 因此多实例部署（如 Serverless 冷启动）会导致会话丢失——这是已知取舍，
 * 黑客松联调可接受，生产需换成共享存储。
 */
const sessions = new Map<string, OAuthSessionState>();

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const hit = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  return hit ? decodeURIComponent(hit.slice(hit.indexOf('=') + 1)) : null;
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  sessions.forEach((session, id) => {
    if (session.expiresAt !== null && session.expiresAt <= now) {
      sessions.delete(id);
    }
  });

  // 即使没有过期项也必须有硬上限，避免攻击者用未完成的 OAuth 会话耗尽内存并驱逐正常用户。
  const MAX_SESSIONS = 512;
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (typeof oldest !== 'string') break;
    sessions.delete(oldest);
  }
}

const emptySession = (): OAuthSessionState => ({
  state: null,
  token: null,
  expiresAt: null,
  profile: null,
  stateVerified: null,
  error: null,
  debug: null,
});

/**
 * 取当前会话；不存在时创建并返回需要下发的 Set-Cookie。
 * 返回值里的 `cookie` 为 null 表示沿用已有会话，无需重设。
 *
 * `secure` 参数决定是否加 `Secure` 属性：**必须按请求的实际协议判断**，
 * 不能按 `NODE_ENV`。因为 `next start` 下 NODE_ENV 恒为 production，
 * 但本地预览走的是 http://127.0.0.1 —— 此时带 Secure 的 Cookie 会被浏览器
 * 直接丢弃，表现为「点了授权但状态一直不保持」。
 */
export function getSession(
  request: Request,
): {
  id: string;
  session: OAuthSessionState;
  cookie: string | null;
} {
  const existingId = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const existing = existingId ? sessions.get(existingId) : undefined;

  if (existingId && existing) {
    return { id: existingId, session: existing, cookie: null };
  }

  pruneExpiredSessions();
  const id = randomBytes(24).toString('base64url');
  const session = emptySession();
  sessions.set(id, session);

  const secure = isSecureRequest(request) ? '; Secure' : '';
  const cookie = `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${
    SESSION_TTL_MS / 1000
  }${secure}`;

  return { id, session, cookie };
}

/**
 * 判断请求是否真的是 HTTPS。
 *
 * 反向代理（Cloudflare / Sealos）下 `x-forwarded-proto` 才是真相，
 * 优先读它；否则回落到 URL 协议。
 */
function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 仅测试用：清空进程内会话表。 */
export function __resetSessions(): void {
  sessions.clear();
}

/**
 * 构造**对外可见**的来源（`scheme://host[:port]`）。
 *
 * ## 为什么不能用 `request.url`
 *
 * 部署形态是「Nginx 反代 → Docker 容器内的 Next standalone」。
 * standalone 的 `request.url` **不是**客户端请求的那条 URL ——
 * 它是容器用自己的 `HOSTNAME` / `PORT` 拼出来的（compose 里为
 * `HOSTNAME=0.0.0.0`、`PORT=3000`）。
 *
 * 于是 `new URL('/oauth?oauth=success', request.url)` 会生成
 * `http://0.0.0.0:3000/oauth?oauth=success`；再被
 * `x-forwarded-proto: https` 抬成 `https://0.0.0.0:3000/...`。
 * 手机浏览器打开就是 `ERR_CONNECTION_REFUSED` —— 授权明明成功了，
 * 用户却看到「网页无法打开」。
 *
 * ## 这个 bug 为什么本地测不出来
 *
 * 本地 `next dev` / 直连时，`request.url` 就是用户访问的那条 URL，
 * 所以无论怎么点都是对的。它**只在反代 + standalone 下暴露** ——
 * 这正是「本地全绿、线上打不开」的典型成因。
 *
 * ## 三级取值
 *
 * 1. `APP_PUBLIC_ORIGIN` —— 部署时显式声明。最可靠，不依赖代理细节。
 * 2. `x-forwarded-host` —— 反代传来的原始主机。要求反代传 `$http_host`
 *    而不是 `$host`：本站对外是 **`:8443`**，而 `$host` 不含端口，
 *    用它会把用户送回 443（那条路在移动网络下是被拦的）。
 * 3. `request.url` —— 本地开发与直连的兜底。
 */
export function publicOrigin(request: Request): string {
  const first = (value: string | null): string =>
    value ? (value.split(',')[0]?.trim() ?? '') : '';

  const configured = process.env.APP_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const forwardedHost = first(request.headers.get('x-forwarded-host'));
  if (forwardedHost) {
    const proto = first(request.headers.get('x-forwarded-proto')).toLowerCase() || 'https';
    return `${proto}://${forwardedHost}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

/**
 * 把路径解析成对外可见的绝对 URL。
 *
 * 传入绝对 URL 时（例如知乎授权页地址）原样返回 —— `new URL(abs, base)`
 * 本来就忽略 base，这里保持同一语义。
 */
export function publicUrl(request: Request, path: string): URL {
  const origin = publicOrigin(request);
  return new URL(path, origin.length > 0 ? origin : request.url);
}

/**
 * 取当前会话对应的知乎用户标识（url_token）。
 *
 * 用途：服务端记忆按账号隔离时做 key。
 * 用 url_token 而不是昵称的原因见 `core/memoryStore.ts` 顶部说明 ——
 * 昵称可改可重复，拿它当主键会导致两个同名用户互相读到对方的记忆。
 *
 * 未授权、或 profile 里没有可用主页链接时返回 null。
 */
export function sessionUrlToken(request: Request): string | null {
  const existingId = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const session = existingId ? sessions.get(existingId) : undefined;
  return extractUrlToken(session?.profile?.url);
}

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function safeCredential(value: string): string {
  if (!value || /[\r\n"\\]/.test(value)) {
    throw new OAuthError('凭证格式无效', 'CREDENTIAL_INVALID');
  }
  return value;
}

export function safeEqual(left: string | null, right: string | null): boolean {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export class OAuthError extends Error {
  readonly code: string;

  constructor(message: string, code = 'OAUTH_FAILED') {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 从平台响应里取错误信息；兼容 Code/data/Message 多种形状。 */
function payloadError(payload: unknown, fallback: string): OAuthError {
  const root = isRecord(payload) ? payload : {};
  const data = root.data ?? root.Data;
  const message =
    (typeof data === 'string' ? data : isRecord(data) ? data.message : null) ||
    (typeof root.message === 'string' ? root.message : null) ||
    (typeof root.Message === 'string' ? root.Message : null) ||
    fallback;

  const code = root.code ?? root.Code;
  return new OAuthError(String(message).slice(0, 200), String(code ?? 'OAUTH_FAILED'));
}

async function postForm(url: string, form: URLSearchParams, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
      cache: 'no-store',
    });

    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * OAuth 当前用户资料端点只认 OAuth access token 的 Bearer 鉴权。
 *
 * 这里刻意不复用 getUserApi：后者服务于 developer.zhihu.com 的五项数据接口，
 * 需要 Access Secret + X-OAuth-Token。把两套鉴权混用会出现“授权成功但昵称/头像为空”。
 */
async function getOAuthUserProfile(
  url: string,
  oauthToken: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${safeCredential(oauthToken)}`,
        accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw payloadError(payload, `用户资料接口失败（HTTP ${response.status}）`);
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getUserApi(
  url: string,
  accessSecret: string,
  oauthToken: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${safeCredential(accessSecret)}`,
        'x-oauth-token': safeCredential(oauthToken),
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'content-type': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeoutId);
  }
}

function firstItem(payload: unknown): unknown | null {
  if (!isRecord(payload)) {
    return null;
  }
  const data = payload.Data ?? payload.data;
  if (!isRecord(data)) {
    return null;
  }
  const items = data.Items ?? data.items;
  return Array.isArray(items) ? items[0] ?? null : null;
}

/* -------------------------------------------------------------------------- */
/* 核心流程                                                                    */
/* -------------------------------------------------------------------------- */

export interface OAuthDeps {
  readonly config: OAuthConfig;
  readonly credentials: { appKey: string; accessSecret: string };
  readonly timeoutMs?: number;
}

/** 构造授权跳转地址。缺回调或缺 app_key 时抛出可诊断错误。 */
export function buildAuthorizeUrl(
  deps: OAuthDeps,
  state: string,
): string {
  if (!deps.config.redirectUri || !isPublicHttpsRedirect(deps.config.redirectUri)) {
    throw new OAuthError(
      '本地地址无法完成知乎登录。请先部署应用并配置公网 HTTPS 回调地址。',
      'DEPLOYMENT_REQUIRED',
    );
  }

  if (!deps.config.appId) {
    throw new OAuthError('尚未配置 App ID（ZHIHU_OAUTH_APP_ID）', 'APP_ID_REQUIRED');
  }

  if (!deps.credentials.appKey) {
    throw new OAuthError('尚未配置 OAuth App Key（ZHIHU_OAUTH_APP_KEY）', 'APP_KEY_REQUIRED');
  }

  const url = new URL(ZHIHU_AUTHORIZE_URL);
  url.searchParams.set('redirect_uri', deps.config.redirectUri);
  url.searchParams.set('app_id', deps.config.appId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface TokenExchangeResult {
  readonly token: string;
  readonly expiresAt: number | null;
}

/** 用 authorization_code 换 OAuth access_token。 */
export async function exchangeToken(
  deps: OAuthDeps,
  code: string,
): Promise<TokenExchangeResult> {
  if (!deps.config.redirectUri) {
    throw new OAuthError('回调地址未配置', 'REDIRECT_URI_MISSING');
  }

  if (!deps.credentials.appKey) {
    throw new OAuthError('后端凭证配置不完整：缺少 OAuth App Key', 'CREDENTIAL_INCOMPLETE');
  }

  // grant_type 是固定枚举值，不从回调读取；code 字段承载 authorization_code
  const form = new URLSearchParams({
    app_id: deps.config.appId,
    app_key: safeCredential(deps.credentials.appKey),
    grant_type: 'authorization_code',
    redirect_uri: deps.config.redirectUri,
    code: safeCredential(code),
  });

  const payload = await postForm(ZHIHU_TOKEN_URL, form, deps.timeoutMs ?? 20_000);

  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : isRecord(root.Data) ? root.Data : null;
  const token =
    (typeof root.access_token === 'string' ? root.access_token : null) ??
    (data && typeof data.access_token === 'string' ? data.access_token : null);

  if (!token) {
    throw payloadError(payload, '未获得 OAuth access token');
  }

  const expiresIn = Number(
    root.expires_in ?? (data ? data.expires_in : undefined) ?? NaN,
  );

  return {
    token,
    expiresAt: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null,
  };
}

/**
 * 读取账号资料。
 *
 * `/user` 没有正式响应 schema，因此只做宽松抽取；失败一律返回 null，
 * **不得伪造字段**，也不阻断五项正式用户接口。
 */
export function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  // 知乎返回的模板不只一种：{size}、{size_xl}、%7Bsize%7D 都要先展开，
  // 否则浏览器会请求一个带花括号的无效 CDN 地址，代理只能得到 502。
  const expanded = value
    .trim()
    .replace(/\\?\{size(?:_[^}]+)?\}|%7Bsize(?:_[^%]+)?%7D/gi, 'xl');
  const absolute = expanded.startsWith('//') ? `https:${expanded}` : expanded;

  try {
    const url = new URL(absolute);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.protocol === 'http:' && /(^|\.)zh(?:img|ihu)\.com$/i.test(url.hostname)) {
      url.protocol = 'https:';
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** 在不确定 schema 的知乎资料响应中递归寻找头像字段。 */
function nestedAvatarUrl(value: unknown, depth = 0): string | null {
  if (depth > 5 || !isRecord(value)) {
    return null;
  }

  for (const [key, candidate] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    const looksLikeAvatar =
      normalizedKey.includes('avatar') ||
      normalizedKey === 'picture' ||
      normalizedKey === 'pictureurl' ||
      normalizedKey === 'imageurl';

    if (looksLikeAvatar) {
      if (typeof candidate === 'string') {
        const normalized = normalizeAvatarUrl(candidate);
        if (normalized) return normalized;
      }
      const nested = nestedAvatarUrl(candidate, depth + 1);
      if (nested) return nested;
    }

    if (isRecord(candidate)) {
      const nested = nestedAvatarUrl(candidate, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}
export async function fetchProfile(
  deps: OAuthDeps,
  token: string,
): Promise<ZhihuProfile | null> {
  const payload = await getOAuthUserProfile(
    `${ZHIHU_OPENAPI_BASE}/user`,
    token,
    deps.timeoutMs ?? 20_000,
  );

  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : null;
  const legacyData = isRecord(root.Data) ? root.Data : null;
  const sources = [
    data?.user,
    data?.User,
    legacyData?.user,
    legacyData?.User,
    root.user,
    root.User,
    data,
    legacyData,
    root,
  ].filter((candidate): candidate is Record<string, unknown> => isRecord(candidate));

  if (sources.length === 0) {
    return null;
  }

  const pick = (...keys: string[]): string | null => {
    for (const source of sources) {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }
    return null;
  };

  const name = pick('name', 'Name', 'nickname', 'nick_name', 'Fullname', 'fullname');
  let rawAvatar = pick(
    'avatar_url',
    'avatarUrl',
    'AvatarURL',
    'AvatarUrl',
    'avatar_url_template',
    'avatarUrlTemplate',
    'AvatarURLTemplate',
    'AvatarUrlTemplate',
    'avatar',
  );

  if (!rawAvatar) {
    const avatarContainers = ['avatar', 'Avatar', 'avatar_info', 'avatarInfo', 'AvatarInfo'];
    const avatarFields = [
      'url',
      'Url',
      'src',
      'Src',
      'url_template',
      'urlTemplate',
      'template',
      'Template',
      'large',
      'medium',
    ];

    outer: for (const source of sources) {
      for (const containerKey of avatarContainers) {
        const container = source[containerKey];
        if (!isRecord(container)) continue;
        for (const field of avatarFields) {
          const value = container[field];
          if (typeof value === 'string' && value.trim().length > 0) {
            rawAvatar = value.trim();
            break outer;
          }
        }
      }
    }
  }

  const avatarUrl = normalizeAvatarUrl(rawAvatar) ?? nestedAvatarUrl(payload);
  const headline = pick('headline', 'Headline', 'description', 'Description');
  const profileUrl = pick('url', 'Url', 'profile_url', 'profileUrl');
  const urlToken = pick('url_token', 'UrlToken');
  const url =
    profileUrl ??
    (urlToken ? `https://www.zhihu.com/people/${encodeURIComponent(urlToken)}` : null);

  if (!name && !avatarUrl && !headline && !url) {
    return null;
  }

  return { name, avatarUrl, headline, url };
}

export type UserInterfaceStatus = 'success' | 'empty' | 'error';

export interface UserInterfaceResult {
  readonly id: UserInterfaceId;
  readonly name: string;
  readonly endpoint: string;
  readonly status: UserInterfaceStatus;
  readonly item: unknown;
  readonly message: string | null;
}

/**
 * 五项用户接口各打一条。
 *
 * `favlist_contents` 依赖第一条收藏夹的 `UrlToken`；账号没有收藏夹时记为
 * `empty` 而**不是失败**（skill 明确要求空数据不算失败）。
 */
export async function runUserInterfaces(
  deps: OAuthDeps,
  token: string,
): Promise<UserInterfaceResult[]> {
  if (!deps.credentials.accessSecret) {
    throw new OAuthError('开放平台 Access Secret 未配置', 'ACCESS_SECRET_MISSING');
  }

  const results: UserInterfaceResult[] = [];
  let favlistToken: string | null = null;

  for (const definition of USER_INTERFACES) {
    const query = new URLSearchParams({ Limit: '1' });

    if (definition.id === 'contents') {
      query.set('ContentType', 'all');
      query.set('Offset', '0');
      query.set('SortField', 'ts');
      query.set('SortOrder', 'desc');
    }

    if (definition.id === 'followees') {
      query.set('Offset', '0');
    }

    if (definition.id === 'favlist_contents') {
      if (!favlistToken) {
        results.push({
          ...definition,
          status: 'empty',
          item: null,
          message: '账号没有可用于测试的收藏夹。',
        });
        continue;
      }
      query.set('FavlistUrlToken', favlistToken);
      query.set('Offset', '0');
    }

    try {
      const payload = await getUserApi(
        `${ZHIHU_USERAPI_BASE}${definition.endpoint}?${query.toString()}`,
        deps.credentials.accessSecret,
        token,
        deps.timeoutMs ?? 30_000,
      );

      const root = isRecord(payload) ? payload : {};
      const code = root.Code ?? root.code;

      if (code !== 0 && code !== undefined) {
        throw payloadError(payload, '用户数据接口失败');
      }

      const item = firstItem(payload);

      if (definition.id === 'favlists' && isRecord(item) && typeof item.UrlToken === 'string') {
        favlistToken = item.UrlToken;
      }

      results.push({
        ...definition,
        status: item ? 'success' : 'empty',
        item,
        message: item ? null : '接口成功但没有数据。',
      });
    } catch (error) {
      results.push({
        ...definition,
        status: 'error',
        item: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * 脱敏诊断。
 *
 * 对齐 skill 的 `deployment-credentials.md` 诊断字段，用于线上排障；
 * 只含长度与 sha256 前缀，**不含任何明文凭证**。
 */
export function buildDiagnostics(
  deps: OAuthDeps,
  code: string | null,
): Record<string, unknown> {
  const diagnostics = credentialDiagnostics(deps.credentials);

  return {
    stage: 'callback_received',
    codeReceived: Boolean(code),
    codeLength: String(code ?? '').length,
    tokenExchange: {
      url: ZHIHU_TOKEN_URL,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      appId: deps.config.appId,
      appKeySource: diagnostics.appKey.source,
      appKeyLength: diagnostics.appKey.length,
      appKeySha256Prefix: diagnostics.appKey.sha256Prefix,
      grantType: 'authorization_code',
      redirectUri: deps.config.redirectUri,
      codeField: 'code',
      codeLength: String(code ?? '').length,
    },
    accessSecret: diagnostics.accessSecret,
    credentialWarnings: credentialWarnings(deps.config, diagnostics),
  };
}
