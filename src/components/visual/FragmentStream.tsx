'use client';

import * as React from 'react';

import {
  FRAGMENT_TRACK_LABEL,
  type ArchiveFragment,
  type FragmentTrack,
} from '@/features/visual/archive';

/**
 * Fragment Stream —— 人生切片归位（报告 §8 / §26.2）。
 *
 * ## 一条纪律写在组件名里
 *
 * 这里显示的每一条都是**真实 exactQuote**。组件不做摘要、不做改写、
 * 不做「AI 润色」——它只负责让这些句子从模糊中归位，并标出来源。
 * 所以它接收的是已经整理好的 `ArchiveFragment`，而不是原始查询结果。
 *
 * ## 为什么是三条轨道而不是三张卡片
 *
 * 报告 §8 明确要求：不要三张普通卡片，要「三条轨道 / 世界线」。
 * 卡片是并列的收集品；轨道是同一个世界里并行发生的人生。
 * 这个区别决定了读者把内容看成「素材」还是「别人的一生」。
 */

export interface FragmentStreamProps {
  readonly groups: readonly {
    readonly track: FragmentTrack;
    readonly items: readonly ArchiveFragment[];
  }[];
  /** 是否已经归位（检索完成）。false 时不渲染内容，只留空轨。 */
  readonly active?: boolean;
  readonly className?: string;
}

const TRACK_ACCENT: Readonly<Record<FragmentTrack, { readonly line: string; readonly text: string }>> = {
  similar: { line: 'rgba(0,132,255,0.55)', text: 'text-zhihu-300' },
  alternative: { line: 'rgba(133,194,255,0.5)', text: 'text-zhihu-200' },
  counter: { line: 'rgba(201,160,90,0.55)', text: 'text-counter-soft' },
};

export function FragmentStream({ groups, active = true, className = '' }: FragmentStreamProps) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section
      className={['flex flex-col gap-5', className].filter(Boolean).join(' ')}
      aria-label="从知乎找到的真实经历"
    >
      {groups.map((group) => {
        const accent = TRACK_ACCENT[group.track];
        return (
          <div key={group.track}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={`font-mono text-[11px] tracking-[0.22em] ${accent.text}`}>
                {FRAGMENT_TRACK_LABEL[group.track]}
              </span>
              <span className="font-mono text-[10px] text-archive-600">
                {group.items.length > 0 ? `${group.items.length} 段` : '—'}
              </span>
            </div>

            {/* 轨道本体：一条极淡的世界线，切片挂在它上面 */}
            <div className="relative mt-2">
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 top-[7px] h-px"
                style={{ background: `linear-gradient(90deg, ${accent.line}, transparent)` }}
              />
              <ol className="relative flex flex-col gap-2.5">
                {group.items.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-3"
                    style={
                      active
                        ? {
                            animation: `sil-fragment-arrive 620ms var(--sil-ease) both`,
                            animationDelay: `${index * 110}ms`,
                          }
                        : { opacity: 0.001 }
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: accent.line, boxShadow: `0 0 8px 1px ${accent.line}` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-relaxed text-archive-200">
                        <span className="mr-1 font-mono text-[10px] text-archive-600">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        “{item.quote}”
                      </span>
                      <span className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-archive-600">
                        <span>{item.author}</span>
                        {item.sourceUrl ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-zhihu-400 transition-colors duration-200 hover:text-zhihu-200"
                            >
                              知乎原回答 ↗
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </li>
                ))}
                {group.items.length === 0 ? (
                  <li className="pl-[17px] text-[11px] leading-relaxed text-archive-600">
                    这一类暂时没找到 —— 我们不会编一条补上。
                  </li>
                ) : null}
              </ol>
            </div>
          </div>
        );
      })}

      {total === 0 ? (
        <p className="text-[11px] leading-relaxed text-archive-600">
          还没有可核对的片段。真实的空白，比编造的热闹更值得相信。
        </p>
      ) : null}
    </section>
  );
}

export default FragmentStream;
