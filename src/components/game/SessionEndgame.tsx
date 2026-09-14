'use client';

import * as React from 'react';

import { SentenceReforge } from '@/components/visual/SentenceReforge';
import { RealityPass } from '@/components/visual/RealityPass';

import type { RealityExperiment } from '@/features/decision-session/domain';

/**
 * 新主链的终局（04_AGENT §31 / §32）。
 *
 * ## 它不再是什么
 *
 * 不是 Boss 判卷、不是属性结算、不是雷达图、不是承诺打卡。终局只回答一件事：
 * **结束时，你的问题比开始时更清楚了。**
 *
 * ## 画面（§31）
 *
 * ```text
 * 所有复杂背景减弱（.obs-shell--still / .session-endgame）
 * 原问题  小号
 * 新问题  Hero
 * ```
 *
 * ## 三条纪律
 *
 * 1. **不给判定**：没有成功/失败、没有成功率、没有匹配度。
 * 2. **不编问题**：重写用的「现在该验证的」必须来自本局蓝图的 `keyUnknown`；
 *    没有就如实说「这一局没有收敛出一个未知」。
 * 3. **可带走**：现实支线要能一键复制 —— 它不需要玩家注册、
 *    也不需要在站内打卡（§32：不要变成 Task Manager）。
 */

export interface SessionEndgameProps {
  /** 玩家开始时问的那句话。 */
  readonly originalQuestion: string;
  /** 这一局收敛出的那个未知（蓝图的 keyUnknown）。 */
  readonly keyUnknown: string | null;
  /** 已经设计好的现实实验；没有就只是不给一张票。 */
  readonly experiment: RealityExperiment | null;
  /** 你选过的行动（按顺序，用于轻量回顾）。 */
  readonly steps: readonly string[];
  /** 这一局你看见了什么（有出处的回顾条目，来自 questView）。 */
  readonly highlights: readonly string[];
  /** 真实经验替你解锁、而你真的用过的行动。 */
  readonly unlockedActions: readonly string[];
  readonly className?: string;
}

function ReviewList({
  label,
  items,
  tone = 'quiet',
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly tone?: 'quiet' | 'path';
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 border-t border-[color:rgb(var(--obs-rgb-text-0)/0.08)] pt-3">
      <p className="obs-kicker">{label}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={[
              'flex gap-2 text-[12px] leading-relaxed',
              tone === 'path'
                ? 'text-[color:var(--obs-path-soft)]'
                : 'text-[color:var(--obs-text-1)]',
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-[color:var(--obs-text-2)]">
              {tone === 'path' ? '◆' : '·'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SessionEndgame({
  originalQuestion,
  keyUnknown,
  experiment,
  steps,
  highlights,
  unlockedActions,
  className = '',
}: SessionEndgameProps) {
  const [broughtBack, setBroughtBack] = React.useState(false);

  /** 可复制的现实支线文本：截图/粘贴都能带走，不需要注册。 */
  const passText = React.useMemo(() => {
    if (!experiment) {
      return '';
    }
    return [
      '现实支线',
      keyUnknown ? `我要验证的问题：${keyUnknown}` : '',
      `时间盒：${experiment.timebox}`,
      `要做的事：${experiment.action}`,
      `会留下什么：${experiment.artifact}`,
      `观察点：${experiment.successSignal}`,
      `什么时候停：${experiment.stopSignal}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }, [experiment, keyUnknown]);

  const onBringBack = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(passText);
      setBroughtBack(true);
    } catch {
      // 剪贴板不可用（非安全上下文等）时如实降级：文字就在页面上，可手动选中
      setBroughtBack(false);
    }
  }, [passText]);

  return (
    <section
      className={['session-endgame relative', className].filter(Boolean).join(' ')}
      aria-label="终局"
    >
      {/* 刘看山第三次出现（全局只出现三次）—— 小型投影，不占屏幕 30%（§33） */}
      <p className="text-[13px] font-semibold leading-relaxed text-[color:var(--obs-text-1)]">
        他们的路你已经看到了。
      </p>
      <p className="mt-1 text-[15px] font-black leading-relaxed text-[color:var(--obs-text-0)]">
        现在，走你自己的。
      </p>

      {/* §31：原问题小号、新问题 Hero */}
      <div className="mt-9">
        <p className="obs-kicker mb-3">你一开始问的是</p>
        <SentenceReforge original={originalQuestion} rewritten={keyUnknown} />
      </div>

      <ReviewList label="这一局你经历了" items={steps} />
      <ReviewList label="你看见了什么" items={highlights} />
      <ReviewList label="你多看见的行动" items={unlockedActions} tone="path" />

      {/* §32：Reality Pass —— 一张薄光票据，不是任务清单 */}
      {experiment ? (
        <RealityPass
          className="mt-8"
          timebox={experiment.timebox}
          action={experiment.action}
          observation={experiment.successSignal}
          artifact={experiment.artifact}
          stopSignal={experiment.stopSignal}
          onBringBack={() => void onBringBack()}
          broughtBack={broughtBack}
        />
      ) : null}
    </section>
  );
}

export default SessionEndgame;
