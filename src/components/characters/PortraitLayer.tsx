'use client';

import * as React from 'react';

import { Portrait } from '@/components/characters/Portrait';

import { getCharacter } from '@/data/characters';

import type { CharacterOnStage, SpeakerId, StageSlot } from '@/types/narrative';

/**
 * 舞台立绘层（从 `play/page.tsx` 提出来共用）。
 *
 * 新主链的推演屏（`components/game/SessionPlayScreen.tsx`）需要与旧推演舱
 * **完全相同的立绘呈现**，但它不能再从页面文件里 import —— 页面只能默认导出。
 * 与其复制一份，不如把这份实现提成公共组件：两处用同一份，改一次两边都变。
 *
 * 行为与原实现逐字一致（同样的位置映射、同样的窄屏缩放、同样的入场动画），
 * 因此旧路径的渲染结果没有任何变化。
 */

export interface PortraitLayerProps {
  readonly stage: readonly CharacterOnStage[];
  readonly speaker: SpeakerId | null;
}

const POSITIONS: Readonly<Record<StageSlot, string>> = {
  left: 'left-[2%] sm:left-[6%]',
  center: 'left-1/2 -translate-x-1/2',
  right: 'right-[2%] sm:right-[6%]',
};

export function PortraitLayer({ stage, speaker }: PortraitLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[74%]">
      {stage.map((member) => {
        const character = getCharacter(member.speaker);

        return (
          <div
            key={member.speaker}
            className={[
              // 窄屏把立绘缩到 0.82，优先保证 HUD 与对话框完整
              'absolute bottom-0 h-full w-[46%] max-w-[320px] origin-bottom scale-[0.82] animate-portrait-in sm:w-[34%] sm:scale-100',
              POSITIONS[member.slot],
            ].join(' ')}
          >
            <Portrait
              character={character}
              expression={member.expression}
              speaking={speaker === member.speaker}
            />
          </div>
        );
      })}
    </div>
  );
}

export default PortraitLayer;
