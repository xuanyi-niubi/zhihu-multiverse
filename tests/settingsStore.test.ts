import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearSettings,
  maskSecret,
  readSettings,
  settingsFileFor,
  toPublicSettings,
  validateBaseUrl,
  validateSecret,
  writeSettings,
} from '@/core/settingsStore';

/**
 * 密钥存储的红线（每条都对应一句产品承诺）：
 * - 「接口永不返回明文」→ `toPublicSettings` 的输出里搜不到任何明文片段；
 * - 「删除是真删」→ 删完文件里没有该字段，甚至整份文件都没了；
 * - 「按账号隔离」→ 两个 token 互不可见；
 * - 「非法值整条拒绝」→ 不会出现"存了一半"的状态。
 */

const SECRET = 'placeholder-zhihu-secret-not-real';
const MODEL_KEY = 'placeholder-model-key-not-a-real-secret';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zhihu-settings-'));
  process.env.SETTINGS_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SETTINGS_DIR;
});

const noEnv = { zhihu: false, model: false };

describe('写入与读取', () => {
  it('保存后能读回，且带 updatedAt', () => {
    const result = writeSettings('token-a', { zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY });

    expect(result.persisted).toBe(true);
    expect(result.reason).toBe('ok');

    const stored = readSettings('token-a');
    expect(stored?.zhihuAccessSecret).toBe(SECRET);
    expect(stored?.modelApiKey).toBe(MODEL_KEY);
    expect(stored?.updatedAt.length).toBeGreaterThan(0);
  });

  it('是合并式 patch：只传一个字段不会清掉其他字段', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });
    writeSettings('token-a', { modelBaseUrl: 'https://api.example.com/v1' });

    const stored = readSettings('token-a');
    expect(stored?.zhihuAccessSecret).toBe(SECRET);
    expect(stored?.modelBaseUrl).toBe('https://api.example.com/v1');
  });

  it('文件权限 0600（非 Windows 才可断言）', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });

    if (process.platform === 'win32') {
      // Windows 不支持 POSIX 权限位，跳过（不假装通过）
      expect(true).toBe(true);
      return;
    }
    const mode = statSync(settingsFileFor('token-a')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('未配置的账号读出 null', () => {
    expect(readSettings('nobody')).toBeNull();
  });

  it('文件损坏时当没配，不抛异常', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });
    const file = settingsFileFor('token-a');
    writeFileSync(file, '{ not json');

    expect(readSettings('token-a')).toBeNull();
  });
});

describe('账号隔离', () => {
  it('两个 token 的配置互不可见', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });
    writeSettings('token-b', { zhihuAccessSecret: 'placeholder-another-secret' });

    expect(readSettings('token-a')?.zhihuAccessSecret).toBe(SECRET);
    expect(readSettings('token-b')?.zhihuAccessSecret).toBe('placeholder-another-secret');
    expect(settingsFileFor('token-a')).not.toBe(settingsFileFor('token-b'));
  });

  it('文件名只用哈希，不包含原 token（防路径穿越）', () => {
    const file = settingsFileFor('../../etc/passwd');
    expect(file.includes('..')).toBe(false);
    expect(file.includes('etc')).toBe(false);
  });
});

describe('校验：非法值整条拒绝，不写一半', () => {
  it('密钥过短 / 含换行 / 含引号 → invalid-secret', () => {
    for (const bad of ['short', 'a'.repeat(257), 'has\nnewline', 'has"quote', "has'quote", 'has\\slash']) {
      const result = writeSettings('token-a', { zhihuAccessSecret: bad });
      expect(result.persisted).toBe(false);
      expect(result.reason).toBe('invalid-secret');
    }
    expect(readSettings('token-a')).toBeNull();
  });

  it('端点只接受 https（放行本机 http 调试）', () => {
    expect(validateBaseUrl('https://api.deepseek.com/v1')).toBe(true);
    expect(validateBaseUrl('http://127.0.0.1:8080/v1')).toBe(true);
    expect(validateBaseUrl('http://evil.example.com/v1')).toBe(false);
    expect(validateBaseUrl('not a url')).toBe(false);
    expect(validateBaseUrl('')).toBe(false);
  });

  it('模型名必须非空且不超长', () => {
    expect(writeSettings('token-a', { modelModel: '  ' }).reason).toBe('invalid-model');
    expect(writeSettings('token-a', { modelModel: 'x'.repeat(65) }).reason).toBe('invalid-model');
    expect(writeSettings('token-a', { modelModel: 'deepseek-chat' }).persisted).toBe(true);
  });

  it('jsonMode 只接受布尔值', () => {
    // 类型层面已挡住，这里验证字符串会被判非法
    const result = writeSettings('token-a', { modelJsonMode: 'yes' as unknown as boolean });
    expect(result.reason).toBe('invalid-field');
  });

  it('validateSecret 边界：8 与 256 通过', () => {
    expect(validateSecret('a'.repeat(8))).toBe(true);
    expect(validateSecret('a'.repeat(256))).toBe(true);
    expect(validateSecret('a'.repeat(7))).toBe(false);
  });
});

describe('删除：真删，不留隐藏副本', () => {
  it('删单个字段后文件里没有该字段，其他字段保留', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY });
    const result = clearSettings('token-a', 'zhihuAccessSecret');

    expect(result.persisted).toBe(true);
    const stored = readSettings('token-a');
    expect(stored?.zhihuAccessSecret).toBeUndefined();
    expect(stored?.modelApiKey).toBe(MODEL_KEY);

    const raw = readFileSync(settingsFileFor('token-a'), 'utf8');
    expect(raw.includes(SECRET)).toBe(false);
  });

  it('删掉最后一项后整份文件被移除（不留空壳）', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });
    clearSettings('token-a', 'zhihuAccessSecret');

    expect(existsSync(settingsFileFor('token-a'))).toBe(false);
    expect(readSettings('token-a')).toBeNull();
  });

  it('all 直接删文件', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY });
    clearSettings('token-a', 'all');

    expect(existsSync(settingsFileFor('token-a'))).toBe(false);
  });

  it('删不存在的配置也返回成功（幂等）', () => {
    expect(clearSettings('nobody', 'all').persisted).toBe(true);
    expect(clearSettings('nobody', 'modelApiKey').persisted).toBe(true);
  });

  it('替换密钥＝整把覆盖，旧值搜不到', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET });
    writeSettings('token-a', { zhihuAccessSecret: 'placeholder-brand-new-secret' });

    const raw = readFileSync(settingsFileFor('token-a'), 'utf8');
    expect(raw.includes(SECRET)).toBe(false);
    expect(raw.includes('placeholder-brand-new-secret')).toBe(true);
  });
});

describe('对外视图：不含明文', () => {
  it('toPublicSettings 的序列化结果里搜不到密钥片段', () => {
    writeSettings('token-a', { zhihuAccessSecret: SECRET, modelApiKey: MODEL_KEY });
    const publicView = toPublicSettings(readSettings('token-a'), { authenticated: true, envFallback: noEnv });
    const serialized = JSON.stringify(publicView);

    expect(serialized.includes(SECRET)).toBe(false);
    expect(serialized.includes(MODEL_KEY)).toBe(false);
    expect(serialized.includes(SECRET.slice(0, 8))).toBe(false);

    expect(publicView.zhihuAccessSecret.configured).toBe(true);
    expect(publicView.zhihuAccessSecret.length).toBe(SECRET.length);
    expect(publicView.zhihuAccessSecret.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('未配置时 configured=false 且长度 0', () => {
    const publicView = toPublicSettings(null, { authenticated: true, envFallback: noEnv });
    expect(publicView.zhihuAccessSecret).toEqual({ configured: false, length: 0, digest: null });
    expect(publicView.model.jsonMode).toBe(true);
    expect(publicView.updatedAt).toBeNull();
  });

  it('maskSecret 对空值/undefined 安全', () => {
    expect(maskSecret('').configured).toBe(false);
    expect(maskSecret(undefined).configured).toBe(false);
    expect(maskSecret(null).digest).toBeNull();
  });

  it('同一把 key 指纹稳定，不同 key 指纹不同（用于人工核对是否换过）', () => {
    expect(maskSecret(SECRET).digest).toBe(maskSecret(SECRET).digest);
    expect(maskSecret(SECRET).digest).not.toBe(maskSecret(`${SECRET}x`).digest);
  });
});
