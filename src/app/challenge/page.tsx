'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { DEFAULT_ORIGIN_ID, ORIGINS, getOrigin, type OriginId } from '@/data/origins';
import { buildPlayUrlFromChallenge } from '@/core/challenge';

/**
 * 种子挑战落地页。
 *
 * 裂变闭环的关键一环：上一局玩家在结算页复制挑战链接，别人打开这个页面，
 * 看到的是「谁、用什么目标、哪个出身、哪颗种子」的挑战卡，而不是冷冰冰的首页。
 * 点「接受挑战」会用**同一颗种子**进入推演舱——同一局、同一组骰面，
 * 结果完全可比（确定性设计是这里成立的前提）。
 *
 * 之所以不做图片海报：不引入 html2canvas 这类截图依赖，
 * 改用「可直接分享的页面 + 复制文案」，传播链路反而更短。
 */

const origins = ORIGINS;

function StatBadge({ label, value }: { readonly label: string; readonly value: string }) {  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function ChallengePanel() {
  const params = useSearchParams();

  const seed = params.get('seed') ?? '';
  const goal = params.get('goal') ?? '';
  const originParam = params.get('origin') ?? DEFAULT_ORIGIN_ID;
  const from = params.get('from') ?? '';
  const acts = params.get('acts') ?? '';
  const result = params.get('result') ?? '';
  /**
   * 剧本 id。**必须透传给推演舱**：少这一步，
   * 被挑战者进来会静默回落到默认剧本，拿到的其实是另一场推演 ——
   * 「同一颗种子、同一组骰面」在预置剧本与 AI 剧本下都会失真。
   */
  const scenarioParam = params.get('scenario') ?? '';

  const origin = React.useMemo(() => getOrigin(originParam), [originParam]);
  const [copied, setCopied] = React.useState(false);

  // 没有种子就不是一个有效挑战——如实说明，而不是伪造一个
  const valid = seed.trim().length > 0;

  const challengeHref = React.useMemo(
    () =>
      buildPlayUrlFromChallenge({
        seed,
        originId: (origins.some((item) => item.id === originParam)
          ? originParam
          : DEFAULT_ORIGIN_ID) as OriginId,
        goal,
        scenarioId: scenarioParam,
      }),
    [goal, originParam, scenarioParam, seed],
  );

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!valid) {
    return (
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-4 px-4 py-16 text-center">
        <p className="font-mono text-[11px] tracking-[0.4em] text-slate-500">SEED CHALLENGE</p>
        <h1 className="text-2xl font-black text-white">这个挑战链接缺少种子</h1>
        <p className="text-sm leading-relaxed text-slate-400">
          挑战链接里必须带 <span className="font-mono text-slate-300">seed</span> 参数，
          否则每个人抽到的骰面都不一样，成绩没法比较。
        </p>
        <div className="mt-2">
          <Link href="/" className="arcade-btn bg-zhihu-500 px-5 py-2.5 text-sm text-white">
            回到命运发令台
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-5 px-4 py-12 sm:px-6">
      <header className="text-center">
        <p className="font-mono text-[11px] tracking-[0.4em] text-zhihu-400">SEED CHALLENGE</p>
        <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">有人向你发起了一场推演</h1>
      </header>

      <article className="relative overflow-hidden rounded-3xl border-2 border-dashed border-zhihu-500/40 bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900 p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-radial-halo opacity-70"
        />

        <p className="font-mono text-[10px] tracking-[0.35em] text-slate-500">
          ZHIHU MULTIVERSE · CHALLENGE
        </p>

        <div className="mt-3 rounded-2xl border border-white/10 bg-ink-900/70 px-4 py-3">
          <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">UNIVERSE SEED</p>
          <p className="mt-1 break-all font-mono text-base font-bold text-white">{seed}</p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatBadge label="发起者" value={from.trim() || '一位同路人'} />
          <StatBadge label="出身流派" value={origin.name} />
          {acts.trim().length > 0 ? <StatBadge label="走到第几幕" value={`${acts} / 4`} /> : null}
          {scenarioParam.trim().length > 0 ? (
            <StatBadge
              label="剧本"
              value={scenarioParam === 'ai-dm' ? 'AI 自由推演' : scenarioParam}
            />
          ) : null}
          {result.trim().length > 0 ? (
            <StatBadge label="最终结局" value={result === 'success' ? '走完全程' : '中途折戟'} />
          ) : null}
        </dl>

        {goal.trim().length > 0 ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-ink-900/60 p-3">
            <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">推演目标</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">「{goal}」</p>
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl border border-relic-gold/30 bg-relic-gold/[0.05] p-3">
          <p className="font-mono text-[10px] tracking-[0.25em] text-relic-gold">同一个宇宙</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            同一颗种子意味着**同一组骰面**。你和他面对的是完全一致的随机事件，
            在同一个岔路口，你们的差距只来自选择——这正是「种子挑战」成立的原因。
          </p>
        </div>
      </article>

      <div className="flex flex-wrap justify-center gap-3">
        <Link href={challengeHref} className="arcade-btn bg-zhihu-500 px-5 py-2.5 text-sm text-white">
          接受挑战
        </Link>

        <button type="button" onClick={handleCopy} className="btn-ghost px-4 py-2.5 text-sm">
          {copied ? '已复制 ✓' : '复制这个挑战'}
        </button>

        <Link href="/" className="btn-ghost px-4 py-2.5 text-sm">
          换自己的目标
        </Link>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-slate-600">
        想发起自己的挑战？推演结束后，在通行证页面复制挑战链接即可。
      </p>
    </main>
  );
}

export default function ChallengePage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="animate-flicker font-mono text-sm text-slate-500">正在读取挑战…</p>
        </main>
      }
    >
      <ChallengePanel />
    </React.Suspense>
  );
}
