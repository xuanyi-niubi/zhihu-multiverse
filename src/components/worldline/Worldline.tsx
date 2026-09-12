'use client';

import * as React from 'react';

/**
 * 世界线组件库（v3 §9 / §23 P1-4）。
 *
 * ## 为什么必须是一套共用组件
 *
 * v3 §17 的视觉纪律要求：**世界线是贯穿所有页面的第一视觉语言**。
 * 如果 `/`、`/play`、`/compare`、`/commitment` 各画一条线，
 * 它们迟早会长成四种不同的东西 —— 那就退化成「几个页面各有个装饰」，
 * 而不是一个作品的世界观母题。
 *
 * 因此几何、配色、状态语义都在这里**只定义一次**：
 *
 * | 组件 | 用途 | 出现页面 |
 * |---|---|---|
 * | `WorldlineTrack` | 一条线本身（几何 + 状态着色） | 全部 |
 * | `WorldlineRail` | 幕次节点轨（起点→终局） | `/play` |
 * | `WorldlineBranch` | 分叉（A / B 两条世界线） | `/compare`、`/` |
 * | `WorldlinePierce` | 穿过第四面墙进入现实 | `/commitment` |
 * | `CriticalFlip` | 翻转瞬间的一次性演出 | `/compare`、`/play` |
 *
 * ## 状态语义（v3 §17.2 的配色纪律）
 *
 * | 状态 | 颜色 | 含义 |
 * |---|---|---|
 * | `stable` | 冷白／青白 | 世界线成立（VIABLE） |
 * | `unstable` | 琥珀 | 有压力但还站得住 |
 * | `breached` | 深红 | 撞上现实边界（BREACHED） |
 * | `unknown` | 灰 | 证据不足，**不给结论**（不是失败，也不是成功） |
 *
 * 关键的诚实性约束：**`unknown` 永远不能渲染成绿色**。
 * 「不知道」被画成「通过」是这个作品最容易犯、也最致命的视觉错误。
 */

export type WorldlineState = 'stable' | 'unstable' | 'breached' | 'unknown';

interface StateTone {
  readonly stroke: string;
  readonly glow: string;
  readonly text: string;
  readonly label: string;
}

/** **唯一配色事实源**：所有世界线组件都从这里取色。 */
export const WORLDLINE_TONE: Readonly<Record<WorldlineState, StateTone>> = {
  stable: {
    stroke: '#CFE8FF',
    glow: 'rgba(207,232,255,0.55)',
    text: 'text-zhihu-100',
    label: '成立',
  },
  unstable: {
    stroke: '#F5B841',
    glow: 'rgba(245,184,65,0.5)',
    text: 'text-amber-300',
    label: '吃紧',
  },
  breached: {
    stroke: '#FF4D6D',
    glow: 'rgba(255,77,109,0.6)',
    text: 'text-rose-300',
    label: '断裂',
  },
  unknown: {
    stroke: '#7C8CA6',
    glow: 'rgba(124,140,166,0.35)',
    text: 'text-slate-400',
    label: '未知',
  },
};

/** 由裁决三态推出世界线状态（**唯一映射点**，避免各页各判一次）。 */
export function worldlineStateOf(verdict: {
  readonly kind: 'viable' | 'breached' | 'unknown';
  readonly margin?: number;
}): WorldlineState {
  if (verdict.kind === 'unknown') {
    return 'unknown';
  }
  if (verdict.kind === 'breached') {
    return 'breached';
  }
  // 可行但余量很紧 → 琥珀：让「勉强站住」在视觉上也是一个状态
  return (verdict.margin ?? 99) <= 2 ? 'unstable' : 'stable';
}

/* -------------------------------------------------------------------------- */
/* 一条线                                                                      */
/* -------------------------------------------------------------------------- */

export interface WorldlineTrackProps {
  readonly state: WorldlineState;
  /** 0..1：线的「生长」进度。1 = 完整。用于入场与翻转动画。 */
  readonly progress?: number;
  /** 是否断裂（画成虚线 + 缺口）。 */
  readonly broken?: boolean;
  readonly height?: number;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/**
 * 一条世界线。
 *
 * 用 SVG 而不是 CSS border，是因为**断裂必须是一个几何事实**：
 * 缺口、错位、噪声都要画得出来。用边框做不出「这条线断在这里」。
 */
export function WorldlineTrack({
  state,
  progress = 1,
  broken = false,
  height = 40,
  className = '',
  ariaLabel,
}: WorldlineTrackProps) {
  const tone = WORLDLINE_TONE[state];
  const clamped = Math.min(1, Math.max(0, progress));
  const width = 1000;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={ariaLabel ?? `世界线状态：${tone.label}`}
    >
      <defs>
        <filter id={`wl-glow-${state}`} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 底轨：让「线长到哪」有参照 */}
      <line
        x1="0"
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke="rgba(255,255,255,0.07)"
        strokeWidth="1"
      />

      {/*
        主线：`pathLength` 固定为 1，因此可以用 strokeDasharray 表达生长进度，
        不需要测量真实长度（这与动画的确定性有关：同一个 progress 必得同一画面）。
      */}
      <line
        x1="0"
        y1={height / 2}
        x2={width * clamped}
        y2={height / 2}
        stroke={tone.stroke}
        strokeWidth={broken ? 2 : 2.4}
        strokeLinecap="round"
        strokeDasharray={broken ? '10 8' : undefined}
        filter={`url(#wl-glow-${state})`}
        opacity={state === 'unknown' ? 0.55 : 0.95}
      />

      {/* 断裂：在线尾画一道错位缺口，让「断」是几何可见的 */}
      {broken && clamped > 0.02 ? (
        <g>
          <line
            x1={width * clamped - 14}
            y1={height / 2 - 7}
            x2={width * clamped + 4}
            y2={height / 2 + 9}
            stroke={tone.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.9"
          />
          <circle cx={width * clamped} cy={height / 2} r="3.2" fill={tone.stroke} opacity="0.9" />
        </g>
      ) : null}

      {/* 生长端的光点：让「线正在长」可被看见 */}
      {clamped > 0 && clamped < 1 ? (
        <circle cx={width * clamped} cy={height / 2} r="4" fill={tone.stroke} opacity="0.85" />
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 幕次节点轨（/play）                                                          */
/* -------------------------------------------------------------------------- */

export interface WorldlineRailProps {
  readonly totalActs: number;
  readonly currentAct: number;
  readonly state: WorldlineState;
  /** 已失稳的幕次（该节点起，后面的节点模糊）。 */
  readonly unstableFrom?: number | null;
  readonly className?: string;
}

/**
 * 幕次节点轨（v3 §9.2）。
 *
 * ```
 * 起点 ──●────●────●────●── 终局
 *        幕1   幕2   幕3
 * ```
 *
 * §9.2 要求「如果世界线失稳：后续节点模糊、线出现噪声」——
 * 这里用**节点透明度 + 虚线**表达，而不是加噪声纹理
 * （后者会引入持续动画，违反 §18「其余全部普通 transition」）。
 */
export function WorldlineRail({
  totalActs,
  currentAct,
  state,
  unstableFrom = null,
  className = '',
}: WorldlineRailProps) {
  const tone = WORLDLINE_TONE[state];
  const acts = Array.from({ length: Math.max(1, totalActs) }, (_, index) => index + 1);
  const progress = Math.min(1, Math.max(0, currentAct / Math.max(1, totalActs)));

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-500">起点</span>
        <span className={`font-mono text-[10px] ${tone.text}`}>
          第 {currentAct} / {totalActs} 幕 · {tone.label}
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-500">终局</span>
      </div>

      <div className="relative mt-1.5 h-7">
        {/* 轨道：已走过的部分实线，未走的虚线 */}
        <svg
          viewBox="0 0 1000 28"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <line
            x1="0"
            y1="14"
            x2={1000 * progress}
            y2="14"
            stroke={tone.stroke}
            strokeWidth="2"
            opacity="0.9"
          />
          <line
            x1={1000 * progress}
            y1="14"
            x2="1000"
            y2="14"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
            strokeDasharray="6 8"
          />
        </svg>

        {/* 节点 */}
        <ol className="absolute inset-0 flex items-center">
          {acts.map((act) => {
            const passed = act < currentAct;
            const current = act === currentAct;
            const dimmed = unstableFrom !== null && act > unstableFrom;

            return (
              <li
                key={act}
                className="flex flex-1 items-center"
                style={{ justifyContent: act === 1 ? 'flex-start' : act === acts.length ? 'flex-end' : 'center' }}
              >
                <span
                  aria-current={current ? 'step' : undefined}
                  title={`第 ${act} 幕`}
                  className={[
                    'inline-block rounded-full border transition-all duration-300',
                    current ? 'h-3 w-3' : 'h-2 w-2',
                    dimmed ? 'opacity-35' : '',
                  ].join(' ')}
                  style={{
                    borderColor: current || passed ? tone.stroke : 'rgba(255,255,255,0.22)',
                    background: current ? tone.stroke : passed ? 'transparent' : 'transparent',
                    boxShadow: current ? `0 0 10px ${tone.glow}` : undefined,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 分叉（/compare、/）                                                          */
/* -------------------------------------------------------------------------- */

export interface WorldlineBranchProps {
  readonly leftState: WorldlineState;
  readonly rightState: WorldlineState;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly height?: number;
  readonly className?: string;
}

/**
 * 分叉（v3 §9.3 / §14）：
 *
 * ```
 *              当前现实
 *                 ●
 *            ╱         ╲
 *         世界 A      世界 B
 * ```
 *
 * 两条线**从同一个原点出发**——这是「同一份证据、唯一变量是你的条件」
 * 在视觉上的表达。如果两个分支各画各的原点，对比就失去了意义。
 */
export function WorldlineBranch({
  leftState,
  rightState,
  leftLabel,
  rightLabel,
  height = 76,
  className = '',
}: WorldlineBranchProps) {
  const left = WORLDLINE_TONE[leftState];
  const right = WORLDLINE_TONE[rightState];

  return (
    <div className={className}>
      <svg
        viewBox="0 0 1000 76"
        preserveAspectRatio="none"
        className="h-[76px] w-full"
        role="img"
        aria-label={`两条世界线：${leftLabel} ${left.label}，${rightLabel} ${right.label}`}
      >
        {/* 原点 */}
        <circle cx="500" cy="10" r="4" fill="#CFE8FF" />
        <circle cx="500" cy="10" r="9" fill="rgba(207,232,255,0.18)" />

        {/* 左支 */}
        <path
          d="M500 10 C 500 36, 380 44, 220 66"
          fill="none"
          stroke={left.stroke}
          strokeWidth="2.2"
          strokeDasharray={leftState === 'breached' ? '10 8' : undefined}
          opacity="0.95"
        />
        {/* 右支 */}
        <path
          d="M500 10 C 500 36, 620 44, 780 66"
          fill="none"
          stroke={right.stroke}
          strokeWidth="2.2"
          strokeDasharray={rightState === 'breached' ? '10 8' : undefined}
          opacity="0.95"
        />

        <circle cx="220" cy="66" r="4" fill={left.stroke} />
        <circle cx="780" cy="66" r="4" fill={right.stroke} />
      </svg>

      <div className="-mt-4 flex items-baseline justify-between">
        <span className={`text-[11px] font-semibold ${left.text}`}>{leftLabel}</span>
        <span className={`text-[11px] font-semibold ${right.text}`}>{rightLabel}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 第四面墙（/commitment）                                                      */
/* -------------------------------------------------------------------------- */

export interface WorldlinePierceProps {
  readonly state?: WorldlineState;
  readonly className?: string;
  /** 现实那一侧的文字（通常是七天实验）。 */
  readonly realityLabel?: string;
}

/**
 * 世界线延伸到现实（v3 §9.4）：
 *
 * ```
 * 游戏宇宙 ───────┆──────→ 现实实验
 *                 ↑
 *              第四面墙
 * ```
 *
 * 这条线是全站唯一一处**纵向**的世界线 —— 它用「穿过一道竖线」
 * 表达「这个游戏的结果会走出游戏」，因此不复用横向轨道。
 */
export function WorldlinePierce({
  state = 'stable',
  className = '',
  realityLabel = '现实实验',
}: WorldlinePierceProps) {
  const tone = WORLDLINE_TONE[state];

  return (
    <div className={className}>
      <svg
        viewBox="0 0 1000 60"
        preserveAspectRatio="none"
        className="h-[60px] w-full"
        role="img"
        aria-label={`世界线穿过第四面墙进入${realityLabel}`}
      >
        <line x1="0" y1="30" x2="500" y2="30" stroke={tone.stroke} strokeWidth="2.2" opacity="0.95" />

        {/* 第四面墙 */}
        <line
          x1="500"
          y1="4"
          x2="500"
          y2="56"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />

        {/* 穿过之后：线变虚，表示它已不在游戏里 */}
        <line
          x1="500"
          y1="30"
          x2="1000"
          y2="30"
          stroke={tone.stroke}
          strokeWidth="1.6"
          strokeDasharray="7 7"
          opacity="0.7"
        />
        <circle cx="500" cy="30" r="4.5" fill={tone.stroke} />
      </svg>

      <div className="-mt-5 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-500">游戏宇宙</span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-400">{realityLabel}</span>
      </div>
    </div>
  );
}
