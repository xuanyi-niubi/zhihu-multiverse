'use client';

import * as React from 'react';

import type { ExperienceCase, ExperienceFact, UserDifference } from '@/features/experience/domain';

/**
 * Experience Card —— 「借来的经验」（产品减法方案 §13 / §14 / §23）。
 *
 * ## 它替代的是什么
 *
 * 旧机制里玩家收集的是遗物：`+3 专业力`、`下次检定 +4`、`SAN 减伤`。
 * 那是「让项目更像游戏」的手段，玩家看完记不住任何东西。
 *
 * 方案把可收集物换成**真实经验本身**：
 *
 * ```text
 * 他当时：  基础一般，没有把握。
 * 他做了：  先用一周完成一个最小项目。
 * 代价：    比直接报名晚了一周。
 * 结果：    发现真正缺的是协作，而不是技术。
 * 与你不同：他当时已经有一个同伴。
 * 查看原文 >
 * ```
 *
 * 六块里有五块来自 `ExperienceFact.type`（condition / action / cost /
 * outcome / reflection），「与你不同」来自 `UserDifference`。**没有一个字
 * 是我们编的**：全部是原文逐字片段，且都能点回知乎原回答。
 *
 * ## 一句话纪律
 *
 * 卡片不是收藏品，是**行动解锁的依据**（§14）：玩家看过这张卡之后，
 * 选项里会多出一个原本不存在、但真实有人做过的做法。所以每张卡都要能
 * 回答「他从哪来」——见卡片底部的原文链接与来源。
 */

export interface ExperienceCardData {
  readonly id: string;
  /** 来源作者，用于「这是谁的经历」。 */
  readonly author: string;
  readonly sourceUrl: string;
  readonly conditions: readonly ExperienceFact[];
  readonly actions: readonly ExperienceFact[];
  readonly costs: readonly ExperienceFact[];
  readonly outcomes: readonly ExperienceFact[];
  readonly reflections: readonly ExperienceFact[];
  /** 与阅读者不同的地方（可选）。 */
  readonly differences?: readonly UserDifference[];
}

/** 把 `ExperienceCase` + 差异整理成卡片数据（纯函数，可测）。 */
export function cardDataFrom(
  experienceCase: ExperienceCase,
  differences: readonly UserDifference[],
): ExperienceCardData {
  const factIds = new Set(
    [
      ...experienceCase.conditions,
      ...experienceCase.actions,
      ...experienceCase.costs,
      ...experienceCase.outcomes,
      ...experienceCase.reflections,
    ].map((fact) => fact.id),
  );

  return {
    id: experienceCase.id,
    author: experienceCase.author,
    sourceUrl: experienceCase.sourceUrl,
    conditions: experienceCase.conditions,
    actions: experienceCase.actions,
    costs: experienceCase.costs,
    outcomes: experienceCase.outcomes,
    reflections: experienceCase.reflections,
    // 只带与这张卡有关的差异（差异本身以 evidenceFactIds 指回片段）
    differences: differences.filter((difference) =>
      difference.evidenceFactIds.some((id) => factIds.has(id)),
    ),
  };
}

export interface ExperienceCardPanelProps {
  readonly cards: readonly ExperienceCardData[];
  /** 每张卡的抬头（例如「先验证，再下注」）。缺省用作者名。 */
  readonly titles?: Readonly<Record<string, string>>;
  readonly className?: string;
}

const BLOCKS: readonly {
  readonly key: 'conditions' | 'actions' | 'costs' | 'outcomes' | 'reflections';
  readonly label: string;
}[] = [
  { key: 'conditions', label: '他当时' },
  { key: 'actions', label: '他做了' },
  { key: 'costs', label: '代价' },
  { key: 'outcomes', label: '结果' },
  { key: 'reflections', label: '后来他怎么想' },
];

function renderFacts(facts: readonly ExperienceFact[]): React.ReactNode {
  return (
    <ul className="flex flex-col gap-0.5">
      {facts.map((fact) => (
        <li key={fact.id} className="text-[12px] leading-relaxed text-slate-300">
          {fact.exactQuote}
        </li>
      ))}
    </ul>
  );
}

export function ExperienceCardPanel({ cards, titles, className = '' }: ExperienceCardPanelProps) {
  if (cards.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-slate-500">
        这一局还没有借到经验 —— 我们不会为了填满列表编一张卡。
      </p>
    );
  }

  return (
    <div className={['flex flex-col gap-4', className].filter(Boolean).join(' ')}>
      {cards.map((card) => (
        <article
          key={card.id}
          className="rounded-2xl border border-zhihu-500/30 bg-zhihu-500/[0.05] p-3.5"
        >
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-bold text-white">
              {titles?.[card.id] ?? '一个人的一段经历'}
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{card.author}</span>
          </header>

          <div className="mt-2.5 flex flex-col gap-2.5">
            {BLOCKS.map((block) =>
              card[block.key].length > 0 ? (
                <div key={block.key} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] tracking-wider text-slate-500">
                    {block.label}
                  </span>
                  {renderFacts(card[block.key])}
                </div>
              ) : null,
            )}

            {card.differences && card.differences.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] tracking-wider text-slate-500">与你不同</span>
                <ul className="flex flex-col gap-0.5">
                  {card.differences.slice(0, 3).map((difference) => (
                    <li key={difference.variable} className="text-[12px] leading-relaxed text-amber-200/90">
                      {difference.variable}
                      {difference.experienceValue ? `：他 ${difference.experienceValue}` : ''}
                      {difference.userValue ? ` / 你 ${difference.userValue}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {card.sourceUrl ? (
            <a
              href={card.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex font-mono text-[11px] font-semibold text-zhihu-300 hover:text-zhihu-100"
            >
              查看原文 ↗
            </a>
          ) : null}
        </article>
      ))}

      <p className="text-[10px] leading-relaxed text-slate-600">
        卡片上的每一句都是原文逐字片段，没有改写、没有概括。它说明有人这样做过，
        不说明这样做会得到什么结果 —— 那需要你自己去验证。
      </p>
    </div>
  );
}

export default ExperienceCardPanel;
