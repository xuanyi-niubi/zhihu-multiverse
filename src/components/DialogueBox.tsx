'use client';

import * as React from 'react';

import { Portrait } from '@/components/characters/Portrait';
import { useTypewriter } from '@/components/Terminal';
import { getCharacter } from '@/data/characters';

import type { Mood, SpeakerId } from '@/types/narrative';

/**
 * 底部对话框——叙事的主舞台。
 *
 * 交互约定：
 * - 正在打字：点击 / 回车 / 空格 → 立刻补全（跳过）
 * - 已打完且允许推进：点击 / 回车 / 空格 → 触发 onAdvance
 * - 选项区通过 children 传入，渲染在正文下方，不参与「跳过」判定
 */

export interface DialogueBoxProps {
  readonly speakerId: SpeakerId | null;
  readonly text: string;
  readonly mood?: Mood;
  /** 检定失败 / SAN 暴扣时切成危险配色。 */
  readonly danger?: boolean;
  /** SAN 濒危时正文轻微抖动。 */
  readonly unstable?: boolean;
  readonly canAdvance: boolean;
  readonly onAdvance: () => void;
  readonly hint?: string;
  /** 右上角插槽：放知乎溯源角标等。 */
  readonly source?: React.ReactNode;
  readonly children?: React.ReactNode;
}

const MOOD_ACCENT: Record<Mood, string> = {
  calm: 'text-zhihu-300',
  tense: 'text-amber-300',
  panic: 'text-rose-300',
  hope: 'text-emerald-300',
};

const MOOD_LABEL: Record<Mood, string> = {
  calm: '',
  tense: '气氛紧绷',
  panic: '心跳失速',
  hope: '有光透进来',
};

export function DialogueBox({
  speakerId,
  text,
  mood = 'calm',
  danger = false,
  unstable = false,
  canAdvance,
  onAdvance,
  hint,
  source,
  children,
}: DialogueBoxProps) {
  const { visible, done, skip } = useTypewriter(text, { speed: 26, chunkSize: 1 });
  const speaker = speakerId && speakerId !== 'narrator' ? getCharacter(speakerId) : null;

  const handleActivate = React.useCallback(() => {
    if (!done) {
      skip();
      return;
    }

    if (canAdvance) {
      onAdvance();
    }
  }, [canAdvance, done, onAdvance, skip]);

  return (
    <div className="relative z-20 w-full px-3 pb-3 sm:px-5 sm:pb-5">
      <div
        className={[
          'gmv-dialogue mx-auto w-full max-w-[940px] rounded-[20px] px-4 py-4 sm:px-6 sm:py-5',
          danger ? 'gmv-dialogue--danger' : '',
        ].join(' ')}
      >
        {/* 名牌 */}
        <div className="flex items-center gap-3 border-b border-white/[0.07] pb-3">
          {speaker ? (
            <span
              className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/15 bg-ink-800"
              aria-hidden="true"
            >
              <Portrait character={speaker} expression={speaker.defaultExpression} />
            </span>
          ) : (
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] font-mono text-[11px] text-slate-500"
              aria-hidden="true"
            >
              旁白
            </span>
          )}

          <div className="min-w-0">
            <p className="gmv-dialogue__name truncate text-sm font-semibold">
              {speaker ? speaker.name : '旁白'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {speaker ? speaker.role : '命运的叙述者'}
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {source}
            <span className={['font-mono text-[11px]', MOOD_ACCENT[mood]].join(' ')}>
              {mood === 'calm' ? '' : MOOD_LABEL[mood]}
            </span>
          </div>
        </div>

        {/* 正文 */}
        <div
          role="button"
          tabIndex={0}
          aria-label={done ? '继续' : '跳过打字动画'}
          onClick={handleActivate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleActivate();
            }
          }}
          className={[
            'mt-4 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zhihu-500/60',
            unstable ? 'animate-text-unstable' : '',
          ].join(' ')}
        >
          <p className="gmv-narrative whitespace-pre-line text-slate-200">
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">{visible}</span>
            {!done ? (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-caret-blink bg-zhihu-400 align-middle"
              />
            ) : null}
          </p>
        </div>

        {/* 选项区 */}
        {children ? <div className="mt-4">{children}</div> : null}

        {/* 推进指示 */}
        {done && canAdvance && !children ? (
          <div className="mt-2 flex items-center justify-end gap-2">
            {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
            <span
              aria-hidden="true"
              className="animate-bounce text-sm text-zhihu-400"
            >
              ▼
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default DialogueBox;
