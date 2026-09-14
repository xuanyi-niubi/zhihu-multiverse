'use client';

import * as React from 'react';

import { WorldCompileScene } from '@/components/visual/WorldCompileScene';
import {
  COMPILE_SUBTITLE,
  type ArchivePhase,
  type FragmentTrack,
} from '@/features/visual/archive';

/**
 * World Compiling —— 把「等待」做成体验点，而不是缺陷（报告 §7 / §8 / §9 / §26.3）。
 *
 * ## 核心纪律：**只显示真的发生了的事**
 *
 * 报告 §7 要求屏幕边缘逐渐出现真实 exactQuote 短片段，但同一份报告与
 * 产品宪法都禁止假动画。所以这里的每一行/每个亮点都对应一个**真实信号**：
 *
 * | 信号 | 真实来源 |
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
 * 三条极淡的「人生轨道」在 `WorldCompileScene` 里汇聚成一个点；
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

const TRACK_OF: Readonly<Record<CompileIntentId, FragmentTrack>> = {
  'similar-person': 'similar',
  alternative: 'alternative',
  counterexample: 'counter',
};

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
            ? 'border-white/15 text-archive-600'
            : hit
              ? 'border-unlock/60 bg-unlock/15 text-unlock'
              : 'border-white/12 text-archive-600',
        ].join(' ')}
      >
        {searching ? '·' : hit ? '✓' : '—'}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            'block text-[13px] leading-relaxed',
            searching ? 'text-archive-600' : hit ? 'text-archive-200' : 'text-archive-600',
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
        <span className="mt-1 block font-mono text-[10px] text-archive-600">
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
  const ready = phase === 'done';
  const archivePhase: ArchivePhase = ready ? 'ready' : 'searching';
  const title = ready ? 'WORLD READY' : 'WORLD COMPILING';
  const subtitle = ready ? '这些真实人生已经归入这一局。' : COMPILE_SUBTITLE;

  const tracks = stages.map((stage) => ({
    id: TRACK_OF[stage.id],
    label: stage.label,
    count: stage.found,
  }));

  const foundTotal = stages.reduce((sum, stage) => sum + (stage.found ?? 0), 0);

  return (
    <section className={['mt-8', className].filter(Boolean).join(' ')} aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[20px] font-black tracking-[0.06em] text-archive-100 sm:text-[24px]"
          style={ready ? { animation: 'arc-fragment-arrive 620ms var(--arc-ease) both' } : undefined}
        >
          {title}
        </h2>
        <span className="font-mono text-[10px] tracking-[0.2em] text-archive-600">
          {ready ? `${foundTotal} 段真实经历` : 'SEARCHING'}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-archive-400">{subtitle}</p>

      <WorldCompileScene tracks={tracks} phase={archivePhase} className="mt-4" />

      {/* 每一条轨道此刻到底找到没有 —— 只写真实状态 */}
      <ul className="mt-2">
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-archive-600">
        每一条都来自知乎上的真实回答，且只能逐字引用 ——
        改一个字我们就会丢掉它，宁可少一条。
      </p>
    </section>
  );
}

export default WorldCompiling;
