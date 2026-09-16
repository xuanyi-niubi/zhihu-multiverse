'use client';

import * as React from 'react';
import { ObserverAvatar } from '@/components/session/ObserverAvatar';

import type { EndgameAnswer, EndgameEvidence } from '@/features/game-world/endgameAnswer';

/**
 * Reality Pass —— 现实层票据（DESIGN-SYSTEM §4.9 / 04_AGENT §32）。
 *
 * ## 全站冷色里的一次回温
 *
 * 设计系统把这一层单独命名为 **Reality Plane**：
 *
 * ```text
 * Evidence   玻璃 · 实     —— 有证据的内容
 * Void       未显影 · 虚   —— 还不知道的东西
 * Reality   暖白纸 · 终局  —— 你能带回现实的东西
 * ```
 *
 * 三种材质必须让眼睛一秒分辨「你在哪一层」。所以这一版的票据不再是
 * 冷色玻璃，而是**一张纸**：`#F2EDE4` 纸白、`#241F1A` 墨色、衬线体、
 * 骑缝区（左侧 2px 暖铜线 + 虚线）。全站只有这里允许暖色。
 *
 * ## 它不是任务列表
 *
 * 没有 checkbox、没有完成度、没有打卡提醒。它只写：未来多长的时间盒、
 * 做什么、看什么信号 —— 然后可以被复制、截图、撕下来带走。
 *
 * 视觉组件不得 fetch API（04_AGENT §7）。
 */

export interface RealityPassIdentity {
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface RealityPassProps {
  /** 真实时间盒，例如「接下来 3 天，每天 40 分钟」。 */
  readonly timebox: string;
  readonly action: string;
  /** 观察点：怎么知道这件事真的发生了（真实 successSignal）。 */
  readonly observation: string;
  /** 会留下什么（可选，骑缝区下方）。 */
  readonly artifact?: string | null;
  /** 停止信号（可选）。 */
  readonly stopSignal?: string | null;
  /**
   * 凝练好的终局答案（P1-2）：你问的、你走过的、你采用过的真实经验、
   * 他们的逐字片段与代价、仍不知道的那一项。
   *
   * 有它就渲染在纸上（这张纸因此是**一份答案**，而不是一张任务卡）；
   * 没有就退回原来的四段式。所有经历类内容都是原文前缀 + 可点回原文。
   */
  readonly answer?: EndgameAnswer | null;
  /** 已登录的知乎身份；只用于终局相纸署名，不参与推演。 */
  readonly identity?: RealityPassIdentity | null;
  readonly onBringBack?: () => void;
  readonly broughtBack?: boolean;
  readonly className?: string;
}

/** 纸上的墨色阶梯：纸层不走冷色文本，只有墨。 */
const INK = 'var(--sil-paper-ink)';
const INK_SOFT = 'rgb(31 27 22 / 0.74)';
const INK_FAINT = 'rgb(31 27 22 / 0.56)';
const INK_RULE = 'rgb(31 27 22 / 0.18)';

/** 纸质答案里的一小节：标签 + 内容。 */
function AnswerRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-t pt-3" style={{ borderColor: INK_RULE }}>
      <p className="sil-label" style={{ color: INK_FAINT }}>
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/**
 * 逐字引用：原文前缀 + 答主 + 可点回原文。
 *
 * 引号是排版，不是内容 —— `quote` 本身只能是原文的连续前缀。
 */
function EvidenceQuote({ item }: { readonly item: EndgameEvidence }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body leading-relaxed" style={{ color: INK }}>
        「{item.quote}」
      </p>
      <p className="flex flex-wrap items-center gap-2 text-label" style={{ color: INK_FAINT }}>
        <span>{item.author}</span>
        {item.editedYear ? <span>最后编辑于 {item.editedYear} 年</span> : null}
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-4"
            style={{ color: INK_SOFT }}
          >
            查看知乎原回答 ↗
          </a>
        ) : null}
      </p>
    </div>
  );
}

export function RealityPass({
  timebox,
  action,
  observation,
  artifact,
  stopSignal,
  answer,
  identity,
  onBringBack,
  broughtBack = false,
  className = '',
}: RealityPassProps) {
  return (
    <section
      className={['sil-paper sil-develop relative px-5 py-5 sm:px-6', className]
        .filter(Boolean)
        .join(' ')}
      aria-label="带回现实的一张票据"
    >
      <div>
        <p className="sil-label" style={{ color: INK_FAINT }}>
          Reality Pass
        </p>

        {answer ? (
          <div className="mt-4 flex flex-col gap-4">
            <AnswerRow label="你问的是">
              <p className="text-body leading-relaxed" style={{ color: INK }}>
                {answer.question}
              </p>
              {answer.conditions.length > 0 ? (
                <p className="mt-1.5 text-meta leading-relaxed" style={{ color: INK_SOFT }}>
                  你补上的条件：{answer.conditions.join(' · ')}
                </p>
              ) : null}
            </AnswerRow>

            {answer.walked.length > 0 ? (
              <AnswerRow label="你走过的路">
                <ol className="flex flex-col gap-1">
                  {answer.walked.map((step, index) => (
                    <li
                      key={`${step}-${index}`}
                      className="flex gap-2 text-meta leading-relaxed"
                      style={{ color: INK_SOFT }}
                    >
                      <span aria-hidden="true" style={{ color: INK_FAINT }}>
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </AnswerRow>
            ) : null}

            {answer.taken.length > 0 ? (
              <AnswerRow label="你采用了谁的经验">
                <div className="flex flex-col gap-3">
                  {answer.taken.map((item) => (
                    <EvidenceQuote key={item.id} item={item} />
                  ))}
                </div>
              </AnswerRow>
            ) : null}

            {answer.borrowed.length > 0 ? (
              <AnswerRow label="真实的人是怎么做的">
                <div className="flex flex-col gap-3">
                  {answer.borrowed.map((item) => (
                    <EvidenceQuote key={item.id} item={item} />
                  ))}
                </div>
              </AnswerRow>
            ) : null}

            {answer.costs.length > 0 ? (
              <AnswerRow label="他们付出的代价">
                <div className="flex flex-col gap-3">
                  {answer.costs.map((item) => (
                    <EvidenceQuote key={item.id} item={item} />
                  ))}
                </div>
              </AnswerRow>
            ) : null}

            {answer.counter ? (
              <AnswerRow label="走坏的那条路">
                <EvidenceQuote item={answer.counter} />
              </AnswerRow>
            ) : null}

            {/*
              平行的时间：同一个问题在不同年代的说法。
              真的能对照时才摆出两个年代；凑不出就只留一句诚实说明 ——
              这条维度最怕的不是空，而是拿不相关的人硬凑出"时代差异"。
            */}
            {answer.eras ? (
              <AnswerRow label="同一个问题，不同年代的人">
                {answer.eras.groups.map((group) => (
                  <div key={group.id} className="mt-2 first:mt-0">
                    <p className="text-label" style={{ color: INK_FAINT }}>
                      {group.label}
                    </p>
                    <div className="mt-1 flex flex-col gap-3">
                      {group.items.map((item) => (
                        <EvidenceQuote key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                ))}
                <p className="mt-2 text-label leading-relaxed" style={{ color: INK_FAINT }}>
                  {answer.eras.note}
                </p>
              </AnswerRow>
            ) : null}

            {answer.unknown ? (
              <AnswerRow label="仍然不知道">
                <p className="text-body leading-relaxed" style={{ color: INK }}>
                  {answer.unknown}
                </p>
              </AnswerRow>
            ) : null}

            <p className="text-label leading-relaxed" style={{ color: INK_FAINT }}>
              {answer.note}
            </p>
          </div>
        ) : null}

        <p className="mt-4 text-meta leading-relaxed" style={{ color: INK_FAINT }}>
          未来 <span style={{ color: INK }}>{timebox}</span>
        </p>

        <p
          className="sil-paper__title mt-2 text-[19px] leading-relaxed sm:text-[21px]"
          style={{ color: INK }}
        >
          {action}
        </p>
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: INK_RULE }}>
        <p className="sil-label" style={{ color: INK_FAINT }}>
          观察点
        </p>
        <p className="mt-2 text-body leading-relaxed" style={{ color: INK_SOFT }}>
          {observation}
        </p>

        {artifact || stopSignal ? (
          <dl className="mt-4 flex flex-col gap-3">
            {artifact ? (
              <div>
                <dt className="sil-label" style={{ color: INK_FAINT }}>
                  会留下什么
                </dt>
                <dd className="mt-1 text-meta leading-relaxed" style={{ color: INK_SOFT }}>
                  {artifact}
                </dd>
              </div>
            ) : null}
            {stopSignal ? (
              <div>
                <dt className="sil-label" style={{ color: INK_FAINT }}>
                  什么时候停
                </dt>
                <dd className="mt-1 text-meta leading-relaxed" style={{ color: INK_SOFT }}>
                  {stopSignal}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {identity ? (
        <div
          className="mt-6 flex items-center justify-between gap-3 border-t pt-4"
          style={{ borderColor: INK_RULE }}
          aria-label={`观测者署名：${identity.name}`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <ObserverAvatar
              name={identity.name}
              avatarUrl={identity.avatarUrl}
              className="h-8 w-8 text-meta"
              imageClassName="bg-[color:var(--sil-paper)]"
              style={{ borderColor: INK_RULE, color: INK_SOFT }}
            />
            <div className="min-w-0">
              <p className="truncate text-meta font-semibold" style={{ color: INK }}>
                {identity.name}
              </p>
              <p className="mt-0.5 text-label" style={{ color: INK_FAINT }}>
                本次推演的观测者
              </p>
            </div>
          </div>
          <span className="sil-label shrink-0" style={{ color: INK_FAINT }}>
            观测者署名
          </span>
        </div>
      ) : null}

      {onBringBack ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={onBringBack}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[2px] border px-5 text-body font-semibold transition-transform duration-200 active:translate-y-px"
            style={{
              borderColor: 'rgb(31 27 22 / 0.52)',
              background: 'rgb(31 27 22 / 0.06)',
              color: INK,
            }}
          >
            {broughtBack ? '已带回现实' : '带回现实'}
          </button>
          <p className="mt-2 text-label leading-relaxed" style={{ color: INK_FAINT }}>
            不需要注册、也不需要在站内打卡：复制、保存、截图都行。
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default RealityPass;
