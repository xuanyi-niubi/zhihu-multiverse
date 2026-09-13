'use client';

import * as React from 'react';

import { PortraitLayer } from '@/components/characters/PortraitLayer';
import { SceneStage } from '@/components/scenes/SceneStage';
import { ExperienceCardPanel, type ExperienceCardData } from '@/components/game/ExperienceCardPanel';
import { ExperienceSourceModal } from '@/components/game/ExperienceSourceModal';
import { SessionEndgame } from '@/components/game/SessionEndgame';
import { useTypewriter } from '@/components/Terminal';

import type { RealityExperiment } from '@/features/decision-session/domain';
import type { ExperienceFact } from '@/features/experience/domain';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';
import type { CharacterOnStage, SceneId, SpeakerId } from '@/types/narrative';

/**
 * 新主链的推演屏（产品化方案 §18-§28 / §32 / §47 / §61）。
 *
 * ## 它为什么必须独立成文件
 *
 * 旧 `play/page.tsx` 同时承载「预置剧本 + AI 自由推演 + 遗物 + 骰子 + Boss +
 * 命途树 + 证据网格 + 契约」。新主链只想要四样东西：幕、场景、选项、借来的经验。
 * 把两者继续写在同一个文件里，每加一个功能都要在一堆旧 UI 之间找插槽 ——
 * 这就是方案 §32 要防的「屎山」。所以：
 *
 * ```text
 * isSessionMode → <SessionPlayScreen />   ← 只渲染新主链要的东西
 * 否则          → 旧的整屏（一行不改）
 * ```
 *
 * **reducer 一行没动**：这里只是把已有状态渲染成另一种样子，
 * 所有动作仍然派发回原来那几个 action。
 *
 * ## 一块屏只讲一件事（§18）
 *
 * ```text
 * ACT 01 / 走进去            ← 幕标（§19）
 * 周六 · 23:46               ← 场景（§20）
 * 一句环境变化 + 人物台词      ← 叙事
 * 你的处境（选项）            ← 行动（§21）
 * 必要时：借来的经验           ← §13 / §14
 * ```
 */

export type SessionActObjective = 'enter-world' | 'experience-cost' | 'meet-counterexample';

export interface SessionPlayView {
  readonly question: string;
  readonly act: {
    readonly index: number;
    readonly total: number;
    readonly objective: SessionActObjective;
    /** 由世界编译给出的本幕副标题（§19）。 */
    readonly subtitle: string;
  };
  readonly scene: { readonly sceneId: SceneId; readonly timeLabel: string };
  /** 当前说话人；没人说话时是 null。 */
  readonly speaker: SpeakerId | null;
  /** 台上的人（立绘层要的是数组，不是单个位置）。 */
  readonly stage: readonly CharacterOnStage[];
  readonly title: string;
  readonly storyText: string;
  /**
   * 回合阶段。`critical` 只是状态机里的一个瞬间 —— 页面会立刻把它收束到终局
   * （新主链不展示属性，也就不该被属性判死），所以这里不单独渲染它。
   */
  readonly phase: 'story' | 'choices' | 'outcome' | 'checking' | 'critical' | 'ended';
  readonly choices: readonly ScenarioChoice[];
  readonly outcome: { readonly title: string; readonly detail: string } | null;
  readonly loading: boolean;
  /** 本局真正用到的经验卡（§13）。 */
  readonly cards: readonly ExperienceCardData[];
  /** 结算数据；没结束就是 null。 */
  readonly endgame: {
    readonly originalQuestion: string;
    readonly keyUnknown: string | null;
    readonly experiment: RealityExperiment | null;
    readonly steps: readonly string[];
    readonly highlights: readonly string[];
    readonly unlockedActions: readonly string[];
  } | null;
  /** 被点开的来源弹层内容（§23 的「查看原文」）。 */
  readonly source: {
    readonly open: boolean;
    readonly facts: readonly ExperienceFact[];
    readonly differences: readonly {
      readonly variable: string;
      readonly relation: 'same' | 'different' | 'unknown';
      readonly userValue?: string;
      readonly experienceValue?: string;
    }[];
  };
}

export interface SessionPlayScreenProps {
  readonly view: SessionPlayView;
  readonly onChoose: (choice: ScenarioChoice) => void;
  readonly onAdvance: () => void;
  /**
   * 结算这一刻的随机结果（§19：玩家不再看到骰子，但随机仍然决定遭遇）。
   *
   * 新主链不显示骰面，所以由屏幕自己**自动**把这一次检定结算掉 ——
   * 否则状态机会停在 `checking` 上，玩家永远看不到结果。
   */
  readonly onResolveCheck: () => void;
  readonly onQuit: () => void;
  readonly onOpenSource: (choice: ScenarioChoice) => void;
  readonly onCloseSource: () => void;
  readonly experienceOpen: boolean;
  readonly onOpenExperience: () => void;
  readonly onCloseExperience: () => void;
}

const ACT_HEADING: Readonly<Record<SessionActObjective, { readonly label: string; readonly number: string }>> = {
  'enter-world': { label: '走进去', number: '01' },
  'experience-cost': { label: '代价出现', number: '02' },
  'meet-counterexample': { label: '另一个答案', number: '03' },
};

/**
 * 叙事文字：逐字打出，但**不阻塞** —— 点一下立刻看全。
 *
 * 打字机是这个作品的既有质感（DESIGN.md §4），保留；但「必须等字打完」
 * 是演示事故的常见来源，所以任意时刻都可以跳过。
 */
function StoryText({ text }: { readonly text: string }) {
  const { visible, done, skip } = useTypewriter(text, { speed: 18 });
  return (
    <button
      type="button"
      onClick={() => skip()}
      className="block w-full cursor-text text-left"
      aria-label="点击可直接显示全文"
    >
      <span className="block whitespace-pre-line text-[15px] leading-[1.9] text-slate-200">
        {visible}
        {!done ? <span className="ml-0.5 animate-pulse text-zhihu-300">▌</span> : null}
      </span>
    </button>
  );
}

export function SessionPlayScreen({
  view,
  onChoose,
  onAdvance,
  onResolveCheck,
  onQuit,
  onOpenSource,
  onCloseSource,
  experienceOpen,
  onOpenExperience,
  onCloseExperience,
}: SessionPlayScreenProps) {
  const heading = ACT_HEADING[view.act.objective] ?? ACT_HEADING['enter-world'];
  const unlockCards = view.choices.filter((choice) => choice.experienceUnlockId);

  /**
   * 检定自动结算（§19）：不显示骰子，但结果仍由随机决定。
   *
   * 留 ~900ms 让「这一刻的结果不由你决定」被看见，再落结算 ——
   * 既有随机性的分量，又不出现骰子界面。
   */
  const checking = view.phase === 'checking';
  React.useEffect(() => {
    if (!checking) {
      return;
    }
    const timer = window.setTimeout(() => onResolveCheck(), 900);
    return () => window.clearTimeout(timer);
  }, [checking, onResolveCheck]);

  return (
    <main className="relative min-h-[100dvh] bg-ink-950">
      {/* 顶部：幕标 + 一个问题出口。刻意只有这两样（§18）。 */}
      <header className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-3 px-5 pt-5">
        <span className="act-label">
          ACT {heading.number}
        </span>
        <span className="flex items-center gap-4">
          {view.cards.length > 0 ? (
            <button
              type="button"
              onClick={onOpenExperience}
              className="font-mono text-[11px] text-relic-jade/90 transition-colors duration-200 hover:text-relic-jade"
            >
              借来的经验 · {view.cards.length}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onQuit}
            className="font-mono text-[11px] text-slate-600 transition-colors duration-200 hover:text-slate-300"
          >
            换一个问题
          </button>
        </span>
      </header>

      <div className="mx-auto w-full max-w-[720px] px-5 pb-16">
        {/* 幕头（§19）：幕名 + 那句副标题 */}
        <div className="mt-6">
          <h1 className="text-[22px] font-bold leading-snug text-white">{heading.label}</h1>
          {view.act.subtitle ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{view.act.subtitle}</p>
          ) : null}
        </div>

        {/* 场景舞台：保留原有的立绘与场景（它们是氛围，不是数值） */}
        <div className="relative mt-5 h-[220px] overflow-hidden rounded-3xl border border-white/8 bg-ink-900">
          <SceneStage sceneId={view.scene.sceneId} />
          <PortraitLayer stage={view.stage} speaker={view.speaker} />
          <div className="absolute bottom-2.5 left-3.5 font-mono text-[11px] text-slate-400">
            {view.scene.timeLabel}
          </div>
        </div>

        {/* 叙事 */}
        <section className="mt-5">
          {view.loading ? (
            <p className="animate-pulse font-mono text-[12px] text-slate-600">
              这一局正在继续往下长…
            </p>
          ) : (
            <>
              {view.title ? (
                <p className="text-[13px] font-semibold text-slate-400">{view.title}</p>
              ) : null}
              <div className="mt-2">
                <StoryText text={view.storyText} />
              </div>
            </>
          )}
        </section>

        {/* 这一幕的叙事讲完了：给一个明确的「继续」，不让玩家卡在文本上 */}
        {view.phase === 'story' && !view.loading ? (
          <button
            type="button"
            onClick={onAdvance}
            className="door-btn mt-6 max-w-[240px]"
          >
            继续
          </button>
        ) : null}

        {/* 检定中：不显示骰子，只说明「结果不由你决定」 */}
        {checking ? (
          <p className="mt-6 animate-pulse font-mono text-[12px] text-slate-500">
            这一刻的结果不由你决定…
          </p>
        ) : null}

        {/* 选项（§21）：普通选项与经验解锁选项视觉不同 */}
        {view.phase === 'choices' && !view.loading ? (
          <section className="mt-6 flex flex-col gap-3">
            {unlockCards.length > 0 ? (
              <p className="reveal-in text-[12px] font-semibold text-relic-jade">
                你多看见了一种做法。
              </p>
            ) : null}

            {view.choices.map((choice) => {
              const isUnlock = Boolean(choice.experienceUnlockId);
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => onChoose(choice)}
                  className={[
                    'w-full rounded-2xl border px-4 py-3.5 text-left transition-colors duration-200',
                    isUnlock
                      ? 'unlock-card reveal-in hover:border-relic-jade/60'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]',
                  ].join(' ')}
                >
                  {isUnlock ? (
                    <span className="mb-1.5 block font-mono text-[10px] tracking-[0.2em] text-relic-jade">
                      ✦ 借来的经验
                    </span>
                  ) : null}
                  <span className="block text-[15px] font-semibold leading-relaxed text-slate-100">
                    {choice.text}
                  </span>
                  {choice.hint ? (
                    <span className="mt-1 block text-[12px] leading-relaxed text-slate-500">
                      {choice.hint}
                    </span>
                  ) : null}
                  {isUnlock ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenSource(choice);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenSource(choice);
                        }
                      }}
                      className="source-link mt-2"
                    >
                      来自知乎真实经历 →
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        ) : null}

        {/* 结果（这一幕发生了什么） */}
        {view.phase === 'outcome' && view.outcome ? (
          <section className="mt-6 fade-in">
            <p className="text-[14px] font-semibold text-slate-200">{view.outcome.title}</p>
            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-slate-400">
              {view.outcome.detail}
            </p>
            <button type="button" onClick={onAdvance} className="door-btn mt-5 max-w-[260px]">
              {view.act.index >= view.act.total ? '走完了' : '继续'}
            </button>
          </section>
        ) : null}

        {/* 终局（§27）：问题重写是这一屏的第一视觉 */}
        {view.phase === 'ended' && view.endgame ? (
          <SessionEndgame
            className="mt-6"
            originalQuestion={view.endgame.originalQuestion}
            keyUnknown={view.endgame.keyUnknown}
            experiment={view.endgame.experiment}
            steps={view.endgame.steps}
            highlights={view.endgame.highlights}
            unlockedActions={view.endgame.unlockedActions}
          />
        ) : null}
      </div>

      {/* 借来的经验（§13）：抽屉里是「一个人的一段经历」 */}
      {experienceOpen ? (
        <div className="fixed inset-0 z-[70] flex justify-end bg-ink-950/80 backdrop-blur-sm" onClick={onCloseExperience} role="presentation">
          <aside
            role="dialog"
            aria-label="借来的经验"
            onClick={(event) => event.stopPropagation()}
            className="h-full w-full max-w-[420px] overflow-y-auto border-l border-white/10 bg-ink-900/95 px-5 py-5"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-white">借来的经验</h2>
              <button
                type="button"
                onClick={onCloseExperience}
                className="font-mono text-[11px] text-slate-500 transition-colors duration-200 hover:text-slate-200"
              >
                关闭
              </button>
            </header>
            <ExperienceCardPanel cards={view.cards} className="mt-4" />
          </aside>
        </div>
      ) : null}

      <ExperienceSourceModal
        open={view.source.open}
        onClose={onCloseSource}
        facts={view.source.facts}
        differences={view.source.differences}
      />
    </main>
  );
}

export default SessionPlayScreen;
