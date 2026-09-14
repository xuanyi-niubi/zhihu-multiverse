import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SPRITE_CHARACTERS,
  actionForExpression,
  spriteSrc,
} from '@/components/characters/KanshanSprite';

/**
 * 角色立绘素材映射测试。
 *
 * 浏览器 MCP 在本机不可用，所以用单测锁住「角色 × 动作 → 素材路径」这层逻辑：
 * 路径拼错、动作不被支持、角色没有素材，都会在这里暴露。
 */

describe('SPRITE_CHARACTERS', () => {
  it('覆盖全部 7 个角色', () => {
    for (const id of ['kanshan', 'player', 'roommate', 'parent', 'interviewer', 'mentor', 'ghost']) {
      expect(SPRITE_CHARACTERS.has(id)).toBe(true);
    }
  });
});

describe('actionForExpression', () => {
  it('情绪映射到对应动作', () => {
    expect(actionForExpression('calm')).toBe('idle');
    expect(actionForExpression('soft')).toBe('idle');
    expect(actionForExpression('cold')).toBe('idle');
    expect(actionForExpression('hope')).toBe('wave');
    expect(actionForExpression('tense')).toBe('sway');
    expect(actionForExpression('panic')).toBe('sway');
    expect(actionForExpression('broken')).toBe('doze');
  });
});

describe('spriteSrc', () => {
  it('刘看山用官方素材（无角色前缀）', () => {
    expect(spriteSrc('kanshan', 'idle')).toBe('/kanshan/webp/idle.webp');
    expect(spriteSrc('kanshan', 'wave')).toBe('/kanshan/webp/wave.webp');
    expect(spriteSrc('kanshan', 'computer')).toBe('/kanshan/webp/computer.webp');
    expect(spriteSrc('kanshan', 'dribble')).toBe('/kanshan/webp/dribble.webp');
  });

  it('配角用角色前缀素材', () => {
    expect(spriteSrc('roommate', 'idle')).toBe('/kanshan/webp/roommate_idle.webp');
    expect(spriteSrc('roommate', 'sway')).toBe('/kanshan/webp/roommate_sway.webp');
    expect(spriteSrc('interviewer', 'wave')).toBe('/kanshan/webp/interviewer_wave.webp');
    expect(spriteSrc('parent', 'doze')).toBe('/kanshan/webp/parent_doze.webp');
    expect(spriteSrc('ghost', 'idle')).toBe('/kanshan/webp/ghost_idle.webp');
    expect(spriteSrc('mentor', 'wave')).toBe('/kanshan/webp/mentor_wave.webp');
    expect(spriteSrc('player', 'sway')).toBe('/kanshan/webp/player_sway.webp');
  });

  it('配角包没有的动作回落到 idle，不会拼出不存在的路径', () => {
    // 配角包只有 idle/wave/sway/doze；computer 与 dribble 是刘看山专属
    expect(spriteSrc('roommate', 'computer')).toBe('/kanshan/webp/roommate_idle.webp');
    expect(spriteSrc('ghost', 'dribble')).toBe('/kanshan/webp/ghost_idle.webp');
  });

  it('未知角色回落到刘看山 idle，避免白屏', () => {
    expect(spriteSrc('does-not-exist', 'wave')).toBe('/kanshan/webp/idle.webp');
    expect(spriteSrc('', 'idle')).toBe('/kanshan/webp/idle.webp');
  });

  it('所有角色 × 所有动作组合都能拼出合法路径', () => {
    const actions = ['idle', 'wave', 'sway', 'doze', 'computer', 'dribble'] as const;

    for (const id of SPRITE_CHARACTERS) {
      for (const action of actions) {
        const src = spriteSrc(id, action);
        expect(src.startsWith('/kanshan/webp/')).toBe(true);
        expect(src.endsWith('.webp')).toBe(true);
        expect(src).not.toContain('undefined');
      }
    }
  });

  // 路径正确不代表资源一定存在；直接检查磁盘可防止角色素材缺失。
  it('每条路径都对应一个真实存在的素材文件', () => {
    const actions = ['idle', 'wave', 'sway', 'doze', 'computer', 'dribble'] as const;
    const missing: string[] = [];

    for (const id of SPRITE_CHARACTERS) {
      for (const action of actions) {
        const src = spriteSrc(id, action);
        const file = join(process.cwd(), 'public', src.replace(/^\//, ''));
        if (!existsSync(file)) missing.push(src);
      }
    }

    expect(missing).toEqual([]);
  });

  it('核心动画素材使用可直接加载的 WebP 文件', () => {
    expect(existsSync(join(process.cwd(), 'public', 'kanshan', 'webp', 'idle.webp'))).toBe(
      true,
    );
  });
});
