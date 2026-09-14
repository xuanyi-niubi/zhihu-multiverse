'use client';

import * as React from 'react';

import { UNKNOWN_CONTINUE_LABEL } from '@/components/game/session/viewModel';
import type { SessionUnknownView } from '@/components/game/session/types';

/**
 * Unknown Stage —— 现实信息不足（Agent 03 §十八 / §二十八）。
 *
 * ## 它不是什么
 *
 * 不是失败，不是错误弹窗，也不是「再抽一次」的机会。
 * 它是这一版产品最诚实的一刻：
 *
 * > 这里没有足够的现实信息继续推演。
 *
 * ## 明确禁止的三件事
 *
 * ```text
 * 强行猜答案        ← 模型没有现实依据就不许给结论
 * 重新投骰          ← 新主链没有骰子，也不该用随机冒充信息
 * 付资源解锁        ← 未知要靠「回到现实验证」解决，不是靠资源
 * ```
 *
 * 唯一出口是「继续到终局」：把所有未知收束成玩家带回现实的那个问题。
 *
 * 视觉隐喻用 Agent 04 的 `.obs-fog`（一条轨道进入半透明雾区），
 * **不用挂锁图标**当主视觉（§三十）。
 */
export interface SessionUnknownStageProps {
  readonly view: SessionUnknownView;
  readonly onContinue?: () => void;
  readonly className?: string;
}

export function SessionUnknownStage({
  view,
  onContinue,
  className = '',
}: SessionUnknownStageProps) {
  return (
    <section
      className={['session-unknown mt-6', className].filter(Boolean).join(' ')}
      data-unknown={view.unknownLabel}
      aria-label="现实信息不足"
    >
      <div className="obs-fog rounded-2xl px-4 py-4">
        <span aria-hidden="true" className="obs-fog__track" />

        <p className="obs-fog__label relative">REALITY REQUIRED</p>

        {/* 固定文案，不是模型生成的一句安慰（§十八）。 */}
        <p
          className="relative mt-2 text-[15px] font-semibold leading-relaxed"
          style={{ color: 'var(--obs-text-1)' }}
        >
          {view.explanation}
        </p>

        {view.unknownLabel ? (
          <p className="relative mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
            还没有答案的是：{view.unknownLabel}
          </p>
        ) : null}

        {view.blockedActions.length > 0 ? (
          <div className="relative mt-3 border-t pt-2.5" style={{ borderColor: 'var(--obs-hairline)' }}>
            <p className="obs-kicker">暂时做不了的行动</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {view.blockedActions.map((action) => (
                <li
                  key={action}
                  className="text-[12px] leading-relaxed"
                  style={{ color: 'var(--obs-text-1)' }}
                >
                  · {action}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onContinue}
          disabled={onContinue === undefined}
          className="door-btn relative mt-4 max-w-[260px]"
        >
          {UNKNOWN_CONTINUE_LABEL}
        </button>
      </div>
    </section>
  );
}

export default SessionUnknownStage;
