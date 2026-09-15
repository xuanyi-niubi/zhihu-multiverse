import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { detectAvatarContentType } from '@/core/oauth/avatar';

describe('知乎头像代理', () => {
  it('CDN 错报 octet-stream 时按图片魔数识别 JPEG / PNG / WebP', () => {
    expect(detectAvatarContentType('application/octet-stream', new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(detectAvatarContentType('', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectAvatarContentType('binary/octet-stream', new TextEncoder().encode('RIFF0000WEBP'))).toBe('image/webp');
  });

  it('非图片内容仍拒绝，不能把任意响应伪装成头像', () => {
    expect(detectAvatarContentType('text/html', new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('头像组件先走同源代理，失败后直连 CDN，再失败显示昵称首字', () => {
    const source = readFileSync(
      new URL('../src/components/session/ObserverAvatar.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("useState(avatarUrl ? '/api/oauth/avatar' : null)");
    expect(source).toContain('setSource(avatarUrl)');
    expect(source).toContain("name.trim().charAt(0) || '知'");
  });
});
