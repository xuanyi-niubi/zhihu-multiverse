'use client';

import * as React from 'react';

import type { Expression } from '@/types/narrative';

/**
 * 角色动态立绘（GIF）。
 *
 * 素材来源：知乎官方刘看山动态包（`/kanshan/{action}.gif`）+ 同源画风的
 * 配角包（`/kanshan/{id}_{action}.gif`，6 角色 × 4 动作）。
 * 全员共用「白色 3D 黏土北极狐 + 红围巾」母版，靠服装配饰区分身份，
 * 因此和官方刘看山同框不出戏。
 *
 * 按比赛规则，刘看山形象在赛事期间可用，赛后商用需另行取得授权。
 *
 * 说明：GIF 无法用 CSS 暂停，`prefers-reduced-motion` 下不做降级——
 * 素材只有动图，没有对应的静态帧。拿到静态图后可在此补降级分支。
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
 * 为什么需要它：素材文件名不随内容变化（`interviewer_idle.gif` 永远是这个名字），
 * 而浏览器可能已经拿着旧图的长缓存（历史上 443 入口下发过
 * `max-age=2592000, immutable`，`immutable` 连刷新都不重新校验）。
 * 在 URL 上带一个 query 就能让地址变化，彻底绕开旧缓存。
 *
 * 只加在 `<img>` 的 src 上，`spriteSrc()` 仍返回干净路径，
 * 因此 `tests/sprite.test.ts` 对路径的断言不受影响。
 */
export const SPRITE_VERSION = '2';

/** 解析出实际可用的素材路径：不支持的动作回落到 idle。 */
export function spriteSrc(characterId: string, action: KanshanAction): string {
  const supported = ACTIONS_BY_CHARACTER[characterId];

  if (!supported) {
    return '/kanshan/idle.gif';
  }

  const resolved = supported.includes(action) ? action : 'idle';

  return characterId === 'kanshan'
    ? `/kanshan/${resolved}.gif`
    : `/kanshan/${characterId}_${resolved}.gif`;
}

export interface KanshanSpriteProps {
  readonly characterId?: string;
  readonly action?: KanshanAction;
  readonly expression?: Expression;
  readonly alt?: string;
  readonly className?: string;
}

export function KanshanSprite({
  characterId = 'kanshan',
  action,
  expression,
  alt,
  className,
}: KanshanSpriteProps) {
  const resolved = action ?? (expression ? actionForExpression(expression) : 'idle');

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

export default KanshanSprite;
