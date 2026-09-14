import type { ExperienceCase } from '@/features/experience/domain';
import type { ExperienceChoiceUnlock } from '@/features/game-world/domain';

/**
 * 经验卡的**行动式标题**（产品化方案 §24）。
 *
 * ## 为什么不是再生成一次
 *
 * §24 要求每张卡有一个像「先验证，再下注」的标题。这件事已经在
 * `withUnlockTitles` 里做过一次：同一段真实经历解锁的选项条，拿到的
 * 就是它自己的行动式标题（模型不可用时退化为原文短标签）。
 *
 * 所以卡片抬头不需要第二次模型调用 —— 它只需要**复用解锁项的 label**。
 * 这样既满足 §24，又不增加 §8 的每局 LLM 成本。
 *
 * ## 三条纪律
 *
 * 1. 只做映射，不生成任何文字：标题来自已经过 `isUsableTitle` 护栏的
 *    `unlock.label`（或它退化后的原文短标签），这里一个字都不造。
 * 2. 找不到对应解锁的卡片**不给标题**，渲染层继续用中性兜底 ——
 *    宁可不给，也不编一个像标题的东西。
 * 3. 一段经历对应一个来源、一张卡（`case:${sourceId}`）；解锁通过
 *    `sourceFactIds` 指回来源里的片段，因此映射是确定的。
 */
export function cardTitlesFrom(
  unlocks: readonly ExperienceChoiceUnlock[],
  cases: readonly ExperienceCase[],
): Readonly<Record<string, string>> {
  const titles: Record<string, string> = {};

  for (const experienceCase of cases) {
    const factIds = new Set(
      [
        ...experienceCase.conditions,
        ...experienceCase.actions,
        ...experienceCase.costs,
        ...experienceCase.outcomes,
        ...experienceCase.reflections,
      ].map((fact) => fact.id),
    );

    const unlock = unlocks.find((item) => item.sourceFactIds.some((id) => factIds.has(id)));
    const title = unlock?.label?.trim();
    if (title) {
      titles[experienceCase.id] = title;
    }
  }

  return titles;
}
