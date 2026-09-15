'use client';

import * as React from 'react';

import { KanshanSprite } from '@/components/characters/KanshanSprite';
import { CelestialBackdrop } from '@/components/visual/CelestialBackdrop';
import { RealityPass } from '@/components/visual/RealityPass';
import { SentenceReforge } from '@/components/visual/SentenceReforge';
import { observerDisplayName } from '@/features/run/observer';
import { useObserver } from '@/features/run/useObserver';

import type { EndgameEvidence } from '@/features/game-world/endgameAnswer';
import type { SessionEndgameView } from '@/components/game/session/types';

/**
 * Session Endgame —— 问题重写（Agent 03 §十九 - §二十二）。
 *
 * ## 它不复用旧报告逻辑
 *
 * 旧的 `EndgameReport` / `EndgamePass` 是判卷结构：成功率、匹配度、四维雷达。
 * 这一屏**一个数字都不给**，只有固定的五块，顺序即重要性：
 *
 * ```text
 * 1. 原问题                 你进来时问的那句话
 * 2. 现在真正值得验证的问题    Hero；只能来自 keyUnknown
 * 3. 本局多看见的行动         成长 = 你离开时多看见几条可行动的路
 * 4. 真实经验回顾            这些路是谁真的走过的
 * 5. Reality Pass           一张能撕下来带回现实的票
 * ```
 *
 * ## 两条诚实性约束
 *
 * - **原问题不得被模型润色覆盖**（§二十）：`originalQuestion` 直接来自
 *   DecisionSession 的 `question`；
 * - **新问题不得凭空生成**（§二十一）：没有 `keyUnknown` 时，
 *   `SentenceReforge` 会如实说「这一局没有收敛出一个新的问题」。
 *
 * ## Reality Pass 不写死时间盒
 *
 * §二十二 点名反对「未来 7 天」。时间盒只能是 `experiment.timebox` ——
 * 它由会话里真实设计过的实验给出。主界面只给 timebox + action +
 * 1~2 个信号，其余折叠在次级位置。
 */
export interface SessionEndgameScreenProps {
  readonly view: SessionEndgameView;
  readonly className?: string;
}

function Block({
  index,
  label,
  children,
}: {
  readonly index: number;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="relative border-t pt-4" style={{ borderColor: 'var(--sil-rule)' }}>
      <p className="sil-label">
        {String(index).padStart(2, '0')} · {label}
      </p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function SessionEndgameScreen({ view, className = '' }: SessionEndgameScreenProps) {
  const [copied, setCopied] = React.useState(false);
  const { session } = useObserver();
  const reportIdentity = session?.authorized
    ? {
        name: observerDisplayName(session.profile),
        avatarUrl: session.profile?.avatarUrl ?? null,
      }
    : null;

  /**
   * 成就 Toast（GAME-DESIGN §4.6）：一局 ≤ 2 个，都在终局，且都不是「奖励」——
   *
   * - 「直面现实」：这一局真的收敛出了一个只有现实能回答的问题（keyUnknown）。
   *   它不是安慰奖，是这款产品想让你做到的那件事本身。
   * - 「行动派」：玩家把 Reality Pass 复制/带走的那一刻 —— 从「看过」变成「带走」。
   *
   * dribble 彩蛋（§4.1）：认下支线的那一瞬间，看山从图章换成 dribble 运球态，
   * 2.8s 后盖回图章。全系统只有这一个地方用它 —— 彩蛋之所以是彩蛋，是因为少。
   */
  const [toast, setToast] = React.useState<{ readonly name: string; readonly line: string } | null>(null);
  const [toastLeaving, setToastLeaving] = React.useState(false);
  const [cheering, setCheering] = React.useState(false);

  React.useEffect(() => {
    if (!view.rewrittenQuestion) {
      return;
    }
    const showTimer = window.setTimeout(() => {
      setToast({ name: '直面现实', line: '你把一个猜不到的问题，带回了现实。' });
      setToastLeaving(false);
    }, 1200);
    return () => window.clearTimeout(showTimer);
  }, [view.rewrittenQuestion]);

  React.useEffect(() => {
    if (!toast) {
      return;
    }
    const leaveTimer = window.setTimeout(() => setToastLeaving(true), 3200);
    const removeTimer = window.setTimeout(() => setToast(null), 3650);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast]);

  React.useEffect(() => {
    if (!cheering) {
      return;
    }
    const timer = window.setTimeout(() => setCheering(false), 2800);
    return () => window.clearTimeout(timer);
  }, [cheering]);

  /** 可带走的文本：复制、截图、手抄都行，不需要注册。 */
  const passText = React.useMemo(() => {
    const pass = view.realityPass;
    if (!pass) {
      return '';
    }
    /**
     * 带走的必须包含**真实经历本身**（逐字 + 答主 + 原文链接）：
     * 用户带走的是一份有出处的答案，而不是一段我们写的话。
     */
    const answer = view.answer;
    const evidenceLines = (label: string, items: readonly EndgameEvidence[]): string[] =>
      items.length > 0
        ? [
            `${label}：`,
            ...items.map((item) => `  「${item.quote}」—— ${item.author} ${item.sourceUrl}`),
          ]
        : [];
    return [
      '现实支线',
      answer ? `你问的是：${answer.question}` : '',
      answer && answer.conditions.length > 0 ? `你补上的条件：${answer.conditions.join(' · ')}` : '',
      answer && answer.walked.length > 0 ? `你走过的路：${answer.walked.join(' → ')}` : '',
      ...(answer ? evidenceLines('你采用了谁的经验', answer.taken) : []),
      ...(answer ? evidenceLines('真实的人是怎么做的', answer.borrowed) : []),
      ...(answer ? evidenceLines('他们付出的代价', answer.costs) : []),
      ...(answer && answer.counter
        ? [`走坏的那条路：「${answer.counter.quote}」—— ${answer.counter.author} ${answer.counter.sourceUrl}`]
        : []),
      answer && answer.unknown ? `仍然不知道：${answer.unknown}` : '',
      view.rewrittenQuestion ? `我要验证的问题：${view.rewrittenQuestion}` : '',
      `时间盒：${pass.timebox}`,
      `要做的事：${pass.action}`,
      `会留下什么：${pass.artifact}`,
      `成功信号：${pass.successSignal}`,
      `停止信号：${pass.stopSignal}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }, [view.realityPass, view.answer, view.rewrittenQuestion]);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(passText);
      setCopied(true);
      // 认下支线的那一刻：行动派 Toast + 看山 dribble 彩蛋（§4.1 / §4.6）。
      setToast({ name: '行动派', line: '这条支线，已经在你手里了。' });
      setToastLeaving(false);
      setCheering(true);
    } catch {
      // 剪贴板不可用（非安全上下文 / 无权限）时如实降级：
      // 文字就在页面上，玩家可以手动选中。绝不假装复制成功。
      setCopied(false);
    }
  }, [passText]);

  return (
    <section
      className={['session-endgame relative mt-6', className].filter(Boolean).join(' ')}
      aria-label="终局"
    >
      {/* 刘看山第三次出现。
          只用官方 GIF 实体：认下支线前 idle，认下后的 2.8s 换成 dribble 运球态
          —— 彩蛋只出现这一次。原先非认下态那枚线稿图章已随整体下架。 */}
      <div className="flex items-start gap-4">
        <span className="sil-cast shrink-0">
          <KanshanSprite characterId="kanshan" action={cheering ? 'dribble' : 'idle'} className="sil-cast__sprite sil-cast__sprite--sm" alt="刘看山" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[13px] font-semibold leading-relaxed"
            style={{ color: 'var(--sil-ink-200)' }}
          >
            他们的路你已经看到了。
          </p>
          <p
            className="mt-1 text-[15px] font-black leading-relaxed"
            style={{ color: 'var(--sil-ink-100)' }}
          >
            现在，走你自己的。
          </p>
        </div>
      </div>

      {/* 1 + 2：原问题（小号）→ 新问题（Hero）。 */}
      <div className="mt-8">
        <h2 className="text-[30px] font-black leading-none tracking-tight" style={{ color: 'var(--sil-ink-100)' }}>
          问题。
        </h2>
        <SentenceReforge
          className="mt-5"
          original={view.originalQuestion}
          rewritten={view.rewrittenQuestion}
        />
      </div>

      <section className="sil-reality-sheet relative mt-8 overflow-hidden px-1 pb-2 pt-5 sm:px-5">
        <CelestialBackdrop scene="returning" />
        <div className="relative z-[1]">
          {view.realityPass ? (
            <>
          {/*
            终局不能从「新问题」直接跳到行动。这里不让 AI 另写一段结论，
            而只摆出本局真实发生过的两类依据：真的解锁过的行动、真的引用过的人。
            因果链完整，但不会把最终那张纸埋进长回顾里。
          */}
          <section className="border-t pt-4" style={{ borderColor: 'var(--sil-rule)' }}>
            <p className="sil-label">这张现实支线从哪里来</p>
            <div className="mt-3 flex flex-col gap-2.5">
              {view.unlockedActions.length > 0 ? (
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--sil-alternate-soft)' }}>
                  <span className="mr-2" style={{ color: 'var(--sil-alternate)' }} aria-hidden="true">◆</span>
                  本局多看见的行动：{view.unlockedActions.slice(0, 2).join('；')}
                </p>
              ) : null}
              {view.experiences.length > 0 ? (
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--sil-ink-200)' }}>
                  <span className="mr-2" style={{ color: 'var(--sil-zhihu-soft)' }} aria-hidden="true">·</span>
                  这条路来自 {view.experiences.slice(0, 2).map((item) => item.author).join('、')} 的真实经历。
                </p>
              ) : null}
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--sil-ink-300)' }}>
                有些答案仍然只能回到现实里验证，所以这一局没有替你下结论。
              </p>
            </div>
          </section>

          <RealityPass
            className="mt-6"
            timebox={view.realityPass.timebox}
            action={view.realityPass.action}
            observation={view.realityPass.successSignal}
            artifact={view.realityPass.artifact}
            stopSignal={view.realityPass.stopSignal}
            answer={view.answer}
            identity={reportIdentity}
            onBringBack={() => void onCopy()}
            broughtBack={copied}
          />
            </>
          ) : (
            <section
              className="sil-paper sil-develop relative px-5 py-6 sm:px-6"
              aria-label="现实支线尚未显影"
            >
              <div className="relative z-[1]">
                <p className="sil-label">REALITY PASS · 现实支线</p>
                <h3
                  className="mt-3 text-[22px] font-black leading-tight"
                  style={{ color: 'var(--sil-paper-ink)' }}
                >
                  现实支线尚未显影
                </h3>
                <p
                  className="mt-3 text-[13px] leading-relaxed"
                  style={{ color: 'var(--sil-paper-muted)' }}
                >
                  这局没有足够的已核验条件来设计一个诚实的实验。我们保留空白，
                  不替你写一个看起来完整、却无法验证的计划。
                </p>
              </div>
            </section>
          )}
        </div>
      </section>

      <div className="mt-9 flex flex-col gap-5">
        <p className="sil-label">回看这一次推演</p>
        {/* 3. 本局多看见的行动 */}
        <Block index={3} label="本局多看见的行动">
          {view.unlockedActions.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {view.unlockedActions.map((action) => (
                <li
                  key={action}
                  className="flex gap-2 text-[12px] leading-relaxed"
                  style={{ color: 'var(--sil-alternate-soft)' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--sil-alternate)' }}>
                    ◆
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--sil-ink-300)' }}>
              这一局没有出现原本不存在的做法 —— 我们不把普通选项算成「成长」。
            </p>
          )}

          {view.steps.length > 0 ? (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer">
                <span className="sil-label">这一局你经历过什么</span>
              </summary>
              <ol className="mt-2 flex flex-col gap-1">
                {view.steps.map((step, index) => (
                  <li
                    key={`${step}-${index}`}
                    className="flex gap-2 text-[12px] leading-relaxed"
                    style={{ color: 'var(--sil-ink-200)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--sil-ink-300)' }}>
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </Block>

        {/* 4. 真实经验回顾 */}
        <Block index={4} label="这些路是谁真的走过的">
          {view.experiences.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {view.experiences.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--sil-ink-200)' }}>
                    {item.title}
                  </span>
                  {item.summary ? (
                    <span className="text-[11px] leading-relaxed" style={{ color: 'var(--sil-ink-200)' }}>
                      「{item.summary}」
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    <span className="sil-label">{item.author}</span>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" className="source-link">
                        查看知乎原回答 ↗
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--sil-ink-300)' }}>
              这一局没有引用到任何真实经历 —— 我们不为了填满这一栏编一段。
            </p>
          )}

          {view.highlights.length > 0 ? (
            <ul
              className="mt-3 flex flex-col gap-1 border-t pt-2.5"
              style={{ borderColor: 'var(--sil-rule)' }}
            >
              {view.highlights.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-[12px] leading-relaxed"
                  style={{ color: 'var(--sil-ink-200)' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--sil-ink-300)' }}>
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Block>

      </div>

      {/*
        成就 Toast（GAME-DESIGN §4.6）：一局 ≤ 2 个。
        「直面现实」在终局落定后自己出现；「行动派」只在玩家真的带走支线时出现。
        文案用「。」收尾，没有感叹号 —— 克制是这款游戏的游戏性。
      */}
      {toast ? (
        <div
          className={['sil-toast', toastLeaving ? 'sil-toast--leaving' : ''].filter(Boolean).join(' ')}
          role="status"
        >
          <span className="sil-toast__name">{toast.name}</span>
          <span className="sil-toast__line">{toast.line}</span>
        </div>
      ) : null}
    </section>
  );
}

export default SessionEndgameScreen;
