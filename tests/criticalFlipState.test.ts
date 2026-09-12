import { describe, expect, it } from 'vitest';

import { WORLDLINE_TONE, worldlineStateOf } from '@/components/worldline/Worldline';

/**
 * v3 §25 点名的 `criticalFlipState.test.ts`。
 *
 * 锁死三件事：
 * 1. `breached → viable` 与 `viable → breached` 的状态映射正确；
 * 2. **`unknown` 不允许显示成绿色/成功** —— 这是最容易犯也最致命的视觉错误；
 * 3. 三态配色唯一事实源（各页不许自己判一次色）。
 */

describe('worldlineStateOf（唯一映射点）', () => {
  it('viable → stable；余量很紧 → unstable', () => {
    expect(worldlineStateOf({ kind: 'viable', margin: 8 })).toBe('stable');
    expect(worldlineStateOf({ kind: 'viable', margin: 2 })).toBe('unstable');
    expect(worldlineStateOf({ kind: 'viable', margin: 0 })).toBe('unstable');
  });

  it('breached → breached', () => {
    expect(worldlineStateOf({ kind: 'breached' })).toBe('breached');
  });

  it('unknown → unknown（绝不能落到 viable 那一档）', () => {
    expect(worldlineStateOf({ kind: 'unknown' })).toBe('unknown');
    // 即使调用方多传了 margin，unknown 也不能被当成可行
    expect(worldlineStateOf({ kind: 'unknown', margin: 99 })).toBe('unknown');
  });

  it('三态互不混淆：四种输入产出四个不同状态', () => {
    const states = new Set([
      worldlineStateOf({ kind: 'viable', margin: 8 }),
      worldlineStateOf({ kind: 'viable', margin: 1 }),
      worldlineStateOf({ kind: 'breached' }),
      worldlineStateOf({ kind: 'unknown' }),
    ]);
    expect(states.size).toBe(4);
  });
});

describe('配色纪律（v3 §17.2）', () => {
  it('每一档都有完整配色（stroke / glow / text / label）', () => {
    for (const state of ['stable', 'unstable', 'breached', 'unknown'] as const) {
      const tone = WORLDLINE_TONE[state];
      expect(tone.stroke).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(tone.glow.length).toBeGreaterThan(0);
      expect(tone.text.length).toBeGreaterThan(0);
      expect(tone.label.length).toBeGreaterThan(0);
    }
  });

  it('**unknown 的描边不是绿色**（不能把「不知道」画成「通过」）', () => {
    const stroke = WORLDLINE_TONE.unknown.stroke.toUpperCase();
    const greenish = ['#3DD6A0', '#00FF00', '#22C55E', '#10B981', '#4ADE80'];
    expect(greenish).not.toContain(stroke);

    // 直接的通道检查：绿明显高于红与蓝即为「绿色系」
    const r = parseInt(stroke.slice(1, 3), 16);
    const g = parseInt(stroke.slice(3, 5), 16);
    const b = parseInt(stroke.slice(5, 7), 16);
    expect(g).toBeLessThanOrEqual(Math.max(r, b) + 12);
  });

  it('**unknown 的描边不等于 stable**（未知与成立必须可区分）', () => {
    expect(WORLDLINE_TONE.unknown.stroke).not.toBe(WORLDLINE_TONE.stable.stroke);
  });

  it('stable 是冷白／青白系，breached 是红色系（v3 §17.2 的主色纪律）', () => {
    const stable = WORLDLINE_TONE.stable.stroke.toUpperCase();
    const breached = WORLDLINE_TONE.breached.stroke.toUpperCase();

    // stable：三通道都高（近白）
    const sr = parseInt(stable.slice(1, 3), 16);
    const sg = parseInt(stable.slice(3, 5), 16);
    const sb = parseInt(stable.slice(5, 7), 16);
    expect(Math.min(sr, sg, sb)).toBeGreaterThan(150);

    // breached：红明显高于绿（偏红）
    const br = parseInt(breached.slice(1, 3), 16);
    const bg = parseInt(breached.slice(3, 5), 16);
    expect(br).toBeGreaterThan(bg + 60);
  });

  it('四档 label 都是中文可读词，不是内部枚举名', () => {
    for (const state of ['stable', 'unstable', 'breached', 'unknown'] as const) {
      const label = WORLDLINE_TONE[state].label;
      expect(label).not.toBe(state);
      expect(/^[\u4e00-\u9fa5]+$/.test(label)).toBe(true);
    }
  });
});
