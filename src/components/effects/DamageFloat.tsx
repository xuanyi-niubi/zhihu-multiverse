'use client';

import * as React from 'react';

import type { TargetStat } from '@/types/game';

/**
 * 属性飘字。
 *
 * 纯展示组件：父组件负责在 1.4s 后把对应 item 从列表里移除。
 * 数字与属性名一起飘，避免「只看到 -26 不知道扣的是什么」。
 */

const STAT_LABEL: Record<TargetStat, string> = {
  san: 'SAN',
  skill: '专业力',
  bond: '羁绊',
};

export interface FloatItem {
  readonly id: string;
  readonly stat: TargetStat;
  readonly value: number;
}

export function DamageFloat({ items }: { readonly items: readonly FloatItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-[16%] z-30 flex justify-center gap-4"
    >
      {items.map((item) => {
        const positive = item.value > 0;

        return (
          <span
            key={item.id}
            className={[
              'animate-float-up font-mono text-2xl font-black tabular-nums drop-shadow-[0_4px_14px_rgba(0,0,0,0.8)] sm:text-3xl',
              positive ? 'text-emerald-300' : 'text-rose-400',
            ].join(' ')}
          >
            {positive ? '+' : ''}
            {item.value}
            <span className="ml-1 text-xs font-bold tracking-widest opacity-80">
              {STAT_LABEL[item.stat]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default DamageFloat;
