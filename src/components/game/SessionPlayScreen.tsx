'use client';

import * as React from 'react';

import { PortraitLayer } from '@/components/characters/PortraitLayer';
import { SceneStage } from '@/components/scenes/SceneStage';
import { ExperienceCardPanel, type ExperienceCardData } from '@/components/game/ExperienceCardPanel';
import { ExperienceSourceModal } from '@/components/game/ExperienceSourceModal';
import { SessionEndgame } from '@/components/game/SessionEndgame';
import { CounterOrbit, type CounterOrbitRow } from '@/components/visual/CounterOrbit';
import { HiddenPathReveal } from '@/components/visual/HiddenPathReveal';
import { OrbitField } from '@/components/visual/OrbitField';
import { actAtmosphereOf, type ActAtmosphere } from '@/features/visual/archive';

import type { RealityExperiment } from '@/features/decision-session/domain';
import type { ExperienceFact } from '@/features/experience/domain';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';
import type { CharacterOnStage, SceneId, SpeakerId } from '@/types/narrative';

/**
 * 新主链的推演屏（04_AGENT §21 / §22 / §23 / §24 / §25 / §28 / §29）。
 *
 * ## 它是一幕互动人生，不是「网页 + 面板」
 *
 * 每一幕同时只保留：幕 / 场景 / 文字 / 人物 / 选择（必要时加 Experience Card）。
 * 三幕各有自己的空气（§22）：
 *
 * ```text
 * ACT I   冷蓝 / 开阔 / 轨道稀疏
 * ACT II  背景更暗 / 局部光源更近 / 轨道略密
 * ACT III 加入琥珀 Counter Orbit
 * END     背景几乎纯黑 / 轨道逐渐退出
 * ```
 *
 * 空气由 `.session-stage[data-act]` 与 `OrbitField` 的 count 表达，
 * 不再用内联 background 字符串 —— 这样三幕的光都在 CSS 里，可被 reduced motion 关掉。
 *
 * ## 三条被点名的表演
 *
 * 1. **Hidden Path Reveal**（§25）：普通 Gate 先暗 150ms，然后一条极细轨迹
 *    在空白处亮起并生长，新行动从里面出现 —— 全产品最重要的记忆点；
 * 2. **Counter Orbit**（§28 / §29）：第三幕琥珀轨道从另一侧进入，
 *    左遗物 / 中央极细琥珀轴 / 右遗物，只比相同/不同/未知；
 * 3. **Sentence Reforge**（§31）：终局只留一个问题重写。
 *
 * **reducer 一行没动**：这里只是把已有状态渲染成另一种样子，
 * 所有动作仍然派发回原来那几个 action。
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
  /** 每张卡的行动式抬头（§24），键是 `card.id`；没有就退回中性兜底。 */
  readonly cardTitles: Readonly<Record<string, string>>;
  /**
   * 第三幕反例分屏数据（§28 / §29）。
   *
   * 可选：没有可对照的两条真实走法时为 null，页面就不显示分屏 ——
   * 不为了「这一幕该有分屏」而凑一组不存在的数据。
   */
  readonly counterFrame?: {
    readonly previousLabel: string;
    readonly counterLabel: string;
    readonly rows: readonly CounterOrbitRow[];
  } | null;
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

/** §22：每一幕的轨道密度（Desktop 上限 10 条）。END 时轨道逐渐退出。 */
const ACT_ORBITS: Readonly<Record<'1' | '2' | '3' | 'end', number>> = {
  '1': 5,
  '2': 7,
  '3': 9,
  end: 2,
};

/** 幕次数据属性：1 / 2 / 3 / end。 */
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

/**
 * 场景文字：按换行与句读切句，每句以 150ms 错位淡入。
 *
 * 刻意不用打字机（打字机让读者等字，句读让读者读意思），
 * 也刻意只用 §34 允许的 `fragment-materialize`（opacity + translate）。
 */
function phraseListOf(text: string): readonly string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function PhraseText({ text }: { readonly text: string }) {
  const phrases = React.useMemo(() => phraseListOf(text), [text]);
  if (phrases.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {phrases.map((phrase, index) => (
        <span
          key={`${index}-${phrase.slice(0, 6)}`}
          className="session-story block"
          style={{
            animation: 'fragment-materialize 520ms var(--obs-ease) both',
            animationDelay: `${Math.min(index, 12) * 150}ms`,
          }}
        >
          {phrase}
        </span>
      ))}
    </div>
  );
}

/** 选项左侧的世界线：hover 时向该选项偏移，表达「选择正在改变当前世界线」。 */
function ChoiceWorldline({ accent }: { readonly accent: 'unlock' | 'normal' }) {
  const stroke = accent === 'unlock' ? 'var(--obs-path-soft)' : 'var(--obs-zhihu-soft)';
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 24"
      preserveAspectRatio="none"
      className="h-6 w-[72px] shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-1"
    >
      <line x1="2" y1="12" x2="112" y2="12" stroke={stroke} strokeWidth="0.9" opacity="0.7" />
      <circle cx="112" cy="12" r="2.4" fill={stroke} />
    </svg>
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
  const atmosphere: ActAtmosphere = actAtmosphereOf(view.act.objective, view.phase === 'ended');
  const actKey = actKeyOf(view.act.objective, view.phase === 'ended');
  const unlockCards = view.choices.filter((choice) => choice.experienceUnlockId);
  const normalChoices = view.choices.filter((choice) => !choice.experienceUnlockId);
  const unlockKey = unlockCards.map((choice) => choice.id).join('|');

  /**
   * 检定自动结算（§19）：不显示骰子，但结果仍由随机决定。
   * 留 ~900ms 让「这一刻的结果不由你决定」被看见。
   */
  const checking = view.phase === 'checking';
  React.useEffect(() => {
    if (!checking) {
      return;
    }
    const timer = window.setTimeout(() => onResolveCheck(), 900);
    return () => window.clearTimeout(timer);
  }, [checking, onResolveCheck]);

  /**
   * Hidden Path Reveal 的第一拍（§25）：新 action mount 之前，普通 Gate 稍暗 150ms。
   * 之后才把新 Gate 交给 HiddenPathReveal —— 时间线写在 CSS 里，这里只管两态。
   */
  const [unlockPhase, setUnlockPhase] = React.useState<'idle' | 'dim' | 'reveal'>('idle');
  const revealing = view.phase === 'choices' && unlockCards.length > 0;
  React.useEffect(() => {
    if (!revealing) {
      setUnlockPhase('idle');
      return;
    }
    setUnlockPhase('dim');
    const timer = window.setTimeout(() => setUnlockPhase('reveal'), 150);
    return () => window.clearTimeout(timer);
  }, [revealing, unlockKey]);

  const renderChoice = (choice: ScenarioChoice, state: 'normal' | 'unlocked' = 'normal') => {
    const isUnlock = state === 'unlocked';
    return (
      <button
        key={choice.id}
        type="button"
        onClick={() => onChoose(choice)}
        className={[
          'session-choice group',
          isUnlock ? 'session-choice--unlocked' : '',
          // §25 第一步：新行动出现前，普通 Gate 稍暗
          !isUnlock && unlockPhase === 'dim' ? 'session-choice--dimmed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <ChoiceWorldline accent={isUnlock ? 'unlock' : 'normal'} />
        <span className="min-w-0 flex-1">
          {isUnlock ? <span className="session-choice__badge">◆ 借来的经验</span> : null}
          <span className="session-choice__title">{choice.text}</span>
          {choice.hint ? <span className="session-choice__hint">{choice.hint}</span> : null}
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
        </span>
      </button>
    );
  };

  return (
    <main
      className={[
        'session-stage obs-shell',
        view.phase === 'ended' ? 'obs-shell--still' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-act={actKey}
      data-atmosphere={atmosphere}
    >
      {/* §22：每一幕的轨道密度不同；END 时逐渐退出 */}
      <OrbitField
        count={ACT_ORBITS[actKey]}
        accent={actKey === '3' ? 'mixed' : 'path'}
        near={view.phase === 'choices'}
      />

      {/* 顶部：幕标 + 一个问题出口。刻意只有这两样（§18）。 */}
      <header className="session-act-header mx-auto flex w-full max-w-[720px] items-center justify-between gap-3 px-5 pt-5">
        <span className="obs-kicker">Act {heading.number}</span>
        <span className="flex items-center gap-4">
          {view.cards.length > 0 ? (
            <button
              type="button"
              onClick={onOpenExperience}
              className="text-[11px] tracking-[0.08em] text-[color:var(--obs-path-soft)] transition-opacity duration-200 hover:opacity-80"
            >
              借来的经验 · {view.cards.length}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onQuit}
            className="text-[11px] text-[color:var(--obs-text-2)] transition-opacity duration-200 hover:opacity-80"
          >
            换一个问题
          </button>
        </span>
      </header>

      <div className="relative mx-auto w-full max-w-[720px] px-5 pb-16">
        {/* 幕头（§19）：幕名 + 那句副标题 */}
        <div className="mt-6">
          <h1 className="text-[22px] font-bold leading-snug text-[color:var(--obs-text-0)]">
            {heading.label}
          </h1>
          {view.act.subtitle ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--obs-text-2)]">
              {view.act.subtitle}
            </p>
          ) : null}
        </div>

        {/*
          第三幕反例揭示（§28）：刘看山第二次出现。
          它是一个叙述转场，不是失败判定 —— 用低饱和琥珀，不用红色警报。
        */}
        {view.act.objective === 'meet-counterexample' && view.phase === 'story' ? (
          <div className="mt-5">
            <p
              className="text-[15px] font-bold text-[color:var(--obs-counter-soft)]"
              style={{ animation: 'fragment-materialize 520ms var(--obs-ease) both' }}
            >
              等等。
            </p>
            <p
              className="mt-1 text-[13px] leading-relaxed text-[color:var(--obs-counter-soft)]/80"
              style={{
                animation: 'fragment-materialize 560ms var(--obs-ease) both',
                animationDelay: '560ms',
              }}
            >
              这个人的结果和前面完全相反。
            </p>

            {view.counterFrame ? (
              <CounterOrbit
                active
                className="mt-5"
                previousLabel={view.counterFrame.previousLabel}
                counterLabel={view.counterFrame.counterLabel}
                rows={view.counterFrame.rows}
              />
            ) : null}
          </div>
        ) : null}

        {/* 场景舞台：保留原有的立绘与场景（它们是氛围，不是数值）。
            观测窗：把 legacy 的场景插画压成「舱外的一格视野」，而不是一张浮起的截图。 */}
        <div className="session-scene-frame relative mt-5 h-[220px] overflow-hidden border border-[color:rgb(var(--obs-rgb-text-0)/0.1)] bg-[color:rgb(var(--obs-rgb-bg-0)/0.6)]">
          <SceneStage sceneId={view.scene.sceneId} />
          <PortraitLayer stage={view.stage} speaker={view.speaker} />
          <span aria-hidden="true" className="session-scene-frame__veil" />
          <div className="absolute bottom-2.5 left-3.5 z-10 obs-kicker">{view.scene.timeLabel}</div>
        </div>

        {/* 叙事：Phrase Reveal（报告 §12） */}
        <section className="mt-5">
          {view.loading ? (
            <p className="animate-pulse text-[12px] text-[color:var(--obs-text-2)]">
              这一局正在继续往下长…
            </p>
          ) : (
            <>
              {view.title ? (
                <p className="text-[13px] font-semibold text-[color:var(--obs-text-2)]">{view.title}</p>
              ) : null}
              <div className="mt-2">
                <PhraseText key={view.storyText} text={view.storyText} />
              </div>
            </>
          )}
        </section>

        {/* 这一幕的叙事讲完了：给一个明确的「继续」 */}
        {view.phase === 'story' && !view.loading ? (
          <button type="button" onClick={onAdvance} className="session-choice mt-6 max-w-[240px] justify-center">
            <span className="session-choice__title">继续</span>
          </button>
        ) : null}

        {/* 检定中：不显示骰子，只说明「结果不由你决定」 */}
        {checking ? (
          <p className="mt-6 animate-pulse text-[12px] text-[color:var(--obs-text-2)]">
            这一刻的结果不由你决定…
          </p>
        ) : null}

        {/* 选项（§23 / §24 / §25）：普通选项是一条人生路径；经验解锁的行动在 Hidden Path 里出现 */}
        {view.phase === 'choices' && !view.loading ? (
          <section className="mt-6 flex flex-col gap-3">
            {normalChoices.map((choice) => renderChoice(choice))}

            {unlockCards.length > 0 && unlockPhase !== 'idle' ? (
              <HiddenPathReveal key={unlockKey} active className="mt-3">
                {unlockCards.map((choice) => renderChoice(choice, 'unlocked'))}
              </HiddenPathReveal>
            ) : null}
          </section>
        ) : null}

        {/* 结果（这一幕发生了什么） */}
        {view.phase === 'outcome' && view.outcome ? (
          <section className="mt-6 fade-in">
            <p className="text-[14px] font-semibold text-[color:var(--obs-text-1)]">
              {view.outcome.title}
            </p>
            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-[color:var(--obs-text-2)]">
              {view.outcome.detail}
            </p>
            <button
              type="button"
              onClick={onAdvance}
              className="session-choice mt-5 max-w-[260px] justify-center"
            >
              <span className="session-choice__title">
                {view.act.index >= view.act.total ? '走完了' : '继续'}
              </span>
            </button>
          </section>
        ) : null}

        {/* 终局（§31 / §32）：问题重写是这一屏的第一视觉 */}
        {view.phase === 'ended' && view.endgame ? (
          <SessionEndgame
            className="session-endgame mt-6"
            originalQuestion={view.endgame.originalQuestion}
            keyUnknown={view.endgame.keyUnknown}
            experiment={view.endgame.experiment}
            steps={view.endgame.steps}
            highlights={view.endgame.highlights}
            unlockedActions={view.endgame.unlockedActions}
          />
        ) : null}
      </div>

      {/* 借来的经验（§26 / §27）：抽屉里是「一个人的一段经历」 */}
      {experienceOpen ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-[color:rgb(var(--obs-rgb-bg-0)/0.86)]"
          onClick={onCloseExperience}
          role="presentation"
        >
          <aside
            role="dialog"
            aria-label="借来的经验"
            onClick={(event) => event.stopPropagation()}
            className="obs-shell h-full w-full overflow-y-auto border-l border-[color:rgb(var(--obs-rgb-text-0)/0.1)] px-5 py-5 sm:max-w-[440px]"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[color:var(--obs-text-0)]">借来的经验</h2>
              <button
                type="button"
                onClick={onCloseExperience}
                className="text-[11px] text-[color:var(--obs-text-2)] transition-opacity duration-200 hover:opacity-80"
              >
                关闭
              </button>
            </header>
            <ExperienceCardPanel cards={view.cards} titles={view.cardTitles} className="mt-4" />
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
