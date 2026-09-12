'use client';

import * as React from 'react';

import type { AxisDelta, DrawnEvent } from '@/core/run/events/eventTypes';

/**
 * 命运事件卡（v3 §6）。
 *
 * ## 视觉纪律：它必须**小**
 *
 * 主舞台永远留给「谁在对你说话」（第一部分 §5 的舞台优先原则）。
 * 事件卡是**一层叠加信息**，因此：
 * - 只有一行标题 + 一行钩子 + 一行轴影响；
 * - 不折叠、不展开、不抢点击；
 * - 出现时轻微滑入，之后静止（不做持续动画）。
 *
 * ## 它必须说清「谁造成的」
 *
 * 四轴变化旁边标注**遭遇**与**命运**两个来源，
 * 让玩家能区分「这是我的选择造成的」还是「这是我遇到的事造成的」——
 * 这正是 v3「随机决定遭遇，不决定真相」在界面上的可读形式。
 */

export interface EventCardProps {
  readonly drawn: DrawnEvent | null;
  readonly className?: string;
}

const AXIS_LABEL: Readonly<Record<string, string>> = {
  runway: '时间余量',
  drawdown: '承压能力',
  reversibility: '回头空间',
  ally: '同行者',
};

const RARITY_TONE: Readonly<Record<DrawnEvent['event']['rarity'], string>> = {
  common: 'border-white/12',
  rare: 'border-zhihu-500/40',
  critical: 'border-amber-400/45',
};

const RARITY_LABEL: Readonly<Record<DrawnEvent['event']['rarity'], string>> = {
  common: '寻常遭遇',
  rare: '少见遭遇',
  critical: '罕见遭遇',
};

/** 轴影响的可读化：只给方向与幅度，不给裸数字焦虑。 */
function deltaLines(applied: AxisDelta): readonly { readonly label: string; readonly text: string; readonly up: boolean }[] {
  const out: { label: string; text: string; up: boolean }[] = [];
  for (const [axis, value] of Object.entries(applied)) {
    if (typeof value !== 'number' || value === 0) {
      continue;
    }
    const up = value > 0;
    const magnitude = Math.abs(value);
    out.push({
      label: AXIS_LABEL[axis] ?? axis,
      text: `${up ? '↑' : '↓'} ${magnitude}`,
      up,
    });
  }
  return out;
}

export function EventCard({ drawn, className = '' }: EventCardProps) {
  if (!drawn) {
    return null;
  }

  const deltas = deltaLines(drawn.applied);

  return (
    <aside
      aria-label="命运事件"
      className={[
        'rounded-2xl border bg-ink-800/70 px-3.5 py-2.5 backdrop-blur-sm',
        'animate-rise-in',
        RARITY_TONE[drawn.event.rarity],
        className,
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[9px] tracking-[0.2em] text-slate-500">遭遇</span>
          <span className="text-[13px] font-bold text-slate-100">{drawn.event.title}</span>
        </span>
        <span className="shrink-0 font-mono text-[9px] text-slate-600">
          {RARITY_LABEL[drawn.event.rarity]}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{drawn.event.narrativeHook}</p>

      {deltas.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
          {deltas.map((delta) => (
            <span key={delta.label} className={delta.up ? 'text-emerald-300' : 'text-rose-300'}>
              {delta.label} {delta.text}
            </span>
          ))}
        </p>
      ) : null}

      {/*
        这一行是 v3 世界观的界面表达：
        遭遇与命运共同改变你的**条件**，但**不改变这条路是否成立**。
      */}
      <p className="mt-1.5 border-t border-white/8 pt-1.5 text-[10px] leading-relaxed text-slate-500">
        {drawn.tone === 'mishap'
          ? '这次遭遇偏不顺，代价被放大了。'
          : drawn.tone === 'breakthrough'
            ? '这次遭遇带来转机，负面的部分被抵消了。'
            : drawn.tone === 'fortunate'
              ? '这次遭遇带来了助力。'
              : '事情按预想的发展。'}
        <span className="text-slate-600"> 遭遇只改变你的条件，不改变这条路是否成立。</span>
      </p>
    </aside>
  );
}

export default EventCard;
