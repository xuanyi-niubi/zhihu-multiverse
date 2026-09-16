'use client';

import * as React from 'react';

import type { WorldlineCard } from '@/features/zhihu-loop/worldlineCard';

/**
 * Worldline Archive Card —— 终局那张**可以带走、也可以种回知乎**的存档卡。
 *
 * ## 它在闭环里的位置
 *
 * ```text
 * Reality Pass（带走一张票）→ 本卡（把这一局存档 + 引导回知乎写回答）
 *                                        ↓
 *                          他写的那条回答成为真实站内内容
 *                                        ↓
 *                          下一次别人检索相似处境时被官方检索抓回、逐字核验
 * ```
 *
 * 所以这一屏有一个**产品之前没有的东西：出口**。
 * 之前的终局只把玩家送出现实，这一屏把他送回知乎。
 *
 * ## 两种"带走"，用途不同，不能合并成一个按钮
 *
 * - **存档卡**：这一局发生过什么的完整记录（含逐字引用与出处），给自己留档；
 * - **写作脚手架**：粘进知乎回答框的草稿骨架，四栏留白等他填自己的经历。
 *
 * 合成一个按钮的话，玩家会把自己那一局的存档当成回答草稿发出去 ——
 * 里面全是别人的经历。
 *
 * ## 为什么这里可以自称"生产端"
 *
 * 复制/发布之后，`features/experience/` 那条既有管线会在下一次检索里
 * 抓到那条回答（官方检索 → `status: 'verified'` → 逐字校验）。
 * 我们**没有**为玩家内容开任何后门，闭合发生在知乎上。
 */
export interface WorldlineCardPanelProps {
  readonly card: WorldlineCard;
  readonly className?: string;
}

function CopyRow({
  label,
  hint,
  text,
}: {
  readonly label: string;
  readonly hint: string;
  readonly text: string;
}) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      // 剪贴板不可用（非安全上下文 / 无权限）时如实降级：
      // 内容就在下面可选中，绝不假装复制成功。
      setState('failed');
    }
  }, [text]);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void onCopy()}
        className="sil-mark min-h-11 px-4 text-meta transition-colors duration-200"
        style={{ borderColor: 'var(--sil-rule-strong)', color: 'var(--sil-paper-ink)' }}
      >
        {state === 'copied' ? `${label} · 已复制` : label}
      </button>
      <p className="text-micro leading-relaxed" style={{ color: 'var(--sil-paper-muted)' }}>
        {state === 'failed' ? '剪贴板不可用 —— 下面的文字可以直接选中复制。' : hint}
      </p>
    </div>
  );
}

export function WorldlineCardPanel({ card, className = '' }: WorldlineCardPanelProps) {
  return (
    <section
      className={['sil-paper sil-develop relative mt-8 overflow-hidden px-5 py-6 sm:px-6', className]
        .filter(Boolean)
        .join(' ')}
      aria-label="世界线存档卡"
    >
      <div className="relative z-[1] flex flex-col gap-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="sil-label" style={{ color: 'var(--sil-paper-muted)' }}>
            WORLDLINE ARCHIVE · 世界线存档
          </p>
          <span className="sil-num text-micro" style={{ color: 'var(--sil-paper-muted)' }}>
            {card.code}
          </span>
        </header>

        <div>
          <h3
            className="text-[22px] font-black leading-tight"
            style={{ color: 'var(--sil-paper-ink)' }}
          >
            把这一局存下来。
          </h3>
          <p className="mt-2 text-meta leading-relaxed" style={{ color: 'var(--sil-paper-muted)' }}>
            {card.walked.length > 0
              ? `这一局你看到了 ${card.walked.length} 条别人真的走过的路${
                  card.counter ? '，还有一条走坏了的路' : ''
                }。`
              : '这一局没有引用到真实经历 —— 我们不为了填满这张卡编一段。'}
            {card.unknown ? ` 但「${card.unknown}」这一项，任何人的经验都替不了你。` : ''}
          </p>
        </div>

        {/* 闭环：这一屏独有的"出口"。之前所有版本到终局就断了。 */}
        <div
          className="border-l-2 pl-3"
          style={{ borderColor: 'var(--sil-zhihu)' }}
        >
          <p className="text-meta font-semibold leading-relaxed" style={{ color: 'var(--sil-paper-ink)' }}>
            七天后，回到知乎写下你自己的那条。
          </p>
          <p className="mt-1.5 text-meta leading-relaxed" style={{ color: 'var(--sil-paper-muted)' }}>
            {card.loopStatement}
          </p>
          <a
            href={card.zhihuHref}
            target="_blank"
            rel="noreferrer noopener"
            className="source-link mt-2 inline-flex min-h-11 items-center"
          >
            去知乎找这个问题 / 写回答 ↗
          </a>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <CopyRow
            label="复制世界线存档卡"
            hint="这一局发生过什么，含逐字引用与原文出处，给自己留档。"
            text={card.archiveText}
          />
          <CopyRow
            label="复制写回答的草稿骨架"
            hint="粘进知乎回答框，四栏留白按你自己的真实经历填完。"
            text={card.draftText}
          />
        </div>

        <details>
          <summary className="min-h-11 cursor-pointer">
            <span className="sil-label" style={{ color: 'var(--sil-paper-muted)' }}>
              先看看草稿长什么样
            </span>
          </summary>
          <pre
            className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[3px] border p-3 text-micro leading-relaxed"
            style={{
              borderColor: 'var(--sil-rule)',
              color: 'var(--sil-paper-muted)',
              background: 'rgb(var(--sil-rgb-void-900) / 0.35)',
            }}
          >
            {card.draftText}
          </pre>
        </details>
      </div>
    </section>
  );
}

export default WorldlineCardPanel;
