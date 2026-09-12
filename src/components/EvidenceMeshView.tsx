'use client';

import * as React from 'react';

import { verdictFor, verdictHeadline } from '@/core/decision/verdict';
import { gradeLabel } from '@/core/evidence/strength';
import { EvidenceRecord } from '@/components/archive/EvidenceRecord';
import { sourceBadgeLabel } from '@/features/run/knowledgeSource';

import type { ConstraintProfile, DecisionPath, EvidenceMesh, PathCard, Verdict } from '@/types/evidence';

/**
 * 证据网格视图（方案 §5 + §11.1「证据应力条」）。
 *
 * 这是「知乎从装饰变成出处」在界面上的唯一落点，因此有三条硬性 UI 约束：
 *
 * 1. **分母必须可见**：每条路线都显示「几条样本 + 证据档位」。
 *    没有分母的结论等于没有结论。
 * 2. **数值必须可点开**：赞同数只出现在 `verified` 卡片上，且点击展开
 *    能看到答主、抓取日期、原回答链接（复用 `sourceBadgeLabel` 的唯一执行点）。
 * 3. **空网格必须诚实**：没有任何样本时显示「证据不足」，
 *    绝不留白让读者以为加载失败，也绝不填剧本数据。
 */

export interface EvidenceMeshViewProps {
  readonly mesh: EvidenceMesh;
  readonly constraints: ConstraintProfile;
  readonly onPickPath?: (pathId: string) => void;
  readonly onTraceCard?: (card: PathCard) => void;
  /** 只显示有样本的路线（对比页用），默认为 true。 */
  readonly onlyEvidenced?: boolean;
  readonly className?: string;
}

const PROVENANCE_LABEL: Record<EvidenceMesh['provenance'], { text: string; tone: string }> = {
  'zhihu-search': { text: '知乎站内检索', tone: 'text-zhihu-300' },
  snapshot: { text: '落盘快照', tone: 'text-emerald-300' },
  demo: { text: '无检索结果', tone: 'text-slate-500' },
};

function VerdictBadge({ verdict }: { readonly verdict: Verdict }) {
  const style =
    verdict.kind === 'viable'
      ? 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30'
      : verdict.kind === 'breached'
        ? 'bg-relic-danger/15 text-rose-300 ring-relic-danger/30'
        : 'bg-white/[0.05] text-slate-400 ring-white/12';

  const text =
    verdict.kind === 'viable'
      ? verdict.margin <= 2
        ? '可行·很紧'
        : '可行'
      : verdict.kind === 'breached'
        ? '越线'
        : '证据不足';

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${style}`}>
      {text}
    </span>
  );
}

/** 证据应力条：左端「证据薄弱」→ 右端「有据」，游标停在强度上。 */
function EvidenceStressBar({ path }: { readonly path: DecisionPath }) {
  const percent = Math.round(path.evidenceStrength * 100);
  const tone =
    path.grade === 'strong'
      ? 'from-emerald-400 to-emerald-300'
      : path.grade === 'partial'
        ? 'from-amber-400 to-amber-300'
        : 'from-slate-600 to-slate-500';

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] text-slate-600">证据薄弱</span>
        <span className="font-mono text-[10px] text-slate-500">
          {path.sampleSize} 条样本 · {gradeLabel(path.grade)}
        </span>
        <span className="font-mono text-[10px] text-slate-600">有据</span>
      </div>
      <div
        role="meter"
        aria-label={`${path.label} 的证据强度`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone} transition-[width] duration-300 ease-out`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

/* CardRow 已移除（v3 §12）：证据不再以「字段列表」呈现，
   改为 components/archive/EvidenceRecord 的档案形态 ——
   编号 / 年份 / 可信度条 / UNKNOWN 大胆显示。 */

function PathBlock({
  path,
  verdict,
  onPickPath,
  onTraceCard,
}: {
  readonly path: DecisionPath;
  readonly verdict: Verdict;
  readonly onPickPath?: (pathId: string) => void;
  readonly onTraceCard?: (card: PathCard) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const grade = path.grade;

  return (
    <article
      className={[
        'rounded-2xl border bg-ink-800/60 p-3.5 transition-colors duration-200',
        grade === 'thin' ? 'border-white/8 opacity-70' : 'border-white/12 hover:border-zhihu-500/35',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            {path.label}
            {grade === 'thin' ? (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] font-normal text-slate-500">
                证据不足
              </span>
            ) : null}
          </h4>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{path.summary}</p>
        </div>
        <VerdictBadge verdict={verdict} />
      </header>

      <EvidenceStressBar path={path} />

      <p className="mt-2 text-[11px] text-slate-400">{verdictHeadline(verdict, path.label)}</p>

      {/* thin 路线：只说明为什么不能判断，不给任何数值 */}
      {grade === 'thin' ? (
        <p className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
          没有足够的站内样本支撑这条路线，因此**不给任何数值判断**。
          这不是「风险低」，而是「还不知道」。
        </p>
      ) : null}

      {path.cards.length > 0 ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition-colors duration-150 hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60"
              aria-expanded={expanded}
            >
              {expanded ? '收起' : `查看 ${path.cards.length} 条前人经历`}
            </button>
            {onPickPath ? (
              <button
                type="button"
                onClick={() => onPickPath(path.pathId)}
                className="rounded-lg border border-zhihu-500/40 bg-zhihu-500/10 px-2.5 py-1 text-[10px] font-semibold text-zhihu-200 transition-colors duration-150 hover:bg-zhihu-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60"
              >
                拿这条路去对比
              </button>
            ) : null}
          </div>

          {expanded ? (
            /*
              展开后按**档案记录**呈现（v3 §12 Reality Archive）。

              替代了原来的「字段列表」形态（CardRow）：档案形态的关键差别
              不是装饰，而是把 `UNKNOWN` 当成一等公民大胆显示
              （见 `EvidenceRecord`）。编号用网格内顺序，因此同一条记录
              每次打开编号一致、可被引用。
            */
            <div className="mt-2.5 flex flex-col divide-y divide-white/8 rounded-xl border border-white/10 bg-ink-900/40">
              {path.cards.map((card, index) => (
                <EvidenceRecord
                  key={card.cardId}
                  index={index}
                  card={card}
                  pathLabel={path.label}
                  costProfile={path.costProfile}
                  {...(onTraceCard ? { onTrace: () => onTraceCard(card) } : {})}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function EvidenceMeshView({
  mesh,
  constraints,
  onPickPath,
  onTraceCard,
  onlyEvidenced = true,
  className = '',
}: EvidenceMeshViewProps) {
  const provenance = PROVENANCE_LABEL[mesh.provenance];
  const visible = onlyEvidenced ? mesh.paths.filter((path) => path.sampleSize > 0) : mesh.paths;
  const totalSamples = mesh.paths.reduce((sum, path) => sum + path.sampleSize, 0);

  return (
    <section
      aria-label="证据网格"
      className={`rounded-2xl border border-white/12 bg-ink-800/50 backdrop-blur-sm ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-wide text-slate-200">证据网格</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
            {provenance.text} · {totalSamples} 条样本 · {mesh.meshId}
          </p>
        </div>
        <span className={`shrink-0 font-mono text-[10px] ${provenance.tone}`}>
          {/*
            按 provenance 如实表述。

            原先这里是**二分支**：只要不是 `zhihu-search` 就写
            「本次没有可用的站内样本」—— 于是同一屏上出现
            「落盘快照 · 12 条样本」与「本次没有可用的站内样本」并存。
            在用户眼里那不是技术细节，那是产品错误。

            `snapshot` 本身就是样本（已落盘的真实回答），所以它必须说
            「来自落盘快照」，并明确可以点回原回答。
          */}
          {mesh.provenance === 'zhihu-search'
            ? '来自真实站内检索'
            : mesh.provenance === 'snapshot'
              ? '来自落盘快照 · 可点回原回答'
              : '演示数据 · 非实时检索'}
        </span>
      </header>

      {mesh.queries.length > 0 ? (
        <details className="border-b border-white/8 px-4 py-2">
          <summary className="cursor-pointer font-mono text-[10px] text-slate-500 hover:text-slate-300">
            本次检索了 {mesh.queries.length} 组关键词
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {mesh.queries.map((query) => (
              <li
                key={query}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-400"
              >
                {query}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm font-semibold text-slate-300">这次没有检索到可用的前人经历</p>
          <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-relaxed text-slate-500">
            证据网格只在拿到真实站内内容时才会给出结论。没有样本时它会如实留空 ——
            这是设计，不是 bug。配置知乎开放平台 Access Secret 后即可检索。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3.5">
          {visible.map((path) => (
            <PathBlock
              key={path.pathId}
              path={path}
              verdict={verdictFor({ path, constraints })}
              {...(onPickPath ? { onPickPath } : {})}
              {...(onTraceCard ? { onTraceCard } : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default EvidenceMeshView;
