'use client';

import * as React from 'react';

import { CelestialBackdrop } from '@/components/visual/CelestialBackdrop';
import { FragmentShard, type FragmentCategory } from '@/components/visual/FragmentShard';
import { Undeveloped } from '@/components/visual/Undeveloped';
import type { CelestialTrackState } from '@/features/visual/celestial';

/**
 * World Forge —— 世界编译场景（04_AGENT §16 / §17 / §18 / §20）。
 *
 * ## 画面（§17）
 *
 * ```text
 * 中央：用户问题
 * 外围：similar orbit / alternative orbit / counter orbit
 * 真实数据到达时：Fragment Shard materialize
 * ```
 *
 * ## 只说真的发生的事（§18）
 *
 * 允许出现的状态只有五句，全部是真实阶段：
 *
 * ```text
 * 正在理解你的处境
 * 正在寻找相似人生
 * 正在寻找另一种走法
 * 正在寻找相反结果
 * 正在编译你的世界
 * ```
 *
 * 禁止假百分比、禁止假的命中人数。所以这里的每一条「找到 N 条」都来自
 * 服务端返回的真实片段数；没找到就如实写「这一类暂时没找到」。
 *
 * ## 收束（§20）
 *
 * 三轨向中央收束 → 短暂连接成几何 → `WORLD READY`（<= 450ms）。
 *
 * 视觉组件不得 fetch API（§7）：它只接收已经算好的 `stages` / `fragments`。
 */

export type ForgePhase = 'understanding' | 'searching' | 'assembling' | 'ready';

export type ForgeStageId = 'similar-person' | 'alternative' | 'counterexample';

export interface ForgeStage {
  readonly id: ForgeStageId;
  /** 真实命中数；null = 还没拿到结果。 */
  readonly found: number | null;
}

export interface ForgeShard {
  readonly id: string;
  readonly sourceId?: string;
  readonly quote: string;
  readonly title?: string | null;
  readonly sourceEditTime?: number | null;
  readonly relevance?: number;
  readonly qualification?: import('@/features/experience/domain').SourceQualification;
  readonly sourceLabel: string;
  readonly category: FragmentCategory;
  /**
   * 这条切片能点回的原回答地址（来自 `ExperienceFact.sourceUrl`）。
   *
   * 在编译页去掉自动跳转之前，碎片只是「已找到」的证据，不需要出路；
   * 现在玩家会停在这一屏，所以必须能点回原文 —— 没有链接的经验等于传说。
   * 缺失时为 null：**不伪造一个链接**，详情里如实说明。
   */
  readonly sourceUrl?: string | null;
}

export interface WorldForgeProps {
  readonly question: string;
  readonly stages: readonly ForgeStage[];
  readonly phase: ForgePhase;
  readonly fragments: readonly ForgeShard[];
  /** 编译完成后交给调用方的真实总数（用于「进入 Play」的那一步）。 */
  readonly className?: string;
  /** 点了某条切片：开那条的详情（完整逐字原文 + 回原文的出路）。 */
  readonly onSelectFragment?: (fragmentId: string) => void;
  /** 详情当前开的是哪一条：给它一次选中反馈。 */
  readonly selectedFragmentId?: string | null;
}

/** §18 允许的固定文案：三类检索意图各自一句。 */
export const FORGE_STAGE_TEXT: Readonly<Record<ForgeStageId, string>> = {
  'similar-person': '正在寻找相似人生',
  alternative: '正在寻找另一种走法',
  counterexample: '正在寻找相反结果',
};

/** §18 允许的固定文案：阶段本身。合起来正好是那五句话。 */
export const FORGE_PHASE_TEXT: Readonly<Record<ForgePhase, string>> = {
  understanding: '正在理解你的处境',
  searching: '正在寻找相似人生',
  assembling: '正在编译你的世界',
  ready: 'WORLD READY',
};

function celestialTrackOf(stage: ForgeStage): CelestialTrackState {
  if (stage.id === 'similar-person') return { id: 'similar', found: stage.found };
  if (stage.id === 'alternative') return { id: 'alternative', found: stage.found };
  return { id: 'counter', found: stage.found };
}

function stageCaption(phase: ForgePhase, stage: ForgeStage): string {
  if (phase === 'understanding') {
    return '正在理解你的处境';
  }
  if (stage.found === null) {
    return FORGE_STAGE_TEXT[stage.id];
  }
  if (stage.found === 0) {
    return '这一类暂时没找到 —— 我们不会编一条补上';
  }
  return `找到 ${stage.found} 位可核验亲历者`;
}

export function WorldForge({
  question,
  stages,
  phase,
  fragments,
  className = '',
  onSelectFragment,
  selectedFragmentId = null,
}: WorldForgeProps) {
  const foundTotal = stages.reduce((sum, stage) => sum + (stage.found ?? 0), 0);
  const ready = phase === 'ready';
  const celestialTracks = stages.map(celestialTrackOf);

  return (
    <section
      aria-live="polite"
      className={[
        'sil-forge sil-panel sil-brackets relative overflow-hidden px-5 py-7 sm:px-8 sm:py-9',
        `sil-forge--${phase}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-forge-phase={phase}
    >
      <CelestialBackdrop scene="retrieving" tracks={celestialTracks} />

      <div className="relative z-[1]">
        <p className="sil-label">The World Forge</p>

        {/* 外围是哪三条轨道，直接写在仪器上（§17），用统一的三意图徽标（DS §4.6） */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="sil-mark sil-mark--zhihu">Similar orbit · 与你相似</span>
          <span className="sil-mark sil-mark--alternate">Alternative orbit · 另一种走法</span>
          <span className="sil-mark sil-mark--counter">Counter orbit · 相反结果</span>
        </div>

        {/* 中央：用户问题 */}
        <h1 className="sil-forge__question mt-4 text-[20px] font-semibold leading-relaxed text-[color:var(--sil-ink-100)] sm:text-[24px]">
          {question}
        </h1>

        <p
          className={[
            'sil-forge__caption mt-3 text-meta leading-relaxed text-[color:var(--sil-ink-200)]',
            ready ? 'sil-forge__ready text-[color:var(--sil-ink-100)]' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {FORGE_PHASE_TEXT[phase]}
          {ready ? <span className="ml-2 text-[color:var(--sil-ink-300)]">· {foundTotal} 位可核验亲历者</span> : null}
        </p>

        {/* 三条轨道的此刻：只写真实状态（§18） */}
        <ul className="mt-5 flex flex-col gap-2">
          {stages.map((stage) => {
            const hit = (stage.found ?? 0) > 0;
            return (
              <li key={stage.id} className="flex items-baseline gap-3">
                <span
                  aria-hidden="true"
                  className={
                    hit
                      ? 'text-[color:var(--sil-alternate-soft)]'
                      : 'text-[color:var(--sil-ink-300)]'
                  }
                >
                  {stage.found === null ? '·' : hit ? '◆' : '—'}
                </span>
                <span className="text-meta leading-relaxed text-[color:var(--sil-ink-200)]">
                  {FORGE_STAGE_TEXT[stage.id]}
                </span>
                {/* 找不到就是找不到：用未显影语法，不补一条、不假装 */}
                {stage.found === 0 ? (
                  <Undeveloped className="ml-auto" label="这一类暂时没找到">
                    不会编一条补上
                  </Undeveloped>
                ) : (
                  <span className="sil-label sil-label--sm ml-auto text-right">{stageCaption(phase, stage)}</span>
                )}
              </li>
            );
          })}
        </ul>

        {/* 真实数据到达 → 碎片归位（§17 / §19） */}
        {fragments.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {fragments.slice(0, 6).map((fragment, index) => (
              <FragmentShard
                key={fragment.id}
                quote={fragment.quote}
                sourceLabel={fragment.sourceLabel}
                category={fragment.category}
                state="materialized"
                className="sm:col-span-1"
                /*
                  可点：编译页是玩家真正会停留的一屏，碎片必须能展开成
                  完整逐字原文并给出回原文的出路。不传 onSelect 时组件
                  退回原来的静态 article，行为不变。
                */
                {...(onSelectFragment
                  ? {
                      onSelect: () => onSelectFragment(fragment.id),
                      selected: selectedFragmentId === fragment.id,
                    }
                  : {})}
                // 齐次错位，避免六块同时出现（性能与节奏）
                style={{ animationDelay: `${Math.min(index, 5) * 90}ms` }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default WorldForge;
