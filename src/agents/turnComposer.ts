import { synthesizeOutcome } from '@/agents/outcomeSynthesizer';

import type { PlotBrief } from '@/agents/types';
import type { ScenarioChoice, ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * Turn Composer：把 **情节简报（AI 决定的结构）** 与 **文本层（既有生成管线）** 合成一回合。
 *
 * 分工刻意清晰：
 * - Plot Director 决定「发生了什么、有哪些选项、谁触发检定」；
 * - 既有 DM 管线负责「怎么讲」（storyText / 知乎引用）；
 * - **本模块负责把 AI 的语义翻译成引擎契约**（选项结果由 `synthesizeOutcome` 算出）。
 *
 * 结果就是：AI 能自由创造剧情结构，却依然无法操作任何数值。
 */

export interface ComposeInput {
  /** 既有文本层产出的回合（提供 storyText / zhihuBullet / 节拍）。 */
  readonly baseTurn: ScenarioTurn;
  readonly brief: PlotBrief;
  /** 实际幕次（用于量级与文案）。 */
  readonly act: number;
  /** 是否采用 AI 结构；false 时原样返回 baseTurn（保证无 key 时零回归）。 */
  readonly useBrief: boolean;
}

/** 把简报选项映射成引擎选项。 */
export function toScenarioChoices(brief: PlotBrief, act: number): readonly ScenarioChoice[] {
  return brief.choices.map((choice) => {
    const { onSuccess, onFail } = synthesizeOutcome({
      tags: choice.tags,
      hasCheck: Boolean(choice.check),
      act,
      ...(choice.check ? { targetStat: choice.check.stat } : {}),
      ...(choice.check?.flavor ? { flavor: choice.check.flavor } : {}),
      successHint: choice.hint,
      hint: choice.hint,
    });

    return {
      id: choice.id,
      text: choice.text,
      hint: choice.hint,
      tags: choice.tags,
      ...(choice.check ? { check: { targetStat: choice.check.stat, difficulty: choice.check.difficulty } } : {}),
      // 同路人回声：用选项自身的代价提示改写，避免出现"数据感"
      ghostEchoStat: choice.tags.efficiency === 'risky' ? '这么走的人，多半吃过亏' : '这一步是最常见的走法',
      onSuccess,
      onFail,
    } satisfies ScenarioChoice;
  });
}

export function composeTurn(input: ComposeInput): ScenarioTurn {
  if (!input.useBrief) {
    return input.baseTurn;
  }

  const choices = toScenarioChoices(input.brief, input.act);
  if (choices.length < 2) {
    // 结构不合法时宁可退回文本层的选项，也不给玩家一个无法选择的回合
    return input.baseTurn;
  }

  return {
    ...input.baseTurn,
    // 结构由 AI 定，正文仍用文本层写好的那一版
    title: input.brief.title.length > 0 ? input.brief.title : input.baseTurn.title,
    choices,
  };
}

/** 情节来源的可解释标注：让前端能如实显示"这一幕的结构是谁定的"。 */
export function plotAttribution(source: 'model' | 'fallback', provider: string | null): string {
  if (source === 'model' && provider) {
    return `结构由 ${provider} 现场生成`;
  }
  return '结构来自本地剧本';
}
