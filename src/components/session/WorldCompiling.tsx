'use client';

import * as React from 'react';

/**
 * 世界编译：把「等待」做成体验点，而不是缺陷（方案 §16 / §17 / §41 / §46）。
 *
 * ## 核心纪律：**只显示真的发生了的事**
 *
 * 旧版是「正在找……正在编译……」两行字。方案要求让用户感到系统真的在知乎里
 * 寻找不同的人生，但同时明确禁止假动画：
 *
 * > 只有真实完成后才能打 ✓。不能假动画。
 *
 * 所以这里的每一行都对应一个**真实信号**：
 *
 * | 行 | ✓ 的条件 |
 * |---|---|
 * | 找到与你处境相近的经历 | 检索结果里真的存在 `purposes` 含 similar-person 的片段 |
 * | 找到另一种走法 | 真的存在 alternative 的片段 |
 * | 找到一条结果相反的经历 | 真的存在 counterexample / failure 的片段 |
 *
 * 找不到的那一类**不打勾**，如实写「这一类暂时没找到」——那不是失败，
 * 而是这个产品存在的理由（宁可说没有，也不编一条）。
 *
 * ## 视觉
 *
 * 三条极淡的「人生轨迹」线；找到来源时线上亮点并缓慢亮起（§17）。
 * 没有进度百分比、没有 terminal 日志、没有技术指标。
 */

export type CompileIntentId = 'similar-person' | 'alternative' | 'counterexample';

export interface CompileStage {
  readonly id: CompileIntentId;
  readonly label: string;
  /** 真实命中数；null = 还在找。 */
  readonly found: number | null;
}

export interface WorldCompilingProps {
  readonly stages: readonly CompileStage[];
  /** `searching` 检索中 / `compiling` 已检索、正在编译世界 / `done` 可以进入。 */
  readonly phase: 'searching' | 'compiling' | 'done';
  readonly className?: string;
}

function StageRow({ stage }: { readonly stage: CompileStage }) {
  const searching = stage.found === null;
  const hit = (stage.found ?? 0) > 0;

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden="true"
        className={[
          'mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
          searching
            ? 'border-white/15 text-slate-600'
            : hit
              ? 'border-relic-jade/60 bg-relic-jade/15 text-relic-jade'
              : 'border-white/12 text-slate-600',
        ].join(' ')}
      >
        {searching ? '·' : hit ? '✓' : '—'}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            'block text-[13px] leading-relaxed',
            searching ? 'text-slate-500' : hit ? 'text-slate-200' : 'text-slate-500',
          ].join(' ')}
        >
          {stage.label}
        </span>
        <span className="mt-1 block h-px w-full bg-white/[0.07]">
          {hit ? (
            <span
              className="trajectory-dot"
              style={{ left: `${Math.min(88, 20 + (stage.found ?? 0) * 8)}%` }}
            />
          ) : null}
        </span>
        <span className="mt-1 block font-mono text-[10px] text-slate-600">
          {searching
            ? '正在找…'
            : hit
              ? `找到 ${stage.found} 条真实经历`
              : '这一类暂时没找到 —— 我们不会编一条补上'}
        </span>
      </span>
    </li>
  );
}

export function WorldCompiling({ stages, phase, className = '' }: WorldCompilingProps) {
  const headline =
    phase === 'searching'
      ? '正在寻找走过这些路的人…'
      : phase === 'compiling'
        ? '正在把这些人生编译进你的世界…'
        : '你的世界已经编译完成。';

  return (
    <section className={['mt-10', className].filter(Boolean).join(' ')} aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={[
            'h-1.5 w-1.5 rounded-full',
            phase === 'done' ? 'bg-relic-jade' : 'bg-zhihu-400 animate-pulse',
          ].join(' ')}
        />
        <p className="text-[14px] font-semibold text-slate-200">{headline}</p>
      </div>

      <ul className="mt-4">
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ul>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
        每一条都来自知乎上的真实回答，且只能逐字引用 ——
        改一个字我们就会丢掉它，宁可少一条。
      </p>
    </section>
  );
}

export default WorldCompiling;
