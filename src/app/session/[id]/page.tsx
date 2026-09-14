'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { ClarificationStep } from '@/components/session/ClarificationStep';
import { AuroraBand } from '@/components/visual/AuroraBand';
import { ArrivalFlash } from '@/components/visual/UniverseJump';
import { WorldForge, type ForgePhase, type ForgeShard, type ForgeStage } from '@/components/visual/WorldForge';
import { KanshanSprite } from '@/components/characters/KanshanSprite';

import { archiveFragments, fragmentTrackOf, roleTrackOf, type FragmentTrack } from '@/features/visual/archive';
import { consumeJumpArrival, peekJumpQuestion } from '@/features/visual/jump';
import {
  AI_UNAVAILABLE,
  CONTENT_UNAVAILABLE,
  NETWORK_UNAVAILABLE,
  NO_RELIABLE_EXPERIENCE,
  playerFacingError,
  type PlayerFacingError,
} from '@/features/run/errorCopy';
import type { ClarifyQuestion } from '@/features/decision-session/clarify';
import type { DecisionSession } from '@/features/decision-session/domain';

/**
 * Session 编译页（04_AGENT §16 / §17 / §18 / §20）。
 *
 * ## 它不是页面，是一段连续转场
 *
 * ```text
 * 必要时一题一屏的澄清
 * ↓  World Forge：中央是用户的问题，外围是三条人生轨道
 * ↓  真实片段 materialize（只显示一行/两行 exactQuote，不展示完整卡）
 * ↓  三轨向中央收束 → WORLD READY（<= 450ms）→ 自动进入 Play
 * ```
 *
 * ## 三条纪律
 *
 * 1. **API 调用一行没动**：这里只换了 presentation（§16）。
 * 2. **状态必须真实**（§18）：只显示五个真实阶段，没有假百分比、
 *    没有假的「找到 N 位用户」；✓ 只出现在真的拿到片段的那一类上。
 * 3. **失败可退可重试**：没找到就如实说，给「修改问题」与「重新尝试」两条路
 *    （05_AGENT §9：错误态只出人话，429 / provider exception 一律不出现在页面上）。
 */

interface SessionView {
  readonly id: string;
  readonly status: DecisionSession['status'];
  readonly question: string;
  readonly userContext: DecisionSession['userContext'];
  readonly retrievalRun: DecisionSession['retrievalRun'];
  readonly evidenceFacts: DecisionSession['evidenceFacts'];
  readonly pathClusters: DecisionSession['pathClusters'];
  readonly selectedUnknown: string | null;
  readonly experiment: DecisionSession['experiment'];
  readonly followUp: DecisionSession['followUp'];
  readonly questions: readonly ClarifyQuestion[];
  readonly experienceFacts?: DecisionSession['experienceFacts'];
  /**
   * 世界蓝图里每一幕引用了哪些片段、扮演什么角色。
   *
   * 离线兜底的片段常常没有 `purposes`，但蓝图一定标了 `evidenceRole` ——
   * 所以三条轨道的归类优先用检索意图、其次用这个**已经编译出来的真实角色**。
   */
  readonly worldBlueprint?: {
    readonly acts: readonly {
      readonly evidenceRole?: 'support' | 'cost' | 'counterexample' | 'reflection';
      readonly experienceFactIds?: readonly string[];
    }[];
  };
}

/** §18 允许出现的三类检索意图（显示文案由 WorldForge 统一负责）。 */
const INTENT_IDS = ['similar-person', 'alternative', 'counterexample'] as const;

const INTENT_TRACK: Readonly<Record<(typeof INTENT_IDS)[number], FragmentTrack>> = {
  'similar-person': 'similar',
  alternative: 'alternative',
  counterexample: 'counter',
};

/**
 * 一条片段该进哪条轨道：**检索意图优先，蓝图证据角色兜底**。
 *
 * 两者都是真实标注 —— 意图来自检索规划，角色来自世界编译，
 * 不是为了让三条轨道看起来满而补造的分类。
 */
function trackResolverFor(
  view: SessionView | null,
): (fact: NonNullable<SessionView['experienceFacts']>[number]) => FragmentTrack | null {
  const roleByFact = new Map<string, FragmentTrack>();
  for (const act of view?.worldBlueprint?.acts ?? []) {
    const track = roleTrackOf(act.evidenceRole);
    if (!track) {
      continue;
    }
    for (const id of act.experienceFactIds ?? []) {
      if (!roleByFact.has(id)) {
        roleByFact.set(id, track);
      }
    }
  }
  return (fact) => fragmentTrackOf(fact.purposes) ?? roleByFact.get(fact.id) ?? null;
}

/**
 * 从**真实检索结果**派生三类经历的命中数。
 *
 * `found === null` 表示还没拿到结果 —— 编译中不猜数字（§18 禁止假进度）。
 */
function stagesFrom(view: SessionView | null, settled: boolean): readonly ForgeStage[] {
  const facts = view?.experienceFacts ?? [];
  const resolveTrack = trackResolverFor(view);
  return INTENT_IDS.map((id) => ({
    id,
    found: view === null || !settled
      ? null
      : facts.filter((fact) => resolveTrack(fact) === INTENT_TRACK[id]).length,
  }));
}

/** §20 的时间预算：收束 700ms + WORLD READY 420ms。 */
const ASSEMBLE_MS = 700;
const READY_MS = 420;
/** 每类轨道最多上墙 2 条：编译页只露碎片，不摊开整张卡（§19）。 */
const SHARDS_PER_TRACK = 2;

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();

  const [view, setView] = React.useState<SessionView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<PlayerFacingError | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [compileFailed, setCompileFailed] = React.useState(false);
  /** 三轨收束 → WORLD READY 的两拍。 */
  const [forgeBeat, setForgeBeat] = React.useState<'assembling' | 'ready'>('assembling');
  /** 刚才是「穿越」过来的：播一次落点环收（§15 升级版）。 */
  const [arrived, setArrived] = React.useState(false);
  /**
   * 穿越带过来的问题原文。**只能在 effect 里读**：
   * `peekJumpQuestion()` 在服务端渲染时永远是空串，渲染期直接读会造成
   * 首帧文本不一致（hydration mismatch），那正是我们要消灭的闪烁来源。
   */
  const [jumpQuestion, setJumpQuestionState] = React.useState('');

  React.useEffect(() => {
    setJumpQuestionState(peekJumpQuestion());
  }, []);

  React.useEffect(() => {
    if (!consumeJumpArrival()) {
      return;
    }
    setArrived(true);
  }, []);

  /**
   * 落点动画的收尾计时必须从 **loading 结束之后** 才开始。
   *
   * 原先它从挂载那一刻就启动 700ms，而数据请求通常要一秒左右 ——
   * 计时在骨架阶段就耗光了，玩家从首页穿过来什么也看不到，
   * 只会看到空屏「闪」一下然后整屏出现内容。
   */
  React.useEffect(() => {
    if (loading || !arrived) {
      return;
    }
    const timer = window.setTimeout(() => setArrived(false), 700);
    return () => window.clearTimeout(timer);
  }, [arrived, loading]);

  React.useEffect(() => {
    if (!id) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${id}`, { signal: controller.signal });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: SessionView;
          error?: { code?: string; message?: string };
        };
        if (controller.signal.aborted) {
          return;
        }
        if (payload.ok && payload.data) {
          setView(payload.data);
        } else {
          // §9：这里只出人话。服务端消息里的技术细节不会进页面。
          setError(payload.error ? playerFacingError(payload.error) : CONTENT_UNAVAILABLE);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(NETWORK_UNAVAILABLE);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [id]);

  /** 统一派发：动作只有一个入口，错误处理只有一份。 */
  const act = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!id) {
        return;
      }
      setBusy(true);
      setError(null);
      setCompileFailed(false);
      try {
        const response = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: SessionView;
          error?: { code?: string; message?: string };
        };
        if (payload.ok && payload.data) {
          setView(payload.data);
          return;
        }
        // 编译失败要能被用户看见并重试，而不是静默停在转圈页上
        setError(payload.error ? playerFacingError(payload.error) : AI_UNAVAILABLE);
        if (body.action === 'prepare-world') {
          setCompileFailed(true);
        }
      } catch {
        setError(NETWORK_UNAVAILABLE);
        if (body.action === 'prepare-world') {
          setCompileFailed(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const status = view?.status ?? null;
  const showClarify = status === 'clarifying';
  const worldReady = status === 'ready_to_play';

  /** 澄清答完（或本来就不需要澄清）→ 自动编译。 */
  const autoPreparedRef = React.useRef(false);
  React.useEffect(() => {
    if (!view || busy || autoPreparedRef.current || compileFailed) {
      return;
    }
    if (view.status === 'comparing' || view.status === 'choosing_unknown') {
      autoPreparedRef.current = true;
      void act({ action: 'prepare-world' });
    }
  }, [act, busy, compileFailed, view]);

  /** 世界就绪 → 三轨收束 → WORLD READY（§20）。**到这里就停住，不再往前带走玩家。** */
  React.useEffect(() => {
    if (!worldReady || !view) {
      setForgeBeat('assembling');
      return;
    }
    setForgeBeat('assembling');
    const toReady = window.setTimeout(() => setForgeBeat('ready'), ASSEMBLE_MS);
    return () => {
      window.clearTimeout(toReady);
    };
  }, [view, worldReady]);

  /**
   * 走向 Play —— **只由用户点击触发，这条主链上没有自动跳转**。
   *
   * 原先这里还有一发 `router.replace`，在「世界就绪 + 至少找到一条真实经历」时
   * 于 `ASSEMBLE_MS + READY_MS`（1120ms）后把玩家带走。三个后果：
   *
   * ```text
   * 1. 编译结果读不完：三条轨道各找到几条、碎片上墙的那一眼，都被这一跳截断；
   * 2. 那一屏的 CTA 形同虚设：它只在「自动跳转恰好没生效」时才可点；
   * 3. 和剧情页的「回到问题」构成弹回：回来看一眼 → 又被弹进剧情，像甩不掉。
   * ```
   *
   * 现在把「走不走」还给玩家：收束动画照旧（三轨 → WORLD READY），
   * 但停在编译页等人点。`ASSEMBLE_MS` 仍是收束节拍，`READY_MS` 不再用于跳转。
   */
  const enterWorld = React.useCallback(() => {
    if (!view || busy) {
      return;
    }
    router.push(`/play?session=${encodeURIComponent(view.id)}`);
  }, [busy, router, view]);

  if (loading) {
    /**
     * 首屏骨架（§16「它不是页面，是一段连续转场」的延伸）。
     *
     * 这里原先只有一行 kicker，于是从首页穿过来看到的是：
     * 内容收缩 → 跳转 → **几乎全黑的空屏一秒** → 整屏内容「啪」地出现。
     * 观感上就是一次闪烁，也正是「点一下会闪、动画没了」的来源之一。
     *
     * 现在把编译期**真实的结构**先立起来：极光带 / 看山 computer 态 /
     * 三条轨道。轨道用 `found: null`（= 还没拿到结果），
     * 符合 §18「不猜数字」。数据到达后只是把数字和碎片填进去，
     * 画面不重建，转场因此是连续的。
     *
     * 注意：这里只用 `KanshanSprite`（GIF 实体）。线稿剪影（`Kanshan`）已整体下架，
     * 全项目不再有任何剪影引用。
     */
    return (
      <main
        id="main-content"
        className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col justify-center px-5 py-12 sm:px-8 sm:py-16"
      >
        <AuroraBand tone="seek" />

        <header className="mb-8 flex items-center justify-between gap-3">
          <p className="sil-label">The Observatory</p>
          <Link
            href="/"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
          >
            换个问题
          </Link>
        </header>

        <div className="mb-6 flex items-center gap-3.5">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center">
            <KanshanSprite
              characterId="kanshan"
              action="computer"
              className="h-full w-full object-contain"
              alt=""
            />
          </span>
          <p className="sil-prose text-[14px] leading-relaxed text-[color:var(--sil-ink-300)]">
            我去找找，有没有人活过你正在纠结的这几种人生。
          </p>
        </div>

        <WorldForge
          question={jumpQuestion || '正在理解你的处境'}
          stages={stagesFrom(null, false)}
          phase="searching"
          fragments={[]}
        />

        {arrived ? <ArrivalFlash /> : null}
      </main>
    );
  }

  if (error && !view) {
    return (
      <main
        id="main-content"
        className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col justify-center px-5 py-16 sm:px-8"
      >
        <p className="sil-label">Session</p>
        <p role="alert" className="sil-prose mt-4 text-[15px] text-[color:var(--sil-ink-100)]">
          {error.title}
        </p>
        {error.hint ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--sil-ink-300)]">{error.hint}</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="sil-btn sm:w-[180px]"
          >
            重试
          </button>
          <Link href="/" className="sil-btn sil-btn--ghost sm:w-[180px]">
            修改问题
          </Link>
        </div>
      </main>
    );
  }

  if (!view) {
    return null;
  }

  const stages = stagesFrom(view, worldReady);
  const foundTotal = stages.reduce((sum, stage) => sum + (stage.found ?? 0), 0);
  /**
   * 命中的真实片段（§19）：只有检索完成后才有内容可上墙。
   * 没有片段时如实留空，不用假动画填满。
   */
  const fragmentGroups = worldReady
    ? archiveFragments(view.experienceFacts ?? [], SHARDS_PER_TRACK, trackResolverFor(view))
    : [];
  const shards: readonly ForgeShard[] = fragmentGroups.flatMap((group) =>
    group.items.map((item) => ({
      id: item.id,
      quote: item.quote,
      sourceLabel: `知乎 · ${item.author}`,
      category: group.track,
    })),
  );

  const phase: ForgePhase = showClarify || !worldReady ? (showClarify ? 'understanding' : 'searching') : forgeBeat;

  return (
    <main
      id="main-content"
      className="sil-viewport relative mx-auto flex w-full max-w-[880px] flex-col justify-center px-5 py-12 sm:px-8 sm:py-16"
    >
      {/* 极光带：编译期是 seek（蓝 → 青） */}
      <AuroraBand tone="seek" />

      <header className="mb-8 flex items-center justify-between gap-3">
        <p className="sil-label">The Observatory</p>
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
        >
          换个问题
        </Link>
      </header>

      {showClarify ? (
        <section className="sil-panel relative px-5 py-6 sm:px-8 sm:py-7">
          {/*
            看山状态机 · 动态澄清态 sway（GAME-DESIGN §4.1）：
            它追问的不是客套，而是「会改变接下来去找谁」的事。
          */}
          <div className="mb-5 flex items-center gap-3.5">
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center">
              <KanshanSprite
                characterId="kanshan"
                action="sway"
                className="h-full w-full object-contain"
                alt="刘看山"
              />
            </span>
            <p className="sil-prose text-[13px] leading-relaxed text-[color:var(--sil-ink-300)]">
              只问会改变结论的事。你答的每一句，都会改变我接下来去找谁。
            </p>
          </div>
          <p className="sil-label">正在理解你的处境</p>
          <ClarificationStep
            questions={view.questions}
            busy={busy}
            onSubmit={(answers) => void act({ action: 'clarify', answers })}
          />
        </section>
      ) : (
        <>
          {/*
            刘看山第一次出现。
            只用官方 GIF 实体 —— 原先与它并排的线稿剪影（§33 投影形态）已下架：
            一只手绘剪影挨着官方黏土立绘，会把两边的质感一起拉下来。

            看山状态机 · 检索/编译态（GAME-DESIGN §4.1）：
            检索与编译时它在 computer 态工作，WORLD READY 那一刻换成 wave 交接。
          */}
          <div className="mb-6 flex items-center gap-3.5">
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center">
              <KanshanSprite
                characterId="kanshan"
                action={worldReady ? 'wave' : 'computer'}
                className="h-full w-full object-contain"
                alt=""
              />
            </span>
            <p className="sil-prose text-[14px] leading-relaxed text-[color:var(--sil-ink-300)]">
              {worldReady
                ? '找到了。走吧。'
                : '我去找找，有没有人活过你正在纠结的这几种人生。'}
            </p>
          </div>

          <WorldForge question={view.question} stages={stages} phase={phase} fragments={shards} />

          {error ? (
            <p role="alert" className="mt-4 text-[13px] leading-relaxed text-[color:var(--sil-counter-soft)]">
              {error.title}
              {error.hint ? ` ${error.hint}` : ''}
            </p>
          ) : null}

          {worldReady ? (
            <div className="mt-8">
              {foundTotal === 0 ? (
                /**
                 * 一条都没找到：如实说，并给两条出路 —— 不假装、也不困住用户。
                 * 文案与按钮固定为 05_AGENT §9 的那一套。
                 */
                <div className="sil-panel px-5 py-5 sm:px-6">
                  <p className="sil-prose text-[15px] text-[color:var(--sil-ink-100)]">
                    {NO_RELIABLE_EXPERIENCE.title}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--sil-ink-300)]">
                    {NO_RELIABLE_EXPERIENCE.hint}
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Link href="/" className="sil-btn sil-btn--ghost sm:w-[220px]">
                      {NO_RELIABLE_EXPERIENCE.actions[0]}
                    </Link>
                    <button
                      type="button"
                      data-action="prepare-world"
                      disabled={busy}
                      onClick={() => void act({ action: 'prepare-world' })}
                      className="sil-btn sm:w-[240px]"
                    >
                      {busy ? '正在重新检索…' : NO_RELIABLE_EXPERIENCE.actions[1]}
                    </button>
                  </div>
                  <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--sil-ink-400)]">
                    也可以先进入这一局：
                    <Link
                      href={`/play?session=${encodeURIComponent(id)}`}
                      data-destination="play-session"
                      className="ml-1 underline decoration-dotted transition-opacity duration-200 hover:opacity-80"
                    >
                      这一局没有别人的经验，世界仍然会走完
                    </Link>
                  </p>
                </div>
              ) : (
                <Link
                  href={`/play?session=${encodeURIComponent(id)}`}
                  data-destination="play-session"
                  className="sil-btn sil-btn--block"
                  onClick={(event) => {
                    // 中键 / 新开标签保留原生跳转：只有左键单击才走客户端推送
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      return;
                    }
                    event.preventDefault();
                    enterWorld();
                  }}
                >
                  进入我的平行宇宙
                </Link>
              )}
            </div>
          ) : compileFailed ? (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                data-action="prepare-world"
                disabled={busy}
                onClick={() => void act({ action: 'prepare-world' })}
                className="sil-btn sm:w-[220px]"
              >
                {busy ? '正在重试…' : '重试一次'}
              </button>
              <Link href="/" className="sil-btn sil-btn--ghost sm:w-[180px]">
                换个问题
              </Link>
            </div>
          ) : (
            /* 还没就绪就停在这一屏：用户始终有明确的一步可点（不再有自动跳转兜底） */
            <div className="mt-8">
              <button
                type="button"
                data-action="prepare-world"
                disabled={busy}
                onClick={() => void act({ action: 'prepare-world' })}
                className="sil-btn sil-btn--block sm:w-[280px]"
              >
                {busy ? '正在编译你的世界…' : '进入我的平行宇宙'}
              </button>
            </div>
          )}
        </>
      )}

      {/* 落点：从首页「穿越」过来时的一次环收 + 闪白（§15 升级版） */}
      {arrived ? <ArrivalFlash /> : null}
    </main>
  );
}
