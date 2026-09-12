'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { usePrefersReducedMotion } from '@/components/Terminal';

import type { CheckOutcome, TargetStat } from '@/types/game';

/**
 * D20 检定模态框。
 *
 * 演出节奏（约 1.4s）：
 *   数字狂闪 + 骰子抖动 → 定格真实骰面 → 重击反馈（通过/失败/大成功/大失败）。
 *
 * 结果由 `core/d20` 提前算好并传入，本组件只负责表演，不参与任何判定，
 * 因此刷新或重播不会改变结果。
 */

const STAT_LABEL: Record<TargetStat, string> = {
  san: 'SAN 心智',
  skill: '专业力',
  bond: '羁绊',
};

/** 裁决三态 → 骰面着色（judged 模式下骰子只代表遭遇，因此用中性/结论色）。 */
function verdictToneColor(kind: 'viable' | 'breached' | 'unknown' | undefined): string {
  if (kind === 'viable') return '#3DD6A0';
  if (kind === 'breached') return '#FF4D6D';
  return '#7C8CA6';
}

/**
 * 一次检定的展示数据。
 *
 * ## v3 §5.1 之后它承载两件不同的事
 *
 * | 字段 | 含义（v3 之后） |
 * |---|---|
 * | `rawRoll` / `fate` | **命运掷骰**：只决定遭遇品质（贵人 / 机会 / 事故），**不决定成败** |
 * | `verdict` | **现实裁决**：由 `verdictFor` 算出的唯一成败来源 |
 *
 * 旧字段（`total` / `difficulty` / `baseModifier` / `relicModifier` / `critical`）
 * 保留给**终局 Boss 判卷**：那条路仍是一次标准 D20（骰面与 DC 来自服务端），
 * 但它判的是「你这一局的方案能不能成」，而不是「你这条人生路是否成立」。
 * 两者语义不同，因此不强行合并。
 */
export interface DiceResultView {
  readonly rawRoll: number;
  readonly total: number;
  readonly difficulty: number;
  readonly outcome: CheckOutcome;
  readonly critical: 'none' | 'critical-failure' | 'critical-success';
  readonly baseModifier: number;
  readonly relicModifier: number;
  readonly targetStat: TargetStat;
  /** 命运掷骰的遭遇品质（v3 §5.2）：有值即表示这一幕是「随机只决定遭遇」。 */
  readonly fate?: {
    readonly quality: 'mishap' | 'ordinary' | 'fortunate' | 'breakthrough';
    readonly label: string;
  };
  /** 现实裁决（v3 §5.1）：有值即表示成败来自纯函数判定，而不是骰子。 */
  readonly verdict?: {
    readonly kind: 'viable' | 'breached' | 'unknown';
    readonly headline: string;
    /** 越线的轴与差额；`viable` 时为 null。 */
    readonly breach: { readonly label: string; readonly shortfall: number } | null;
  };
}

export interface DiceModalProps {
  readonly open: boolean;
  readonly result: DiceResultView | null;
  /** 演出结束后点击「继续」触发；由调用方推进到结果阶段。 */
  readonly onConfirm: () => void;
}

/** 二十面体的正视图：外六边形 + 内三角 + 三条辐条。 */
function D20Shape({ tone }: { tone: string }) {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden="true">
      <polygon
        points="100,12 176,56 176,144 100,188 24,144 24,56"
        fill="rgba(255,255,255,0.03)"
        stroke={tone}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon
        points="100,34 158,148 42,148"
        fill="rgba(255,255,255,0.05)"
        stroke={tone}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <g stroke={tone} strokeWidth="2" opacity="0.7">
        <line x1="100" y1="34" x2="100" y2="12" />
        <line x1="158" y1="148" x2="176" y2="144" />
        <line x1="42" y1="148" x2="24" y2="144" />
      </g>
    </svg>
  );
}

export function DiceModal({ open, result, onConfirm }: DiceModalProps) {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = React.useState(false);
  const [face, setFace] = React.useState(1);
  const [revealed, setRevealed] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  React.useEffect(() => {
    if (!open || !result) {
      setRevealed(false);
      return;
    }

    if (reduced) {
      setFace(result.rawRoll);
      setRevealed(true);
      return;
    }

    setRevealed(false);

    const start = performance.now();
    const duration = 1400;
    let raf = 0;

    const tick = (now: number) => {
      if (now - start >= duration) {
        setFace(result.rawRoll);
        setRevealed(true);
        return;
      }

      setFace(1 + Math.floor(Math.random() * 20));
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(raf);
  }, [open, result, reduced]);

  if (!mounted || !open || !result) {
    return null;
  }

  const isSuccess = result.outcome === 'success';
  const isCritical = result.critical !== 'none';
  const modifier = result.baseModifier + result.relicModifier;

  const tone = revealed
    ? isSuccess
      ? '#3DD6A0'
      : '#FF4D6D'
    : '#3D9BFF';

  const panelBorder = revealed
    ? isSuccess
      ? 'border-emerald-400/50 shadow-[0_0_80px_-20px_rgba(61,214,160,0.7)]'
      : 'border-rose-500/60 shadow-[0_0_80px_-20px_rgba(255,77,109,0.75)]'
    : 'border-zhihu-500/40 shadow-[0_0_70px_-24px_rgba(0,132,255,0.7)]';

  const banner = result.critical === 'critical-success'
    ? '大成功 · 天然 20'
    : result.critical === 'critical-failure'
      ? '大失败 · 天然 1'
      : isSuccess
        ? '检定通过'
        : '检定失败';

  /**
   * v3 §5.1：有 `verdict` 时，**成败来自纯函数裁决，骰面只是遭遇**。
   * 这时界面必须换一套说法 —— 否则玩家仍会以为「是骰子决定了我这条路的成败」。
   */
  const judged = result.verdict !== undefined;
  const verdictKind = result.verdict?.kind;
  const verdictTone =
    verdictKind === 'viable'
      ? { text: 'text-emerald-300', border: 'border-emerald-400/50', glow: 'shadow-[0_0_80px_-20px_rgba(61,214,160,0.7)]' }
      : verdictKind === 'breached'
        ? { text: 'text-rose-300', border: 'border-rose-500/60', glow: 'shadow-[0_0_80px_-20px_rgba(255,77,109,0.75)]' }
        : { text: 'text-slate-300', border: 'border-white/20', glow: 'shadow-[0_0_70px_-24px_rgba(255,255,255,0.25)]' };

  const verdictBanner =
    verdictKind === 'viable'
      ? '这条路在你的条件下成立'
      : verdictKind === 'breached'
        ? '撞上了现实的边界'
        : '证据不足 · 这一局不给结论';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/85 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={judged ? '现实裁决' : `${STAT_LABEL[result.targetStat]}检定`}
        className={[
          'relative w-full max-w-md overflow-hidden rounded-3xl border bg-ink-800/95 p-6 transition-all duration-300',
          judged && revealed ? `${verdictTone.border} ${verdictTone.glow}` : panelBorder,
        ].join(' ')}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.3em] text-zhihu-400">
            {judged ? 'REALITY CHECK' : 'RISK CHECK'}
          </p>
          <span className="chip">
            {judged ? '由规则引擎裁决' : `${STAT_LABEL[result.targetStat]} · DC ${result.difficulty}`}
          </span>
        </div>

        <h3 className="mt-2 text-lg font-bold text-white">
          {judged ? '现实裁决' : '风险检定'}
        </h3>

        {/* 骰子：judged 时它只代表「遭遇掷骰」，不代表成败 */}
        <div className="relative mx-auto mt-5 h-40 w-40">
          {!revealed ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-scan-sweep bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />
          ) : null}

          <div className={revealed ? 'h-full w-full' : 'h-full w-full animate-dice-tumble'}>
            <D20Shape tone={judged && revealed ? verdictToneColor(verdictKind) : tone} />
          </div>

          <span
            className={[
              'absolute inset-0 flex items-center justify-center font-mono text-5xl font-black tabular-nums transition-colors duration-200',
              revealed
                ? judged
                  ? 'text-slate-200'
                  : isSuccess
                    ? 'text-emerald-300'
                    : 'text-rose-300'
                : 'text-white/90 blur-[0.5px]',
            ].join(' ')}
          >
            {face}
          </span>
        </div>

        {/* judged：骰面只是遭遇；未 judged：仍是检定算式 */}
        {judged ? (
          <p className="mt-4 text-center font-mono text-xs text-slate-500">
            遭遇掷骰 {result.rawRoll}
            {result.fate ? <span className="ml-2 text-slate-400">{result.fate.label}</span> : null}
          </p>
        ) : (
          <p className="mt-5 text-center font-mono text-xs text-slate-400">
            D20 {result.rawRoll}
            <span className="mx-1 text-slate-600">+</span>
            修正 {modifier >= 0 ? `+${modifier}` : modifier}
            <span className="mx-1 text-slate-600">=</span>
            <span className="font-semibold text-slate-200">{result.total}</span>
            <span className="mx-1 text-slate-600">vs</span>
            DC {result.difficulty}
          </p>
        )}

        {/* 裁决结论（judged 的主角） */}
        {judged && revealed ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center">
            <p className={`font-mono text-[11px] tracking-[0.2em] ${verdictTone.text}`}>
              {verdictKind === 'viable' ? 'VIABLE' : verdictKind === 'breached' ? 'BREACHED' : 'UNKNOWN'}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{verdictBanner}</p>
            {result.verdict?.breach ? (
              <p className="mt-1.5 font-mono text-[11px] text-rose-300">
                缺口 · {result.verdict.breach.label}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              成败来自你的条件与这条路的需求，不是骰子。
            </p>
          </div>
        ) : null}

        {/* 结果 */}
        {/*
          旧的 D20 结果块**只在非 judged（终局 Boss 判卷）时渲染**。

          这块原本无条件渲染，于是 judged 模式下同一屏会出现
          「成败来自你的条件与这条路的需求，不是骰子」与
          「检定通过 · 总值达到难度线」并存 —— 两句话在打架。
          Boss 判卷确实是标准 D20（骰面与 DC 来自服务端），所以它的文案保持不变。
        */}
        {!judged ? (
          revealed ? (
            <div
              className={[
                'mt-4 animate-bounce-in rounded-2xl border px-4 py-3 text-center',
                isSuccess
                  ? 'border-emerald-400/40 bg-emerald-400/10'
                  : 'border-rose-500/40 bg-rose-500/10',
              ].join(' ')}
            >
              <p
                className={[
                  'text-xl font-black tracking-wide',
                  isSuccess ? 'text-emerald-300' : 'text-rose-300',
                ].join(' ')}
              >
                {banner}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {isCritical
                  ? '临界骰面优先于数值比较：天然 1 必败，天然 20 必成。'
                  : isSuccess
                    ? '总值达到难度线，判定成功。'
                    : '总值未达难度线，判定失败。'}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-center text-[11px] text-slate-500">
              骰面正在滚动，结果由本局种子锁定……
            </p>
          )
        ) : null}

        <button
          type="button"
          onClick={onConfirm}
          disabled={!revealed}
          className={[
            'mt-5 w-full rounded-xl px-4 py-3 text-sm font-bold transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-40',
            isSuccess
              ? 'bg-emerald-500 text-ink-900 hover:bg-emerald-400'
              : 'bg-rose-500 text-white hover:bg-rose-400',
          ].join(' ')}
        >
          {revealed ? '承受结果' : '骰面滚动中…'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default DiceModal;
