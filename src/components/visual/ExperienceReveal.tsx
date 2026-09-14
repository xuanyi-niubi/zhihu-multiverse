'use client';

import * as React from 'react';

import { FragmentShard, type FragmentCategory } from '@/components/visual/FragmentShard';
import type { ForgeShard } from '@/components/visual/WorldForge';

/**
 * ExperienceReveal —— 真实人生显影。
 *
 * World Forge 负责诚实地说明「找到了什么」；这一层负责让玩家在进入推演前
 * 真正看见这些人。它只使用已经校验过的 exactQuote / author / sourceUrl，
 * 不生成标题、不补写经历，也不把样本伪装成结论。
 *
 * 顺序固定为：与你相似 → 另一种走法 → 相反结果。
 * 这不是检索进度，而是结果到齐后的阅读顺序；用户可上一条、下一条、暂停
 * 自动显影，或跳过直接进入世界。
 */

type RevealTrack = FragmentCategory;

interface RevealChapter {
  readonly track: RevealTrack;
  readonly label: string;
  readonly lead: string;
  readonly note: string;
  readonly tone: string;
}

const CHAPTERS: readonly RevealChapter[] = [
  {
    track: 'similar',
    label: '与你相似',
    lead: '先找到和你站在相似位置的人。',
    note: '相似的处境，不代表相同的答案。',
    tone: 'var(--sil-zhihu-soft)',
  },
  {
    track: 'alternative',
    label: '另一种走法',
    lead: '但相似的人，也不只走了一条路。',
    note: '有些行动，原本不在你的选项里。',
    tone: 'var(--sil-alternate-soft)',
  },
  {
    track: 'counter',
    label: '相反结果',
    lead: '最后，再看一个没有顺着前面结论发展的人。',
    note: '相同的选择，也可能产生相反的结果。',
    tone: 'var(--sil-counter-soft)',
  },
];

export interface ExperienceRevealProps {
  readonly fragments: readonly ForgeShard[];
  readonly onInspect: (fragmentId: string) => void;
  readonly onEnterWorld: () => void;
}

function firstFragmentOf(fragments: readonly ForgeShard[], track: RevealTrack): ForgeShard | null {
  return [...fragments]
    .filter((fragment) => fragment.category === track)
    .sort((left, right) => (right.relevance ?? 0) - (left.relevance ?? 0))[0] ?? null;
}

function sourceYearOf(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  const year = new Date(timestamp * 1000).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : null;
}

export function ExperienceReveal({ fragments, onInspect, onEnterWorld }: ExperienceRevealProps) {
  const [chapterIndex, setChapterIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const reducedMotion = React.useRef(false);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reducedMotion.current = media.matches;
      if (media.matches) {
        setPaused(true);
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const lastChapter = chapterIndex >= CHAPTERS.length;
  React.useEffect(() => {
    if (paused || reducedMotion.current || lastChapter) {
      return;
    }
    const timer = window.setTimeout(() => {
      setChapterIndex((current) => Math.min(current + 1, CHAPTERS.length));
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [chapterIndex, lastChapter, paused]);

  const chapter = CHAPTERS[Math.min(chapterIndex, CHAPTERS.length - 1)]!;
  const representative = firstFragmentOf(fragments, chapter.track);
  const qualification = representative?.qualification;
  const displayLabel =
    qualification?.assignedTrack === 'adjacent' ? '目标相同，条件不同' : chapter.label;
  const displayLead =
    qualification?.assignedTrack === 'adjacent'
      ? '没有找到条件完全相同的人，先看一段目标相同的邻近经历。'
      : chapter.lead;
  const sourceYear = sourceYearOf(representative?.sourceEditTime);

  const next = () => setChapterIndex((current) => Math.min(current + 1, CHAPTERS.length));
  const previous = () => setChapterIndex((current) => Math.max(current - 1, 0));

  return (
    <section className="sil-reveal mt-7" aria-label="真实人生显影">
      {!lastChapter ? (
        <div
          className="sil-panel sil-brackets relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => {
            if (!reducedMotion.current) setPaused(false);
          }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: chapter.tone, opacity: 0.78 }}
          />
          <div className="flex items-center justify-between gap-4">
            <p className="sil-label" style={{ color: chapter.tone }}>
              REAL LIFE / {String(chapterIndex + 1).padStart(2, '0')} · 03
            </p>
            <button
              type="button"
              onClick={() => setPaused((current) => !current)}
              className="min-h-11 px-1 text-[12px] text-[color:var(--sil-ink-300)] transition-colors hover:text-[color:var(--sil-ink-100)]"
              aria-pressed={paused}
            >
              {paused ? '继续显影' : '暂停'}
            </button>
          </div>

          <p className="mt-5 text-[15px] font-semibold leading-relaxed" style={{ color: 'var(--sil-ink-100)' }}>
            {displayLead}
          </p>

          {representative ? (
            <article
              key={representative.id}
              className="mt-5 border-l pl-4"
              style={{ borderColor: chapter.tone, animation: 'fragment-materialize 520ms var(--sil-ease) both' }}
            >
              {representative.title ? (
                <h3 className="mb-3 text-[16px] font-semibold leading-relaxed text-[color:var(--sil-ink-100)]">
                  {representative.title}
                </h3>
              ) : null}
              {qualification ? (
                <div className="mb-3 space-y-1 text-[11px] leading-relaxed text-[color:var(--sil-ink-300)]">
                  {qualification.matchedConstraints.length > 0 ? (
                    <p>与你相同：{qualification.matchedConstraints.join('、')}</p>
                  ) : (
                    <p>没有确认到与你完全相同的条件。</p>
                  )}
                  {qualification.differentConstraints.length > 0 ? (
                    <p>与你不同：{qualification.differentConstraints.join('、')}</p>
                  ) : null}
                  {qualification.unknownConstraints.length > 0 ? (
                    <p>尚不确定：{qualification.unknownConstraints.slice(0, 2).join('、')}</p>
                  ) : null}
                </div>
              ) : null}
              <blockquote
                className="max-h-[8.8em] overflow-hidden text-[15px] leading-[1.82] text-[color:var(--sil-ink-200)]"
              >
                “{representative.quote}”
              </blockquote>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="sil-mark" style={{ color: chapter.tone }}>
                  {displayLabel}
                </span>
                <span className="text-[12px] text-[color:var(--sil-ink-300)]">
                  {representative.sourceLabel}{sourceYear ? ` · ${sourceYear}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPaused(true);
                    onInspect(representative.id);
                  }}
                  className="min-h-11 text-[12px] underline decoration-dotted underline-offset-4 transition-colors hover:text-[color:var(--sil-ink-100)]"
                  style={{ color: chapter.tone }}
                >
                  看完整原文
                </button>
              </div>
            </article>
          ) : (
            <div className="mt-5 border-l border-[color:var(--sil-undev-line)] pl-4">
              <p className="text-[14px] leading-relaxed text-[color:var(--sil-ink-300)]">
                这一类暂时没找到可靠经历。我们不会为了让故事完整，编一个人出来。
              </p>
            </div>
          )}

          <p className="mt-5 text-[13px] leading-relaxed" style={{ color: chapter.tone }}>
            {chapter.note}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--sil-rule)] pt-3">
            <div className="flex gap-2">
              {CHAPTERS.map((item, index) => (
                <span
                  key={item.track}
                  aria-label={item.label}
                  className="h-1.5 w-5"
                  style={{
                    background: index === chapterIndex ? chapter.tone : 'var(--sil-rule-strong)',
                  }}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              {chapterIndex > 0 ? (
                <button
                  type="button"
                  onClick={previous}
                  className="min-h-11 px-1 text-[12px] text-[color:var(--sil-ink-300)] transition-colors hover:text-[color:var(--sil-ink-100)]"
                >
                  上一条
                </button>
              ) : null}
              <button type="button" onClick={next} className="sil-btn min-h-11 px-4 text-[13px]">
                {chapterIndex === CHAPTERS.length - 1 ? '看见了' : '下一段'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="sil-panel sil-brackets px-5 py-6 sm:px-8 sm:py-8">
          <p className="sil-label">WORLD READY</p>
          <h2 className="sil-title mt-3 text-[25px] leading-tight sm:text-[30px]">这些经历不是你的答案。</h2>
          <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-[color:var(--sil-ink-200)]">
            它们会成为接下来那个世界的地形。你可以先核对原文，也可以把它们带进自己的推演。
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onEnterWorld} className="sil-btn sm:min-w-[230px]">
              穿越我的平行宇宙
            </button>
            <button
              type="button"
              onClick={() => setArchiveOpen((current) => !current)}
              className="sil-btn sil-btn--ghost sm:min-w-[190px]"
              aria-expanded={archiveOpen}
            >
              {archiveOpen ? '收起真实经历' : '先看看这几个人'}
            </button>
          </div>

          {archiveOpen ? (
            <div className="mt-7 border-t border-[color:var(--sil-rule)] pt-5">
              <p className="sil-label">他们真的走过</p>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {fragments.map((fragment, index) => (
                  <FragmentShard
                    key={fragment.id}
                    quote={fragment.quote}
                    sourceLabel={fragment.sourceLabel}
                    category={fragment.category}
                    state="materialized"
                    onSelect={() => onInspect(fragment.id)}
                    style={{ animationDelay: `${Math.min(index, 5) * 70}ms` }}
                  />
                ))}
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--sil-ink-300)]">
                每一段都能打开查看完整逐字原文，并回到知乎来源。
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default ExperienceReveal;
