import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ERROR_STATUS, fail } from '@/features/decision-session/api';
import { allocateAppLlmCall, DailyLlmBudget, SessionLlmBudget } from '@/core/usage/budget';
import { resolveModelConfigForRequest, secretOriginFor } from '@/features/run/keyResolution';

/**
 * 公开部署的安全与预算契约（产品化方案 §13 / §14 / §45）。
 *
 * 这个文件回答三个「上线前必须能自证」的问题：
 *
 * 1. 配额拒绝给出的 HTTP 语义对不对（**429 + 可重试时间**，不是 400）；
 * 2. 全站每日额度用满时，**自带 key 的访客是否完全不受影响**；
 * 3. 路由是否只在**真的花服务器 key** 时才扣 App 预算。
 *
 * 第 3 条用源码断言而不是起服务：与 `serverProviderOrigin.test.ts` 同一种做法，
 * 它钉的是「这类漏网不许再出现」，而不是某一次请求的结果。
 */

function request(cookie?: string): Request {
  return new Request('http://localhost/api/sessions', {
    headers: cookie ? { cookie } : {},
  });
}

describe('配额 / 预算拒绝的 HTTP 语义（方案 §14）', () => {
  it('quota-exceeded → 429，并下发 retryAfter（秒）与 Retry-After 头', async () => {
    const res = fail({
      code: 'quota-exceeded',
      message: '这一小时里已经开了 5 局，先歇一会儿再开下一局。',
      retryable: true,
      retryAfterMs: 89_500,
      traceId: 't-quota',
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; retryable: boolean; retryAfter?: number };
      traceId: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('quota-exceeded');
    expect(body.error.retryable).toBe(true);
    // 89.5 秒向上取整成 90：宁可让用户多等半秒，也不要让他早半秒又撞一次
    expect(body.error.retryAfter).toBe(90);
    expect(res.headers.get('retry-after')).toBe('90');
    expect(body.traceId).toBe('t-quota');
  });

  it('没有恢复时间时不发 Retry-After（避免前端拿 0 空转重试）', async () => {
    const res = fail({
      code: 'quota-exceeded',
      message: 'x',
      retryAfterMs: null,
      traceId: 't-none',
    });
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect('retryAfter' in body.error).toBe(false);
    expect(res.headers.get('retry-after')).toBeNull();
    // 0 或负数同样视为「没有恢复时间」
    const zero = fail({ code: 'quota-exceeded', message: 'x', retryAfterMs: 0, traceId: 't-zero' });
    expect(zero.headers.get('retry-after')).toBeNull();
  });

  it('参数错误仍是 400，且绝不带 retryAfter（重试一万次也没用）', async () => {
    const res = fail({
      code: 'bad-request',
      message: '先写下一句你现在卡住的选择。',
      traceId: 't-bad',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect('retryAfter' in body.error).toBe(false);
    expect(res.headers.get('retry-after')).toBeNull();
  });

  it('错误体只有 code / message / retryable，不含堆栈', async () => {
    const res = fail({ code: 'app-provider-unavailable', message: '这一档暂时不可用。', traceId: 't-503' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'retryable']);
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('两类配额拒绝都钉在 429，来源不可用钉在 503', () => {
    expect(ERROR_STATUS['quota-exceeded']).toBe(429);
    expect(ERROR_STATUS['budget-exhausted']).toBe(429);
    expect(ERROR_STATUS['app-provider-unavailable']).toBe(503);
  });
});

describe('全站每日额度用满后：BYOK 照常', () => {
  it('App 额度耗尽时，自带 key 的访客来源仍是 account 且能拿到自己的配置', async () => {
    const { writeSettings } = await import('@/core/settingsStore');
    const { readOwnSettings } = await import('@/features/run/identity');

    /**
     * 匿名身份是首次访问时下发 cookie 的：要先拿一次身份、再把 cookie 带回来，
     * 否则两次调用是两个不同的人（与 `serverProviderOrigin.test.ts` 同一套动作）。
     */
    const first = readOwnSettings(request());
    const cookie = first.identity.setCookie?.split(';')[0] ?? '';
    expect(cookie.length).toBeGreaterThan(0);

    const req = request(cookie);
    const { identity } = readOwnSettings(req);
    writeSettings(identity.key, { modelApiKey: 'user-own-key-for-budget-test' });

    try {
      const env = { APP_LLM_API_KEY: 'app-key-should-not-be-used' };
      const daily = new DailyLlmBudget({ limit: 1 });
      daily.consume(); // 全站当天额度用满

      // 1. 这一局用的是他自己的钱
      expect(secretOriginFor(req, env)).toEqual({ model: 'account', zhihu: 'none' });
      // 2. 他自己的配置照常解析出来（App 额度与它无关）
      expect(resolveModelConfigForRequest(req, env)?.apiKey).toBe('user-own-key-for-budget-test');
      // 3. 只有走 App 的调用才会被这道闸拦下
      const denied = allocateAppLlmCall({
        session: new SessionLlmBudget(),
        daily,
        key: 's1',
      });
      expect(denied.allowed).toBe(false);
      expect(denied.scope).toBe('daily');
    } finally {
      writeSettings(identity.key, { modelApiKey: '' });
    }
  });
});

describe('路由只在真的花服务器 key 时才扣 App 预算', () => {
  function source(relative: string): string {
    return readFileSync(join(process.cwd(), relative), 'utf8');
  }

  it('sessions 路由：按 origin.model === app 记账，且每日上限会先暂停 App provider', () => {
    const text = source('src/app/api/sessions/route.ts');
    /**
     * 旧写法 `usesAppProvider && modelConfig` 会把「自己配了模型 key、
     * 只是借用了 App 知乎」的访客也扣一轮服务器的账。
     */
    expect(text).not.toContain('usesAppProvider && modelConfig');
    expect(text).toContain("origin.model === 'app' && modelConfig");
    expect(text).toContain('appDailyLlmBudget.peek()');
    expect(text).toContain('retryAfterMs: quota.retryAfterMs');
  });

  it('dm 路由：本局上限与全局每日一起过，且失败只降级不报错', () => {
    const text = source('src/app/api/dm/route.ts');
    expect(text).toContain('allocateAppLlmCall');
    expect(text).toContain('appDailyLlmBudget');
    expect(text).toContain('config = null');
  });
});

/**
 * `/api/health` 是唯一一个「匿名可打、无需上下文」的接口，也是最容易被
 * 顺手写成调试面板的地方。方案 §16 的硬规则：只报结论，不报值。
 */
describe('/api/health：只报结论，不报值（方案 §16）', () => {
  it('配了 App 能力也只回就绪结论，响应里找不到密钥值或端点', async () => {
    const { GET } = await import('@/app/api/health/route');

    const before = { ...process.env };
    process.env.APP_LLM_API_KEY = 'sk-health-test-should-never-leak';
    process.env.APP_LLM_BASE_URL = 'https://internal-proxy.example.com/v1';
    process.env.APP_ZHIHU_ACCESS_SECRET = 'zhihu-health-test-should-never-leak';

    try {
      const res = await GET(new Request('http://localhost/api/health'));
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).not.toContain('sk-health-test-should-never-leak');
      expect(text).not.toContain('zhihu-health-test-should-never-leak');
      // 端点同样不许出现（方案 §16 禁止「完整 baseUrl」）
      expect(text).not.toContain('internal-proxy.example.com');
      expect(text).not.toContain('baseUrl');

      const body = JSON.parse(text) as { readiness: Record<string, unknown> };
      expect(body.readiness).toEqual({ ai: 'ready', zhihu: 'ready', publicRuntimeReady: true });
    } finally {
      // 环境必须还原：这个用例不能影响同文件后面的用例
      for (const key of ['APP_LLM_API_KEY', 'APP_LLM_BASE_URL', 'APP_ZHIHU_ACCESS_SECRET']) {
        if (before[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = before[key];
        }
      }
    }
  });

  it('都没配时如实回 fallback，而不是宣称在线', async () => {
    const { GET } = await import('@/app/api/health/route');
    const before = { ...process.env };
    delete process.env.APP_LLM_API_KEY;
    delete process.env.APP_ZHIHU_ACCESS_SECRET;

    try {
      const res = await GET(new Request('http://localhost/api/health'));
      const body = (await res.json()) as { readiness: Record<string, unknown> };
      expect(body.readiness).toEqual({ ai: 'fallback', zhihu: 'fallback', publicRuntimeReady: false });
    } finally {
      for (const key of ['APP_LLM_API_KEY', 'APP_ZHIHU_ACCESS_SECRET']) {
        if (before[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = before[key];
        }
      }
    }
  });
});

/**
 * 方案 §20 的「浏览器里找不到 APP_LLM_API_KEY / APP_ZHIHU_ACCESS_SECRET」。
 *
 * 光看 `NEXT_PUBLIC_*` 是不够的：只要有一个 `'use client'` 模块 import 了
 * `serverEnv`，密钥就会被 Webpack 打进客户端 bundle —— 那时页面源码里没有，
 * `Network` 里却躺着。这里直接把这条不可能性钉死。
 */
describe('服务端密钥模块不许进客户端组件（方案 §20）', () => {
  const FORBIDDEN = ['config/serverEnv', 'APP_LLM_API_KEY', 'APP_ZHIHU_ACCESS_SECRET', 'APP_MAX_'];

  it("没有任何 'use client' 文件引用 serverEnv 或 APP_* 密钥", () => {
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) {
          continue;
        }
        const text = readFileSync(full, 'utf8');
        if (!/^\s*['"]use client['"]/m.test(text)) {
          continue;
        }
        const hit = FORBIDDEN.find((needle) => text.includes(needle));
        if (hit) {
          offenders.push(`${full.replace(/\\/g, '/').replace(`${process.cwd().replace(/\\/g, '/')}/`, '')} → ${hit}`);
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
