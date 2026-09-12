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
    expect(spriteSrc('kanshan', 'idle')).toBe('/kanshan/idle.gif');
    expect(spriteSrc('kanshan', 'wave')).toBe('/kanshan/wave.gif');
    expect(spriteSrc('kanshan', 'computer')).toBe('/kanshan/computer.gif');
    expect(spriteSrc('kanshan', 'dribble')).toBe('/kanshan/dribble.gif');
  });

  it('配角用角色前缀素材', () => {
    expect(spriteSrc('roommate', 'idle')).toBe('/kanshan/roommate_idle.gif');
    expect(spriteSrc('roommate', 'sway')).toBe('/kanshan/roommate_sway.gif');
    expect(spriteSrc('interviewer', 'wave')).toBe('/kanshan/interviewer_wave.gif');
    expect(spriteSrc('parent', 'doze')).toBe('/kanshan/parent_doze.gif');
    expect(spriteSrc('ghost', 'idle')).toBe('/kanshan/ghost_idle.gif');
    expect(spriteSrc('mentor', 'wave')).toBe('/kanshan/mentor_wave.gif');
    expect(spriteSrc('player', 'sway')).toBe('/kanshan/player_sway.gif');
  });

  it('配角包没有的动作回落到 idle，不会拼出不存在的路径', () => {
    // 配角包只有 idle/wave/sway/doze；computer 与 dribble 是刘看山专属
    expect(spriteSrc('roommate', 'computer')).toBe('/kanshan/roommate_idle.gif');
    expect(spriteSrc('ghost', 'dribble')).toBe('/kanshan/ghost_idle.gif');
  });

  it('未知角色回落到刘看山 idle，避免白屏', () => {
    expect(spriteSrc('does-not-exist', 'wave')).toBe('/kanshan/idle.gif');
    expect(spriteSrc('', 'idle')).toBe('/kanshan/idle.gif');
  });

  it('所有角色 × 所有动作组合都能拼出合法路径', () => {
    const actions = ['idle', 'wave', 'sway', 'doze', 'computer', 'dribble'] as const;

    for (const id of SPRITE_CHARACTERS) {
      for (const action of actions) {
        const src = spriteSrc(id, action);
        expect(src.startsWith('/kanshan/')).toBe(true);
        expect(src.endsWith('.gif')).toBe(true);
        expect(src).not.toContain('undefined');
      }
    }
  });
});
