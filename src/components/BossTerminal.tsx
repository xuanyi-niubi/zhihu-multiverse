'use client';

import * as React from 'react';

import type { BossVerdictView } from '@/core/bossClient';

/**
 * 第四幕：终端 Boss。
 *
 * 这一幕**没有普通选项**：玩家必须在 20–240 字内写下具体的破局方案，
 * 然后由判卷（模型或本地规则）+ 一次 D20 决定结局。
 *
 * 两条产品约束：
 * - **不做黑箱**：判卷结果必须把「四维评分 / 基础属性 / 遗物 / 思路修正 / 骰面 vs DC」
 *   全部摊开给玩家看，否则「AI 给我打了个分」会让人不服气；
 * - **不拦路**：写不出来或不想写，也要有「放弃提交，直接结算」的出口。
 */

export const DIMENSION_ORDER = ['specificity', 'evidenceUse', 'feasibility', 'selfAwareness'] as const;
export type DimensionKey = (typeof DIMENSION_ORDER)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  specificity: '具体性',
  evidenceUse: '证据利用',
  feasibility: '可执行性',
  selfAwareness: '自我认知',
};

/** 判卷来源的中文标注 —— 玩家有权知道这个分是谁给的。 */
export const SOURCE_LABELS: Record<BossVerdictView['source'], string> = {
  model: '模型判卷',
  fallback: '本地规则判卷',
  cached: '判卷结果（重复提交）',
};

/** 把判卷结果摊成可读的行：终局分解不让玩家猜。 */
export function verdictLines(verdict: BossVerdictView): readonly string[] {
  const dims = DIMENSION_ORDER.map(
    (key) => `${DIMENSION_LABELS[key]} ${verdict.dimensions[key]}/2`,
  ).join(' · ');

  const sign = verdict.bossModifier >= 0 ? '+' : '';
  const relic = verdict.relicModifier !== 0 ? `遗物 ${verdict.relicModifier >= 0 ? '+' : ''}${verdict.relicModifier}` : '无遗物加成';
  const knowledge = verdict.knowledgeModifier > 0 ? ` + 引用材料 +${verdict.knowledgeModifier}` : '';

  return [
    `思路评分：${dims}`,
    `结算：D20 ${verdict.dice} + 属性 ${verdict.baseModifier >= 0 ? '+' : ''}${verdict.baseModifier} + ${relic} + 思路 ${sign}${verdict.bossModifier}${knowledge} = ${verdict.total} vs DC ${verdict.dc}`,
    `判卷来源：${SOURCE_LABELS[verdict.source]}${verdict.modelIssue ? `（模型异常：${verdict.modelIssue}）` : ''}`,
  ];
}

/** 骰面只有 1 或 20 时才值得单独提示（天然成败优先于数值比较）。 */
export function criticalNote(verdict: BossVerdictView): string | null {
  if (verdict.critical === 'critical-success') {
    return '天然 20：无论 DC 多高，这一手成立。';
  }
  if (verdict.critical === 'critical-failure') {
    return '天然 1：思路再好也翻不了这一手。';
  }
  return null;
}

export interface BossTerminalProps {
  /** 题面（这一幕要求玩家回答什么）。 */
  readonly question: string;
  readonly minLength: number;
  readonly maxLength: number;
  readonly submitting: boolean;
  /** 提交失败的原因码；null 表示没有失败。 */
  readonly error: string | null;
  readonly onSubmit: (answer: string) => void;
  /** 放弃提交：直接按「稳妥选项」结算。 */
  readonly onSkip: () => void;
  readonly className?: string;
}

export function BossTerminal({
  question,
  minLength,
  maxLength,
  submitting,
  error,
  onSubmit,
  onSkip,
  className,
}: BossTerminalProps) {
  const [answer, setAnswer] = React.useState('');
  const trimmed = answer.trim();
  const tooShort = trimmed.length < minLength;
  const tooLong = trimmed.length > maxLength;

  return (
    <section
      aria-label="终端"
      className={[
        'animate-rise-in motion-reduce:animate-none rounded-2xl border border-zhihu-500/40 bg-ink-900/70 p-3.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="font-mono text-[10px] tracking-[0.3em] text-zhihu-300">TERMINAL · 第四幕</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{question}</p>

      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value.slice(0, maxLength))}
        rows={5}
        placeholder="写下你的破局方案：做什么、什么时候做完、怎么算成、什么情况下收手。"
        className="mt-3 w-full resize-y rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-zhihu-500/60 focus:outline-none focus:ring-1 focus:ring-zhihu-500/40"
      />

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={`font-mono text-[10px] ${tooLong ? 'text-relic-danger' : 'text-slate-600'}`}>
          {trimmed.length} / {maxLength}（至少 {minLength}）
        </span>
        {error ? (
          /**
           * 05_AGENT §9：原因码（`invalid-response` / `network-error` 这类技术细节）
           * 不进页面文案，只留在 `data-boss-error` 里给排查用。
           */
          <span className="text-[10px] text-relic-danger" data-boss-error={error}>
            这次提交没能完成 —— 可以重试，或直接放弃提交
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={submitting || tooShort || tooLong}
          onClick={() => onSubmit(trimmed)}
          className="arcade-btn bg-zhihu-500 text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? '判卷中…' : '提交方案，接受判卷'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onSkip}
          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-45"
        >
          放弃提交，直接结算
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        判卷只看四件事：具体性、有没有用上本局给出的知乎片段、能不能执行、有没有写退路。
        最终胜负仍由一次 D20 决定 —— 模型改不了骰子，也改不了 DC。
      </p>
    </section>
  );
}

/** 判卷分解面板：结果页用它把「为什么是这个结局」摊开。 */
export function BossVerdictPanel({
  verdict,
  className,
}: {
  readonly verdict: BossVerdictView;
  readonly className?: string;
}) {
  const note = criticalNote(verdict);

  return (
    <section
      aria-label="判卷分解"
      className={[
        'rounded-2xl border border-white/12 bg-ink-900/60 p-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="font-mono text-[10px] tracking-[0.3em] text-slate-500">BOSS VERDICT</p>

      <ul className="mt-2 space-y-1">
        {verdictLines(verdict).map((line) => (
          <li key={line} className="text-[11px] leading-relaxed text-slate-300">
            {line}
          </li>
        ))}
      </ul>

      {note ? <p className="mt-1.5 text-[11px] font-semibold text-relic-gold">{note}</p> : null}

      {verdict.feedback ? (
        <p className="mt-2 border-l-2 border-zhihu-500/50 pl-2.5 text-[11px] leading-relaxed text-slate-200">
          {verdict.feedback}
        </p>
      ) : null}

      {verdict.issues.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {verdict.issues.map((issue) => (
            <li key={issue} className="text-[10px] text-slate-500">
              待补：{issue}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default BossTerminal;
