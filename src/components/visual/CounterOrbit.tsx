'use client';

import * as React from 'react';

/**
 * Counter Orbit —— 反例轨道（04_AGENT §28 / §29）。
 *
 * ## 它替代的是什么
 *
 * 旧语言会把这一幕做成「VS 红蓝对抗」：左边一个红色血条，右边一个蓝色血条，
 * 中间一个巨大的 VS。那是数值博弈的语法，而这里要表达的是
 * **同一个问题的两种真实走法**。
 *
 * ## 两个规定动作
 *
 * ```text
 * §28 第三幕：琥珀 path 从另一侧进入（stroke-dasharray / dashoffset，600~900ms）
 * §29 视觉：桌面 左遗物 / 中央极细琥珀轴 / 右遗物；移动端上下
 * ```
 *
 * 没有全屏震动、没有匹配度、没有百分比、没有评分 —— 只有
 * **相同 / 不同 / 未知** 三种关系，且「未知」必须能被说出来。
 *
 * 视觉组件不得 fetch API（§7）。
 */

export type CounterRelation = 'same' | 'different' | 'unknown';

export interface CounterOrbitRow {
  readonly kind: CounterRelation;
  readonly text: string;
}

export interface CounterOrbitProps {
  readonly active: boolean;
  /** 左：前一条经验（通常来自你自己选过的路）。 */
  readonly previousLabel: string;
  /** 右：结果完全相反的那个人。 */
  readonly counterLabel: string;
  readonly rows: readonly CounterOrbitRow[];
  readonly className?: string;
}

const RELATION_META: Readonly<Record<CounterRelation, { readonly label: string; readonly className: string }>> = {
  same: { label: '相同', className: 'text-[color:var(--sil-zhihu-soft)] border-[color:rgb(var(--sil-rgb-zhihu)/0.4)]' },
  different: { label: '不同', className: 'text-[color:var(--sil-counter-soft)] border-[color:rgb(var(--sil-rgb-counter)/0.42)]' },
  unknown: { label: '未知', className: 'text-[color:var(--sil-ink-300)] border-[color:rgb(var(--sil-rgb-ink-100)/0.14)]' },
};

export function CounterOrbit({
  active,
  previousLabel,
  counterLabel,
  rows,
  className = '',
}: CounterOrbitProps) {
  if (!active) {
    return null;
  }

  return (
    <section
      className={['session-collision relative', className].filter(Boolean).join(' ')}
      aria-label="一条结果相反的经历进入了这一局"
    >
      {/* §28：琥珀轨道从另一侧进入 */}
      <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none" className="sil-coordinate__orbit">
        <path
          d="M 100 5 C 74 5, 62 1, 50 1 C 38 1, 26 9, 0 9"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: 'var(--sil-counter)', strokeWidth: 0.8 }}
          pathLength={1}
        />
      </svg>

      {/* §29：左遗物 / 中央轴 / 右遗物（移动端自动变成上下） */}
      <div className="sil-coordinate mt-4">
        <article className="sil-panel px-4 py-3.5">
          <p className="sil-label">前一条经验</p>
          <p className="mt-2 text-[13px] font-semibold leading-relaxed text-[color:var(--sil-ink-200)]">
            {previousLabel}
          </p>
        </article>

        <span aria-hidden="true" className="sil-coordinate__key" />

        <article className="sil-panel sil-panel--counter relative overflow-hidden px-4 py-3.5">
          <span aria-hidden="true" className="sil-panel__dust" />
          <p className="sil-label text-[color:var(--sil-counter)]">结果完全相反的人</p>
          <p className="mt-2 text-[13px] font-semibold leading-relaxed text-[color:var(--sil-counter-soft)]">
            {counterLabel}
          </p>
        </article>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((row, index) => {
            const meta = RELATION_META[row.kind];
            return (
              <li
                key={`${row.kind}-${index}`}
                className="flex items-start gap-2.5"
                style={{ animation: 'fragment-materialize 480ms var(--sil-ease) both', animationDelay: `${index * 110}ms` }}
              >
                <span
                  className={`mt-px shrink-0 border px-2 py-0.5 text-[10px] tracking-[0.12em] ${meta.className}`}
                >
                  {meta.label}
                </span>
                <span className="text-[12px] leading-relaxed text-[color:var(--sil-ink-200)]">{row.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-[color:var(--sil-ink-300)]">
        只比较这三件事 —— 不显示匹配度、百分比或评分。他的课程压力是否和你一样，原文没说，就是未知。
      </p>
    </section>
  );
}

export default CounterOrbit;
