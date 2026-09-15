'use client';

import * as React from 'react';

import { ExperienceCardPanel, type ExperienceCardData } from '@/components/game/ExperienceCardPanel';
import { experienceSummariesOf } from '@/components/game/session/viewModel';

/**
 * 借来的经验（Agent 03 §十五 / §十六）。
 *
 * ## 只列「这一局真正用到」的
 *
 * 不是全部检索结果。调用方（页面）已经按「被某一幕或某个解锁引用过」
 * 过滤过一次；这里再取一次摘要，是为了让抽屉标题与卡片正文同源。
 *
 * 文案保留 `借来的经验 · N` —— 它是新主链里唯一还带数字的地方，
 * 而这个数字是**真实的**：本局引用了几个人的经历。
 *
 * ## 外观归 Agent 04
 *
 * 抽屉结构（trigger / 侧栏 / 全屏 sheet）由这里提供，材质与动画由
 * 视觉线程写样式；两端通过 `session-experience-dock` 这组语义 class 对接。
 */
export interface SessionExperienceDockProps {
  /** 本局真正用到的卡片（已过滤）。 */
  readonly experiences: readonly ExperienceCardData[];
  readonly cardTitles?: Readonly<Record<string, string>>;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly className?: string;
}

export function SessionExperienceDock({
  experiences,
  cardTitles = {},
  open,
  onOpen,
  onClose,
  className = '',
}: SessionExperienceDockProps) {
  const summaries = React.useMemo(
    () => experienceSummariesOf(experiences, cardTitles),
    [cardTitles, experiences],
  );

  // 一张卡都没有时不显示入口：不为了「这一屏该有个按钮」编一张卡。
  if (experiences.length === 0) {
    return null;
  }

  return (
    <div className={['session-experience-dock', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="min-h-11 font-mono text-label text-unlock/90 transition-colors duration-200 hover:text-unlock"
      >
        借来的经验 · {experiences.length}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-archive-950/80 backdrop-blur-sm"
          onClick={onClose}
          role="presentation"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="借来的经验"
            onClick={(event) => event.stopPropagation()}
            className="h-full w-full overflow-y-auto border-l border-white/10 bg-archive-900/95 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:max-w-[420px]"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-body font-semibold text-archive-100">借来的经验</h2>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 font-mono text-label text-archive-600 transition-colors duration-200 hover:text-archive-200"
              >
                关闭
              </button>
            </header>

            {/* 摘要：一行原文，告诉玩家这一局借到了谁的哪一段。 */}
            <ul className="mt-4 flex flex-col gap-2">
              {summaries.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5">
                  <span className="text-meta font-semibold text-archive-200">{item.title}</span>
                  {item.summary ? (
                    <span className="line-clamp-2 text-label leading-relaxed text-archive-600">
                      {item.summary}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            <ExperienceCardPanel cards={experiences} titles={cardTitles} className="mt-5" />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export default SessionExperienceDock;
