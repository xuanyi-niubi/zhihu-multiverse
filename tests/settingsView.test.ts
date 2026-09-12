import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME, secretStatusText } from '@/features/run/settingsView';

/**
 * 密钥状态文案：三态必须分清。
 *
 * 最危险的一种误读是「我在这里填了 key，所以系统用的是我的 key」——
 * 实际上可能账号没配、跑的是服务器环境变量。文案必须把这件事说出来。
 */

describe('secretStatusText', () => {
  it('已配置：给出长度与指纹，便于核对是不是同一把 key', () => {
    const text = secretStatusText({ configured: true, length: 56, digest: 'a1b2c3d4' }, false);

    expect(text).toContain('已配置');
    expect(text).toContain('56');
    expect(text).toContain('a1b2c3d4');
  });

  it('账号未配但环境变量兜底：必须说清"只读"，不能让人以为能在这里改', () => {
    const text = secretStatusText({ configured: false, length: 0, digest: null }, true);

    expect(text).toContain('环境变量');
    expect(text).toContain('只读');
  });

  it('都没有：未配置', () => {
    expect(secretStatusText({ configured: false, length: 0, digest: null }, false)).toBe('未配置');
  });

  it('指纹缺失时不显示 undefined', () => {
    const text = secretStatusText({ configured: true, length: 40, digest: null }, false);
    expect(text).not.toContain('undefined');
    expect(text).toContain('未知');
  });

  it('默认端点是 DeepSeek，且是 https', () => {
    expect(DEFAULT_MODEL_NAME).toBe('deepseek-chat');
    expect(DEFAULT_MODEL_BASE_URL.startsWith('https://')).toBe(true);
    expect(DEFAULT_MODEL_BASE_URL).toContain('deepseek');
  });
});
