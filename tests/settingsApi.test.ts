import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 密钥配置接口的契约测试。
 *
 * 会话用 `vi.mock` 换成可控 token —— 这样能同时覆盖「已登录 / 匿名」两条路径，
 * 而不必真的跑一遍知乎 OAuth。
 *
 * 三条必须成立的承诺（**2026-09-13 修订第 1 条**）：
 * 1. **未登录也能配置**：按匿名 cookie 隔离，不再要求登录
 *    （「不登陆账号也能配置 AI，自己玩耍」）；
 * 2. 任何响应里都搜不到明文密钥；
 * 3. 删除后确实清空（GET 立刻反映）。
 *
 * 另有一条**安全承诺**必须守住：**env 里的 key 永不被使用**
 * （见 `keyResolution.test.ts`）—— 否则部署者的 key 会被访客白用。
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('@/core/oauth/zhihu', () => ({
  sessionUrlToken: () => session.token,
}));

const { DELETE, GET, PUT } = await import('@/app/api/settings/route');

const SECRET = 'placeholder-zhihu-secret-not-real';
const MODEL_KEY = 'placeholder-model-key-not-a-real-secret';
/** 一条合法的匿名 cookie（32 位十六进制），用于模拟「同一个浏览器」。 */
const ANON_COOKIE = `zhihu_anon=${'b'.repeat(32)}`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zhihu-settings-api-'));
  process.env.SETTINGS_DIR = dir;
  session.token = null;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SETTINGS_DIR;
});

/** 带匿名 cookie 的请求：模拟「同一个未登录浏览器」。 */
function post(body: unknown, method = 'PUT'): Request {
  return new Request('http://localhost/api/settings', {
    method,
    headers: { 'content-type': 'application/json', cookie: ANON_COOKIE },
    body: JSON.stringify(body),
  });
}

const getReq = () => new Request('http://localhost/api/settings', { headers: { cookie: ANON_COOKIE } });
const deleteReq = (field: string) =>
  new Request(`http://localhost/api/settings?field=${field}`, {
    method: 'DELETE',
    headers: { cookie: ANON_COOKIE },
  });

describe('未登录：按匿名身份正常服务（v3 之后的契约）', () => {
  it('不再要求登录；配置能存能读', async () => {
    const getPayload = await (await GET(getReq())).json();
    expect(getPayload.authenticated).toBe(false);
    // 未登录是**正常态**：不再是 not-signed-in 拒绝
    expect(getPayload.reason).not.toBe('not-signed-in');

    const putPayload = await (await PUT(post({ zhihuAccessSecret: SECRET }))).json();
    expect(putPayload.ok).toBe(true);
    expect(putPayload.authenticated).toBe(false);

    const afterGet = await (await GET(getReq())).json();
    expect(afterGet.settings.zhihuAccessSecret.configured).toBe(true);

    await DELETE(deleteReq('all'));
  });

  it('匿名身份之间互不可见（隔离靠 cookie，不靠登录）', async () => {
    await PUT(post({ modelApiKey: MODEL_KEY }));
    expect((await (await GET(getReq())).json()).settings.model.apiKey.configured).toBe(true);

    // 另一个「浏览器」：不同 cookie → 另一个匿名身份
    const otherBrowser = new Request('http://localhost/api/settings', {
      headers: { cookie: `zhihu_anon=${'c'.repeat(32)}` },
    });
    const other = await (await GET(otherBrowser)).json();
    expect(other.settings.model.apiKey.configured).toBe(false);

    await DELETE(deleteReq('all'));
  });

  it('首次访问会下发匿名 cookie（否则下次请求配置就"丢"了）', async () => {
    const fresh = new Request('http://localhost/api/settings');
    const response = await GET(fresh);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('zhihu_anon=');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('已登录：保存与回读', () => {
  beforeEach(() => {
    session.token = 'url-token-alice';
  });

  it('保存成功后只回指纹，不回明文', async () => {
    const response = await PUT(post({ zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY }));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.ok).toBe(true);
    expect(payload.persisted).toBe(true);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-trace-id')).toBeTruthy();

    expect(serialized.includes(SECRET)).toBe(false);
    expect(serialized.includes(MODEL_KEY)).toBe(false);
    expect(payload.settings.zhihuAccessSecret.configured).toBe(true);
    expect(payload.settings.zhihuAccessSecret.length).toBe(SECRET.length);
  });

  it('GET 反映已配置状态，且不含明文', async () => {
    await PUT(post({ zhihuAccessSecret: SECRET }));
    const payload = await (await GET(getReq())).json();

    expect(payload.ok).toBe(true);
    expect(payload.authenticated).toBe(true);
    expect(payload.settings.zhihuAccessSecret.configured).toBe(true);
    expect(payload.settings.zhihuAccessSecret.digest).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(payload).includes(SECRET)).toBe(false);
  });

  it('非法密钥被拒且不落盘', async () => {
    const payload = await (await PUT(post({ zhihuAccessSecret: 'short' }))).json();

    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('invalid-secret');
    expect(payload.settings.zhihuAccessSecret.configured).toBe(false);
  });

  it('非法端点被拒', async () => {
    const payload = await (await PUT(post({ modelBaseUrl: 'http://evil.example.com/v1' }))).json();
    expect(payload.reason).toBe('invalid-base-url');
  });

  it('空请求体 / 无可更新字段 → 结构化拒绝，不是 500', async () => {
    const empty = await (await PUT(post({}))).json();
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('nothing-to-update');

    const broken = await (await PUT(new Request('http://localhost/api/settings', { method: 'PUT', body: 'nope' }))).json();
    expect(broken.reason).toBe('invalid-body');
  });

  it('未知字段被忽略（不进白名单就不落盘）', async () => {
    const payload = await (await PUT(post({ somethingElse: 'x', adminToken: 'y' }))).json();
    expect(payload.reason).toBe('nothing-to-update');
  });

  it('**env 兜底恒为 false**：部署者的 key 不会被当作访客的配置', async () => {
    const previous = process.env.DM_API_KEY;
    process.env.DM_API_KEY = 'env-model-key-123456';
    try {
      const payload = await (await GET(getReq())).json();
      // 即使服务端 env 里有 key，界面也必须报「没配」——
      // 否则访客会以为可以直接用，而实际上我们不会替他付账
      expect(payload.settings.envFallback.model).toBe(false);
      expect(payload.settings.envFallback.zhihu).toBe(false);
      expect(payload.settings.model.apiKey.configured).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.DM_API_KEY;
      } else {
        process.env.DM_API_KEY = previous;
      }
    }
  });
});

describe('已登录：删除', () => {
  beforeEach(() => {
    session.token = 'url-token-alice';
  });

  it('删知乎 key 后模型配置保留', async () => {
    await PUT(post({ zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY }));
    const payload = await (await DELETE(deleteReq('zhihu'))).json();

    expect(payload.ok).toBe(true);
    expect(payload.cleared).toBe(true);
    expect(payload.settings.zhihuAccessSecret.configured).toBe(false);
    expect(payload.settings.model.apiKey.configured).toBe(true);
  });

  it('删 model 一组字段', async () => {
    await PUT(post({ zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY }));
    const payload = await (await DELETE(deleteReq('model'))).json();

    expect(payload.settings.model.apiKey.configured).toBe(false);
    expect(payload.settings.zhihuAccessSecret.configured).toBe(true);
  });

  it('all 清空一切，且响应里没有明文', async () => {
    await PUT(post({ zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY }));
    const response = await DELETE(deleteReq('all'));
    const payload = await response.json();

    expect(payload.settings.zhihuAccessSecret.configured).toBe(false);
    expect(payload.settings.model.apiKey.configured).toBe(false);
    expect(JSON.stringify(payload).includes(SECRET)).toBe(false);

    // 再 GET 一次确认真的空了（而不是只在响应里说空了）
    const after = await (await GET(getReq())).json();
    expect(after.settings.zhihuAccessSecret.configured).toBe(false);
    expect(after.settings.model.apiKey.configured).toBe(false);
  });

  it('两个账号互不影响', async () => {
    session.token = 'alice';
    await PUT(post({ zhihuAccessSecret: SECRET }));

    session.token = 'bob';
    const bobView = await (await GET(getReq())).json();
    expect(bobView.settings.zhihuAccessSecret.configured).toBe(false);

    await DELETE(deleteReq('all'));
    session.token = 'alice';
    const aliceView = await (await GET(getReq())).json();
    expect(aliceView.settings.zhihuAccessSecret.configured).toBe(true);
  });
});
