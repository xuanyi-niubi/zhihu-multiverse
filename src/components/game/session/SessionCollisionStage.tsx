'use client';

import * as React from 'react';

import type { SessionCollisionView } from '@/components/game/session/types';

/**
 * Collision Stage —— 两段真实人生给出不同结果（Agent 03 §十七 / §二十八）。
 *
 * ## 它只做一件事：指出分歧
 *
 * ```text
 * primary case     ← 一条真实走法（左）
 * counter case     ← 结果不同的另一条（右）
 * focus candidates ← 玩家接下来想重点观察的变量
 * ```
 *
 * ## 三条硬约束
 *
 * 1. **不打分**：没有匹配度、没有百分比、没有 VS 红蓝对抗
 *    （§二十八 的断言就是「collision 不显示 score」）；
 * 2. **不裁决**：文案只说「这里没有标准答案」，绝不说谁对；
 * 3. **选了也不算结论**：`onSelectFocus` 只把焦点交回页面写进
 *    `focusVariable`（§十七），组件自己不推导任何因果。
 *
 * ## 结构与视觉的分工
 *
 * 结构化 class 归这里（`.session-collision` + silver 体系的
 * `.sil-coordinate` / `.sil-panel` / `.sil-coordinate__key`），
 * 材质、光、轨道动画归视觉线程。移动端上下堆叠，中央轴只在桌面出现（§二十九）。
 */
export interface SessionCollisionStageProps {
  readonly view: SessionCollisionView;
  readonly onSelectFocus?: (focusId: string) => void;
  readonly className?: string;
}

function CaseBlock({
  side,
  label,
  quotes,
}: {
  readonly side: 'primary' | 'counter';
  readonly label: string;
  readonly quotes: readonly string[];
}) {
  const isCounter = side === 'counter';
  return (
    <article
      className={`sil-panel relative overflow-hidden px-4 py-3.5 ${
        isCounter ? 'sil-panel--counter' : ''
      }`}
    >
      {isCounter ? <span aria-hidden="true" className="sil-panel__dust" /> : null}
      <p className={`sil-label ${isCounter ? 'text-[color:var(--sil-counter)]' : ''}`}>
        {isCounter ? '结果不同的人' : '走这条路的人'}
      </p>
      <p
        className="mt-2 text-meta font-semibold leading-relaxed"
        style={{ color: isCounter ? 'var(--sil-counter-soft)' : 'var(--sil-ink-200)' }}
      >
        {label}
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {quotes.map((quote) => (
          <li key={quote} className="text-meta leading-relaxed" style={{ color: 'var(--sil-ink-200)' }}>
            「{quote}」
          </li>
        ))}
      </ul>
    </article>
  );
}

export function SessionCollisionStage({
  view,
  onSelectFocus,
  className = '',
}: SessionCollisionStageProps) {
  return (
    <section
      className={['session-collision-wrap mt-6', className].filter(Boolean).join(' ')}
      aria-label="两段真实经历的冲突"
    >
      <p className="sil-label">COLLISION</p>
      <p className="mt-2 text-meta leading-relaxed" style={{ color: 'var(--sil-ink-200)' }}>
        两个人的经验互相矛盾 —— 这里没有标准答案。
      </p>

      {/* §29：桌面 左遗物 / 中央极细轴 / 右遗物；移动端上下 */}
      <div className="session-collision sil-cases">
        <CaseBlock side="primary" label={view.primary.label} quotes={view.primary.quotes} />
        <span aria-hidden="true" className="sil-coordinate__key" />
        <CaseBlock side="counter" label={view.counter.label} quotes={view.counter.quotes} />
      </div>

      {view.focuses.length > 0 ? (
        <div className="mt-5">
          <p className="text-meta leading-relaxed" style={{ color: 'var(--sil-ink-200)' }}>
            你更想继续观察哪一个变量？
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {view.focuses.map((focus) => {
              const active = focus.id === view.activeFocusId;
              return (
                <button
                  key={focus.id}
                  type="button"
                  aria-pressed={active}
                  disabled={onSelectFocus === undefined}
                  onClick={() => onSelectFocus?.(focus.id)}
                  className="sil-mark min-h-11 px-4 text-meta transition-colors duration-200 disabled:opacity-60"
                  style={
                    active
                      ? {
                          borderColor: 'rgb(var(--sil-rgb-counter) / 0.6)',
                          background: 'rgb(var(--sil-rgb-counter) / 0.12)',
                          color: 'var(--sil-counter-soft)',
                        }
                      : {
                          borderColor: 'var(--sil-rule)',
                          color: 'var(--sil-ink-200)',
                        }
                  }
                >
                  {focus.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-micro leading-relaxed" style={{ color: 'var(--sil-ink-300)' }}>
            这只是你接下来想重点观察的东西 —— 不是结论，也不改变任何数值。
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default SessionCollisionStage;
