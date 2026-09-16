import { describe, expect, it } from 'vitest';

import { isWechatUserAgent } from '@/features/run/wechat';

/**
 * 微信 UA 识别。
 *
 * 这组断言守的是**不被误伤**：只有真的在微信里才提示
 * 「点右上角 → 在浏览器打开」，普通浏览器一个字都不该看到。
 */
describe('微信内置浏览器识别', () => {
  it('微信内置浏览器（MicroMessenger）为真', () => {
    expect(
      isWechatUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003132) NetType/WIFI Language/zh_CN',
      ),
    ).toBe(true);
  });

  it('微信工作台 UA（WeChat）也为真', () => {
    expect(isWechatUserAgent('Mozilla/5.0 (Windows NT 10.0; WOW64) WeChat/8.0.30')).toBe(true);
  });

  it('普通浏览器为假（零打扰）', () => {
    const others = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'curl/8.4.0',
      '',
    ];
    for (const ua of others) {
      expect(isWechatUserAgent(ua)).toBe(false);
    }
  });
});
