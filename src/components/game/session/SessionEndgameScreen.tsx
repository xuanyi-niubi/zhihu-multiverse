'use client';

import * as React from 'react';

import { RealityPass } from '@/components/visual/RealityPass';
import { SentenceReforge } from '@/components/visual/SentenceReforge';

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
    <section className="relative border-t pt-4" style={{ borderColor: 'var(--obs-hairline)' }}>
      <p className="obs-kicker">
        {String(index).padStart(2, '0')} · {label}
      </p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function SessionEndgameScreen({ view, className = '' }: SessionEndgameScreenProps) {
  const [copied, setCopied] = React.useState(false);

  /** 可带走的文本：复制、截图、手抄都行，不需要注册。 */
  const passText = React.useMemo(() => {
    const pass = view.realityPass;
    if (!pass) {
      return '';
    }
    return [
      '现实支线',
      view.rewrittenQuestion ? `我要验证的问题：${view.rewrittenQuestion}` : '',
      `时间盒：${pass.timebox}`,
      `要做的事：${pass.action}`,
      `会留下什么：${pass.artifact}`,
      `成功信号：${pass.successSignal}`,
      `停止信号：${pass.stopSignal}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }, [view.realityPass, view.rewrittenQuestion]);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(passText);
      setCopied(true);
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
      {/* 刘看山第三次出现（全局只出现三次） */}
      <p className="text-[13px] font-semibold leading-relaxed" style={{ color: 'var(--obs-text-1)' }}>
        他们的路你已经看到了。
      </p>
      <p className="mt-1 text-[15px] font-black leading-relaxed" style={{ color: 'var(--obs-text-0)' }}>
        现在，走你自己的。
      </p>

      {/* 1 + 2：原问题（小号）→ 新问题（Hero）。 */}
      <div className="mt-8">
        <h2 className="text-[30px] font-black leading-none tracking-tight" style={{ color: 'var(--obs-text-0)' }}>
          问题。
        </h2>
        <SentenceReforge
          className="mt-5"
          original={view.originalQuestion}
          rewritten={view.rewrittenQuestion}
        />
      </div>

      <div className="mt-8 flex flex-col gap-5">
        {/* 3. 本局多看见的行动 */}
        <Block index={3} label="本局多看见的行动">
          {view.unlockedActions.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {view.unlockedActions.map((action) => (
                <li
                  key={action}
                  className="flex gap-2 text-[12px] leading-relaxed"
                  style={{ color: 'var(--obs-path-soft)' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--obs-path)' }}>
                    ◆
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
              这一局没有出现原本不存在的做法 —— 我们不把普通选项算成「成长」。
            </p>
          )}

          {view.steps.length > 0 ? (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer">
                <span className="obs-kicker">这一局你经历过什么</span>
              </summary>
              <ol className="mt-2 flex flex-col gap-1">
                {view.steps.map((step, index) => (
                  <li
                    key={`${step}-${index}`}
                    className="flex gap-2 text-[12px] leading-relaxed"
                    style={{ color: 'var(--obs-text-1)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--obs-text-2)' }}>
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
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--obs-text-1)' }}>
                    {item.title}
                  </span>
                  {item.summary ? (
                    <span className="text-[11px] leading-relaxed" style={{ color: 'var(--obs-text-1)' }}>
                      「{item.summary}」
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    <span className="obs-kicker">{item.author}</span>
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
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
              这一局没有引用到任何真实经历 —— 我们不为了填满这一栏编一段。
            </p>
          )}

          {view.highlights.length > 0 ? (
            <ul
              className="mt-3 flex flex-col gap-1 border-t pt-2.5"
              style={{ borderColor: 'var(--obs-hairline)' }}
            >
              {view.highlights.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-[12px] leading-relaxed"
                  style={{ color: 'var(--obs-text-1)' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--obs-text-2)' }}>
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Block>

        {/* 5. Reality Pass */}
        <Block index={5} label="Reality Pass">
          {view.realityPass ? (
            <RealityPass
              timebox={view.realityPass.timebox}
              action={view.realityPass.action}
              observation={view.realityPass.successSignal}
              artifact={view.realityPass.artifact}
              stopSignal={view.realityPass.stopSignal}
              onBringBack={() => void onCopy()}
              broughtBack={copied}
            />
          ) : (
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--obs-text-2)' }}>
              这一局还没有设计出现实实验 —— 我们不凭空给一个「未来 7 天」的计划。
            </p>
          )}
        </Block>
      </div>
    </section>
  );
}

export default SessionEndgameScreen;
