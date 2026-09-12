'use client';

import * as React from 'react';

import { KanshanSprite, SPRITE_CHARACTERS } from '@/components/characters/KanshanSprite';

import type { Character, Expression } from '@/types/narrative';

/**
 * 角色立绘。
 *
 * 现在全部角色都走官方同源的 3D 黏土 GIF（见 `KanshanSprite`），
 * 这里只负责「说话者高亮 / 非说话者压暗」和呼吸动效的包装。
 *
 * 保留一个 SVG 兜底分支：若将来新增了没有素材的角色，至少不会白屏。
 */

export interface PortraitProps {
  readonly character: Character;
  readonly expression?: Expression;
  /** 说话中：取消降饱和、上浮并呼吸。 */
  readonly speaking?: boolean;
  readonly className?: string;
}

export function Portrait({ character, expression, speaking = false, className }: PortraitProps) {
  const resolvedExpression = expression ?? character.defaultExpression;

  const wrapperClass = [
    'gmv-portrait flex h-full w-full items-end justify-center',
    speaking ? 'gmv-portrait--speaking' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (SPRITE_CHARACTERS.has(character.id)) {
    return (
      <span className={wrapperClass}>
        <KanshanSprite
          characterId={character.id}
          expression={resolvedExpression}
          alt={character.name}
          className="h-full w-auto"
        />
      </span>
    );
  }

  // 没有素材的角色：用一个带角色配色的圆角占位，避免白屏
  return (
    <span className={wrapperClass}>
      <span
        aria-label={character.name}
        role="img"
        className="flex h-2/3 w-2/3 items-center justify-center rounded-3xl border border-white/15 text-4xl font-black"
        style={{ color: character.palette.accent, background: `${character.palette.cloth}33` }}
      >
        {character.name.slice(0, 1)}
      </span>
    </span>
  );
}

export default Portrait;
