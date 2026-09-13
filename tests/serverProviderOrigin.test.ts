import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appLlmFromEnv,
  appModelConfigFromEnv,
  appProviderStatus,
  appZhihuConfigFromEnv,
  appZhihuSecretFromEnv,
} from '@/config/serverEnv';
import { secretOriginFor } from '@/features/run/keyResolution';

/**
 * App-owned provider（产品化方案 §5 / §6 / §43）。
 *
 * 这一层的存在理由是「普通用户打开即用」：不该先理解 API、先充值、先创建
 * Key 才能玩一句。测试把三级来源 `account > app > none` 逐档钉住。
 */

const APP_ENV = {
  APP_LLM_API_KEY: 'app-key-1234567890',
  APP_LLM_BASE_URL: 'https://api.example.com/v1',
  APP_LLM_FAST_MODEL: 'fast-model',
  APP_LLM_DEEP_MODEL: 'deep-model',
  APP_ZHIHU_ACCESS_SECRET: 'app-zhihu-secret',
} as const;

describe('serverEnv：只认 App 前缀，绝不猜默认值', () => {
  it('配了 APP_LLM_API_KEY → 得到配置', () => {
    const cfg = appLlmFromEnv(APP_ENV);
    expect(cfg?.apiKey).toBe('app-key-1234567890');
    expect(cfg?.baseUrl).toBe('https://api.example.com/v1');
    expect(cfg?.fastModel).toBe('fast-model');
    expect(cfg?.deepModel).toBe('deep-model');
  });

  it('没配 → null（不编造一份配置）', () => {
    expect(appLlmFromEnv({})).toBeNull();
    expect(appModelConfigFromEnv({})).toBeNull();
    expect(appZhihuConfigFromEnv({})).toBeNull();
  });

  it('空字符串 / 纯空格视为没配', () => {
    expect(appLlmFromEnv({ APP_LLM_API_KEY: '   ' })).toBeNull();
    expect(appZhihuSecretFromEnv({ APP_ZHIHU_ACCESS_SECRET: '' })).toBeNull();
  });

  it('只配 baseUrl 不配 key → 仍然是 null（key 是前提）', () => {
    expect(appLlmFromEnv({ APP_LLM_BASE_URL: 'https://x/v1' })).toBeNull();
  });

  it('模型名缺省时 deep 优先、fast 兜底，baseUrl 有默认端点', () => {
    const cfg = appModelConfigFromEnv({ APP_LLM_API_KEY: 'k' });
    expect(cfg?.model).toBe('deepseek-chat');
    expect(cfg?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(cfg?.jsonMode).toBe(true);

    const fastOnly = appModelConfigFromEnv({ APP_LLM_API_KEY: 'k', APP_LLM_FAST_MODEL: 'f' });
    expect(fastOnly?.model).toBe('f');

    const both = appModelConfigFromEnv({ APP_LLM_API_KEY: 'k', APP_LLM_FAST_MODEL: 'f', APP_LLM_DEEP_MODEL: 'd' });
    expect(both?.model).toBe('d');
  });

  it('状态只报布尔，不泄露任何值', () => {
    const status = appProviderStatus(APP_ENV);
    expect(status).toEqual({ model: true, zhihu: true });
    expect(JSON.stringify(status)).not.toContain('app-key');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('**不在浏览器里工作**：被客户端调用直接抛错而不是静默泄露', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {};
    try {
      expect(() => appLlmFromEnv(APP_ENV)).toThrow(/服务端/);
      expect(() => appZhihuSecretFromEnv(APP_ENV)).toThrow(/服务端/);
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });
});

/**
 * 三级来源：`account > app > none`。
 *
 * 用假的 Request + 注入 env 就能覆盖三档，不需要真的起服务。
 */
describe('secretOriginFor：account > app > none', () => {
  function request(cookie?: string): Request {
    return new Request('http://localhost/api/health', {
      headers: cookie ? { cookie } : {},
    });
  }

  it('两处都没配 → none', () => {
    expect(secretOriginFor(request(), {})).toEqual({ model: 'none', zhihu: 'none' });
  });

  it('只有 App 配了 → app（普通用户打开即用的那一档）', () => {
    expect(secretOriginFor(request(), APP_ENV)).toEqual({ model: 'app', zhihu: 'app' });
  });

  it('用户自己配了 → account（优先，花他自己的钱）', async () => {
    const { writeSettings } = await import('@/core/settingsStore');
    const { readOwnSettings } = await import('@/features/run/identity');

    /**
     * 匿名身份是**首次访问时下发 cookie** 的，所以要先拿一次身份、
     * 再把它的 cookie 带回来 —— 否则两次调用是两个不同的人。
     */
    const first = readOwnSettings(request());
    const cookie = first.identity.setCookie?.split(';')[0] ?? '';
    expect(cookie.length).toBeGreaterThan(0);

    const req = request(cookie);
    const { identity } = readOwnSettings(req);
    expect(identity.key).toBe(first.identity.key);

    writeSettings(identity.key, { modelApiKey: 'user-own-key' });
    try {
      const origin = secretOriginFor(req, APP_ENV);
      expect(origin.model).toBe('account');
      // 知乎没配自己的 → 仍然用 App 的
      expect(origin.zhihu).toBe('app');
    } finally {
      writeSettings(identity.key, { modelApiKey: '' });
    }
  });
});

/**
 * 统一层纪律：路由**不允许**自己读账号配置。
 *
 * 旧注释里写过「改这一处即等于八处同时修好 —— 不会出现某个路由忘了改、
 * 结果还在用共享 key 的漏网」。这条测试就是那个保证本身：只要有人把
 * `zhihuConfigForIdentity` / `modelConfigForIdentity` 直接写进路由文件，
 * 它就会红。
 */
describe('路由必须走统一层取凭证', () => {
  const ROUTES = [
    'src/app/api/dm/route.ts',
    'src/app/api/mesh/route.ts',
    'src/app/api/health/route.ts',
    'src/app/api/sessions/route.ts',
    'src/app/api/sessions/[id]/route.ts',
    'src/app/api/profile/route.ts',
    'src/app/api/report/route.ts',
    'src/app/api/boss/evaluate/route.ts',
    'src/app/api/zhihu/hot/route.ts',
  ] as const;

  it('没有任何路由直接调用 identity 的配置函数', () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      const full = join(process.cwd(), route);
      if (!existsSync(full)) {
        continue;
      }
      const source = readFileSync(full, 'utf8');
      if (source.includes('zhihuConfigForIdentity') || source.includes('modelConfigForIdentity')) {
        offenders.push(route);
      }
    }
    expect(offenders).toEqual([]);
  });
});
