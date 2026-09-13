'use client';

import * as React from 'react';

import type { RealityExperiment } from '@/features/decision-session/domain';

/**
 * 新主链的终局（产品减法方案 §15 / §20 / §21 / §22 / §30 / §35）。
 *
 * ## 它不再是什么
 *
 * 不是 Boss 判卷、不是属性结算、不是雷达图、不是承诺打卡。方案把终局
 * 重新定义成一句话：**结束时，你的问题比开始时更清楚了。**
 *
 * ## 它是什么
 *
 * ```text
 * 刘看山最后两句（他们的路你已经看到了 / 现在，走你自己的）
 * 这一局你经历了什么（轻量回顾：你选过的每个行动）
 * 问题重写：你开始时问的是… → 现在真正该验证的是…
 * Reality Quest：未来 7 天做什么、成功信号、停止信号 —— 可复制带走
 * ```
 *
 * ## 三条纪律
 *
 * 1. **不给判定**：没有成功/失败、没有成功率、没有匹配度。
 * 2. **不编问题**：重写用的「现在该验证的」必须来自本局蓝图的 `keyUnknown`；
 *    没有就如实说「这一局没有收敛出一个未知」。
 * 3. **可带走**：现实支线要能一键复制/save —— 它不需要玩家注册、也不需要
 *    在站内打卡（方案 §30：不要变成 Task Manager）。
 */

export interface SessionEndgameProps {
  /** 玩家开始时问的那句话。 */
  readonly originalQuestion: string;
  /** 这一局收敛出的那个未知（蓝图的 keyUnknown）。 */
  readonly keyUnknown: string | null;
  /** 已经设计好的现实实验；没有就只是不给七天计划。 */
  readonly experiment: RealityExperiment | null;
  /** 你选过的行动（按顺序，用于轻量回顾）。 */
  readonly steps: readonly string[];
  /** 这一局你看见了什么（有出处的回顾条目，来自 questView）。 */
  readonly highlights: readonly string[];
  /** 真实经验替你解锁、而你真的用过的行动（§14/§15）。 */
  readonly unlockedActions: readonly string[];
  readonly className?: string;
}

function Block({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] tracking-wider text-slate-500">{label}</span>
      <span className="text-[12px] leading-relaxed text-slate-300">{children}</span>
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
  const [copied, setCopied] = React.useState(false);

  /** 可复制的现实支线文本：截图/粘贴都能带走，不需要注册。 */
  const questText = React.useMemo(() => {
    if (!experiment) {
      return '';
    }
    return [
      '现实支线',
      keyUnknown ? `我要验证的问题：${keyUnknown}` : '',
      `未来 7 天：${experiment.action}`,
      `时间盒：${experiment.timebox}`,
      `会留下什么：${experiment.artifact}`,
      `成功信号：${experiment.successSignal}`,
      `停止信号：${experiment.stopSignal}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }, [experiment, keyUnknown]);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(questText);
      setCopied(true);
    } catch {
      // 剪贴板不可用（非安全上下文等）时如实降级：文字就在页面上，可手动选中
      setCopied(false);
    }
  }, [questText]);

  return (
    <section
      className={['panel relative overflow-hidden p-5', className].filter(Boolean).join(' ')}
      aria-label="终局"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-radial-halo opacity-25" />

      {/* 刘看山第三次出现（方案 §35：全局只出现三次） */}
      <p className="relative text-[13px] font-semibold leading-relaxed text-slate-200">
        他们的路你已经看到了。
      </p>
      <p className="relative mt-1 text-[15px] font-black leading-relaxed text-white">
        现在，走你自己的。
      </p>

      {steps.length > 0 ? (
        <div className="relative mt-5 border-t border-white/8 pt-3.5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">这一局你经历了</p>
          <ol className="mt-2 flex flex-col gap-1">
            {steps.map((step, index) => (
              <li key={`${step}-${index}`} className="flex gap-2 text-[12px] leading-relaxed text-slate-400">
                <span aria-hidden="true" className="font-mono text-slate-600">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <div className="relative mt-4 border-t border-white/8 pt-3.5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">你看见了什么</p>
          <ul className="mt-2 flex flex-col gap-1">
            {highlights.map((item) => (
              <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-400">
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unlockedActions.length > 0 ? (
        <div className="relative mt-4 border-t border-white/8 pt-3.5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">你多看见的行动</p>
          <ul className="mt-2 flex flex-col gap-1">
            {unlockedActions.map((action) => (
              <li key={action} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
                <span aria-hidden="true" className="text-zhihu-300">
                  ◆
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 问题重写（方案 §21）：这是全场最重要的产出 */}
      <div className="relative mt-5 border-t border-white/8 pt-3.5">
        <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">问题重写</p>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          你开始时问的是：
          <span className="text-slate-300">{originalQuestion}</span>
        </p>
        {keyUnknown ? (
          <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-white">
            现在真正该验证的是：
            <span className="text-zhihu-200">{keyUnknown}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
            这一局没有收敛出一个明确的未知 —— 我们不会替你编一个。
          </p>
        )}
      </div>

      {/* Reality Quest（方案 §30）：给一条现实支线，可复制带走 */}
      {experiment ? (
        <div className="relative mt-5 border-t border-white/8 pt-3.5">
          <p className="font-mono text-[10px] tracking-[0.25em] text-emerald-300">REALITY QUEST</p>
          <div className="mt-2.5 flex flex-col gap-3">
            <Block label="未来 7 天">{experiment.action}</Block>
            <Block label="时间盒">{experiment.timebox}</Block>
            <Block label="会留下什么">{experiment.artifact}</Block>
            <Block label="成功信号">{experiment.successSignal}</Block>
            <Block label="停止信号">{experiment.stopSignal}</Block>
          </div>

          <button
            type="button"
            onClick={() => void onCopy()}
            className="arcade-btn mt-4 w-full bg-emerald-500 text-white"
          >
            {copied ? '已复制 · 拿去用' : '复制这条现实支线'}
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
            不需要注册、也不需要在站内打卡：复制、保存、截图都行。
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default SessionEndgame;
