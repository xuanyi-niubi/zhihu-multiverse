'use client';

import * as React from 'react';

/**
 * Fragment Shard —— 真实记忆碎片（04_AGENT §19）。
 *
 * ## 它只显示两样东西
 *
 * ```text
 * 一行 / 两行 exactQuote
 * 来源标签
 * ```
 *
 * 编译页**不展示完整 Experience Card** —— 那是进入 Play 之后、玩家主动
 * 点开「借来的经验」才发生的事。等待期间只露碎片，让用户看见
 * 「真的有人的话被搬进来了」，而不是看见一份报告。
 *
 * ## 纪律
 *
 * 逐字引用。组件不做截断以外的任何加工：没有摘要、没有改写、没有「AI 总结」。
 * 视觉组件不得 fetch API（§7）。
 */

export type FragmentCategory = 'similar' | 'alternative' | 'counter';

/** 三条轨道在产品语言里的名字（与 `features/visual/archive.ts` 一致）。 */
export const FRAGMENT_CATEGORY_LABEL: Readonly<Record<FragmentCategory, string>> = {
  similar: '与你相似',
  alternative: '另一种走法',
  counter: '相反结果',
};

/**
 * 轨道 → silver 修饰符。
 *
 * 这三条轨道在产品语言里叫「相似 / 另一种 / 相反」，而在设计系统里
 * 对应的强调色叫「知乎蓝 / 解锁青 / 代价棕」。两边词汇不同，所以需要一个
 * 显式映射表 —— 直接拼 `sil-fragment--${category}` 会得到
 * `sil-fragment--similar` 这种**设计系统里不存在的类名**，
 * 表现是这三条轨道看起来一模一样（都不上色），不报错。
 */
const FRAGMENT_MODIFIER: Readonly<Record<FragmentCategory, string>> = {
  similar: 'zhihu',
  alternative: 'alternate',
  counter: 'counter',
};

export type FragmentState = 'pending' | 'materialized';

export interface FragmentShardProps {
  /** 逐字原文（`ExperienceFact.exactQuote`）。 */
  readonly quote: string;
  /** 来源标签，例如「知乎 · 答主名」。 */
  readonly sourceLabel: string;
  readonly category: FragmentCategory;
  /** `materialized` 时才播放归位动画；`pending` 保持占位。 */
  readonly state?: FragmentState;
  /** 允许调用方错开归位时间（六块同时出现会同时占用 blur/transform 预算）。 */
  readonly style?: React.CSSProperties;
  readonly className?: string;
}

export function FragmentShard({
  quote,
  sourceLabel,
  category,
  state = 'materialized',
  style,
  className = '',
}: FragmentShardProps) {
  const materialized = state === 'materialized';

  return (
    <article
      className={[
        'sil-fragment',
        `sil-fragment--${FRAGMENT_MODIFIER[category]}`,
        // 显影（DESIGN-SYSTEM §0 机制 1）：碎片是「从暗房里浮出来」的
        materialized ? 'sil-develop' : 'opacity-0',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-fragment-category={category}
      data-fragment-state={state}
      style={style}
    >
      <p className="sil-fragment__quote">{quote}</p>
      <p className="sil-fragment__meta">
        <span className={`sil-mark sil-mark--${FRAGMENT_MODIFIER[category]}`}>
          {FRAGMENT_CATEGORY_LABEL[category]}
        </span>
        <span className="truncate">{sourceLabel}</span>
      </p>
    </article>
  );
}

export default FragmentShard;
