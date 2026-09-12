'use client';

import * as React from 'react';

import { allSignalItems, stripItems, type SignalItem } from '@/core/run/signalText';

import type { WorldState } from '@/core/run/worldState';

/**
 * 隐藏信号条。
 *
 * 产品约定：**只显示定性信号，不显示裸数值。**「身体开始报警」可以给玩家看，
 * `bodyAlarm=63` 不行 —— 后者会把推演变成看仪表盘。
 *
 * 平时只占一行（仅在出现需要提醒的信号时渲染），点右侧「状态」展开看全部五项。
 * 展开态同样只有定性文案，没有进度条与百分比。
 */

const TONE_CLASS: Record<SignalItem['tone'], string> = {
  calm: 'border-white/10 bg-white/[0.02] text-slate-400',
  watch: 'border-white/12 bg-white/[0.03] text-slate-300',
  warn: 'border-amber-400/40 bg-amber-400/[0.07] text-amber-200',
  danger: 'border-relic-danger/45 bg-relic-danger/[0.08] text-relic-danger',
};

function SignalChip({ item }: { readonly item: SignalItem }) {
  return (
    <span
      className={[
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-none',
        TONE_CLASS[item.tone],
      ].join(' ')}
    >
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{item.text}</span>
    </span>
  );
}

export interface HiddenSignalStripProps {
  readonly world: WorldState;
  /**
   * 额外信号（心理状态 / 现实锚点）。
   *
   * 这些来自世界模型，与五个隐藏状态同属"只给定性、不露数值"的通道，
   * 所以直接拼在同一条里，不另开一套视觉语言。
   */
  readonly extra?: readonly string[];
  readonly className?: string;
}

export function HiddenSignalStrip({ world, extra = [], className }: HiddenSignalStripProps) {
  const [expanded, setExpanded] = React.useState(false);

  const alerts = stripItems(world);
  const items = expanded ? allSignalItems(world) : alerts;

  // 没有需要提醒的信号、也没展开、也没有额外信号时，不占版面
  if (items.length === 0 && extra.length === 0) {
    return null;
  }

  return (
    <div className={['flex flex-wrap items-center gap-1.5', className].filter(Boolean).join(' ')}>
      <span className="font-mono text-[9px] tracking-[0.2em] text-slate-600">SIGNALS</span>

      {/* aria-live：状态变化时读出定性信号（而不是数字） */}
      <span role="status" aria-live="polite" className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => (
          <SignalChip key={item.key} item={item} />
        ))}
        {extra.map((text) => (
          <span
            key={text}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/[0.07] px-2 py-1 text-[11px] leading-none text-amber-200"
          >
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            <span className="truncate">{text}</span>
          </span>
        ))}
      </span>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 transition-colors duration-150 hover:text-slate-300"
      >
        {expanded ? '收起' : '状态'}
      </button>
    </div>
  );
}

export default HiddenSignalStrip;
