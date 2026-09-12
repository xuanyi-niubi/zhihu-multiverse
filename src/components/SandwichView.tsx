'use client';

import * as React from 'react';

import { verdictHeadline } from '@/core/decision/verdict';

import type {
  ConstraintProfile,
  DecisionPath,
  EvidenceMesh,
  Sandwich,
  SandwichCard,
  Verdict,
} from '@/types/evidence';

/**
 * 双牌对比（方案 §7.1 · 冲刺蓝图 §3「绝杀时刻」）。
 *
 * **这是演示视频里唯一必须拍到的镜头**：同一份证据、同一批真人经历，
 * 只因为玩家自己的约束不同，结论当场翻转。
 *
 * 三个设计决定：
 *
 * 1. **并排而不是上下**：对比必须是共时的，眼睛要能一眼扫到两边差异。
 * 2. **分歧路线高亮**：结论不同的那条路线加琥珀描边 ——
 *    这是「看点」，不能让评委自己在两列里找不同。
 * 3. **零请求**：父组件传进来的 `sandwich` 由纯函数算出，
 *    拖动滑杆时只重算不请求，因此反馈是即时的。
 */

export interface SandwichViewProps {
  readonly mesh: EvidenceMesh;
  readonly sandwich: Sandwich;
  readonly constraints: ConstraintProfile;
  readonly onConstraintsChange: (next: ConstraintProfile) => void;
  readonly renderSlider?: (props: {
    readonly constraints: ConstraintProfile;
    readonly onChange: (next: ConstraintProfile) => void;
  }) => React.ReactNode;
  /** 只显示有样本的路线（默认 true）。 */
  readonly onlyEvidenced?: boolean;
  readonly className?: string;
}

function verdictStyle(verdict: Verdict): { readonly badge: string; readonly row: string; readonly text: string } {
  switch (verdict.kind) {
    case 'viable':
      return {
        badge: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
        row: 'border-emerald-400/25',
        text: '可行',
      };
    case 'breached':
      return {
        badge: 'bg-relic-danger/15 text-rose-300 ring-relic-danger/30',
        row: 'border-relic-danger/30',
        text: '越线',
      };
    default:
      return {
        badge: 'bg-white/[0.05] text-slate-400 ring-white/12',
        row: 'border-white/10',
        text: '证据不足',
      };
  }
}

function CardColumn({
  card,
  paths,
  divergentIds,
  tone,
}: {
  readonly card: SandwichCard;
  readonly paths: readonly DecisionPath[];
  readonly divergentIds: readonly string[];
  readonly tone: 'generous' | 'tight';
}) {
  const accent = tone === 'generous' ? 'border-zhihu-500/35' : 'border-amber-400/35';
  const headerTone = tone === 'generous' ? 'text-zhihu-300' : 'text-amber-300';

  return (
    <div className={`flex min-w-0 flex-1 flex-col rounded-2xl border bg-ink-800/60 ${accent}`}>
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
        <h4 className={`text-xs font-bold tracking-wide ${headerTone}`}>{card.label}</h4>
        <span className="font-mono text-[10px] text-slate-500">
          {card.viableCount} / {card.verdicts.length} 可行
        </span>
      </header>

      <dl className="grid grid-cols-3 gap-2 border-b border-white/8 px-3.5 py-2">
        <div>
          <dt className="font-mono text-[9px] text-slate-600">可投入</dt>
          <dd className="font-mono text-xs text-slate-200">{card.constraints.runwayMonths} 月</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] text-slate-600">可亏损</dt>
          <dd className="font-mono text-xs text-slate-200">{card.constraints.drawdown}</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] text-slate-600">并肩</dt>
          <dd className="font-mono text-xs text-slate-200">{card.constraints.ally}</dd>
        </div>
      </dl>

      <ul className="flex flex-1 flex-col gap-2 p-3">
        {card.verdicts.map((item) => {
          const path = paths.find((candidate) => candidate.pathId === item.pathId);
          if (!path) {
            return null;
          }
          const style = verdictStyle(item.verdict);
          const diverges = divergentIds.includes(item.pathId);

          return (
            <li
              key={item.pathId}
              className={[
                'rounded-xl border px-3 py-2 transition-colors duration-200',
                style.row,
                diverges ? 'ring-1 ring-inset ring-amber-400/40' : '',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-xs font-semibold text-slate-100">{path.label}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${style.badge}`}>
                  {style.text}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                {verdictHeadline(item.verdict, path.label).replace(`${path.label}：`, '')}
              </p>
              <p className="mt-1 font-mono text-[9px] text-slate-600">
                {path.sampleSize > 0 ? `${path.sampleSize} 条样本` : '无样本'}
                {diverges ? ' · 两张牌结论不同' : ''}
              </p>
            </li>
          );
        })}
      </ul>

      {card.critical ? (
        <div className="border-t border-white/10 px-3.5 py-2.5">
          <p className="font-mono text-[9px] tracking-wider text-rose-300">最脆弱的一环</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{card.critical.narrative}</p>
        </div>
      ) : (
        <div className="border-t border-white/10 px-3.5 py-2.5">
          <p className="text-[10px] text-slate-500">这组条件下没有卡住的环节。</p>
        </div>
      )}
    </div>
  );
}

export function SandwichView({
  mesh,
  sandwich,
  constraints,
  onConstraintsChange,
  renderSlider,
  onlyEvidenced = true,
  className = '',
}: SandwichViewProps) {
  const paths = onlyEvidenced ? mesh.paths.filter((path) => path.sampleSize > 0) : mesh.paths;
  const { cardA, cardB, divergentPathIds } = sandwich;

  return (
    <section aria-label="双牌对比" className={`flex flex-col gap-3.5 ${className}`}>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-wide text-slate-200">同一份证据，两组条件</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            两张牌用的是同一批真人经历，唯一变量是你自己的处境。拖动下面的滑杆，看哪条路的结论会翻转。
          </p>
        </div>
        <span className="font-mono text-[10px] text-slate-600">{mesh.meshId}</span>
      </header>

      {renderSlider ? (
        <div className="rounded-2xl border border-white/12 bg-ink-800/50 p-3.5">
          {renderSlider({ constraints, onChange: onConstraintsChange })}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row">
        <CardColumn card={cardA} paths={paths} divergentIds={divergentPathIds} tone="generous" />
        <CardColumn card={cardB} paths={paths} divergentIds={divergentPathIds} tone="tight" />
      </div>

      {divergentPathIds.length > 0 ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-100">
          结论翻转的是：
          {divergentPathIds
            .map((id) => paths.find((path) => path.pathId === id)?.label ?? id)
            .join('、')}
          。这就是「换个条件，路就不一样了」的具体位置。
        </p>
      ) : (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          这两组条件下所有路线的结论都相同 —— 说明你的约束还没卡到这些路的边界上。
        </p>
      )}
    </section>
  );
}

export default SandwichView;
