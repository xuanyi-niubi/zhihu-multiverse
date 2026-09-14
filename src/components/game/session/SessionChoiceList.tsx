'use client';

import * as React from 'react';

import { HiddenPathReveal } from '@/components/visual/HiddenPathReveal';

import { SessionChoiceCard } from '@/components/game/session/SessionChoiceCard';
import type { SessionChoiceView } from '@/components/game/session/types';

/**
 * 选项列表（Agent 03 §十 / §二十七）。
 *
 * ## 普通选项与解锁选项不混在一起
 *
 * 解锁项单独成组，由 `HiddenPathReveal` 演出「一条原本不存在的轨道亮起来」
 * （04_AGENT §25：整个产品最高优先级的动画）。如果把它和普通选项并排铺开，
 * 玩家只会看到列表多了一行 —— 而这件事是整个产品的 WOW Point。
 *
 * 分组只做一次：`state === 'unlocked'` 是 ViewModel 已经算好的结论，
 * 组件不重新判断「这条算不算解锁」。
 *
 * ## 移动端
 *
 * 单列、`gap-3`、每张卡 `min-h-11`。没有固定侧栏（§二十七）。
 */
export interface SessionChoiceListProps {
  readonly choices: readonly SessionChoiceView[];
  readonly onChoose: (choiceId: string) => void;
  readonly onOpenSource: (choiceId: string) => void;
  readonly className?: string;
}

export function SessionChoiceList({
  choices,
  onChoose,
  onOpenSource,
  className = '',
}: SessionChoiceListProps) {
  const unlocked = choices.filter((choice) => choice.state === 'unlocked');
  const plain = choices.filter((choice) => choice.state !== 'unlocked');

  if (choices.length === 0) {
    return null;
  }

  return (
    <section
      className={['session-choice-list mt-6 flex flex-col gap-3', className].filter(Boolean).join(' ')}
      aria-label="你的处境"
    >
      {plain.map((choice) => (
        <SessionChoiceCard
          key={choice.id}
          choice={choice}
          onChoose={onChoose}
          onOpenSource={onOpenSource}
        />
      ))}

      {unlocked.length > 0 ? (
        <HiddenPathReveal
          key={unlocked.map((choice) => choice.id).join('|')}
          active
          label="ANOTHER PATH REVEALED"
          subLabel="你多看见了一种做法"
          className="mt-3"
        >
          {unlocked.map((choice) => (
            <SessionChoiceCard
              key={choice.id}
              choice={choice}
              onChoose={onChoose}
              onOpenSource={onOpenSource}
            />
          ))}
        </HiddenPathReveal>
      ) : null}
    </section>
  );
}

export default SessionChoiceList;
