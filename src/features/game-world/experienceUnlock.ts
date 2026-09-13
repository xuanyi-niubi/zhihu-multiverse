import { synthesizeOutcome } from '@/agents/outcomeSynthesizer';

import type { DmExperienceUnlock } from '@/features/game-world/dmContext';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';

/**
 * 经验解锁注入（Phase 14 / P0-H）。
 *
 * ## 这是比赛的 WOW Point
 *
 * ```text
 * 玩家在上一幕获得一条真实经验
 *   ↓
 * *之后的某一幕*，选项里多出一个此前不存在的行动
 *   ↓
 * 评委一眼看懂：知乎内容不是装饰，而是玩法
 * ```
 *
 * ## 纪律
 *
 * 1. **必须让玩家看得见**：3 个以内直接追加；已经 4 个时**替换最后一条**
 *    （写清被替换的是模型生成的那一项）。旧版「满 3 个就等下一幕」实测会让
 *    这条机制在很多回合根本不出现 —— 而它是全产品的 WOW Point，
 *    不出现就等于没有；
 * 2. **同一解锁绝不重复出现**（连续几幕都解锁同一条经验没有意义）；
 * 3. 解锁选项**永远无检定**：它是一小步试探，不是一次冒险；
 * 4. 每个注入的选项都带 `experienceUnlockId` + `sourceFactIds`，
 *    界面据此打上「经验解锁」标并可回溯到真实知乎原文。
 */

export interface InjectExperienceUnlockInput {
  readonly choices: readonly ScenarioChoice[];
  readonly unlock: DmExperienceUnlock | null;
  /** 当前幕（1 基），用于让结果量级与幕次一致。 */
  readonly act: number;
}

/**
 * 把经验解锁织进选项列表。
 *
 * 不满足注入条件时**原样返回** —— 调用方不需要写任何 if。
 */
export function injectExperienceUnlock(input: InjectExperienceUnlockInput): readonly ScenarioChoice[] {
  const { choices, unlock } = input;
  if (!unlock) {
    return choices;
  }
  // 同一解锁已在场（重渲染 / 重试请求）→ 不重复
  if (choices.some((choice) => choice.experienceUnlockId === unlock.unlockId)) {
    return choices;
  }

  const { onSuccess } = synthesizeOutcome({
    tags: { efficiency: 'indirect' },
    hasCheck: false,
    act: input.act,
    hint: unlock.hint,
  });

  const injected: ScenarioChoice = {
    id: `choice-${unlock.unlockId}`,
    text: unlock.choiceText,
    hint: unlock.hint,
    tags: { efficiency: 'indirect' },
    // 无检定：解锁选项是一小步试探，不是一次掷骰
    ghostEchoStat: '这条路有人真实走过',
    onSuccess,
    experienceUnlockId: unlock.unlockId,
    sourceFactIds: [...unlock.sourceFactIds],
  };

  /**
   * 超过 4 个就替换最后一条：宁可挤掉一条模型生成的选项，
   * 也不能让「真实经验解锁的新行动」缺席（它是这个产品的核心机制）。
   */
  if (choices.length >= 4) {
    return [...choices.slice(0, 3), injected];
  }
  return [...choices, injected];
}
