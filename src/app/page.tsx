'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * 首页（产品减法重构方案 §5）。
 *
 * ## 首页只做一个任务
 *
 * > 让用户说出一个真实困惑。
 *
 * 所以这里不再展示：黄金 Case 卡片、出身（Origin）选择、宇宙种子、领域选择、
 * 引擎状态灯、「REALITY CHECK」入口、模式选择、以及多个同级 CTA。
 * 它们都曾是「证明这个项目做了多少功能」的东西 —— 而首页不需要证明什么。
 *
 * 留下的只有四样：
 *
 * ```text
 * 一句话说明这是什么
 * 一个输入框
 * 一个 CTA
 * 一句「我们不会替你决定」
 * ```
 *
 * ## 旧的入口去哪了
 *
 * 旧剧本入口（`/play?goal=` 与黄金 Case）仍然存在，但**不再从首页进入**
 * —— 它们降级成开发调试与降级路径（方案 §38：旧系统全部旁路，不删代码）。
 * 首页唯一的主链是：输入困惑 → 决策会话 → 译成世界 → 进入推演。
 */

export default function HomePage() {
  const router = useRouter();
  const [goal, setGoal] = React.useState('');
  const [launching, setLaunching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const disabled = launching || goal.trim().length === 0;

  /**
   * 唯一的主链入口：把这句话变成一局属于他的世界。
   *
   * 失败时**如实报错**，不再静默回落到旧剧本 —— 用户以为自己在走新主链、
   * 实际进了旧路径，是最坏的一种「看起来能用」。
   */
  const onSubmit = React.useCallback(async () => {
    const trimmed = goal.trim();
    if (trimmed.length === 0 || launching) {
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: { id?: string };
        error?: { message?: string };
      };
      if (payload.ok && payload.data?.id) {
        router.push(`/session/${payload.data.id}`);
        return;
      }
      setError(payload.error?.message ?? '没能建立这一局，请稍后再试。');
    } catch {
      setError('网络似乎不通，请检查连接后重试。');
    } finally {
      setLaunching(false);
    }
  }, [goal, launching, router]);

  return (
    <main
      id="main-content"
      className="relative mx-auto flex min-h-[100dvh] w-full max-w-[720px] flex-col justify-center px-5 py-10"
    >
      <header>
        <p className="font-mono text-[11px] tracking-[0.3em] text-slate-500">ZHIHU MULTIVERSE</p>
        <h1 className="mt-2 text-2xl font-black leading-tight text-white sm:text-3xl">
          知乎平行宇宙
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-300">
          别人已经替你活过很多种人生。进去看看。
        </p>
      </header>

      <section className="mt-8">
        <label htmlFor="goal" className="text-[13px] font-semibold text-slate-200">
          你最近真正纠结什么？
        </label>

        <textarea
          id="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            // Enter 提交，Shift+Enter 换行 —— 长句子也能写得下
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSubmit();
            }
          }}
          rows={3}
          maxLength={200}
          placeholder="例如：大三法学，想转计算机，但怕脱产找不到工作"
          className="mt-2.5 w-full resize-none rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-3 text-[14px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-zhihu-500/70 focus:outline-none focus:shadow-glow"
        />

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={disabled}
          className="door-btn mt-3"
        >
          {launching ? '正在为你找路…' : '进入我的平行宇宙'}
        </button>

        {error ? (
          <p role="alert" className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/[0.08] px-3 py-2 text-[12px] text-rose-200">
            {error}
          </p>
        ) : null}

        <p className="mt-4 text-[12px] leading-relaxed text-slate-500">
          我们不会替你决定，而会寻找知乎上真正走过类似道路的人。
        </p>
      </section>

      {/*
        极轻量的应用导航：日志（我的经验）与设置。
        它们不承担任何主任务，因此刻意做成一行小字，不与上面的 CTA 争视觉。
      */}
      <footer className="mt-10 flex items-center gap-4 font-mono text-[10px] text-slate-600">
        <Link href="/journal" className="transition-colors duration-150 hover:text-slate-300">
          我的日志
        </Link>
        <Link href="/settings" className="transition-colors duration-150 hover:text-slate-300">
          设置
        </Link>
      </footer>
    </main>
  );
}
