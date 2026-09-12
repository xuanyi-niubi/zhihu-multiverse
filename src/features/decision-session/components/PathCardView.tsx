'use client';

import * as React from 'react';

import type { Claim, ClaimKind, EvidenceFact } from '@/features/decision-session/domain';
import type { UserContext } from '@/features/decision-session/domain';

/**
 * 一条路径的对照板（重构方案 §3.1 第四步）。
 *
 * ## 它替换了什么
 *
 * 旧版本展示的是**裁决**：「可行 / 不可行 / 还差 13 个月」。
 * 那把一个有限轶事包装成了对个人的预测（方案 §1.2）。
 *
 * 现在展示的是**对照**：
 *
 * ```text
 * 路径 A：先参加，以完成为目标
 * 知乎经历：3 条
 * 他们当时的条件：有队友 / 每周 15～20 小时
 * 与你相似 / 与你不同
 * 证据分歧：有人认为比赛逼着成长，也有人因时间失控中途退出
 * 当前未知：8 小时是否足以完成最小作品
 * ```
 *
 * **没有一处说「你能不能成」。**
 */

/** 展示标记（方案 §4.3 只允许这四种）。 */
const KIND_BADGE: Readonly<Record<ClaimKind, { readonly label: string; readonly tone: string }>> = {
  quote: { label: '原文', tone: 'border-white/14 bg-white/[0.04] text-slate-300' },
  'sample-observation': { label: '样本观察', tone: 'border-zhihu-500/40 bg-zhihu-500/10 text-zhihu-100' },
  'ai-synthesis': { label: 'AI 归纳', tone: 'border-violet-400/40 bg-violet-400/10 text-violet-100' },
  unknown: { label: '待验证', tone: 'border-amber-400/40 bg-amber-400/10 text-amber-100' },
};

function Badge({ kind }: { readonly kind: ClaimKind }) {
  const badge = KIND_BADGE[kind];
  return (
    <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${badge.tone}`}>
      {badge.label}
    </span>
  );
}

/** 一条带类型标记的断言。 */
export function ClaimLine({ claim, className = '' }: { readonly claim: Claim; readonly className?: string }) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-1 ${className}`}>
      <Badge kind={claim.kind} />
      <span className="text-[12px] leading-relaxed text-slate-300">{claim.text}</span>
      {claim.sourceUrl ? (
        <a
          href={claim.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono text-[10px] text-zhihu-300 hover:text-zhihu-100"
        >
          原始回答 ↗
        </a>
      ) : null}
    </p>
  );
}

export interface PathCardViewProps {
  readonly cluster: {
    readonly id: string;
    readonly label: string;
    readonly summary: string;
    readonly supportingFactIds: readonly string[];
    readonly opposingFactIds: readonly string[];
    readonly conditions: readonly string[];
    readonly unknowns: readonly string[];
    readonly origin: 'curated' | 'ai-clustered';
  };
  readonly facts: readonly EvidenceFact[];
  readonly userContext: UserContext;
  readonly selectedUnknown: string | null;
  readonly busy: boolean;
  readonly onPickUnknown: (unknown: string) => void;
}

export function PathCardView({
  cluster,
  facts,
  userContext,
  selectedUnknown,
  busy,
  onPickUnknown,
}: PathCardViewProps) {
  const [expanded, setExpanded] = React.useState(false);
  const byId = React.useMemo(() => new Map(facts.map((fact) => [fact.id, fact])), [facts]);

  const supporting = cluster.supportingFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is EvidenceFact => fact !== undefined);
  const opposing = cluster.opposingFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is EvidenceFact => fact !== undefined);

  return (
    <article className="panel p-3.5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold leading-snug text-slate-100">{cluster.label}</h3>
        <span className="shrink-0 font-mono text-[10px] text-slate-500">
          知乎经历 {supporting.length} 条
          {cluster.origin === 'curated' ? ' · 已人工核验' : ''}
        </span>
      </header>

      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">{cluster.summary}</p>

      {/* 他们当时的条件 vs 你的条件（对照，不是判断） */}
      {cluster.conditions.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          <span className="font-mono text-slate-600">他们当时的条件：</span>
          {cluster.conditions.join(' / ')}
        </p>
      ) : null}

      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        <span className="font-mono text-slate-600">你的条件：</span>
        {userContext.availableTime ?? <span className="text-amber-300/80">待验证（你还没说能拿出多少时间）</span>}
        {userContext.nonNegotiables.length > 0 ? ` · ${userContext.nonNegotiables.join(' / ')}` : ''}
      </p>

      {/* 证据分歧：主动呈现反例（方案 §5.2 / §11 的关键句） */}
      <div className="mt-2.5 border-t border-white/8 pt-2">
        <p className="font-mono text-[10px] text-slate-600">证据分歧</p>
        {opposing.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1">
            {opposing.slice(0, 2).map((fact) => (
              <li key={fact.id} className="text-[11px] leading-relaxed text-slate-400">
                <span className="mr-1 text-rose-300/80">反例</span>
                {fact.quote.slice(0, 72)}
                {fact.quote.length > 72 ? '…' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
            <Badge kind="unknown" />
            <span className="ml-1.5">目前没有找到明确提到代价或中途退出的经历 —— 这条走法的下行风险仍是未知。</span>
          </p>
        )}
      </div>

      {/* 当前未知：本产品的核心输出 */}
      {cluster.unknowns.length > 0 ? (
        <div className="mt-2.5 border-t border-white/8 pt-2">
          <p className="font-mono text-[10px] text-slate-600">当前未知</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {cluster.unknowns.map((unknown) => {
              const active = selectedUnknown === unknown;
              return (
                <li key={unknown} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Badge kind="unknown" />
                  <span className="flex-1 text-[11px] leading-relaxed text-slate-300">{unknown}</span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={active}
                    onClick={() => onPickUnknown(unknown)}
                    className={[
                      'shrink-0 rounded-lg border px-2 py-0.5 font-mono text-[10px] transition-colors duration-150',
                      active
                        ? 'border-zhihu-500/70 bg-zhihu-500/15 text-zhihu-100'
                        : 'border-white/12 text-slate-400 hover:border-zhihu-500/40 hover:text-slate-200',
                    ].join(' ')}
                  >
                    {active ? '已选' : '先弄清这个'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* 原文：默认折叠，不挤压主任务 */}
      {supporting.length > 0 ? (
        <div className="mt-2.5 border-t border-white/8 pt-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="font-mono text-[10px] text-zhihu-300 transition-colors duration-150 hover:text-zhihu-100"
          >
            {expanded ? '收起原文' : `展开 ${supporting.length} 条原文`}
          </button>

          {expanded ? (
            <ul className="mt-2 flex flex-col gap-2.5">
              {supporting.map((fact) => (
                <li key={fact.id} className="border-l-2 border-zhihu-500/30 pl-2.5">
                  <p className="text-[11px] leading-relaxed text-slate-300">“{fact.quote}”</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-slate-600">
                    <span>{fact.author ?? '匿名用户'}</span>
                    <span>·</span>
                    <span>{fact.retrievedAt.slice(0, 10)}</span>
                    {fact.explicitValue ? (
                      <>
                        <span>·</span>
                        <span className="text-slate-400">原文写的是「{fact.explicitValue}」</span>
                      </>
                    ) : null}
                    <a
                      href={fact.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-zhihu-300 hover:text-zhihu-100"
                    >
                      原始回答 ↗
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default PathCardView;
