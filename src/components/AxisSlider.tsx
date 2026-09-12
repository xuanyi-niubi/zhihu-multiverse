'use client';

import * as React from 'react';

import { AXES, clampAxis } from '@/core/decision/axis';

import type { AxisId, ConstraintProfile } from '@/types/evidence';

/**
 * 约束滑杆（冲刺蓝图 §1「把约束变成捏脸」）。
 *
 * 三条体验纪律：
 *
 * 1. **零请求**：拖动只改本地 state，裁决在父组件用纯函数重算。
 *    这是「机制裁决是纯函数」这个架构决定第一次被兑现成体验优势 ——
 *    滑杆的反馈必须感觉像在捏脸，不能像在提交问卷。
 * 2. **即时语义**：每根轴旁边实时显示「这条路还差多少」的定性提示，
 *    而不是只显示一个裸数字。
 * 3. **可访问**：原生 `input[type=range]`，键盘可调、有 focus-visible 环、
 *    `prefers-reduced-motion` 下不做过渡动画。
 */

export interface AxisSliderProps {
  readonly constraints: ConstraintProfile;
  readonly onChange: (next: ConstraintProfile) => void;
  /**
   * 每条轴当前的「最紧需求」：来自各路线的代价画像。
   * 有值时会画出需求刻度线，让玩家看见自己在往哪边挪。
   */
  readonly requirements?: Partial<Record<AxisId, number>>;
  readonly disabled?: boolean;
}

/** 玩家侧只自陈三条轴；`reversibility` 由证据决定，不在这里调。 */
const PLAYER_AXES: readonly AxisId[] = ['runway', 'drawdown', 'ally'];

const KEY_OF: Readonly<Record<AxisId, keyof ConstraintProfile>> = {
  runway: 'runwayMonths',
  drawdown: 'drawdown',
  reversibility: 'reversibility' as keyof ConstraintProfile,
  ally: 'ally',
};

/** 轴被「满足 / 欠缺」的判定：需求刻度比当前值高就是欠缺。 */
function gapLabel(axisId: AxisId, value: number, requirement: number | undefined, unit: string): string {
  if (requirement === undefined) {
    return '';
  }
  const gap = requirement - value;
  if (gap <= 0) {
    return '够用';
  }
  /*
    措辞与 `verdict.ts` 的 shortfallLabel 保持一致：**对比**而非预测。
    「与样本差 X」陈述的是「你和那些人当时差多少」；
    「还差 X」读起来像在宣告「你需要 X」—— 而那个数只来自样本上沿。
  */
  return `与样本差 ${gap}${unit}`;
}

export function AxisSlider({ constraints, onChange, requirements = {}, disabled = false }: AxisSliderProps) {
  const [activeAxis, setActiveAxis] = React.useState<AxisId | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {PLAYER_AXES.map((axisId) => {
        const axis = AXES.find((item) => item.id === axisId);
        if (!axis) {
          return null;
        }

        const key = KEY_OF[axisId];
        const value = constraints[key] as number;
        const requirement = requirements[axisId];
        const percent = axis.max === axis.min ? 0 : ((value - axis.min) / (axis.max - axis.min)) * 100;
        const reqPercent =
          requirement === undefined || axis.max === axis.min
            ? null
            : Math.min(100, Math.max(0, ((requirement - axis.min) / (axis.max - axis.min)) * 100));
        const short = requirement !== undefined && requirement > value;

        return (
          <div key={axisId} className="group">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <label
                htmlFor={`axis-${axisId}`}
                className="flex items-center gap-2 text-xs font-semibold text-slate-200"
              >
                {axis.label}
                <span className="font-mono text-[10px] font-normal text-slate-600">
                  {axis.hard ? '硬约束' : '软约束'}
                </span>
              </label>

              <span className="flex items-baseline gap-2">
                {requirement !== undefined ? (
                  <span
                    className={[
                      'font-mono text-[10px]',
                      short ? 'text-rose-300' : 'text-emerald-300/80',
                    ].join(' ')}
                  >
                    {gapLabel(axisId, value, requirement, axis.unit)}
                  </span>
                ) : null}
                <span className="font-mono text-sm font-bold tabular-nums text-slate-100">
                  {value}
                  <span className="ml-0.5 text-[10px] font-normal text-slate-500">{axis.unit}</span>
                </span>
              </span>
            </div>

            {/* 轨道：底色 + 已填 + 需求刻度 + 指示游标 */}
            <div className="relative h-7">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={[
                    'h-full rounded-full transition-[width] duration-150 ease-out',
                    short ? 'bg-gradient-to-r from-relic-danger/70 to-rose-400' : 'bg-gradient-to-r from-zhihu-500 to-zhihu-300',
                    activeAxis === axisId ? 'brightness-125' : '',
                  ].join(' ')}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {reqPercent !== null ? (
                <div
                  className="pointer-events-none absolute top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-amber-300/90 shadow-[0_0_8px_rgba(245,184,65,0.8)]"
                  style={{ left: `${reqPercent}%` }}
                  aria-hidden="true"
                  title={`该路线的需求：${requirement}${axis.unit}`}
                />
              ) : null}

              <input
                id={`axis-${axisId}`}
                type="range"
                min={axis.min}
                max={axis.max}
                step={1}
                value={value}
                disabled={disabled}
                aria-label={`${axis.label}（${axis.hint}）`}
                aria-valuetext={`${value}${axis.unit}`}
                onFocus={() => setActiveAxis(axisId)}
                onBlur={() => setActiveAxis(null)}
                onPointerDown={() => setActiveAxis(axisId)}
                onPointerUp={() => setActiveAxis(null)}
                onChange={(event) => {
                  const next = clampAxis(axisId, Number(event.target.value));
                  onChange({ ...constraints, [key]: next });
                }}
                className="absolute inset-0 h-7 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/70 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.6)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 hover:[&::-webkit-slider-thumb]:scale-110 focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-zhihu-500 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/70 [&::-moz-range-thumb]:bg-white focus-visible:outline-none"
              />
            </div>

            <p
              className={[
                'mt-0.5 text-[10px] leading-relaxed transition-colors duration-150',
                activeAxis === axisId ? 'text-slate-400' : 'text-slate-600',
              ].join(' ')}
            >
              {axis.hint}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default AxisSlider;
