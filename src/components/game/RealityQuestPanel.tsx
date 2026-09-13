'use client';

import * as React from 'react';

import type { RealityExperiment } from '@/features/decision-session/domain';

/**
 * 终局的现实交接（P1-2）。
 *
 * ## 它取代的是什么
 *
 * 此前终局第一屏是「生成报告 → 一堆指标」（判卷分解、四维雷达、证据覆盖）。
 * 那些东西回答的是「这一局你玩得怎么样」，而玩家真正带走的问题
 * 在别处：**这一局有一个任何人的人生经验都替代不了的问题，只属于他**。
 *
 * 所以这里把终局改成一次交接：
 *
 * ```text
 * 这一局你重新看见了：…（真实经历带来的三个改变）
 * 但还有一个问题，任何人的经验都不能替你回答：「那个未知」
 * REALITY QUEST：未来 7 天做什么 / 成功信号 / 停止信号
 * 　　　　　　　 [认下这条现实支线]
 * ```
 *
 * ## 三条纪律
 *
 * 1. **不预测**：这里只出现「你会知道什么」，不出现成功率、匹配度、推荐分。
 * 2. **不伪造**：没有实验（`experiment === null`）时不编一个七天计划，
 *    而是把玩家送回会话页把未知变成一个能做完的实验。
 * 3. **停止信号必须在场**：没有停止信号的实验是赌博，不是实验。
 */

export interface RealityQuestPanelProps {
  /** 这一局最该由现实回答的那个未知（蓝图 `keyUnknown`）。 */
  readonly keyUnknown: string | null;
  /** 已经设计好的现实实验（来自会话页；没有就是 null）。 */
  readonly experiment: RealityExperiment | null;
  /** 这一局你重新看见了什么（≤3 条，来自本局真实经历）。 */
  readonly seen: readonly string[];
  /** 是否已认下这条支线。 */
  readonly claimed: boolean;
  readonly claiming?: boolean;
  readonly onClaim: () => void | Promise<void>;
  /** 没有实验时，回会话页把它变成实验的地址。 */
  readonly designHref?: string;
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

export function RealityQuestPanel({
  keyUnknown,
  experiment,
  seen,
  claimed,
  claiming = false,
  onClaim,
  designHref,
  className = '',
}: RealityQuestPanelProps) {
  return (
    <section
      className={['panel relative mt-4 overflow-hidden p-5', className].filter(Boolean).join(' ')}
      aria-label="现实支线"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-radial-halo opacity-30" />

      <header className="relative flex items-center gap-2">
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-emerald-400" />
        <h3 className="text-sm font-semibold text-white">这一局你重新看见了</h3>
      </header>

      {seen.length > 0 ? (
        <ol className="relative mt-2.5 flex flex-col gap-1.5">
          {seen.slice(0, 3).map((item) => (
            <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {keyUnknown ? (
        <div className="relative mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            但还有一个问题，任何人的经验都不能替你回答：
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-slate-100">
            「{keyUnknown}」
          </p>
        </div>
      ) : null}

      <div className="relative mt-4 border-t border-white/8 pt-3.5">
        <p className="font-mono text-[10px] tracking-[0.25em] text-emerald-300">REALITY QUEST</p>

        {experiment ? (
          <div className="mt-2.5 flex flex-col gap-3">
            <Block label="未来 7 天">{experiment.action}</Block>
            <Block label="时间盒">{experiment.timebox}</Block>
            <Block label="会留下什么">{experiment.artifact}</Block>
            <Block label="成功信号">{experiment.successSignal}</Block>
            <Block label="停止信号">{experiment.stopSignal}</Block>
          </div>
        ) : (
          <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
            这个问题还没有变成一个能做完的实验 —— 我们不会在这里替你编一个七天计划。
            {designHref ? (
              <>
                {' '}
                <a href={designHref} className="font-semibold text-zhihu-300 hover:text-zhihu-100">
                  去把它变成一个本周能做完的实验 ↗
                </a>
              </>
            ) : null}
          </p>
        )}

        {experiment ? (
          <button
            type="button"
            disabled={claimed || claiming}
            onClick={() => void onClaim()}
            className="arcade-btn mt-4 w-full bg-emerald-500 text-white disabled:opacity-60"
          >
            {claimed ? '已认下这条现实支线 · 七天后回访' : claiming ? '正在认下…' : '认下这条现实支线'}
          </button>
        ) : null}

        <p className="mt-2.5 text-[10px] leading-relaxed text-slate-600">
          我们不给成功概率，也不替你做决定。这条支线只负责让你在七天后知道一件现在还不知道的事。
        </p>
      </div>
    </section>
  );
}

export default RealityQuestPanel;
