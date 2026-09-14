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
import ObserverChip from '@/components/session/ObserverChip';

import { markJumpArrival, setJumpQuestion } from '@/features/visual/jump';
import { NETWORK_UNAVAILABLE, playerFacingError, type PlayerFacingError } from '@/features/run/errorCopy';

/**
 * 首页 · 人生裂缝登记处
 *
 * ## 它只做一个任务
 *
 * > 让用户说出一个真实困惑，并让这句话成为这一局的坐标。
 *
 * ## 本次重做的三个判断
 *
 * **1. 双栏，而不是永远居中的一行。**
 *
 * 旧版把全部内容塞进 `max-w-[560px]` 居中。在 1440px 的屏幕上，
 * 这意味着 61% 的宽度是空的 —— 那不是「留白」，是没做桌面设计。
 * 现在：宽屏左栏是观象仪与叙事（占满、可呼吸），右栏是操作台（固定 520px）；
 * 窄屏自动合成单列，且**顺序重排** —— 先给结论式标题，再给输入，
 * 观象仪退到输入之后（移动端用户第一眼要看到「这能干什么」，不是一台仪器）。
 *
 * **2. 显影盘不再堆满 9px 英文标签。**
 *
 * 旧版四角各贴一个 9px 的英文铭牌（Slot 01 / Silver Observatory /
 * Borrowed Lives Archive / 经验卡 ×0）。在手机上这些字小到不可读，
 * 只贡献视觉噪音。现在只保留一句真正有信息量的状态行，其余交给留白。
 *
 * **3. 装饰层减法。**
 *
 * 星尘从 18 颗降到 9 颗且只在宽屏出现（窄屏省掉这层 DOM 与动画）；
 * 体积光柱、地平线弧、外框刻度全部撤掉 —— 暗房不需要这些，
 * 材质本身（颗粒 + 晕影）已经给足了空间感。
 */

/**
 * 进入动画总时长。
 *
 * 原始约束是 600~800ms（「不要拖」）；用户反馈「穿越那一下不能省」之后取 900ms
 * —— 仍是 1 秒以内，而且转场与真实请求并行，不增加任何等待。
 */
const ENTER_MS = 900;

/**
 * 观测台前的星尘：9 颗，坐标写死。
 *
 * 为什么不用随机数：刷新十次应该是同一片天区 —— 这是「仪器」而不是「壁纸」。
 * 为什么从 18 降到 9：移动端这层不可见却要付渲染成本，宽屏上 9 颗已够。
 */
const DUST: readonly { readonly x: number; readonly y: number; readonly tone?: 'path' | 'zhihu' }[] = [
  { x: 14, y: 20, tone: 'zhihu' },
  { x: 27, y: 64 },
  { x: 36, y: 33, tone: 'path' },
  { x: 45, y: 84 },
  { x: 58, y: 24 },
  { x: 66, y: 72, tone: 'zhihu' },
  { x: 76, y: 40 },
  { x: 85, y: 60 },
  { x: 22, y: 88, tone: 'path' },
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

  const nearFocus = focused || goal.trim().length > 0 || launching;

  return (
    <main
      id="main-content"
      className="sil-viewport relative flex w-full items-center justify-center px-5 py-10 sm:px-8 sm:py-14 lg:py-16"
    >
      {/* 极光带：全站唯一的情绪指示器（首页恒为 seek） */}
      <AuroraBand tone="seek" />

      {/*
        星尘：只在宽屏出现（窄屏不可见却要付渲染成本）
      */}
      <div aria-hidden="true" className="sil-dust hidden lg:block">
        {DUST.map((mote, index) => (
          <span
            key={`mote-${index}`}
            className={['sil-dust__mote', mote.tone ? `sil-dust__mote--${mote.tone}` : '']
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${mote.x}%`, top: `${mote.y}%` }}
          />
        ))}
      </div>

      {/*
        人生轨道场：**整页背景**，不放进任何栅格列。

        ## 为什么不做成左栏里的一个方块

        轨道族原本被包在左栏的正方形容器里（`aspect-square`）。
        但轨道是为「满屏铺开」设计的：它的 SVG 用
        `preserveAspectRatio="xMidYMid slice"`，意思就是「按容器尺寸裁切铺满」——
        这正是对局页的用法（那里它是全幅背景）。

        塞进正方形后，容器不再是整个画面，`slice` 的裁切就从
        「画面边缘」变成了「方块边缘」：轨道在方块左右被竖直切断，
        读起来像画面被裁坏了，而不是「天空延伸到画面之外」。

        放回成整页背景后，弧线自然地在视口边缘之外延续，
        与 `AuroraBand` / 星尘同一层，内容栅格用 `z-10` 压在它上面。
      */}
      <OrbitField count={nearFocus ? 10 : 7} accent="path" near={nearFocus} />

      {/*
        两栏栅格。
        宽屏：左 = 观象仪 + 叙事（弹性），右 = 操作台（定宽 520px）
        窄屏：单列，且用 order 把「标题 → 输入」提到观象仪之前
      */}
      <div className="relative z-10 mx-auto grid w-full max-w-[1240px] grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-16">
        {/* ---------------- 观象仪（窄屏排在输入之后） ---------------- */}
        <div className="order-2 flex justify-center lg:order-1 lg:justify-start">
          <div className="relative flex aspect-square w-full max-w-[min(78vw,460px)] items-center justify-center lg:max-w-none">
            <AstralDial focus={nearFocus} />
          </div>
        </div>

        {/* ---------------- 叙事 + 操作台 ---------------- */}
        <div className="order-1 w-full lg:order-2">
          <header>
            <p className="sil-label">知乎平行宇宙 · The Silver Observatory</p>

            <h1 className="sil-title sil-title--display mt-4">
              说出你正在经历的那件事
            </h1>

            <p className="sil-prose mt-5">
              把别人真实走过的人生，显影成你自己能验证的一局。
              <br className="hidden sm:block" />
              我们不替你决定 —— 先看清楚走过这条路的人，付出过什么。
            </p>

            {/*
              刘看山引导员（GAME-DESIGN §4.1 · 首页待命态 idle）。
              看山只以官方 GIF 立绘出现 —— 线稿剪影（constellation / projection /
              stamp 三种形态）已按设计反馈整体下架：手绘剪影和官方黏土立绘并排时
              会互相拉低质感，所以不留任何一种。
              点击 CTA 后，它的下一句在会话页（computer 态）接上。
            */}
            <div className="mt-6 flex items-center gap-3.5">
              <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center">
                <KanshanSprite characterId="kanshan" action="idle" className="h-full w-full object-contain" alt="刘看山" />
              </span>
              <p className="sil-prose text-[13px] leading-relaxed text-[color:var(--sil-ink-300)] sm:text-[14px]">
                我去找找，有没有人活过你正在纠结的这几种人生。
              </p>
            </div>
          </header>

          <FateProjectionConsole
            className="mt-8"
            value={goal}
            onChange={setGoal}
            onSubmit={() => void onSubmit()}
            busy={launching}
            collapsing={launching}
            onFocusChange={setFocused}
            title="你最近真正纠结什么？"
            placeholder="大三法学，想转计算机，但怕脱产以后找不到工作。"
            ctaLabel="生成我的平行宇宙"
            hint="来自知乎真实回答 · 逐字引用 · 每条都可回溯。我们不替你决定，只帮你看见别人真正付出过什么。"
          />

          {error ? (
            <div
              role="alert"
              className="mt-4 border-l-2 border-[color:var(--sil-counter)] bg-[color:rgb(179_133_74_/_0.06)] px-3.5 py-3 text-[13px] leading-relaxed text-[color:var(--sil-counter-soft)]"
            >
              <p className="font-medium">{error.title}</p>
              {error.hint ? <p className="mt-1 opacity-80">{error.hint}</p> : null}
            </div>
          ) : null}

          {/*
            次级入口：不承担任何主任务，因此只是两行小字，
            且**放大到 12px** —— 旧版 10px 在手机上无法点击（实测两个链接
            只有 46×15 与 23×15，远低于 44px 可点标准）。
          */}
          <footer className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="sil-label">60 条真实来源 · 引用逐字可回溯 · 未知永不上锁</p>
            <nav className="flex flex-wrap items-center gap-x-5">
              {/*
                命中框必须真的够大。
                上一版写 `py-2` 就以为够了，实测仍只有 34px 高、24px 宽 ——
                `py-2` 的 8px 上下内边距加起来还是不到 44。
                现在 `min-h-11`（44px）钉高度、`min-w-11`（44px）钉宽度：
                两字链接（「关于」）的字身本身只有 26px，必须靠内边距撑到 44。
                这是**实测驱动**的修正，不是审美偏好。
              */}
              <Link
                href="/journal"
                className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
              >
                我的经历
              </Link>
              <Link
                href="/about"
                className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
              >
                关于
              </Link>
              {/*
                观测者徽标：已登记显示知乎头像 + 昵称；访客显示一个「登记」入口。
                放这里而不是页头，是因为首页页头被标题与观象仪占满，
                而这个身份标识不该和主叙事抢位置。
              */}
              <ObserverChip />
            </nav>
          </footer>
        </div>
      </div>

      {/* 穿越平行宇宙：观测台上的一次空间转场 */}
      <UniverseJump active={launching} question={goal.trim()} />
    </main>
  );
}
