'use client';

import * as React from 'react';

import type { ExperienceCase, ExperienceFact, UserDifference } from '@/features/experience/domain';

/**
 * Experience Reliquary —— 借来的经验（04_AGENT §26 / §27）。
 *
 * ## 它替代的是什么
 *
 * 旧机制里玩家收集的是遗物：`+3 专业力`、`下次检定 +4`、`SAN 减伤`。
 * 那是「让项目更像游戏」的手段，玩家看完记不住任何东西。
 *
 * 方案把可收集物换成**真实经验本身**，而外观换成一枚深色晶体：
 *
 * ```text
 * REAL LIFE / ZHIHU
 * 标题
 * 那时        他当时面对什么
 * 他做了      他实际做了什么
 * 代价        这条路要付什么
 * 后来        结果是什么
 * 他后来怎么想
 * 不能直接照搬  与你不同的地方
 * 来源        逐字回溯到知乎原回答
 * ```
 *
 * ## 材质（§26）
 *
 * ```text
 * 深色晶体
 * 透明 0.8
 * 边缘内高光
 * 少量 dust（固定 3 个 1px 点，不用 canvas 粒子）
 * ```
 *
 * ## 展开（§27）
 *
 * Desktop：侧浮层（由推演屏的抽屉提供）；Mobile：全屏 sheet。
 * 动画只有 opacity + translate，**没有**复杂 3D flip。
 *
 * 数据全部来自 Agent 03 的 `cardDataFrom`：**没有一个字是这里编的**。
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
  /** 每张卡的抬头（例如「先验证，再下注」）。缺省用中性兜底。 */
  readonly titles?: Readonly<Record<string, string>>;
  readonly className?: string;
}

const BLOCKS: readonly {
  readonly key: 'conditions' | 'actions' | 'costs' | 'outcomes' | 'reflections';
  readonly label: string;
}[] = [
  { key: 'conditions', label: '那时' },
  { key: 'actions', label: '他做了' },
  { key: 'costs', label: '代价' },
  { key: 'outcomes', label: '后来' },
  { key: 'reflections', label: '他后来怎么想' },
];

function renderFacts(facts: readonly ExperienceFact[]): React.ReactNode {
  return (
    <ul className="flex flex-col gap-1">
      {facts.map((fact) => (
        <li key={fact.id} className="text-[13px] leading-relaxed text-[color:var(--obs-text-1)]">
          {fact.exactQuote}
        </li>
      ))}
    </ul>
  );
}

function ExperienceReliquary({
  card,
  index,
  title,
  defaultOpen,
}: {
  readonly card: ExperienceCardData;
  readonly index: number;
  readonly title: string;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <article className="obs-reliquary relative overflow-hidden">
      {/* 少量 dust：深色晶体里的三点微尘 */}
      <span aria-hidden="true" className="obs-reliquary__dust" />

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="relative flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors duration-300 hover:bg-[color:rgb(var(--obs-rgb-text-0)/0.03)]"
      >
        <span className="min-w-0">
          <span className="obs-kicker block">
            Real Life / Zhihu · {String(index).padStart(3, '0')}
          </span>
          <span className="mt-2 block text-[15px] font-bold leading-snug text-[color:var(--obs-text-0)]">
            {title}
          </span>
        </span>
        <span className="mt-1 shrink-0 text-[10px] tracking-[0.2em] text-[color:var(--obs-text-2)]">
          {open ? '收起' : '读取'}
        </span>
      </button>

      {/* §27 展开：opacity + translate，没有 3D flip */}
      {open ? (
        <div
          className="relative border-t border-[color:rgb(var(--obs-rgb-text-0)/0.08)] px-4 pb-4 pt-3.5"
          style={{ animation: 'fragment-materialize 460ms var(--obs-ease) both' }}
        >
          <div className="flex flex-col gap-3">
            {BLOCKS.map((block, blockIndex) =>
              card[block.key].length > 0 ? (
                <div
                  key={block.key}
                  className="flex flex-col gap-1"
                  style={{
                    animation: 'fragment-materialize 420ms var(--obs-ease) both',
                    animationDelay: `${blockIndex * 80}ms`,
                  }}
                >
                  <span className="obs-kicker">{block.label}</span>
                  {renderFacts(card[block.key])}
                </div>
              ) : null,
            )}

            {card.differences && card.differences.length > 0 ? (
              <div className="border border-[color:rgb(var(--obs-rgb-counter)/0.28)] bg-[color:rgb(var(--obs-rgb-counter)/0.05)] px-3 py-2.5">
                <span className="obs-kicker text-[color:var(--obs-counter-soft)]">
                  这条经验不能直接照搬
                </span>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {card.differences.slice(0, 3).map((difference) => (
                    <li
                      key={difference.variable}
                      className="text-[12px] leading-relaxed text-[color:var(--obs-counter-soft)]"
                    >
                      {difference.variable}
                      {difference.experienceValue ? `：他 ${difference.experienceValue}` : ''}
                      {difference.userValue ? ` / 你 ${difference.userValue}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <footer className="mt-3.5 flex items-center justify-between gap-3 border-t border-[color:rgb(var(--obs-rgb-text-0)/0.08)] pt-2.5">
            <span className="obs-kicker">
              来源 · {card.author}
            </span>
            {card.sourceUrl ? (
              <a
                href={card.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] font-semibold text-[color:var(--obs-zhihu-soft)] transition-opacity duration-200 hover:opacity-80"
              >
                查看知乎原回答 ↗
              </a>
            ) : null}
          </footer>
        </div>
      ) : null}
    </article>
  );
}

export function ExperienceCardPanel({ cards, titles, className = '' }: ExperienceCardPanelProps) {
  if (cards.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-[color:var(--obs-text-2)]">
        这一局还没有借到经验 —— 我们不会为了填满列表编一张卡。
      </p>
    );
  }

  return (
    <div className={['flex flex-col gap-4', className].filter(Boolean).join(' ')}>
      {cards.map((card, index) => (
        <ExperienceReliquary
          key={card.id}
          card={card}
          index={index + 1}
          title={titles?.[card.id] ?? '一个人的一段经历'}
          defaultOpen={index === 0}
        />
      ))}

      <p className="text-[10px] leading-relaxed text-[color:var(--obs-text-2)]">
        晶体上的每一句都是原文逐字片段，没有改写、没有概括。它说明有人这样做过，
        不说明这样做会得到什么结果 —— 那需要你自己去验证。
      </p>
    </div>
  );
}

export default ExperienceCardPanel;
