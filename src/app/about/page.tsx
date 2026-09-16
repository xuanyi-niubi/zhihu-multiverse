import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * 「关于」页。
 *
 * ## 它为什么存在
 *
 * 首页的次级入口只保留两项：**我的经历** 与 **关于**。
 * 把「这是什么、为什么必须是知乎、我们不做什么」集中放在这里，
 * 首页就不必承担说明书的责任 —— 也不必在导航里摆一个「设置」。
 *
 * 设置页从本页进入：普通用户先读到「不需要配置任何 Key」，
 * 而不是先看到一个密钥表单。
 *
 * ## 文案纪律
 *
 * 只允许说：真实来源、真实经历、可追溯、不替你判断。
 * 禁止：百万数据、100% 准确、预测未来 —— 没有依据的话一句都不写。
 *
 * ## 本次的排版修正
 *
 * 「我们刻意不做什么」这三条是本页最有价值的内容（它证明产品有边界），
 * 旧版把它们排成 13px 标题 + 12px 正文的紧凑列表，在手机上挤成一团。
 * 现在改用带左引线的条目，每条 15px 正文、行高 1.85，
 * 让「不做什么」和「做什么」一样被读清楚。
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
      className="sil-viewport relative mx-auto flex w-full max-w-[720px] flex-col justify-center px-5 py-14 sm:px-8 sm:py-16"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="sil-label">The Observatory of Borrowed Lives</p>
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-meta tracking-wide text-[color:var(--sil-ink-300)] transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
        >
          回到首页
        </Link>
      </header>

      <section className="mt-8">
        <h1 className="sil-title sil-title--act">知乎平行宇宙</h1>
        <p className="sil-prose sil-prose--lead mt-4">
          把别人真实走过的人生，变成你原本没看见的行动。
        </p>
        <p className="sil-prose mt-3 text-body text-[color:var(--sil-ink-300)]">
          从知乎找到真正走过相似、不同、甚至相反道路的人，把他们真实做过的事编译成一局属于你的互动人生实验。
        </p>
      </section>

      {/* 四条规则：用「仪器铭牌」的排版，它们是这一局的规则，不是营销话术 */}
      <section className="sil-panel mt-10 px-5 py-5 sm:px-6">
        <h2 className="sil-label">这一局的四条规则</h2>
        <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {CORE_LOOP.map((line) => (
            <li
              key={line}
              className="flex items-baseline gap-2.5 text-body leading-relaxed text-[color:var(--sil-ink-200)]"
            >
              <span aria-hidden="true" className="text-[color:var(--sil-alternate)]">
                ·
              </span>
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="sil-label">为什么必须是知乎</h2>
        <p className="sil-prose mt-4">
          知乎内容在这里不是旁边的参考资料，而是世界的规则：
          <strong className="font-semibold text-[color:var(--sil-ink-100)]">
            一段真实经历，会直接解锁你原本没有想到的行动
          </strong>
          。别人真实做过的事、付出的代价、走到的结果，决定了这一局里你能看见哪些选择。
        </p>
      </section>

      {/* 产品的边界：这一节是「不做什么」，所以用相纸外的中性材质，不用强调色 */}
      <section className="mt-10">
        <h2 className="sil-label">我们刻意不做什么</h2>
        <ul className="mt-4 space-y-5">
          {HONESTY.map((item) => (
            <li
              key={item.title}
              className="border-l border-[color:var(--sil-rule-strong)] pl-4"
            >
              <p className="text-body font-semibold leading-relaxed text-[color:var(--sil-ink-100)]">
                {item.title}
              </p>
              <p className="sil-prose mt-1.5 text-body">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Link href="/" className="sil-btn sm:w-[180px]">
          开始一局
        </Link>
        <Link href="/journal" className="sil-btn sil-btn--ghost sm:w-[180px]">
          我的经历
        </Link>
        <Link href="/settings" className="sil-btn sil-btn--quiet sm:w-[200px]">
          设置 · 用自己的模型（可选）
        </Link>
      </section>

      <footer className="mt-12 border-t border-[color:var(--sil-rule-faint)] pt-6">
        <p className="sil-label">
          知乎黑客松 2026 · 校园新锐季 ｜ 主赛道：跨次元游乐场 ｜ 关联方向：知识炼金场
        </p>
        {/*
          页脚的外链原来是 12px 的行内 <a>，实测命中框只有 145×16 ——
          手指点不中，而且 12px 在手机上偏小。
          现在改成 flex 列 + 每个链接独立成行、`min-h-11`（44px）、字号 13px。
          手机端一行一个比「用竖线挤成一行」更好读，也更好点。
        */}
        <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
          <span className="text-meta text-[color:var(--sil-ink-400)]">
            在线体验
          </span>
          <a
            href="https://zhihu.xuanyi888.cloud:8443"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center text-meta text-[color:var(--sil-zhihu-soft)] underline decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
          >
            zhihu.xuanyi888.cloud:8443
          </a>
          <span className="text-meta text-[color:var(--sil-ink-400)]">仓库</span>
          <a
            href="https://github.com/xuanyi-niubi/zhihu-multiverse"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center text-meta text-[color:var(--sil-zhihu-soft)] underline decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-[color:var(--sil-ink-100)]"
          >
            xuanyi-niubi/zhihu-multiverse
          </a>
        </div>
        <p className="mt-3 text-meta leading-relaxed text-[color:var(--sil-ink-400)]">
          真实来源 · 真实经历 · 可追溯 · 不替你判断。
        </p>
      </footer>
    </main>
  );
}
