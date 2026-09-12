'use client';

import * as React from 'react';

import { buildChallengeUrl } from '@/core/challenge';

/**
 * 终局「平行宇宙通行证」。
 *
 * 对应草稿里通关后一键生成海报、印上专属 Seed 与刘看山印章的节拍。
 * 这里用纯 DOM + Tailwind 渲染，不引入 html2canvas，避免为了截图能力
 * 多背一个依赖；需要导出图片时可在外层套一层截图库。
 */

export interface EndgameRelicSummary {
  readonly name: string;
  readonly kind: 'passive' | 'active';
}

export interface EndgamePassProps {
  readonly seed: string;
  readonly scenarioTitle: string;
  readonly stats: { readonly san: number; readonly skill: number; readonly bond: number };
  readonly survivedTurns: number;
  readonly totalTurns: number;
  readonly saltPoints: number;
  readonly relics: readonly EndgameRelicSummary[];
  readonly success: boolean;
  /** 每幕结束时的 SAN 快照，用于「看山心情日记」折线图。 */
  readonly sanHistory: readonly number[];
  /** 本局提炼出的决策画像标签。 */
  readonly archetypes: readonly string[];
  /** 玩家写下的反思短评，会成为下一局的「前世遗念」。 */
  readonly finalWords: string;
  readonly onFinalWordsChange: (words: string) => void;
  /**
   * 记忆保存状态。
   *
   * - `guest`   未登录：这一局不会被记住，也不会产生下一局的遗念
   * - `saved`   已登录且**真的落盘**了
   * - `pending` 已登录但尚未保存完成
   * - `failed`  已登录但**没写进去**（磁盘只读等）：必须如实告知，不得宣称已保存
   */
  readonly memoryStatus: 'guest' | 'saved' | 'pending' | 'failed';
  /** memoryStatus === 'failed' 时的原因码，用于给出可诊断的说明。 */
  readonly saveFailureReason?: string | null;
  /** 封存遗言（终局第二步）：玩家点按钮才写。 */
  readonly onSealFinalWords: () => void;
  /** 遗言封存状态。只有 `sealed` 才表示真的写进去了。 */
  readonly sealState: 'idle' | 'sealing' | 'sealed' | 'failed';
  /**
   * 本局剧本 id。挑战链接必须带上它 ——
   * 少了这个参数，接受挑战的人会静默回落到默认剧本，拿到的其实是另一场推演。
   */
  readonly scenarioId?: string;
  /** 存入后累计第几局，用于文案。 */
  readonly savedTotalRuns: number;
  readonly onRestart: () => void;
}

/** 找出一局里 SAN 跌得最狠的那一幕，生成看山的一句评语。 */
function sanVerdict(history: readonly number[]): string {
  if (history.length < 2) {
    return '这一局很短，看山还没来得及说什么。';
  }

  let worstIndex = 0;
  let worstDrop = 0;

  for (let index = 1; index < history.length; index += 1) {
    const drop = history[index - 1] - history[index];
    if (drop > worstDrop) {
      worstDrop = drop;
      worstIndex = index;
    }
  }

  if (worstDrop <= 0) {
    return '整局的曲线都在往上走，看山难得松了口气。';
  }

  return `第 ${worstIndex} 幕心态断崖式下跌 ${worstDrop} 点，看山在旁边为你捏了把汗。`;
}

/** 原生 SVG 折线：不做图表库，省一个依赖。 */
function SanCurve({ history }: { readonly history: readonly number[] }) {
  if (history.length < 2) {
    return null;
  }

  const W = 320;
  const H = 96;
  const PAD = 10;

  const points = history.map((value, index) => {
    const x = PAD + (index / (history.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - Math.max(0, Math.min(100, value)) / 100) * (H - PAD * 2);
    return { x, y, value, index };
  });

  const path = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="本局 SAN 走势">
      {/* 基准线 */}
      {[0, 50, 100].map((value) => {
        const y = PAD + (1 - value / 100) * (H - PAD * 2);
        return (
          <g key={value}>
            <line
              x1={PAD}
              y1={y}
              x2={W - PAD}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="3 6"
            />
            <text x={PAD} y={y - 3} fontSize="8" fill="rgba(148,163,184,0.55)" fontFamily="monospace">
              {value}
            </text>
          </g>
        );
      })}

      <polyline
        points={path}
        fill="none"
        stroke="var(--gmv-rose-500)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {points.map((point) => (
        <g key={point.index}>
          <circle cx={point.x} cy={point.y} r="4" fill="var(--gmv-ink-900)" stroke="var(--gmv-rose-500)" strokeWidth="2" />
          <text
            x={point.x}
            y={point.y - 9}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(201,212,227,0.9)"
            fontFamily="monospace"
          >
            {point.value}
          </text>
          <text
            x={point.x}
            y={H - 1}
            textAnchor="middle"
            fontSize="8"
            fill="rgba(124,140,166,0.8)"
            fontFamily="monospace"
          >
            {point.index === 0 ? '起' : `第${point.index}幕`}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Stamp() {
  return (
    <div className="pointer-events-none absolute -right-3 -top-4 rotate-[-8deg] animate-stamp-in">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-relic-danger/70">
        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full border border-relic-danger/50 text-relic-danger/80">
          <span className="text-[9px] font-bold leading-none tracking-widest">知乎</span>
          <span className="mt-0.5 text-[8px] leading-none tracking-widest">平行宇宙</span>
          <span className="mt-0.5 font-mono text-[7px] leading-none">SEAL</span>
        </div>
      </div>
    </div>
  );
}

export function EndgamePass({
  seed,
  scenarioTitle,
  stats,
  survivedTurns,
  totalTurns,
  saltPoints,
  relics,
  success,
  sanHistory,
  archetypes,
  finalWords,
  onFinalWordsChange,
  onSealFinalWords,
  sealState,
  memoryStatus,
  saveFailureReason,
  scenarioId,
  savedTotalRuns,
  onRestart,
}: EndgamePassProps) {
  const [copied, setCopied] = React.useState(false);

  /**
   * 挑战链接指向 /challenge 落地页，而不是直接回推演舱。
   *
   * 原因：被分享的人需要一个「这是什么」的过渡页。直接跳 /play 会让他
   * 一上来就面对陌生剧情，裂变转化差；落地页先讲清挑战内容再让他接受。
   */
  const shareUrl = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    // 拼装逻辑抽到 core/challenge.ts —— 「剧本 id 必须随链接传递」
    // 是一条可以被单测锁住的不变量，不适合埋在组件里。
    return buildChallengeUrl({
      currentHref: window.location.href,
      seed,
      survivedTurns,
      success,
      scenarioId,
    });
  }, [scenarioId, seed, success, survivedTurns]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [shareUrl]);

  const rows: ReadonlyArray<readonly [string, string]> = [
    ['存活回合', `${survivedTurns} / ${totalTurns}`],
    ['最终 SAN', `${stats.san}`],
    ['专业力', `${stats.skill}`],
    ['社区羁绊', `${stats.bond}`],
  ];

  return (
    <div className="relative animate-rise-in">
      {/* 通行证本体 */}
      <article
        className={[
          'relative overflow-hidden rounded-3xl border-2 border-dashed p-5',
          success
            ? 'border-relic-gold/50 bg-gradient-to-br from-[#1B1608] via-ink-800 to-ink-900'
            : 'border-white/15 bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900',
        ].join(' ')}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-radial-gold opacity-60"
        />

        <Stamp />

        <p className="font-mono text-[10px] tracking-[0.35em] text-slate-500">
          ZHIHU MULTIVERSE · PASS
        </p>

        <h3
          className={[
            'mt-1 text-xl font-black tracking-wide',
            success ? 'text-glow-gold text-amber-300' : 'text-slate-300',
          ].join(' ')}
        >
          {success ? '平行宇宙通行证' : '推演中止记录'}
        </h3>

        <p className="mt-1 text-[11px] text-slate-500">{scenarioTitle}</p>

        {/* Seed */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-ink-900/70 px-4 py-3">
          <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">UNIVERSE SEED</p>
          <p className="mt-1 break-all font-mono text-base font-bold text-white">{seed}</p>
        </div>

        {/* 属性结算 */}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <dt className="text-[10px] text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-mono text-base font-semibold text-white">{value}</dd>
            </div>
          ))}
        </dl>

        {/* 遗物清单 */}
        <div className="mt-3">
          <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">RELIC LOADOUT</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {relics.length > 0 ? (
              relics.map((relic) => (
                <span
                  key={relic.name}
                  className={relic.kind === 'active' ? 'chip-gold' : 'chip-zhihu'}
                >
                  {relic.name}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-slate-600">本局未获得任何遗物</span>
            )}
          </div>
        </div>

        {/* 看山心情日记 */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-ink-900/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">
              看山心情日记
            </p>
            <span className="font-mono text-[10px] text-slate-600">SAN 走势</span>
          </div>

          <div className="mt-1">
            <SanCurve history={sanHistory} />
          </div>

          <p className="mt-1.5 border-l-2 border-zhihu-500/50 pl-2.5 text-[11px] leading-relaxed text-slate-300">
            刘看山：{sanVerdict(sanHistory)}
          </p>

          {archetypes.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.07] pt-2.5">
              <span className="font-mono text-[10px] tracking-[0.2em] text-slate-500">
                决策画像
              </span>
              {archetypes.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* 前世遗念：写下的这句话会变成下一局的初始卡牌 */}
        {memoryStatus === 'guest' ? (
          /* 游客：说清代价，给出登录入口。不弹窗、不拦路，只是让损失可视化 */
          <div className="mt-4 rounded-2xl border border-white/12 bg-white/[0.03] p-3">
            <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">
              MEMORY · 这一局不会被记住
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              你现在是游客身份。这一局的目标、结局与决策画像都不会被保存，
              下一局也不会有【前世的避坑顿悟】带你少走弯路。
            </p>
            <a
              href="/oauth"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-zhihu-500/50 bg-zhihu-500/10 px-3 py-1.5 text-[11px] font-semibold text-zhihu-300 transition-colors duration-150 hover:bg-zhihu-500/20"
            >
              连接知乎账号，让宇宙记住你
            </a>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-relic-gold/35 bg-relic-gold/[0.05] p-3">
            <p className="font-mono text-[10px] tracking-[0.25em] text-relic-gold">
              LEGACY · 留下一句遗念
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              写给下一世的自己。这句话会变成开局卡牌【前世的避坑顿悟】，
              为专业力检定提供永久 +{success ? 12 : survivedTurns >= 3 ? 8 : 5} 修正——
              走得越远，那一世的教训越值钱。
            </p>

            <input
              type="text"
              value={finalWords}
              maxLength={60}
              onChange={(event) => onFinalWordsChange(event.target.value)}
              placeholder="例如：别盲目背八股，一定要先做出一个能讲清楚的项目"
              className="mt-2.5 w-full rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-relic-gold/60 focus:outline-none focus:ring-1 focus:ring-relic-gold/40"
            />

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSealFinalWords}
                disabled={
                  sealState === 'sealing' ||
                  sealState === 'sealed' ||
                  finalWords.trim().length === 0
                }
                className="rounded-lg border border-relic-gold/50 bg-relic-gold/10 px-3 py-1.5 text-[11px] font-semibold text-relic-gold transition-colors duration-150 hover:bg-relic-gold/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {sealState === 'sealing'
                  ? '正在封存…'
                  : sealState === 'sealed'
                    ? '已封存'
                    : '封存这句遗念'}
              </button>
              <span className="font-mono text-[10px] text-slate-600">
                {finalWords.length} / 60
              </span>
            </div>

            {/* 只有真落盘才说「已封存」；失败就说失败，不糊弄 */}
            <p
              className={[
                'mt-1.5 text-[10px] leading-relaxed',
                sealState === 'failed' || memoryStatus === 'failed'
                  ? 'text-relic-danger'
                  : sealState === 'sealed'
                    ? 'text-relic-gold'
                    : 'text-slate-500',
              ].join(' ')}
            >
              {sealState === 'sealed'
                ? '已封存 · 下一局开局会带着这句遗念'
                : sealState === 'sealing'
                  ? '正在写入你的宇宙…'
                  : sealState === 'failed'
                    ? '没能写入你的宇宙，这句遗念不会被记住 —— 可以稍后重试'
                    : '写下后点「封存这句遗念」，它才会成为下一局的卡牌'}
            </p>

            <p className="mt-1 text-[10px] text-slate-500">
              {memoryStatus === 'saved'
                ? `本局已存入你的宇宙 · 累计第 ${savedTotalRuns} 局`
                : memoryStatus === 'failed'
                  ? `本局基础记录没能保存（${saveFailureReason ?? 'storage-write-failed'}）· 只剩当前页面有效`
                  : '正在保存本局记录…'}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
          <span className="font-mono text-[10px] text-slate-500">轮回积分</span>
          <span className="font-mono text-lg font-bold text-relic-gold">+{saltPoints}</span>
        </div>
      </article>

      {/* 操作区 */}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onRestart} className="arcade-btn bg-zhihu-500 text-white">
          再推演一局
        </button>

        <button type="button" onClick={handleCopy} className="btn-ghost">
          {copied ? '已复制挑战链接 ✓' : '复制挑战链接'}
        </button>
      </div>
    </div>
  );
}

export default EndgamePass;
