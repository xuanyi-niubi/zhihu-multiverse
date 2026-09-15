import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CELESTIAL_SCENES,
  DESKTOP_STARS,
  MOBILE_STARS,
  celestialTrackState,
} from '@/features/visual/celestial';

const component = () => readFileSync(
  new URL('../src/components/visual/CelestialBackdrop.tsx', import.meta.url),
  'utf8',
);

describe('叙事星系背景', () => {
  it('四个场景和固定星位逐次渲染都一致', () => {
    expect(CELESTIAL_SCENES).toEqual(['observatory', 'retrieving', 'simulation', 'returning']);
    expect(MOBILE_STARS).toHaveLength(36);
    expect(DESKTOP_STARS).toHaveLength(72);
    expect(new Set(MOBILE_STARS.map((star) => `${star.x}:${star.y}`)).size).toBe(36);
    expect(new Set(DESKTOP_STARS.map((star) => `${star.x}:${star.y}`)).size).toBe(72);
  });

  it('检索轨道只反映真实 pending / hit / empty 状态', () => {
    expect(celestialTrackState(null)).toBe('pending');
    expect(celestialTrackState(2)).toBe('hit');
    expect(celestialTrackState(0)).toBe('empty');
  });

  it('只用一个无障碍隐藏 SVG，不启动 JS 动画或外链资源', () => {
    const source = component();
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('<svg');
    expect(source).toContain('sil-celestial');
    for (const forbidden of ['requestAnimationFrame', 'setInterval', 'mousemove', 'http://', 'https://']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
