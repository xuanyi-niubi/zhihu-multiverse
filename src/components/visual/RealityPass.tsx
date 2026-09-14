'use client';

import * as React from 'react';

/**
 * Reality Pass —— 现实层票据（DESIGN-SYSTEM §4.9 / 04_AGENT §32）。
 *
 * ## 全站冷色里的一次回温
 *
 * 设计系统把这一层单独命名为 **Reality Plane**：
 *
 * ```text
 * Evidence   玻璃 · 实     —— 有证据的内容
 * Void       未显影 · 虚   —— 还不知道的东西
 * Reality   暖白纸 · 终局  —— 你能带回现实的东西
 * ```
 *
 * 三种材质必须让眼睛一秒分辨「你在哪一层」。所以这一版的票据不再是
 * 冷色玻璃，而是**一张纸**：`#F2EDE4` 纸白、`#241F1A` 墨色、衬线体、
 * 骑缝区（左侧 2px 暖铜线 + 虚线）。全站只有这里允许暖色。
 *
 * ## 它不是任务列表
 *
 * 没有 checkbox、没有完成度、没有打卡提醒。它只写：未来多长的时间盒、
 * 做什么、看什么信号 —— 然后可以被复制、截图、撕下来带走。
 *
 * 视觉组件不得 fetch API（04_AGENT §7）。
 */

export interface RealityPassProps {
  /** 真实时间盒，例如「接下来 3 天，每天 40 分钟」。 */
  readonly timebox: string;
  readonly action: string;
  /** 观察点：怎么知道这件事真的发生了（真实 successSignal）。 */
  readonly observation: string;
  /** 会留下什么（可选，骑缝区下方）。 */
  readonly artifact?: string | null;
  /** 停止信号（可选）。 */
  readonly stopSignal?: string | null;
  readonly onBringBack?: () => void;
  readonly broughtBack?: boolean;
  readonly className?: string;
}

/** 纸上的墨色阶梯：纸层不走冷色文本，只有墨。 */
const INK = 'var(--sil-paper-ink)';
const INK_SOFT = 'rgb(31 27 22 / 0.74)';
const INK_FAINT = 'rgb(31 27 22 / 0.56)';
const INK_RULE = 'rgb(31 27 22 / 0.18)';

export function RealityPass({
  timebox,
  action,
  observation,
  artifact,
  stopSignal,
  onBringBack,
  broughtBack = false,
  className = '',
}: RealityPassProps) {
  return (
    <section
      className={['sil-paper sil-develop relative px-5 py-5 sm:px-6', className]
        .filter(Boolean)
        .join(' ')}
      aria-label="带回现实的一张票据"
    >
      <div>
        <p className="sil-label" style={{ color: INK_FAINT }}>
          Reality Pass
        </p>

        <p className="mt-4 text-[13px] leading-relaxed" style={{ color: INK_FAINT }}>
          未来 <span style={{ color: INK }}>{timebox}</span>
        </p>

        <p
          className="sil-paper__title mt-2 text-[19px] leading-relaxed sm:text-[21px]"
          style={{ color: INK }}
        >
          {action}
        </p>
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: INK_RULE }}>
        <p className="sil-label" style={{ color: INK_FAINT }}>
          观察点
        </p>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: INK_SOFT }}>
          {observation}
        </p>

        {artifact || stopSignal ? (
          <dl className="mt-4 flex flex-col gap-3">
            {artifact ? (
              <div>
                <dt className="sil-label" style={{ color: INK_FAINT }}>
                  会留下什么
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
                  {artifact}
                </dd>
              </div>
            ) : null}
            {stopSignal ? (
              <div>
                <dt className="sil-label" style={{ color: INK_FAINT }}>
                  什么时候停
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
                  {stopSignal}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {onBringBack ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={onBringBack}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[2px] border px-5 text-[14px] font-semibold transition-transform duration-200 active:translate-y-px"
            style={{
              borderColor: 'rgb(31 27 22 / 0.52)',
              background: 'rgb(31 27 22 / 0.06)',
              color: INK,
            }}
          >
            {broughtBack ? '已带回现实' : '带回现实'}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: INK_FAINT }}>
            不需要注册、也不需要在站内打卡：复制、保存、截图都行。
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default RealityPass;
