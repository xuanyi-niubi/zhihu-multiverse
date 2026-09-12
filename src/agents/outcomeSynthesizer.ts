import type { ChoiceTagLike } from '@/core/run/scenarioAdapter';
import type { ScenarioOutcome } from '@/data/prebuiltScenarios';
import type { TargetStat } from '@/types/game';

/**
 * 数值合成器：把 **AI 创造但没有数值** 的选项，翻译成引擎认识的结果契约。
 *
 * 为什么必须有这一层：AI 不许写 `statDeltas`（那是引擎的活），可选项又必须带
 * 成败结果才能在推演里生效。于是规则表按「选项语义 + 幕次 + 是否检定」算出成员，
 * 文案则沿用 AI 给的 hint / flavor —— **AI 提供意义，引擎提供数字**。
 *
 * 所有系数都是写死的常量、按幕次分段，因此同一幕同一个选项永远得到同一组数值：
 * 这既保证了可复现，也保证了 AI 无法通过措辞偷偷改变平衡。
 */

/** 各幕的基础量级：越往后代价与收益越大。 */
const ACT_MAGNITUDE: Record<number, number> = { 1: 6, 2: 8, 3: 10, 4: 12 };

/** 失败时的惩罚倍数（失败总是比成功更"疼"）。 */
const FAILURE_MULTIPLIER = 1.6;

export interface SynthesizeInput {
  readonly tags: ChoiceTagLike;
  readonly hasCheck: boolean;
  readonly act: number;
  /** 检定目标属性（无检定则忽略）。 */
  readonly targetStat?: TargetStat;
  /** AI 给的成功风味（失败时由引擎改写，避免"成功文案讲失败"）。 */
  readonly successHint?: string;
  readonly flavor?: string;
  readonly hint: string;
}

function magnitude(act: number): number {
  return ACT_MAGNITUDE[act] ?? 8;
}

function round(value: number): number {
  return Math.round(value);
}

/** 把数字从文案里彻底去掉（项目纪律：玩家看到的话里不许有编造的数字）。 */
function sanitize(text: string): string {
  return text.replace(/\d+(?:\.\d+)?\s*[%％]/g, '很多').replace(/\s+/g, ' ').trim();
}

/**
 * 合成成败结果。
 *
 * 规则表（可解释、可对账）：
 * - 成功：目标属性 +量级；`direct`/`risky` 额外吃心智成本，`indirect` 心智成本更低
 * - 失败：心智 −量级×1.6；`risky` 再减羁绊（赌输要付关系账）
 * - 社交：`ally` 成功加羁绊，`antagonize` 失败减羁绊
 * - 道德：`good` 成功小幅加羁绊；`dark` 失败额外扣心智（心里过不去）
 */
export function synthesizeOutcome(input: SynthesizeInput): {
  readonly onSuccess: ScenarioOutcome;
  readonly onFail: ScenarioOutcome;
} {
  const mag = magnitude(input.act);
  const { tags, hasCheck } = input;
  const target: TargetStat = input.targetStat ?? 'skill';

  /* ---------------- 成功 ---------------- */
  const successDelta: Partial<Record<TargetStat, number>> = {};

  if (hasCheck) {
    successDelta[target] = round(mag * (tags.efficiency === 'risky' ? 1.2 : 1));
  } else {
    successDelta.skill = round(mag * 0.5);
  }

  // 心智成本：走得越直接/越野，消耗越大
  const successSanCost = tags.efficiency === 'direct' ? 0.6 : tags.efficiency === 'risky' ? 0.9 : 0.3;
  successDelta.san = -round(mag * successSanCost);

  if (tags.social === 'ally') {
    successDelta.bond = round(mag * 0.5);
  }
  if (tags.moral === 'good') {
    successDelta.bond = (successDelta.bond ?? 0) + round(mag * 0.3);
  }

  /* ---------------- 失败 ---------------- */
  const failDelta: Partial<Record<TargetStat, number>> = {
    san: -round(mag * FAILURE_MULTIPLIER),
  };

  if (tags.efficiency === 'risky') {
    failDelta.bond = -round(mag * 0.4);
  }
  if (tags.social === 'antagonize') {
    failDelta.bond = (failDelta.bond ?? 0) - round(mag * 0.4);
  }
  if (tags.moral === 'dark') {
    failDelta.san = (failDelta.san ?? 0) - round(mag * 0.3);
  }

  const successText = sanitize(input.successHint ?? input.hint ?? '这一步走通了。');
  const failText = sanitize(
    input.flavor ?? (tags.efficiency === 'risky' ? '赌输的代价立刻显形。' : '这一步没有按你想的走。'),
  );

  return {
    onSuccess: { feedback: successText.length > 0 ? successText : '这一步走通了。', statDeltas: successDelta },
    onFail: { feedback: failText.length > 0 ? failText : '这一步没有按你想的走。', statDeltas: failDelta },
  };
}

/** 供测试与文档引用：某一幕的量级。 */
export function magnitudeForAct(act: number): number {
  return magnitude(act);
}
