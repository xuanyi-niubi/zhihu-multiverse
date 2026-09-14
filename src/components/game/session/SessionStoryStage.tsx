'use client';

import * as React from 'react';

import { PortraitLayer } from '@/components/characters/PortraitLayer';
import { SceneStage } from '@/components/scenes/SceneStage';

import type { SessionStoryView } from '@/components/game/session/types';

/**
 * 叙事舞台（Agent 03 §十四）。
 *
 * 只展示四样东西：**场景 / 叙事 / 人物 / 本幕张力**。
 *
 * ## 不强行拆结构
 *
 * 现有 DM 只返回一段 `narrative`。硬把它拆成
 * `scene context + dialogue + tension` 就会开始编造「谁在什么时候说了哪句」。
 * 所以这里的处理是**零改动**的：
 *
 * ```text
 * story.text     ← DM 原文（一个字都不动）
 * story.phrases  ← ViewModel 的句读切分，只服务于错位淡入
 * ```
 *
 * 切分规则住在 ViewModel（可测），组件只负责画。
 *
 * 叙事容器用 `.session-story`（Agent 04 发布的语义 class）：字号 / 行高 /
 * 颜色由视觉线程决定，这里不写死排版。
 */
export interface SessionStoryStageProps {
  readonly story: SessionStoryView;
  readonly loading: boolean;
  readonly className?: string;
}

function PhraseText({ phrases }: { readonly phrases: readonly string[] }) {
  if (phrases.length === 0) {
    return null;
  }

  return (
    <span className="flex flex-col gap-1.5">
      {phrases.map((phrase, index) => (
        <span
          key={`${index}-${phrase.slice(0, 6)}`}
          className="arc-phrase block"
          style={{ animationDelay: `${Math.min(index, 12) * 150}ms` }}
        >
          {phrase}
        </span>
      ))}
    </span>
  );
}

export function SessionStoryStage({ story, loading, className = '' }: SessionStoryStageProps) {
  return (
    <section
      className={['mt-5', className].filter(Boolean).join(' ')}
      aria-label="这一幕的场景与叙事"
    >
      {/* 场景 + 立绘：它们是氛围，不是数值 */}
      <div className="relative h-[220px] overflow-hidden rounded-3xl border border-white/8 bg-archive-900">
        <SceneStage sceneId={story.scene.sceneId} />
        <PortraitLayer stage={story.stage} speaker={story.speaker} />
        <div className="absolute bottom-2.5 left-3.5 font-mono text-[11px] text-archive-400">
          {story.scene.timeLabel}
        </div>
      </div>

      {story.tension ? (
        <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wider text-counter-soft">
          本幕张力 · {story.tension}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-5 animate-pulse font-mono text-[12px] text-archive-600">
          这一局正在继续往下长…
        </p>
      ) : (
        <>
          {story.title ? (
            <p className="mt-5 text-[13px] font-semibold text-archive-400">{story.title}</p>
          ) : null}
          <p className="session-story mt-2 block">
            <PhraseText key={story.text} phrases={story.phrases} />
          </p>
        </>
      )}
    </section>
  );
}

export default SessionStoryStage;
