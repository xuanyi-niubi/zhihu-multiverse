'use client';

import * as React from 'react';

import type { Expression } from '@/types/narrative';

/**
 * 角色动态立绘（动画 WebP）。
 *
 * 素材来源：知乎官方刘看山动态包与同源画风配角素材。
 * 页面只加载压缩后的 WebP 资源；赛事结束后的商业使用需另行确认授权。
 */

export type KanshanAction = 'idle' | 'wave' | 'sway' | 'doze' | 'computer' | 'dribble';

/** 刘看山本人有 6 个动作；配角包只有 4 个。 */
const ACTIONS_BY_CHARACTER: Record<string, readonly KanshanAction[]> = {
  kanshan: ['idle', 'wave', 'sway', 'doze', 'computer', 'dribble'],
  player: ['idle', 'wave', 'sway', 'doze'],
  roommate: ['idle', 'wave', 'sway', 'doze'],
  parent: ['idle', 'wave', 'sway', 'doze'],
  interviewer: ['idle', 'wave', 'sway', 'doze'],
  mentor: ['idle', 'wave', 'sway', 'doze'],
  ghost: ['idle', 'wave', 'sway', 'doze'],
};

/** 有动态素材的角色 id。 */
export const SPRITE_CHARACTERS: ReadonlySet<string> = new Set(Object.keys(ACTIONS_BY_CHARACTER));

/** 表情 → 动作映射：让情绪和动效对上。 */
const ACTION_BY_EXPRESSION: Record<Expression, KanshanAction> = {
  calm: 'idle',
  soft: 'idle',
  cold: 'idle',
  hope: 'wave',
  tense: 'sway',
  panic: 'sway',
  broken: 'doze',
};

export function actionForExpression(expression: Expression): KanshanAction {
  return ACTION_BY_EXPRESSION[expression] ?? 'idle';
}

/**
 * 立绘素材版本号。**每次重绘角色后 +1。**
 *
 * 为什么需要它：素材文件名不随内容变化（`interviewer_idle.webp` 永远是这个名字），
 * 而浏览器可能已经拿着旧图的长缓存（历史上 443 入口下发过
 * `max-age=2592000, immutable`，`immutable` 连刷新都不重新校验）。
 * 在 URL 上带一个 query 就能让地址变化，彻底绕开旧缓存。
 *
 * 只加在 `<img>` 的 src 上，`spriteSrc()` 仍返回干净路径，
 * 因此 `tests/sprite.test.ts` 对路径的断言不受影响。
 */
export const SPRITE_VERSION = '2';

/** 页面实际加载的动画 WebP 素材目录。 */
const SPRITE_DIR = '/kanshan/webp';
const SPRITE_EXT = 'webp';

/** 解析出实际可用的素材路径：不支持的动作回落到 idle。 */
export function spriteSrc(characterId: string, action: KanshanAction): string {
  const supported = ACTIONS_BY_CHARACTER[characterId];

  if (!supported) {
    return `${SPRITE_DIR}/idle.${SPRITE_EXT}`;
  }

  const resolved = supported.includes(action) ? action : 'idle';

  return characterId === 'kanshan'
    ? `${SPRITE_DIR}/${resolved}.${SPRITE_EXT}`
    : `${SPRITE_DIR}/${characterId}_${resolved}.${SPRITE_EXT}`;
}

export interface KanshanSpriteProps {
  readonly characterId?: string;
  readonly action?: KanshanAction;
  readonly expression?: Expression;
  readonly alt?: string;
  readonly className?: string;
  /**
   * 是否自带台座（接触阴影 + 相纸弧）。
   *
   * 默认 `true`。台座是「融入暗房」的关键：素材是透明背景的白色黏土立绘，
   * 没有落点时会像贴纸浮在近黑背景上。见 `silver.css` 的 `.sil-cast`
   * 一节（那里解释了四个病因与解法）。
   *
   * 只有在**父级已经画好台座**的场合才需要关掉，否则会出现两层阴影。
   */
  readonly grounded?: boolean;
  /** 虚影态：第三幕反例揭示时用，去饱和 + 降透明。 */
  readonly ghost?: boolean;
}

export function KanshanSprite({
  characterId = 'kanshan',
  action,
  expression,
  alt,
  className,
  grounded = true,
  ghost = false,
}: KanshanSpriteProps) {
  const resolved = action ?? (expression ? actionForExpression(expression) : 'idle');

  const image = (
    <img
      src={`${spriteSrc(characterId, resolved)}?v=${SPRITE_VERSION}`}
      alt={alt ?? ''}
      draggable={false}
      /*
        尺寸类（h-full / w-full / gd-guide__sprite 等）由**外层**承担，
        这里只保留「填满外层」的约束。原因是台座（.sil-cast__ground）
        是外层的兄弟节点，它的定位依赖外层盒子；若尺寸只给 img，
        外层会塌成 0 宽高，台座就画在错误的位置上。
      */
      className={[
        grounded ? 'sil-cast__sprite' : '',
        'pointer-events-none h-full w-full select-none object-contain object-bottom',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );

  if (!grounded) {
    // 不带台座时，尺寸类仍要落在 img 上
    return (
      <img
        src={`${spriteSrc(characterId, resolved)}?v=${SPRITE_VERSION}`}
        alt={alt ?? ''}
        draggable={false}
        className={['pointer-events-none select-none object-contain object-bottom', className]
          .filter(Boolean)
          .join(' ')}
      />
    );
  }

  return (
    <span
      className={['sil-cast', ghost ? 'sil-cast--ghost' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {image}
      <span aria-hidden="true" className="sil-cast__ground" />
    </span>
  );
}

export default KanshanSprite;
