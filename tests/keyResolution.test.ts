import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSettings } from '@/core/settingsStore';

/**
 * 密钥解析的契约（**2026-09-13 修订**）：**只读这个身份自己配置的 key**。
 *
 * 旧契约是「账号配置 > 环境变量 > 无」。那个 env 兜底在公开部署下
 * 有一个不可接受的后果：部署者把 key 放进 env 后，**任何访问者都能白用**。
 *
 * 新契约守两件事：
 * 1. 配置页填的 key 必须真的被用上（旧的退化问题）；
 * 2. **env 里的 key 永远不被使用** —— 这一条现在有专门的断言。
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('@/core/oauth/zhihu', () => ({
  sessionUrlToken: () => session.token,
}));

const { resolveModelConfigForRequest, resolveZhihuConfigForRequest, secretOriginFor } = await import(
  '@/features/run/keyResolution'
);

let dir: string;
const savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = ['DM_API_KEY', 'OPENAI_API_KEY', 'DM_BASE_URL', 'DM_MODEL', 'ZHIHU_ACCESS_SECRET'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zhihu-keyres-'));
  process.env.SETTINGS_DIR = dir;
  session.token = 'token-alice';
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SETTINGS_DIR;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

const req = () => new Request('http://localhost/api/test');

describe('模型配置', () => {
  it('都没配 → null（判卷会走本地规则）', () => {
    expect(resolveModelConfigForRequest(req())).toBeNull();
  });

  it('**只有环境变量时必须返回 null**（部署者的 key 永不被访客白用）', () => {
    process.env.DM_API_KEY = 'placeholder-env-key';
    process.env.DM_MODEL = 'env-model';

    expect(resolveModelConfigForRequest(req())).toBeNull();
    expect(resolveZhihuConfigForRequest(req())).toBeNull();
  });

  it('**账号配置生效，且与 env 无关**', () => {
    process.env.DM_API_KEY = 'placeholder-env-key';
    process.env.DM_MODEL = 'env-model';
    process.env.DM_BASE_URL = 'https://env.example.com/v1';

    writeSettings('token-alice', {
      modelApiKey: 'placeholder-account-key',
      modelBaseUrl: 'https://api.deepseek.com/v1',
      modelModel: 'deepseek-chat',
    });

    const config = resolveModelConfigForRequest(req());
    expect(config?.apiKey).toBe('placeholder-account-key');
    expect(config?.model).toBe('deepseek-chat');
    expect(config?.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('账号只配了 key → 端点/模型走默认 DeepSeek', () => {
    writeSettings('token-alice', { modelApiKey: 'placeholder-account-key' });

    const config = resolveModelConfigForRequest(req());
    expect(config?.apiKey).toBe('placeholder-account-key');
    expect(config?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(config?.model).toBe('deepseek-chat');
    expect(config?.jsonMode).toBe(true);
  });

  it('jsonMode 可被账号关掉（自建端点不支持结构化输出时）', () => {
    writeSettings('token-alice', { modelApiKey: 'placeholder-account-key', modelJsonMode: false });
    expect(resolveModelConfigForRequest(req())?.jsonMode).toBe(false);
  });

  it('未登录时读不到**别人的**账号配置（匿名身份隔离）', () => {
    session.token = null;
    writeSettings('token-alice', { modelApiKey: 'placeholder-account-key' });

    // 访客没有自己的配置 → null（不会读到 alice 的，也不会读 env）
    expect(resolveModelConfigForRequest(req())).toBeNull();
  });

  it('别的账号的配置不会被读到', () => {
    writeSettings('token-bob', { modelApiKey: 'placeholder-bob-key' });
    expect(resolveModelConfigForRequest(req())).toBeNull();
  });
});

describe('知乎配置', () => {
  it('都没配 → null', () => {
    expect(resolveZhihuConfigForRequest(req())).toBeNull();
  });

  it('**只有环境变量时必须返回 null**（部署者的 secret 永不被访客白用）', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'placeholder-env-zhihu-secret';
    expect(resolveZhihuConfigForRequest(req())).toBeNull();
  });

  it('账号配置生效，且端点默认官方域名', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'placeholder-env-zhihu-secret';
    writeSettings('token-alice', { zhihuAccessSecret: 'placeholder-account-zhihu-secret' });

    const config = resolveZhihuConfigForRequest(req());
    expect(config?.accessSecret).toBe('placeholder-account-zhihu-secret');
    expect(config?.baseUrl).toBe('https://developer.zhihu.com');
    expect(config?.timeoutMs).toBeGreaterThan(0);
  });
});

describe('来源标记（v3 之后只有两态）', () => {
  it('未配置 → none；自己配了 → account；**env 不再产生任何状态**', () => {
    expect(secretOriginFor(req())).toEqual({ model: 'none', zhihu: 'none' });

    // env 里有 key 也不改变来源标记 —— 因为它根本不被使用
    process.env.DM_API_KEY = 'placeholder-env-key';
    process.env.ZHIHU_ACCESS_SECRET = 'placeholder-env-zhihu-secret';
    expect(secretOriginFor(req())).toEqual({ model: 'none', zhihu: 'none' });

    writeSettings('token-alice', {
      modelApiKey: 'placeholder-account-key',
      zhihuAccessSecret: 'placeholder-account-zhihu-secret',
    });
    expect(secretOriginFor(req())).toEqual({ model: 'account', zhihu: 'account' });
  });
});
