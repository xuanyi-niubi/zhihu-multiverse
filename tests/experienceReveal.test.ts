import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const reveal = () =>
  readFileSync(new URL('../src/components/visual/ExperienceReveal.tsx', import.meta.url), 'utf8');

describe('真实人生显影', () => {
  it('按相似、另一种走法、反例的真实顺序阅读，不随机补造标题', () => {
    const source = reveal();
    expect(source).toContain("track: 'similar'");
    expect(source).toContain("track: 'alternative'");
    expect(source).toContain("track: 'counter'");
    expect(source.indexOf("track: 'similar'")).toBeLessThan(source.indexOf("track: 'alternative'"));
    expect(source.indexOf("track: 'alternative'")).toBeLessThan(source.indexOf("track: 'counter'"));
    expect(source).not.toContain('Math.random');
    expect(source).toContain('representative.quote');
  });

  it('每段经历都能看完整原文；世界只能由用户点击进入', () => {
    const source = reveal();
    expect(source).toContain('看完整原文');
    expect(source).toContain('onInspect(representative.id)');
    expect(source).toContain('先看看这几个人');
    expect(source).toContain('穿越我的平行宇宙');
    expect(source).toContain('onClick={onEnterWorld}');
    expect(source).not.toContain('router.push');
    expect(source).not.toContain('window.location');
  });

  it('找不到某条轨道时如实保留空缺，且支持暂停与减少动画', () => {
    const source = reveal();
    expect(source).toContain('这一类暂时没找到可靠经历');
    expect(source).toContain('我们不会为了让故事完整，编一个人出来');
    expect(source).toContain('暂停');
    expect(source).toContain('prefers-reduced-motion: reduce');
  });
});
