'use client';

import * as React from 'react';

import type { PathCluster, EvidenceFact } from '@/features/decision-session/domain';

/**
 * 证据抽屉（重构方案 §3.3）。
 *
 * > 证据详情用抽屉或折叠层，**不让来源元数据挤压主任务**。
 *
 * ## 为什么按「路径」而不是按「来源」组织
 *
 * 旧的证据网格先列来源、再让人自己归纳 —— 用户得自己看出
 * 「这 12 条其实是三种不同的走法」。现在按路径分组，
 * 因为**分歧才是信息**：同一个问题下，人们走的路不一样，
 * 而那正是用户真正需要看见的东西。
 *
 * ## 默认折叠
 *
 * 主视图只显示摘要与分歧；要看原文才展开。
 * 这不是藏起来 —— 每一条都标着「原文」并且能点回知乎。
 */

export function EvidenceDrawer({
  facts,
  clusters,
  className = '',
}: {
  readonly facts: readonly EvidenceFact[];
  readonly clusters: readonly PathCluster[];
  readonly className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const byId = React.useMemo(() => new Map(facts.map((fact) => [fact.id, fact])), [facts]);

  /** 没有任何路径命中时（例如证据不足），抽屉不出现。 */
  if (clusters.length === 0) {
    return null;
  }

  return (
    <section className={`rounded-2xl border border-white/10 bg-ink-900/50 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[11px] text-slate-300">
          全部来源原文
          <span className="ml-1.5 text-slate-600">
            {facts.length} 条 · 按走法分组
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-zhihu-300">{open ? '收起' : '展开'}</span>
      </button>

      {open ? (
        <div className="border-t border-white/8 px-3.5 py-3">
          {clusters.map((cluster) => {
            const supporting = cluster.supportingFactIds
              .map((id) => byId.get(id))
              .filter((fact): fact is EvidenceFact => fact !== undefined);
            const opposing = cluster.opposingFactIds
              .map((id) => byId.get(id))
              .filter((fact): fact is EvidenceFact => fact !== undefined);

            return (
              <div key={cluster.id} className="mb-4 last:mb-0">
                <p className="font-mono text-[10px] tracking-wider text-slate-500">
                  {cluster.label} · 支持 {supporting.length} / 反例 {opposing.length}
                </p>

                <ul className="mt-2 flex flex-col gap-2.5">
                  {[...supporting, ...opposing].map((fact) => (
                    <li key={fact.id} className="border-l-2 border-white/12 pl-2.5">
                      <p className="text-[11px] leading-relaxed text-slate-300">“{fact.quote}”</p>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-slate-600">
                        <span>{fact.author ?? '匿名用户'}</span>
                        <span>·</span>
                        <span>{fact.retrievedAt.slice(0, 10)}</span>
                        <span>·</span>
                        {/* 事实类型是内部口径，但对用户有用：它在说「这句话是代价还是结果」 */}
                        <span>{FACT_TYPE_LABEL[fact.factType]}</span>
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
              </div>
            );
          })}

          <p className="mt-1 border-t border-white/8 pt-2 text-[10px] leading-relaxed text-slate-600">
            以上都是**原文片段**，没有经过改写。它们说明「这些人经历了什么」，
            不能说明「你必须满足什么」。
          </p>
        </div>
      ) : null}
    </section>
  );
}

const FACT_TYPE_LABEL: Readonly<Record<EvidenceFact['factType'], string>> = {
  action: '做了什么',
  condition: '当时条件',
  cost: '付出的代价',
  outcome: '结果',
  opinion: '个人看法',
};

export default EvidenceDrawer;
