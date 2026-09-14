'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AstralDial } from '@/components/visual/AstralDial';
import { AuroraBand } from '@/components/visual/AuroraBand';
import { FateProjectionConsole } from '@/components/visual/FateProjectionConsole';
import { OrbitField } from '@/components/visual/OrbitField';
import { UniverseJump } from '@/components/visual/UniverseJump';
import { KanshanSprite } from '@/components/characters/KanshanSprite';

import { markJumpArrival, setJumpQuestion } from '@/features/visual/jump';
import { NETWORK_UNAVAILABLE, playerFacingError, type PlayerFacingError } from '@/features/run/errorCopy';

/**
 * 首页（04_AGENT §8 / §9 / §10 / §14 / §15）。
 *
 * ## 它只做一个任务
 *
 * > 让用户说出一个真实困惑，并让这句话成为这一局的坐标。
 *
 * 视觉顺序是固定的（§8），PASS 2 把它做成一台真正的仪器：
 *
 * ```text
 * 观测窗外框（四方极细刻度 + 角标 + 读数）   ← 未来天文仪器
 * ↓ 深空建筑（地平线弧 + 顶部体积光柱）
 * ↓ 命运观象仪 AstralDial + 人生轨道 + 刘看山星座
 * ↓ Brand（衬线碑感标题 + 一条准线）
 * ↓ Hero copy
 * ↓ FateProjectionConsole（含唯一 CTA）
 * ↓ 极弱 secondary links
 * ```
 *
 * ## 首页禁止出现（§10）
 *
 * Key / 设置大按钮 / 模型 / Engine / Seed / Golden Case / 技术状态 /
 * 排行榜 / 功能矩阵 —— 一个都不在这里。次级入口只有两行 10px 的小字。
 *
 * ## 世界怎么介入（§14）
 *
 * 还没有问题时轨道各自缓慢漂移；用户一开口，附近轨道亮 10%，
 * 主焦点开始脉冲。首页只用青蓝/知乎蓝：琥珀是「反例」的颜色，
 * 不许拿来当装饰（§5）。
 *
 * ## 穿越平行宇宙（§15 升级版）
 *
 * 点击 CTA 之后不是「跳转」：控制台收缩 → 输入消失 → 中心脉冲 →
 * 光环向外加速、24 条光轨拉长、问题被拉向观者 → 收束为白 → 落点环收。
 * 请求与动画**并行**：动画绝不为了好看拖延真实响应。
 */

/**
 * §15：进入动画总时长。
 *
 * 原始约束是 600~800ms（「不要拖」）；用户反馈「穿越那一下不能省」之后取 900ms
 * —— 仍是 1 秒以内，而且转场与真实请求并行，不增加任何等待。
 */
const ENTER_MS = 900;

/**
 * 观测台前的星尘：18 颗，坐标写死。
 *
 * 为什么不用随机数：刷新十次应该是同一片天区 —— 这是「仪器」而不是「壁纸」。
 * 数量也刻意压在 §36 的 decorative particles 上限（24）以内。
 */
const DUST: readonly { readonly x: number; readonly y: number; readonly tone?: 'path' | 'zhihu' }[] = [
  { x: 12, y: 18, tone: 'zhihu' },
  { x: 24, y: 62 },
  { x: 31, y: 34, tone: 'path' },
  { x: 38, y: 82 },
  { x: 46, y: 12 },
  { x: 53, y: 54, tone: 'path' },
  { x: 58, y: 26 },
  { x: 63, y: 74, tone: 'zhihu' },
  { x: 69, y: 44 },
  { x: 74, y: 16, tone: 'path' },
  { x: 79, y: 66 },
  { x: 84, y: 32 },
  { x: 88, y: 88, tone: 'path' },
  { x: 92, y: 52 },
  { x: 17, y: 88 },
  { x: 41, y: 46 },
  { x: 66, y: 92 },
  { x: 8, y: 44, tone: 'zhihu' },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function HomePage() {
  const router = useRouter();
  const [goal, setGoal] = React.useState('');
  const [launching, setLaunching] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [error, setError] = React.useState<PlayerFacingError | null>(null);

  /**
   * 唯一的主链入口：把这句话变成一局属于他的世界。
   * 失败时如实报错并收回转场，不静默回落到旧剧本。
   */
  const onSubmit = React.useCallback(async () => {
    const trimmed = goal.trim();
    if (trimmed.length === 0 || launching) {
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const [response] = await Promise.all([
        fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        }),
        delay(ENTER_MS),
      ]);
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: { id?: string };
        error?: { code?: string; message?: string };
      };
      if (payload.ok && payload.data?.id) {
        // 告诉会话页：刚才是穿越过来的，给它一次落点
        markJumpArrival();
        // 连同这句话一起带过去：会话页在网络等待期间就能先把问题显示出来，
        // 转场因此是连续的，而不是「空屏一下再整屏弹出」
        setJumpQuestion(trimmed);
        router.push(`/session/${payload.data.id}`);
        return;
      }
      // §9：额度用满 / 上游失败各有固定人话，技术细节只留在 trace 里。
      setError(playerFacingError(payload.error ?? {}));
    } catch {
      setError(NETWORK_UNAVAILABLE);
    } finally {
      setLaunching(false);
    }
  }, [goal, launching, router]);

  const engaging = goal.trim().length > 0;
  const nearFocus = focused || engaging || launching;

  return (
    <main
      id="main-content"
      className="obs-shell relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-5 py-16 sm:py-20"
    >
      {/* 极光带：全站唯一的情绪指示器（首页恒为 seek） */}
      <AuroraBand tone="seek" />

      {/* 深空建筑：顶部体积光柱 + 地平线弧（都是 gradient，不是 blur） */}
      <span aria-hidden="true" className="obs-shaft" />
      <span aria-hidden="true" className="obs-horizon" />

      {/* 观测台前的星尘：18 颗极弱点，整层极慢自转 */}
      <div aria-hidden="true" className="obs-dust">
        {DUST.map((mote, index) => (
          <span
            key={`mote-${index}`}
            className={['obs-dust__mote', mote.tone ? `obs-dust__mote--${mote.tone}` : '']
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${mote.x}%`, top: `${mote.y}%` }}
          />
        ))}
      </div>

      {/* 观测仪器：主刻度盘 + 人生轨道 */}
      <AstralDial focus={nearFocus} />
      <OrbitField count={nearFocus ? 10 : 7} accent="path" near={nearFocus} />
      {/* 观测窗外框：四方极细刻度 + 角标 + HUD 读数（画布 SLOT 01） */}
      <div aria-hidden="true" className="obs-frame">
        <span className="obs-frame__border" />
        <span className="obs-frame__ticks obs-frame__ticks--top" />
        <span className="obs-frame__ticks obs-frame__ticks--bottom" />
        <span className="obs-frame__label obs-frame__label--tl">Slot 01 · 裂缝登记中</span>
        <span className="obs-frame__label obs-frame__label--tr">Silver Observatory · 显影盘待激活</span>
        <span className="obs-frame__label obs-frame__label--bl">Borrowed Lives Archive</span>
        <span className="obs-frame__label obs-frame__label--br">经验卡 ×0 · 未知 ×0</span>
      </div>

      <div className="relative z-10 w-full max-w-[560px]">
        <header>
          <p className="ds-kicker">知乎平行宇宙 · The Silver Observatory</p>
          <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-[color:var(--obs-zhihu-soft)]">
            OBS-01 · 人生裂缝登记处
          </p>
          <h1 className="ds-display mt-4">说出你正在经历的那件事</h1>
          <span aria-hidden="true" className="obs-hero-rule mt-5 block w-full" />
          <p className="ds-body-lead mt-5">
            把别人真实走过的人生，显影成你自己能验证的一局。
            <br />
            我们不替你决定——先看清楚走过这条路的人，付出过什么。
          </p>

          {/*
            刘看山引导员（GAME-DESIGN §4.1 · 首页待命态 idle）。
            看山只以官方 GIF 立绘出现 —— 线稿剪影（constellation / projection /
            stamp 三种形态）已按设计反馈整体下架：手绘剪影和官方黏土立绘并排时
            会互相拉低质感，所以不留任何一种。
            点击 CTA 后，它的下一句在会话页（computer 态）接上。
          */}
          <div className="gd-guide mt-6">
            <span className="gd-guide__base">
              <KanshanSprite characterId="kanshan" action="idle" className="gd-guide__sprite" alt="刘看山" />
            </span>
            <p className="gd-guide__line">我去找找，有没有人活过你正在纠结的这几种人生。</p>
          </div>
        </header>

        <FateProjectionConsole
          className="mt-9"
          value={goal}
          onChange={setGoal}
          onSubmit={() => void onSubmit()}
          busy={launching}
          collapsing={launching}
          onFocusChange={setFocused}
          title="你最近真正纠结什么？"
          placeholder="大三法学，想转计算机，但怕脱产以后找不到工作。"
          ctaLabel="生成我的平行宇宙"
          hint="我们不会替你决定。"
        />

        {error ? (
          <div
            role="alert"
            className="mt-4 border border-[color:rgb(255,120,140/0.32)] bg-[color:rgb(255,120,140/0.05)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[color:rgb(255,200,210)]"
          >
            <p>{error.title}</p>
            {error.hint ? <p className="mt-1 opacity-80">{error.hint}</p> : null}
          </div>
        ) : null}

        {/*
          §8 的「极弱 secondary links」：不承担任何主任务，
          因此只是两行 10px 小字，绝不与 CTA 争视觉。
          05_AGENT §8：这里最多两项 —— 我的经历 / 关于；
          /settings、/compare、/challenge、/commitment 这些 route 仍然存在，
          但不再从首页主导航暴露（设置从「关于」页进入）。
        */}
        <footer className="mt-14">
          {/* 底部信任条（画布：60 条真实来源 / 引用逐字可回溯 / 未知永不上锁） */}
          <p className="font-mono text-[10px] tracking-[0.14em] text-[color:var(--obs-text-2)] opacity-70">
            60 条真实来源 · 引用逐字可回溯 · 未知永不上锁
          </p>
          <div className="mt-4 flex items-center gap-5 text-[10px] tracking-[0.14em] text-[color:var(--obs-text-2)] opacity-70">
            <Link href="/journal" className="transition-opacity duration-200 hover:opacity-100">
              我的经历
            </Link>
            <Link href="/about" className="transition-opacity duration-200 hover:opacity-100">
              关于
            </Link>
          </div>
        </footer>
      </div>

      {/* 穿越平行宇宙：观测台上的一次空间转场 */}
      <UniverseJump active={launching} question={goal.trim()} />
    </main>
  );
}
