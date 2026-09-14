'use client';

import * as React from 'react';

import { ExperienceSourceModal } from '@/components/game/ExperienceSourceModal';
import { SessionActHeader } from '@/components/game/session/SessionActHeader';
import { SessionChoiceList } from '@/components/game/session/SessionChoiceList';
import { SessionCollisionStage } from '@/components/game/session/SessionCollisionStage';
import { SessionEndgameScreen } from '@/components/game/session/SessionEndgameScreen';
import { SessionExperienceDock } from '@/components/game/session/SessionExperienceDock';
import { SessionStoryStage } from '@/components/game/session/SessionStoryStage';
import { SessionUnknownStage } from '@/components/game/session/SessionUnknownStage';
import { loadingCopyOf } from '@/components/game/session/viewModel';
import type { SessionActObjective, SessionPlayScreenProps } from '@/components/game/session/types';
import { AuroraBand } from '@/components/visual/AuroraBand';
import { CounterOrbit } from '@/components/visual/CounterOrbit';
import { OrbitField } from '@/components/visual/OrbitField';
import { KanshanSprite } from '@/components/characters/KanshanSprite';
import { AI_UNAVAILABLE } from '@/features/run/errorCopy';
import { actAtmosphereOf } from '@/features/visual/archive';

/**
 * Session 主链的推演屏（Agent 03 §三 / §五 / §六 / §三十）。
 *
 * ## 它的职责边界
 *
 * ```text
 * play/page.tsx
 * ├─ data loading
 * ├─ common runtime handlers
 * ├─ SessionPlayScreen   ← 只渲染 SessionPlayView
 * └─ legacy render       ← 旧 RPG 整屏，一行未动
 * ```
 *
 * 屏幕**不碰 reducer、不碰旧 UI**：所有动作仍然由页面派发回原来那几个
 * action，这里只负责「这一幕长什么样」。
 *
 * ## §五 的禁止清单是用测试钉死的
 *
 * ```text
 * BossTerminal / BossVerdictPanel / DiceModal / FateTree / GameHud /
 * InventoryBar / AxisHUD / AxisSlider / EvidenceMeshView / ClarityRadar /
 * EngineStatusBar / CommitPicker / CriticalPointCard / EndgameReport / EndgamePass
 * ```
 *
 * 这棵子树里没有属性条、没有骰子、没有 Boss、没有遗物 —— 不是「记得别渲染」，
 * 而是这些模块的 import 会被 `tests/sessionPlayScreen.contract.test.ts` 拦下。
 *
 * ## 三幕空气（报告 §10 / 04_AGENT §22）
 *
 * ```text
 * Act I   冷蓝 / 空旷 / 轨道稀疏
 * Act II  更暗 / 更近 / 轨道略密
 * Act III 灰蓝 / 琥珀 / 分叉
 * Ending  接近纯黑 / 轨道退出
 * ```
 *
 * 空气由 `.session-stage[data-act]` 与 `OrbitField` 的 count 表达，
 * 材质与动画全部归 Agent 04 的 `globals.css`，这里只提供结构。
 */
export type { SessionPlayScreenProps };

/** §22：每一幕的轨道密度（Desktop 上限 10 条）。END 时轨道逐渐退出。 */
const ACT_ORBITS: Readonly<Record<'1' | '2' | '3' | 'end', number>> = {
  '1': 5,
  '2': 7,
  '3': 9,
  end: 2,
};

/** 幕次数据属性：1 / 2 / 3 / end（与 `globals.css` 的 `.session-stage[data-act]` 对齐）。 */
function actKeyOf(objective: SessionActObjective, ended: boolean): '1' | '2' | '3' | 'end' {
  if (ended) {
    return 'end';
  }
  if (objective === 'experience-cost') {
    return '2';
  }
  if (objective === 'meet-counterexample') {
    return '3';
  }
  return '1';
}

/** 统一失败态（§二十五）：文案固定，技术细节只进 console。 */
function ErrorState({
  message,
  onRetry,
  onBackToQuestion,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly onBackToQuestion?: () => void;
}) {
  return (
    <section className="session-error obs-glass obs-brackets mt-10 px-5 py-6" role="alert">
      <p className="text-[17px] font-semibold leading-relaxed" style={{ color: 'var(--obs-text-0)' }}>
        {message}
      </p>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
        {AI_UNAVAILABLE.hint}
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="door-btn sm:max-w-[200px]">
            重试
          </button>
        ) : null}
        {onBackToQuestion ? (
          <button
            type="button"
            onClick={onBackToQuestion}
            className="min-h-11 border px-5 text-[14px] font-semibold transition-opacity duration-200 hover:opacity-80 sm:max-w-[240px]"
            style={{ borderColor: 'var(--obs-hairline)', color: 'var(--obs-text-1)' }}
          >
            返回修改问题
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function SessionPlayScreen({
  view,
  onChoose,
  onAdvance,
  onResolveCheck,
  onQuit,
  onRetry,
  onBackToQuestion,
  onOpenSource,
  onCloseSource,
  onSelectCollisionFocus,
  onContinueFromUnknown,
}: SessionPlayScreenProps) {
  /**
   * 检定自动结算（§十九）：新主链不显示骰子，但「这一刻的结果不由你决定」
   * 必须被看见。留 ~900ms 让这句话落地，然后自己把它结算掉 ——
   * 否则状态机会停在 `checking` 上，玩家永远看不到结果。
   */
  const checking = view.phase === 'story' && view.loadingPhase === 'resolving-choice';
  React.useEffect(() => {
    if (!checking) {
      return;
    }
    const timer = window.setTimeout(() => onResolveCheck(), 900);
    return () => window.clearTimeout(timer);
  }, [checking, onResolveCheck]);

  /** 经验抽屉是**屏幕自己的**局部状态：它不影响 reducer，也不该进页面状态。 */
  const [dockOpen, setDockOpen] = React.useState(false);

  /**
   * 经验卡获得演出（GAME-DESIGN §4.3）。
   *
   * 「借来一张卡」是这个产品的核心时刻之一，不能只是抽屉里的数字 +1 ——
   * 卡片入册的瞬间要有一次可见的获得演出 + HUD 脉冲。纪律：
   *
   * - 初次挂载时已有的卡片**不算获得**（那是开局就借到的，不是这一刻发生的）；
   * - 只有 `view.experiences` 真的长出新 id 才播，且一局内每张卡只播一次；
   * - 入场复用 fragment-materialize，出场是 380ms transition —— 零新增 keyframes。
   */
  const [gained, setGained] = React.useState<{ readonly id: string; readonly title: string } | null>(null);
  const [gainLeaving, setGainLeaving] = React.useState(false);
  const seenExperienceIdsRef = React.useRef<ReadonlySet<string> | null>(null);

  React.useEffect(() => {
    const current = new Set(view.experiences.map((card) => card.id));
    const seen = seenExperienceIdsRef.current;
    seenExperienceIdsRef.current = current;
    // 初次渲染：把已有卡片登记为「开局就有」，不播获得演出。
    if (seen === null) {
      return;
    }
    const fresh = view.experiences.filter((card) => !seen.has(card.id));
    if (fresh.length === 0) {
      return;
    }
    const card = fresh[fresh.length - 1]!;
    setGained({ id: card.id, title: view.cardTitles[card.id] ?? '一个人的一段经历' });
    setGainLeaving(false);
    const leaveTimer = window.setTimeout(() => setGainLeaving(true), 2600);
    const removeTimer = window.setTimeout(() => setGained(null), 3050);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [view.experiences, view.cardTitles]);

  const atmosphere = actAtmosphereOf(view.act.objective, view.phase === 'ended');
  const actKey = actKeyOf(view.act.objective, view.phase === 'ended');

  /** 完全空白 + loading：这是「世界还在编译」的那一屏（§二十六）。 */
  const isEmptyPlaceholder =
    view.loading && view.story.text.length === 0 && view.story.title.length === 0 && view.choices.length === 0;

  const encounter = view.encounter;
  const collision = encounter?.type === 'experience-collision' ? encounter.collision : null;
  /**
   * 未知锁有两条出口，这里合成一个变量（§十八）：
   *
   * ```text
   * 本幕只有未知、别无交互 → encounter 本身就是它（此时它取代选项）
   * 本幕同时有反例与未知   → encounter 是反例，未知在幕末收尾
   * ```
   */
  const unknown =
    view.unknownLock ?? (encounter?.type === 'unknown-lock' ? encounter.unknown : null);

  return (
    <main
      className={['session-stage obs-shell', view.phase === 'ended' ? 'obs-shell--still' : '']
        .filter(Boolean)
        .join(' ')}
      data-act={actKey}
      data-atmosphere={atmosphere}
    >
      {/* §4.7 极光带：全站唯一的情绪指示器（一幕一个颜色，最多两种强调色同屏） */}
      <AuroraBand tone={actKey === 'end' ? 'end' : actKey === '3' ? 'counter' : 'seek'} />

      {/* §22：每一幕的轨道密度不同；END 时逐渐退出 */}
      <OrbitField
        count={ACT_ORBITS[actKey]}
        accent={actKey === '3' ? 'mixed' : 'path'}
        near={view.phase === 'choice'}
      />

      <div className="relative mx-auto w-full max-w-[720px] px-5 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {/* 每一幕开始时，一条极细的扫描线扫过 —— 幕与幕之间有一个明确的「换场」 */}
        <span key={`sweep-${actKey}`} aria-hidden="true" className="obs-act-sweep" />

        <SessionActHeader act={view.act} className="pt-5">
          <SessionExperienceDock
            experiences={view.experiences}
            cardTitles={view.cardTitles}
            open={dockOpen}
            onOpen={() => setDockOpen(true)}
            onClose={() => setDockOpen(false)}
          />
          <button
            type="button"
            onClick={onQuit}
            className="min-h-11 text-[11px] transition-opacity duration-200 hover:opacity-80"
            style={{ color: 'var(--obs-text-2)' }}
          >
            换一个问题
          </button>
        </SessionActHeader>

        {/*
          极简 HUD（GAME-DESIGN §4.8）：幕次 / 经验卡 / 未知。
          没有血条、没有分数 —— 未知数刻意用未显影灰，它不是待解锁的成就。
          终局不显示：那一刻屏幕上只该有问题（§二十二）。
        */}
        {view.phase === 'ended' ? null : (
          <div className="gd-hud mt-3" aria-label="本局状态">
            <span className="gd-hud__act">
              ACT {String(view.act.display).padStart(2, '0')} / {String(view.act.total).padStart(2, '0')}
            </span>
            <span className={gained ? 'gd-hud__cards gd-hud__cards--pulse' : 'gd-hud__cards'}>
              ◈ 经验卡 ×{view.experiences.length}
            </span>
            <span className="gd-hud__unknown">? 未知 ×{unknown ? 1 : 0}</span>
          </div>
        )}

        {view.error ? (
          <ErrorState message={view.error} onRetry={onRetry} onBackToQuestion={onBackToQuestion} />
        ) : isEmptyPlaceholder ? (
          <section className="mt-16 flex flex-col items-center gap-3" aria-live="polite">
            <p className="obs-kicker">WORLD COMPILING</p>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--obs-text-1)' }}>
              {loadingCopyOf(view.loadingPhase)}
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
              我们只会说现在真的在等什么 —— 没有假进度条。
            </p>
          </section>
        ) : (
          <>
            {/*
              第三幕反例揭示（§28）：刘看山第二次出现。
              它是一个叙述转场，不是失败判定 —— 低饱和琥珀，不用红色警报。
            */}
            {view.act.objective === 'meet-counterexample' &&
            view.phase === 'story' &&
            view.counterFrame ? (
              <div className="mt-5">
                <div className="flex items-start gap-3">
                  {/*
                    看山状态机 · 反例揭示态 ghost（GAME-DESIGN §4.1）：
                    虚影模式 —— 去饱和 + 降透明度，视觉上先感到不对，再读到内容。
                    原先立在旁边的线稿剪影（信号源）已随整体下架，这里只留 ghost 实体。
                  */}
                  <span className="gd-guide gd-guide--ghost">
                    <span className="gd-guide__base">
                      <KanshanSprite
                        characterId="ghost"
                        action="sway"
                        className="gd-guide__sprite gd-guide__sprite--sm"
                        alt=""
                      />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[15px] font-bold"
                      style={{
                        color: 'var(--obs-counter-soft)',
                        animation: 'fragment-materialize 520ms var(--obs-ease) both',
                      }}
                    >
                      等等。
                    </p>
                    <p
                      className="mt-1 text-[13px] leading-relaxed"
                      style={{
                        color: 'var(--obs-counter-soft)',
                        opacity: 0.8,
                        animation: 'fragment-materialize 560ms var(--obs-ease) both',
                        animationDelay: '560ms',
                      }}
                    >
                      这个人的结果和前面完全相反。
                    </p>
                  </div>
                </div>

                <CounterOrbit
                  active
                  className="mt-5"
                  previousLabel={view.counterFrame.previousLabel}
                  counterLabel={view.counterFrame.counterLabel}
                  rows={view.counterFrame.rows}
                />
              </div>
            ) : null}

            {/*
              叙事舞台。终局不再显示它：那一刻屏幕上只该有问题（§二十二），
              而且 reducer 在收尾时会把 `dialogueText` 设成旧路径的过场文案
              （「…生成《专属避坑指南》」）—— 那句话不属于新主链，绝不能
              被当成终局的第一眼。
            */}
            {view.phase === 'ended' ? null : (
              <SessionStoryStage story={view.story} loading={view.loading} />
            )}

            {/* 这一幕的叙事讲完了：给一个明确的「继续」 */}
            {view.phase === 'story' && !view.loading && !checking ? (
              <button type="button" onClick={onAdvance} className="door-btn mt-6 max-w-[240px]">
                继续
              </button>
            ) : null}

            {/* 检定中：不显示骰面，只说明结果不由玩家决定 */}
            {checking ? (
              <p className="mt-6 animate-pulse text-[12px]" style={{ color: 'var(--obs-text-2)' }}>
                {loadingCopyOf('resolving-choice')}
              </p>
            ) : null}

            {/*
              选项（§十三）。本幕**只有**未知锁、别无交互时，它取代选项：
              这里已经没有可靠现实信息继续推演了，再给几个选项就是让玩家瞎猜（§十八）。
            */}
            {view.phase === 'choice' && !view.loading ? (
              unknown && !collision ? (
                <SessionUnknownStage view={unknown} onContinue={onContinueFromUnknown ?? onAdvance} />
              ) : (
                <>
                  {collision ? (
                    <SessionCollisionStage view={collision} onSelectFocus={onSelectCollisionFocus} />
                  ) : null}
                  <SessionChoiceList
                    choices={view.choices}
                    onChoose={onChoose}
                    onOpenSource={onOpenSource}
                  />
                </>
              )
            ) : null}

            {/*
              结果（这一幕发生了什么）。

              最后一幕的结果之后，如果本局还留着一个未解的未知，收尾就不是
              普通的「走完了」，而是**最诚实的那一句**：这里已经没得推了，
              剩下的只能回到现实验证（§十八 / §二十三）。这正是 06_AGENT 的
              E2E 清单里「第三幕反例 → Unknown → Endgame」的顺序 ——
              反例与未知可以在同一幕同时存在，这时先看冲突，再看诚实。
            */}
            {view.phase === 'reflection' ? (
              <>
                <section className="session-reflection mt-6">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--obs-text-1)' }}>
                    {view.outcome?.title || '这一刻过去了'}
                  </p>
                  <p
                    className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed"
                    style={{ color: 'var(--obs-text-1)' }}
                  >
                    {view.outcome?.detail ?? ''}
                  </p>
                  {unknown ? null : (
                    <button type="button" onClick={onAdvance} className="door-btn mt-5 max-w-[260px]">
                      {view.act.display >= view.act.total ? '走完了' : '继续'}
                    </button>
                  )}
                </section>

                {unknown ? (
                  <SessionUnknownStage
                    view={unknown}
                    onContinue={onContinueFromUnknown ?? onAdvance}
                  />
                ) : null}
              </>
            ) : null}

            {/* 终局（§十九 - §二十二） */}
            {view.phase === 'ended' && view.endgame ? (
              <SessionEndgameScreen view={view.endgame} />
            ) : null}
          </>
        )}

        {/* 仪表脚注：观象厅里永远显示你现在在回答哪个问题 —— 它是一台仪器 */}
        <div className="obs-instrument-bar">
          <span className="obs-instrument-bar__key">Coordinate</span>
          <span className="min-w-0 flex-1 truncate" title={view.question}>
            {view.question}
          </span>
        </div>
      </div>

      <ExperienceSourceModal
        open={view.source.open}
        onClose={onCloseSource}
        facts={view.source.facts}
        differences={view.source.differences}
      />

      {/*
        经验卡获得演出（GAME-DESIGN §4.3）：一张借来的人生入册的瞬间。
        不是 Toast（成就语言），是「收集」—— 所以它报的是谁的哪段经历，
        而不是「你获得了什么奖励」。
      */}
      {gained ? (
        <div
          className={['gd-card-gain', gainLeaving ? 'gd-card-gain--leaving' : '']
            .filter(Boolean)
            .join(' ')}
          role="status"
        >
          <span className="gd-card-gain__kicker">Borrowed Experience</span>
          <span className="gd-card-gain__title">{gained.title}</span>
          <span className="gd-card-gain__line">借来的经验 +1 · 它可能会在某一幕打开一条新路。</span>
        </div>
      ) : null}
    </main>
  );
}

export default SessionPlayScreen;
