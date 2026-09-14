import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * 「关于」页（05_AGENT §3 / §8 / §19）。
 *
 * ## 它为什么存在
 *
 * 首页的次级入口只保留两项：**我的经历** 与 **关于**（§8）。
 * 把「这是什么、为什么必须是知乎、我们不做什么」集中放在这里，
 * 首页就不必承担说明书的责任 —— 也不必在导航里摆一个「设置」。
 *
 * 设置页从本页进入：普通用户先读到「不需要配置任何 Key」，
 * 而不是先看到一个密钥表单（§5 / §6）。
 *
 * ## 文案纪律（§19）
 *
 * 只允许说：真实来源、真实经历、可追溯、不替你判断。
 * 禁止：百万数据、100% 准确、预测未来 —— 没有依据的话一句都不写。
 */

export const metadata: Metadata = {
  title: '关于 · 知乎平行宇宙',
  description: '把别人真实走过的人生，变成你原本没看见的行动。',
};

const CORE_LOOP: readonly string[] = [
  '经验就是关卡',
  '差异就是冲突',
  '行动解锁就是成长',
  '把问题问清楚就是通关',
];

const HONESTY: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: '只引用原文逐字片段',
    body: '每条经历都带着 exactQuote、来源与原文链接；模型只有挑选权，没有改写权。改一个字，那条就不进世界。',
  },
  {
    title: '找不到反例就诚实为空',
    body: '检索计划强制包含「另一种走法」与「反例」；真的找不到时，世界会空着那一块，而不是拿支持性内容硬凑。',
  },
  {
    title: '不替你决定',
    body: '没有成功率、没有匹配度、没有分数。终局还给你的是一条带成功信号与停止信号的现实支线 —— 要验证什么，由你自己定。',
  },
];

export default function AboutPage() {
  return (
    <main
      id="main-content"
      className="obs-shell mx-auto flex min-h-[100dvh] w-full max-w-[720px] flex-col justify-center px-5 py-16 sm:py-20"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="obs-kicker">The Observatory of Borrowed Lives</p>
        <Link
          href="/"
          className="text-[11px] text-[color:var(--obs-text-2)] transition-opacity duration-200 hover:opacity-80"
        >
          回到首页
        </Link>
      </header>

      <section className="mt-6">
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-[color:var(--obs-text-0)] sm:text-[30px]">
          知乎平行宇宙
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--obs-text-1)]">
          把别人真实走过的人生，变成你原本没看见的行动。
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--obs-text-2)]">
          从知乎找到真正走过相似、不同、甚至相反道路的人，把他们真实做过的事编译成一局属于你的互动人生实验。
        </p>
      </section>

      <section className="obs-glass mt-8 px-5 py-5">
        <h2 className="text-[12px] font-semibold tracking-[0.14em] text-[color:var(--obs-text-2)]">这一局的四条规则</h2>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CORE_LOOP.map((line) => (
            <li key={line} className="text-[13px] leading-relaxed text-[color:var(--obs-text-1)]">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-[12px] font-semibold tracking-[0.14em] text-[color:var(--obs-text-2)]">为什么必须是知乎</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--obs-text-1)]">
          知乎内容在这里不是旁边的参考资料，而是世界的规则：
          <strong className="text-[color:var(--obs-text-0)]">一段真实经历，会直接解锁你原本没有想到的行动</strong>。
          别人真实做过的事、付出的代价、走到的结果，决定了这一局里你能看见哪些选择。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[12px] font-semibold tracking-[0.14em] text-[color:var(--obs-text-2)]">我们刻意不做什么</h2>
        <ul className="mt-3 space-y-3">
          {HONESTY.map((item) => (
            <li key={item.title}>
              <p className="text-[13px] font-semibold text-[color:var(--obs-text-1)]">{item.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--obs-text-2)]">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/" className="session-choice session-choice--unlocked justify-center sm:max-w-[220px]">
          <span className="session-choice__title">开始一局</span>
        </Link>
        <Link href="/journal" className="session-choice justify-center sm:max-w-[200px]">
          <span className="session-choice__title">我的经历</span>
        </Link>
        <Link href="/settings" className="session-choice justify-center sm:max-w-[200px]">
          <span className="session-choice__title">设置</span>
          <span className="session-choice__hint">用自己的模型（可选）</span>
        </Link>
      </section>

      <footer className="mt-10 border-t border-white/8 pt-5 text-[11px] leading-relaxed text-[color:var(--obs-text-2)]">
        <p>知乎黑客松 2026 · 校园新锐季 ｜ 主赛道：跨次元游乐场 ｜ 关联方向：知识炼金场</p>
        <p className="mt-1.5">
          在线体验：
          <a
            href="https://zhihu.xuanyi888.cloud:8443"
            target="_blank"
            rel="noreferrer noopener"
            className="text-zhihu-300 underline decoration-dotted"
          >
            zhihu.xuanyi888.cloud:8443 ↗
          </a>
          ｜ 仓库：
          <a
            href="https://github.com/xuanyi-niubi/zhihu-multiverse"
            target="_blank"
            rel="noreferrer noopener"
            className="text-zhihu-300 underline decoration-dotted"
          >
            xuanyi-niubi/zhihu-multiverse ↗
          </a>
        </p>
        <p className="mt-1.5">
          真实来源 · 真实经历 · 可追溯 · 不替你判断。
        </p>
      </footer>
    </main>
  );
}
