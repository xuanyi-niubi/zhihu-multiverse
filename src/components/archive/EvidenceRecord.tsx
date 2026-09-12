'use client';

import * as React from 'react';

import { sourceBadgeLabel } from '@/features/run/knowledgeSource';

import type { DecisionPath, PathCard } from '@/types/evidence';

/**
 * 现实档案 · 单条记录（v3 §12「Reality Archive」）。
 *
 * ## 为什么重做而不是沿用「字段列表」
 *
 * 旧版证据卡是一串 `dt/dd`（起点 / 做了什么 / 花了多久 / 结果），
 * 读起来像后台表格 —— v3 §12 明确要求「不要像后台表格」。
 *
 * 档案形态的差别不在装饰，而在**信息组织方式**：
 *
 * ```
 * 编号：R-021
 * 作者：***
 * 年份：2025
 * 路线：在职转型
 *
 * 关键事实：
 * “……”（原文引用，带引号，是**证物**不是字段）
 *
 * 提取：
 * 时间成本：8 个月
 * 承压需求：UNKNOWN     ← 大胆显示
 *
 * 可信度：■■■■□
 * [查看知乎原回答]
 * ```
 *
 * ## 一条硬纪律：`UNKNOWN` 必须大胆显示
 *
 * v3 §12 原文：「'未知' 必须大胆显示，不要隐藏。」
 *
 * 这是本作品最容易滑坡的地方 —— 把 `未知` 画成灰色小字、
 * 或者干脆省略那一行，都会让玩家**误以为**数据是完整的。
 * 因此这里给 `UNKNOWN` 一个专属的视觉待遇：
 * 琥珀描边 + 明确的「未知」字样 + 一句解释。
 */

export interface EvidenceRecordProps {
  /** 编号（按网格内顺序生成，稳定可复现）。 */
  readonly index: number;
  readonly card: PathCard;
  /** 这条记录归属的路线名（v3 §12 的「路线：在职转型」）。 */
  readonly pathLabel?: string | null;
  /**
   * 该路线的代价画像（来自 mesh 的确定性聚合）。
   *
   * 只展示**真的有数据**的字段：`costProfile` 里为 `null` 的项会渲染成
   * 醒目的 `UNKNOWN`，而整条路线都没提到过的轴则**不渲染该行** ——
   * 因为「这条路线没提到承压需求」与「承压需求是未知」不是同一句话。
   */
  readonly costProfile?: PathCard extends never ? never : DecisionPath['costProfile'] | null;
  /**
   * 玩家**真的看过这条记录**时回调。
   *
   * 用于四维结算里的「证据覆盖」：只有展开过前人经历才算看过，
   * 因此这个回调用挂载而不是点击 —— 挂载即表示它已经进入视野。
   */
  readonly onTrace?: () => void;
  readonly className?: string;
}

/** 从抓取时间取年份（v3 §12 要求展示「年份」）。 */
function yearOf(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? String(new Date(parsed).getFullYear()) : '未知';
}

/** 编号：`R-021`。用索引而不是随机数，保证同一网格每次打开编号一致。 */
function recordId(index: number): string {
  return `R-${String(index + 1).padStart(3, '0')}`;
}

/**
 * 可信度（v3 §12 的 `■■■■□`）。
 *
 * **只使用官方信号**：优先权威等级（平台给的 L1–L5），
 * 没有等级时退回赞同数的对数刻度。两者都没有 → 一格都不填，
 * 并标注「未知」——绝不为了好看给个中间值。
 */
export function credibilityOf(card: PathCard): { readonly filled: number; readonly basis: string } {
  if (card.authorityRank >= 3) {
    return { filled: 5, basis: '官方权威等级高' };
  }
  if (card.authorityRank === 2) {
    return { filled: 4, basis: '官方权威等级中' };
  }
  if (card.authorityRank === 1) {
    return { filled: 3, basis: '官方权威等级低' };
  }
  if (card.upvotes !== null) {
    if (card.upvotes >= 1000) return { filled: 4, basis: '赞同数很高' };
    if (card.upvotes >= 100) return { filled: 3, basis: '赞同数较高' };
    if (card.upvotes >= 10) return { filled: 2, basis: '赞同数一般' };
    return { filled: 1, basis: '赞同数较少' };
  }
  return { filled: 0, basis: '未知' };
}

function CredibilityMeter({ card }: { readonly card: PathCard }) {
  const { filled, basis } = credibilityOf(card);
  const unknown = filled === 0;

  return (
    <p className="flex items-center gap-2 font-mono text-[10px]">
      <span className="text-slate-600">可信度</span>
      <span aria-hidden="true" className={unknown ? 'text-slate-600' : 'text-zhihu-300'}>
        {'■'.repeat(filled)}
        <span className="text-white/12">{'□'.repeat(5 - filled)}</span>
      </span>
      <span className={unknown ? 'text-amber-300' : 'text-slate-500'}>
        {unknown ? '未知（无权威等级与赞同数）' : basis}
      </span>
    </p>
  );
}

/** 一条「提取」项：未知时给专属视觉，而不是灰色小字。 */
function ExtractedRow({
  label,
  value,
  unit,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly unit?: string;
}) {
  const unknown = value === null || value.length === 0;

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 font-mono text-[10px] text-slate-600">{label}</dt>
      {unknown ? (
        <dd className="rounded-md border border-amber-400/40 bg-amber-400/[0.08] px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-300">
          UNKNOWN
        </dd>
      ) : (
        <dd className="text-right text-[11px] text-slate-200">
          {value}
          {unit ? <span className="ml-0.5 text-slate-500">{unit}</span> : null}
        </dd>
      )}
    </div>
  );
}

export function EvidenceRecord({
  index,
  card,
  pathLabel = null,
  costProfile = null,
  onTrace,
  className = '',
}: EvidenceRecordProps) {
  const badge = sourceBadgeLabel({ status: card.status, upvotes: card.upvotes, answerId: card.sourceId });
  const year = yearOf(card.retrievedAt);

  /**
   * 挂载即视为「看过」。
   *
   * 与旧实现（点击才回调）的差别是有意的：档案形态下记录是**铺开**的，
   * 玩家不需要再点一次才能看到内容 —— 那么「看过」的判定就应当是挂载。
   * 这也让四维结算的「证据覆盖」更符合实际行为。
   */
  React.useEffect(() => {
    onTrace?.();
    // 只在挂载时通知一次：父组件用它累积「已看过的路线」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 提取区**只列出真的有数据来源的字段**。
   *
   * 曾经这里写死了三行 `UNKNOWN`（承压 / 可逆 / 同伴），
   * 结果是「假诚实」：无论原文有没有提到，它都显示未知 ——
   * 那不是「如实标注不确定」，那只是没接数据却装作谨慎。
   *
   * 现在：有数据就显示数值，聚合过但确实没提到就显示 `UNKNOWN`，
   * 整条路线都没这个概念时**不渲染该行**。
   */
  const extracted: { readonly label: string; readonly value: string | null; readonly unit?: string }[] = [];

  const timeCost = costProfile?.timeCostMonths ?? null;
  if (card.shape.duration || timeCost) {
    extracted.push({
      label: '时间成本',
      value: card.shape.duration ?? (timeCost ? `${timeCost.min}–${timeCost.max}` : null),
      unit: card.shape.duration ? undefined : '个月',
    });
  }

  if (costProfile && costProfile.moneyCost !== 'unknown') {
    const moneyLabel = costProfile.moneyCost === 'high' ? '高' : costProfile.moneyCost === 'medium' ? '中' : '低';
    extracted.push({ label: '资金代价', value: moneyLabel });
  }

  if (costProfile && costProfile.irreversible !== null) {
    extracted.push({ label: '可逆性', value: costProfile.irreversible ? '走错难回头' : '可以回头' });
  }

  if (costProfile && costProfile.requiresAlly !== null) {
    extracted.push({ label: '同伴依赖', value: costProfile.requiresAlly ? '需要有人并肩' : '不依赖同伴' });
  }

  /** 有数据来源但确实缺失的字段 —— 这些才配得上醒目的 UNKNOWN。 */
  const missingKnownFields: string[] = [];
  if (costProfile) {
    if (costProfile.timeCostMonths === null && !card.shape.duration) {
      missingKnownFields.push('时间成本');
    }
    if (costProfile.moneyCost === 'unknown') {
      missingKnownFields.push('资金代价');
    }
  }

  return (
    <article
      className={[
        // 档案纸的形态：左侧一条竖脊 + 等宽编号区，而不是圆角卡片
        'relative border-l-2 border-zhihu-500/30 bg-white/[0.015] pl-3 pr-3 py-3',
        className,
      ].join(' ')}
    >
      {/* 编号与来源头 */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] font-bold tracking-[0.15em] text-zhihu-300">
          {recordId(index)}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
          <span>{card.author}</span>
          <span className="text-slate-600">·</span>
          <span>{year} 年</span>
          {pathLabel ? (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{pathLabel}</span>
            </>
          ) : null}
        </span>
      </header>

      {/* 关键事实：引号包裹，视作证物 */}
      <blockquote className="mt-2 text-[12px] leading-relaxed text-slate-300">
        <span className="mr-0.5 text-slate-600">“</span>
        {card.quote}
        <span className="ml-0.5 text-slate-600">”</span>
      </blockquote>

      {extracted.length > 0 || missingKnownFields.length > 0 ? (
        <>
          <dl className="mt-2.5 flex flex-col gap-1 border-t border-white/8 pt-2">
            {extracted.map((row) => (
              <ExtractedRow key={row.label} label={row.label} value={row.value} unit={row.unit} />
            ))}
            {missingKnownFields.map((label) => (
              <ExtractedRow key={label} label={label} value={null} />
            ))}
          </dl>

          {missingKnownFields.length > 0 ? (
            <p className="mt-1.5 text-[9px] leading-relaxed text-slate-600">
              标为 UNKNOWN 的字段表示
              <strong className="font-semibold text-amber-300/80">原文没有提到</strong>
              ，不是「不需要」—— 我们不会为了让档案好看而补一个数字。
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 border-t border-white/8 pt-2 text-[9px] leading-relaxed text-slate-600">
          这条记录只提供了经历本身，没有可提取的代价数据。
        </p>
      )}

      {/* 可信度 + 溯源 */}
      <footer className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-white/8 pt-2">
        <CredibilityMeter card={card} />
        <a
          href={card.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-zhihu-300 transition-colors duration-150 hover:text-zhihu-100"
        >
          {badge.tone === 'verified' ? badge.label : '查看来源'}
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </footer>
    </article>
  );
}

export default EvidenceRecord;
