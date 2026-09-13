'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { KanshanSprite } from '@/components/characters/KanshanSprite';
import { useTypewriter } from '@/components/Terminal';
import { fetchMemory } from '@/core/memoryClient';
import {
  DEFAULT_ORIGIN_ID,
  ORIGIN_ACCENT,
  ORIGINS,
  type OriginId,
} from '@/data/origins';
import { AI_DM_SCENARIO_ID, DEFAULT_SCENARIO_ID, PREBUILT_SCENARIOS } from '@/data/prebuiltScenarios';
import { fetchCommitments, fetchHealth, type HealthView } from '@/core/evidence/meshClient';
import { EngineStatusBar } from '@/components/EngineStatusBar';
import { DemoCaseCards, type DemoCaseMeta } from '@/components/DemoCaseCards';
import { WorldlineBranch } from '@/components/worldline/Worldline';
import { DOMAIN_OPTIONS, domainConfidenceOf, isConfidentEnough } from '@/core/evidence/plan';

/**
 * 命运发令台（首页）。
 *
 * 刻意不做营销落地页：这是一个街机控制台。
 * 玩家面对的是 CRT 启动自检日志、终端式目标输入、卡带式剧本槽，
 * 以及一枚需要「投币」的启动按钮——按下去会走故障艺术转场进入推演舱。
 */

/**
 * CRT 自检日志：**固定一行**。
 *
 * 原本是 5 行（每行一条 OK），实测占掉约 300px，是首屏滚动的最大单项。
 * 压成一行后打字机演出仍在（逐字打），只是不再撑高；
 * 「就绪」提示在打完后由组件补上，因此信息没有丢。
 */
const BOOT_LOG = [
  '> ZHIHU MULTIVERSE OS v2.0',
  '载入知乎真实语料索引 OK',
  '挂载确定性裁决引擎 OK',
  '校准刘看山情绪传感器 OK',
].join(' · ');

const QUICK_GOALS_REMOVED =
  '快捷目标 chip 已移除（2026-09-12）：三个黄金 Case 成为主入口后，' +
  '它们与裂缝卡承担同一职责，留着只是重复劳动且拉长首屏。';

function createSeed(): string {
  return `SEED-2026-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * 根据输入的目标决定走哪个剧本：
 * - 命中精调剧本的关键词 → 走离线剧本（零延迟，演示稳）
 * - 输入了自定义目标但不命中 → 走 AI 自由推演（真实动态生成）
 * - 空输入 → 默认剧本
 *
 * 这条规则解决「不管输入什么都播同一个固定剧本」的问题。
 */
function pickScenarioId(goal: string): string {
  const trimmed = goal.trim();

  if (trimmed.length === 0) {
    return DEFAULT_SCENARIO_ID;
  }

  const matched = PREBUILT_SCENARIOS.find((scenario) =>
    scenario.goalKeywords.some((keyword) => trimmed.includes(keyword)),
  );

  return matched ? matched.id : AI_DM_SCENARIO_ID;
}

export default function FateConsolePage() {
  const router = useRouter();
  const [goal, setGoal] = React.useState('');
  const [originId, setOriginId] = React.useState<OriginId>(DEFAULT_ORIGIN_ID);
  const [seed] = React.useState(() => createSeed());
  const [launching, setLaunching] = React.useState(false);
  /**
   * 登录与记忆状态。
   * 用来在开局前就如实告诉玩家「这一局会不会被记住」——
   * 把代价放在决策点之前，而不是等结算完才让他发现白玩了。
   */
  const [memoryStatus, setMemoryStatus] = React.useState<'guest' | 'signed-in' | 'unknown'>(
    'unknown',
  );
  const [memoryTotalRuns, setMemoryTotalRuns] = React.useState(0);

  /**
   * 黄金 Casey（v2 §5.1「人生裂缝大厅」）。
   *
   * 从 `/api/mesh` 的 GET 拿，而不是 import `demoCases.ts` ——
   * 后者会为了读快照而 import 59KB 的 generated JSON，
   * 一旦被客户端组件引用就会整份打进浏览器产物。
   */
  const [cases, setCases] = React.useState<readonly DemoCaseMeta[]>([]);
  const [casesLoading, setCasesLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch('/api/mesh', { signal: controller.signal });
        if (!response.ok) {
          return;
        }
        const payload: unknown = await response.json();
        const list = (payload as { cases?: unknown }).cases;
        if (controller.signal.aborted || !Array.isArray(list)) {
          return;
        }
        setCases(
          list
            .filter((item): item is DemoCaseMeta =>
              typeof item === 'object' &&
              item !== null &&
              typeof (item as DemoCaseMeta).caseId === 'string' &&
              typeof (item as DemoCaseMeta).title === 'string' &&
              typeof (item as DemoCaseMeta).fork === 'string' &&
              typeof (item as DemoCaseMeta).sources === 'number',
            )
            .map((item) => ({ ...item, goal: item.goal ?? '', anchors: item.anchors ?? 0 })),
        );
      } catch {
        // 静默：没有裂缝卡时首页仍有自定义输入可用
      } finally {
        if (!controller.signal.aborted) {
          setCasesLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    void fetchMemory({ signal: controller.signal }).then((state) => {
      if (controller.signal.aborted) {
        return;
      }
      setMemoryStatus(state.authenticated ? 'signed-in' : 'guest');
      setMemoryTotalRuns(state.totalRuns);
    });

    return () => controller.abort();
  }, []);

  /**
   * 到期的承诺回执（方案 §7.2）。
   *
   * 这是闭环在首页的落点：**七天后它会回来问你**。
   * 拉取失败只是「不显示这个模块」，绝不打扰主流程。
   */
  const [dueCommitment, setDueCommitment] = React.useState<{
    readonly action: string;
    readonly overdueDays: number;
  } | null>(null);

  /** 运行模式（v2 §11 / §20.1）：路演时只用这三个灯证明「不是现场粘 Key」。 */
  const [health, setHealth] = React.useState<HealthView | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchHealth({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setHealth(result);
      }
    });
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    void fetchCommitments({ signal: controller.signal }).then((view) => {
      if (controller.signal.aborted) {
        return;
      }
      const first = view.due[0];
      if (first) {
        setDueCommitment({ action: first.action, overdueDays: view.overdueDays });
      }
    });

    return () => controller.abort();
  }, []);

  const { visible: bootText, done: bootDone } = useTypewriter(BOOT_LOG, {
    speed: 16,
    startDelay: 260,
  });

  const launch = React.useCallback(
    (scenarioId: string, goalText: string, caseId?: string) => {
      if (launching) {
        return;
      }

      setLaunching(true);

      const params = new URLSearchParams({ scenario: scenarioId, seed, origin: originId });
      const trimmed = goalText.trim();
      if (trimmed.length > 0) {
        params.set('goal', trimmed);
      }
      /**
       * 黄金 Case 走**离线档案**（v2 §15.1 的 DEMO 路径）：
       * 带上 caseId 后 `/api/mesh` 直接返回已人工核验的真实快照网格 ——
       * 零延迟、零配额、内容不随一次搜索抖动而变。
       */
      if (caseId) {
        params.set('case', caseId);
      }

      // 故障艺术转场：给玩家一个「穿越」的视觉停顿，再跳转。
      window.setTimeout(() => {
        router.push(`/play?${params.toString()}`);
      }, 1150);
    },
    [launching, originId, router, seed],
  );

  /**
   * 个性化主链：把当前输入交给决策会话，先澄清条件，再生成世界。
   *
   * 与 `launch` 刻意分开：`launch` 是跳过澄清的旧入口；这条路径会让
   * 真实经历参与世界蓝图和经验解锁，因此是自定义问题的默认入口。
   */
  const openPersonalizedRun = React.useCallback(
    async (goalText: string) => {
      const trimmed = goalText.trim();
      if (trimmed.length === 0 || launching) {
        return;
      }
      setLaunching(true);
      try {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        });
        const payload = (await response.json()) as { ok?: boolean; data?: { id?: string } };
        if (payload.ok && payload.data?.id) {
          router.push(`/session/${payload.data.id}`);
          return;
        }
      } catch {
        // 静默失败：用户仍可用下方旧入口直接推演，不阻断页面
      } finally {
        setLaunching(false);
      }
    },
    [launching, router],
  );

  /** 进入一个黄金裂缝：用 Case 自己的目标当 goal，因此不需要玩家输入。 */
  const launchCase = React.useCallback(
    (meta: DemoCaseMeta) => {
      launch(AI_DM_SCENARIO_ID, meta.goal, meta.caseId);
    },
    [launch],
  );

  /**
   * 自定义输入的安全兜底（v3 §20 / §23 P2-7）。
   *
   * 「自定义输入是现场最容易出事故的地方」：一句与职业决策无关的话
   * 照样能进游戏，然后检索出一张空网格 —— 玩家白玩一局。
   *
   * 这里在**开局之前**判一次领域置信度（与检索共用同一份词表与判定）：
   * - 置信度足够 → 正常开局；
   * - 置信度不足 → 先摆出几个宽领域，用它的检索词二次检索再开局。
   *
   * **刻意不做成硬墙**：玩家可能就是想问一件很具体的事，
   * 我们不该替他判断「你有没有方向」。因此只把选择摆出来，
   * 并明说「也可以按你写的直接走」。
   */
  const [domainPicker, setDomainPicker] = React.useState<{
    readonly goal: string;
    readonly options: readonly { readonly id: string; readonly label: string; readonly querySeed: string }[];
  } | null>(null);

  const startCustomRun = React.useCallback(
    (goalText: string) => {
      const trimmed = goalText.trim();
      const confidence = domainConfidenceOf({ goal: trimmed });

      // 空输入保持原行为（走默认剧本），不弹选择器
      if (trimmed.length === 0 || isConfidentEnough(confidence)) {
        setDomainPicker(null);
        launch(pickScenarioId(trimmed), trimmed);
        return;
      }

      setDomainPicker({
        goal: trimmed,
        options: DOMAIN_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
          querySeed: option.querySeed,
        })),
      });
    },
    [launch],
  );

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col justify-center px-4 py-10 lg:px-8">
      {/* 机台顶部铭牌 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.4em] text-zhihu-400">
            ZHIHU MULTIVERSE / ARCADE
          </p>
          <h1 className="mt-2 animate-mask-reveal text-3xl font-black leading-tight text-white sm:text-4xl">
            知乎平行宇宙
            <span className="ml-3 align-middle font-mono text-sm font-normal text-slate-500">
              推演机 v2.0
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="chip font-mono">{seed}</span>
          <span className="chip-zhihu">跨次元游乐场</span>
        </div>
      </div>

      {/* 机台本体 */}
      <div className="console mt-4 p-4 sm:p-5">
        {/*
          CRT 自检：**固定一行**，不再随日志行数撑高。

          实测它原本占掉约 300px（5 行等宽文本 + py-4 内边距），
          是首屏滚动的最大单项。打字机演出与扫描线都保留 ——
          压掉的只是它占的高度，不是它的质感。
        */}
        <div className="console-screen px-3 py-2">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-scanline opacity-[0.18]"
          />
          <p className="relative truncate font-mono text-[11px] leading-relaxed text-emerald-300/90">
            {bootText}
            {!bootDone ? (
              <span className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-caret-blink bg-emerald-300 align-middle" />
            ) : (
              <span className="ml-2 text-slate-500">
                · 就绪，等待你的裂缝
              </span>
            )}
          </p>
        </div>

        {/* 主交互区 */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_264px]">
          <div className="flex flex-col gap-4">
            {/*
              人生裂缝（v2 §5.1）：三个黄金 Case 是**主入口**。
              它们各自绑定一份已人工核验的真实知乎快照，
              所以点进去立刻有东西玩，不需要玩家先想出一句话。
            */}
            <div>
              <p className="font-mono text-[11px] tracking-widest text-slate-500">
                &gt; 选择一个你想进入的未来
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                每条世界线，都由真实的人生经验构成。
              </p>

              {/*
                v3 §9.1：首页的世界线母题 ——
                三条已稳定的世界线从「当前现实」这一个原点分叉出来。
                它不是装饰：分叉本身就是这个作品的主张
                （同一个你，在不同条件下会走向不同的路）。
              */}
              <WorldlineBranch
                leftState="stable"
                rightState="unstable"
                leftLabel="条件宽裕时"
                rightLabel="条件紧张时"
                className="mt-2 px-1"
              />

              <DemoCaseCards
                cases={cases}
                onPick={launchCase}
                loading={casesLoading}
                className="mt-2.5"
              />

              {!casesLoading && cases.filter((item) => item.sources > 0).length === 0 ? (
                <p className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  当前没有可用的真实样本（未跑过 <code className="font-mono">npm run sync:zhihu</code>），
                  因此不提供裂缝入口 —— 宁可不给，也不做一个点进去空转的入口。
                </p>
              ) : null}
            </div>

            {/*
              自定义裂缝：不与上面的案例争主视觉，因此视觉权重刻意低一档。

              **但移动端它必须排在最前**（`order-first`，桌面端 `lg:order-none` 还原）。
              实测依据：375×751 视口下三张案例卡竖向堆叠（各 309px），
              把「投币开始推演」推到了顶部 1044px —— 首屏完全看不到主操作，
              玩家会以为这个页面只能点三张卡。
              主操作优先于入口列表，是移动端唯一正确的顺序。
            */}
            <div className="order-first lg:order-none">
              <label
                htmlFor="goal"
                className="font-mono text-[11px] tracking-widest text-slate-500"
              >
                &gt; 或者，输入你此刻最纠结的那件事
              </label>

              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/12 bg-ink-900/70 px-3 py-2 focus-within:border-zhihu-500/70 focus-within:shadow-glow">
                <span aria-hidden="true" className="font-mono text-sm text-slate-500">
                  ▮
                </span>
                <input
                  id="goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void openPersonalizedRun(goal);
                    }
                  }}
                  placeholder="例如：大三法学，想转计算机，但怕脱产找不到工作"
                  className="w-full bg-transparent font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              {/*
                v3 §20 的二次选择：置信度不足时才出现。
                它不是错误提示，而是一次「你更接近哪一类」的追问 ——
                点一个就用它的检索词重新检索，避免把玩家放进空网格。
              */}
              {domainPicker ? (
                <div className="mt-2.5 rounded-2xl border border-amber-400/35 bg-amber-400/[0.06] p-3">
                  <p className="text-[11px] leading-relaxed text-amber-100">
                    我没找到足够稳定的现实路径。你更接近哪一类？
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {domainPicker.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setDomainPicker(null);
                          setGoal(option.querySeed);
                          launch(AI_DM_SCENARIO_ID, option.querySeed);
                        }}
                        className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-100 transition-colors duration-150 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                      >
                        {option.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const raw = domainPicker.goal;
                        setDomainPicker(null);
                        launch(AI_DM_SCENARIO_ID, raw);
                      }}
                      className="rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400 transition-colors duration-150 hover:border-white/25 hover:text-slate-200"
                    >
                      仍然按我写的走
                    </button>
                  </div>
                </div>
              ) : null}

              {/*
                到期的承诺回执（方案 §7.2）：七天后它回来问你。
                这是「建议 → 数据」闭环在首页的入口，也是产品能自证有用的地方。
              */}
              {dueCommitment ? (
                <div className="mt-3 rounded-2xl border border-relic-gold/35 bg-relic-gold/[0.07] p-3">
                  <p className="font-mono text-[10px] tracking-[0.25em] text-amber-300">
                    上次认下的事
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                    {dueCommitment.action}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {dueCommitment.overdueDays > 0
                      ? `已经过了 ${dueCommitment.overdueDays} 天，怎么样了？`
                      : '到期了，怎么样了？'}
                  </p>
                  <Link
                    href="/commitment"
                    className="mt-2.5 inline-flex rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition-colors duration-150 hover:bg-amber-400/20"
                  >
                    去回执
                  </Link>
                </div>
              ) : null}

              {/*
                知乎热榜模块已移除（2026-09-12）。

                原因不是「不好看」，而是它三个条件全不满足：
                1. **没进游戏机制** —— 热榜数据唯一去处是 `setGoal(标题)`，
                   既不参与证据网格，也不参与叙事生成；
                2. **语义错配** —— 热榜里有娱乐/时事话题，点它们会走
                   `pickScenarioId` 的 AI 分支：Query Planner 拆不出真实路径样本
                   （网格空转显示「证据不足」），却仍然花掉一次 DeepSeek 生成，
                   最后给玩家一段与他的迷茫无关的叙事；
                3. **占用最稀缺的配额** —— 热榜 100 次/天，搜索 1000 次/天，
                   而它只换来「省你打几个字」。

                保留 `/api/zhihu/hot` 路由未动：它天然适合做「今日共同世界线」
                （当日热榜话题作为全局共享 goal + 按日期派生 seed，所有人玩同一局、
                成绩可比）。那才是热榜唯一非它不可的位置，届时直接接上即可。
              */}
            </div>

            {/*
              投币启动。

              `order-first lg:order-none` 与上面的输入框**必须同时提升** ——
              我第一版只提升了输入框，于是移动端出现了
              「输入框在 227px、按钮还在 1044px」的割裂状态：
              玩家看到一个输入框，却找不到提交它的按钮。
              （实测抓到：launchInOrderFirstBlock === false）

              两者是一件事（输入 → 提交），必须作为一个整体参与排序。
            */}
            <div className="order-first flex flex-wrap items-center gap-4 lg:order-none">
              <button
                type="button"
                onClick={() => void openPersonalizedRun(goal)}
                disabled={launching || goal.trim().length === 0}
                className="arcade-btn bg-zhihu-500 text-white disabled:opacity-70"
              >
                <span aria-hidden="true" className="text-lg">
                  ◉
                </span>
                生成我的平行宇宙
              </button>

              {/*
                旧的直达路径保留为明确的降级入口：它不做条件澄清，也不会先把
                真实经历编译进世界蓝图。评委与新用户默认走上面的个性化主链。
              */}
              <button
                type="button"
                onClick={() => startCustomRun(goal)}
                disabled={launching}
                className="btn-ghost text-xs disabled:opacity-50"
              >
                跳过澄清，直接推演
              </button>

              {/*
                双牌对比直达：不推演、只算账。
                这是「决策引擎」与「游戏」分家的入口 —— 想直接看结论的人走这里。
              */}
              {goal.trim().length > 0 ? (
                <Link
                  href={`/compare?goal=${encodeURIComponent(goal.trim())}`}
                  className="btn-ghost text-xs"
                >
                  只算账，不推演
                </Link>
              ) : null}

              <p className="max-w-[260px] text-[11px] leading-relaxed text-slate-500">
                {/*
                  主 CTA 的一句话解释（收口方案 §5）：新用户与评委第一眼看懂
                  「这些经验是从哪来的」，比先讲幕数更有价值。
                */}
                我们会从知乎寻找真正走过类似道路的人，再把这些经历编译成一局属于你的游戏。
                <br />
                {/* 幕数是动态的：AI 路径实测 7–8 幕，预置剧本 4 幕。写死数字会直接损伤信任。 */}
                一次推演 4–8 幕、约 3 分钟；结果由种子锁定，可复盘、可发起挑战。
              </p>
            </div>

            {/*
              引擎状态（三个指示灯）+「还没配 key」提示。

              **刻意排在投币按钮之后**：它们是诊断与配置信息，不是主操作。
              实测（1280×720，视口高 659px）引擎状态条高 138px，
              夹在输入框与按钮之间时会把「投币开始推演」压到 743px —— 首屏看不见。
              顺序换过之后按钮回到首屏内，而这两块信息仍然在首屏下方一屏可达。
            */}
            <div className="order-last lg:order-none">
              <EngineStatusBar health={health} />

              {health?.needsOwnKey ? (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  当前是<b className="font-semibold text-slate-300">离线演示模式</b>
                  （预置剧本 + 已落盘的真实知乎快照，完整可玩）。
                  <Link
                    href="/settings"
                    className="ml-1 font-semibold text-zhihu-300 underline decoration-zhihu-500/40 transition-colors duration-150 hover:text-zhihu-100"
                  >
                    填入自己的 key
                  </Link>
                  即可解锁 AI 动态关卡与实时检索。
                </p>
              ) : null}
            </div>

            {/*
              登录态提示。
              产品设计：游客可以随便逛逛，但宇宙不会记住他。
              这里如实说明代价，而不是拦住他去路 —— 用损失感驱动登录，
              比强制弹窗的转化更真实，也符合「记忆绑定身份」的设计逻辑。
            */}
            {memoryStatus === 'guest' ? (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <span className="text-[11px] leading-relaxed text-slate-400">
                  当前是<b className="font-semibold text-slate-300">游客身份</b>
                  ：能玩，但这一局不会被记住，也不会有跨局的前世遗念。
                </span>
                <a
                  href="/oauth"
                  className="shrink-0 rounded-lg border border-zhihu-500/50 bg-zhihu-500/10 px-2.5 py-1 text-[11px] font-semibold text-zhihu-300 transition-colors duration-150 hover:bg-zhihu-500/20"
                >
                  连接知乎账号
                </a>
              </div>
            ) : memoryStatus === 'signed-in' ? (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-relic-jade/30 bg-relic-jade/[0.06] px-3 py-2.5">
                <span className="text-[11px] leading-relaxed text-slate-300">
                  已连接知乎账号
                  {memoryTotalRuns > 0 ? (
                    <>
                      ，宇宙记得你走过的{' '}
                      <b className="font-semibold text-relic-jade">{memoryTotalRuns}</b> 局
                    </>
                  ) : (
                    '，这一局将是你的第一次推演'
                  )}
                  。
                </span>
                {/*
                  命运档案馆入口（v3 §15）。
                  只在有东西可看时出现 —— 一个空的档案馆不值得占首屏位置。
                */}
                {memoryTotalRuns > 0 ? (
                  <Link
                    href="/archive"
                    className="shrink-0 rounded-lg border border-relic-jade/40 bg-relic-jade/10 px-2.5 py-1 text-[11px] font-semibold text-relic-jade transition-colors duration-150 hover:bg-relic-jade/20"
                  >
                    走进档案馆
                  </Link>
                ) : null}
                <a
                  href="/oauth"
                  className="shrink-0 rounded-lg border border-white/12 px-2.5 py-1 text-[11px] text-slate-400 transition-colors duration-150 hover:border-white/25 hover:text-white"
                >
                  查看
                </a>
              </div>
            ) : null}

            {/* 出身拨档 */}
            <div>
              <p className="font-mono text-[11px] tracking-widest text-slate-500">
                &gt; 选择出身流派
              </p>

              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ORIGINS.map((origin) => {
                  const accent = ORIGIN_ACCENT[origin.accent];
                  const active = originId === origin.id;

                  return (
                    <button
                      key={origin.id}
                      type="button"
                      onClick={() => setOriginId(origin.id)}
                      aria-pressed={active}
                      className={[
                        'rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ease-out',
                        active
                          ? `bg-white/[0.06] ${accent.ring} ${accent.glow}`
                          : 'border-white/10 bg-white/[0.02] hover:border-white/25',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'block text-xs font-bold',
                          active ? accent.text : 'text-slate-300',
                        ].join(' ')}
                      >
                        {origin.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
                        {origin.tagline}
                      </span>
                      <span className="mt-1.5 flex gap-2 font-mono text-[10px] text-slate-400">
                        <span>SAN {origin.stats.san}</span>
                        <span>SKILL {origin.stats.skill}</span>
                        <span>BOND {origin.stats.bond}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/*
              卡带槽已移除（2026-09-12）。

              它列出的 4 张卡（两个预置剧本 + AI 自由推演 + 一个空位）与上方的
              三个「人生裂缝」是同一职责 —— 实测渲染后页面高度 1273px、视口 883px，
              首屏必须滚动才能看到启动按钮，而重复的入口正是主要原因。

              现在入口收敛为两处，且语义不重叠：
              - **人生裂缝**（三个黄金 Case）：有已验证证据的那几条路；
              - **自定义裂缝**（上方输入框 + 投币）：没有现成证据时，由 AI 现场检索。
            */}
          </div>

          {/* 看山随身导师：整屏立绘，而不是角落小图标 */}
          <div className="relative flex flex-col gap-3">
            <div className="panel relative overflow-hidden p-4">
              <div className="absolute inset-0 bg-radial-halo opacity-70" aria-hidden="true" />
              <div className="relative mx-auto h-[220px] w-[220px] animate-float-tilt">
                <KanshanSprite action="wave" className="h-full w-full" />
              </div>
              <div className="relative mt-2 text-center">
                <p className="text-sm font-semibold text-white">刘看山</p>
                <p className="mt-0.5 text-[11px] text-slate-400">推演随身导师 · 会替你喊人</p>
              </div>
            </div>

            <div className="panel p-4">
              <p className="font-mono text-[10px] tracking-widest text-slate-500">HOW TO PLAY</p>
              <ul className="mt-2.5 space-y-2 text-[11px] leading-relaxed text-slate-400">
                <li className="flex gap-2">
                  <span className="text-zhihu-400">01</span>
                  稳妥选项没有门槛，收益低但稳。
                </li>
                <li className="flex gap-2">
                  <span className="text-relic-gold">02</span>
                  高危选项要过**现实裁决**：成败取决于你的条件够不够，骰子只决定遭遇。
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-400">03</span>
                  条件成立会掉落遗物，塞进底部 3 个槽位。
                </li>
                <li className="flex gap-2">
                  <span className="text-rose-400">04</span>
                  SAN 归零推演中断，可消耗 30 羁绊呼叫救场。
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-5 text-center font-mono text-[10px] text-slate-600">
        知乎黑客松 2026 · 校园新锐季 | 基于知乎真实社区语料的互动叙事原型
      </p>

      {/* 密钥配置入口：用自己的知乎 / 模型 key 跑真实语料与 AI 判卷 */}
      <p className="mt-2 text-center">
        <Link
          href="/settings"
          className="font-mono text-[10px] text-slate-500 underline decoration-dotted transition-colors duration-150 hover:text-zhihu-300"
        >
          配置我的知乎 / 模型 key ↗
        </Link>
      </p>

      {/* 故障艺术转场 */}
      {launching ? (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-ink-900">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-scanline opacity-20"
          />
          <p className="animate-glitch font-mono text-2xl font-black tracking-widest text-zhihu-400 sm:text-4xl">
            正在穿越平行宇宙
          </p>
          <p className="font-mono text-[11px] tracking-[0.3em] text-slate-500">
            SEED {seed}
          </p>
          <div className="h-1 w-56 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full origin-left animate-[scan-sweep_1.1s_ease-in-out_infinite] bg-zhihu-500" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
