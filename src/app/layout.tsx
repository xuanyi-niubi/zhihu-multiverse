import type { Metadata, Viewport } from 'next';

import AppearanceBootstrap from '@/components/AppearanceBootstrap';

import './globals.css';

/**
 * 站点根地址：只为生成分享卡（`opengraph-image.png`）的**绝对 URL** 用。
 *
 * 不能省。没有 `metadataBase` 时 Next 会把 OG 图输出成相对路径，
 * 微信 / 飞书 / 项目广场抓取时拿不到封面，分享出去就是一条纯文字链接。
 * 部署换域名时改 `NEXT_PUBLIC_SITE_URL`，不必动代码。
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://zhihu.xuanyi888.cloud:8443';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: '知乎平行宇宙 · 别人真实走过的人生，会改变你现在能看见的选择',
  description:
    '说出一个真实困惑，我们去找真正走过这些路的人，把他们的逐字经历编译成一局属于你的平行世界。别人已经替你活过很多种人生 —— 看看他们的路，会不会让你多看见一种选择。',
  keywords: ['知乎', '平行宇宙', '真实经历', '人生经验', '互动叙事', '选择'],
  authors: [{ name: 'Zhihu Multiverse Team' }],
  openGraph: {
    title: '知乎平行宇宙 · 别人真实走过的人生，会改变你现在能看见的选择',
    description: '说出一个真实困惑，系统去寻找真正走过不同道路的人，把他们的经历编译成一局属于你的互动故事。',
    type: 'website',
    locale: 'zh_CN',
    siteName: '知乎平行宇宙',
  },
  twitter: {
    // 不依赖 Twitter，但共用一个标准：有卡就用大图卡，别退化成一行文字。
    card: 'summary_large_image',
  },
};

export const viewport: Viewport = {
  themeColor: '#04050A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

/**
 * 根布局。
 *
 * 背景由四层固定定位的装饰层叠加而成（底色 / 顶部光晕 / 网格 / 扫描线），
 * 全部 pointer-events-none 且位于 -z-10，不影响任何交互命中。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        {/* 设置页的「减少动画」：把用户偏好落到 <html data-reduce-motion>，全站生效 */}
        <AppearanceBootstrap />
        {/* DESIGN.md §3：中文衬线体承担叙事质感，加载失败时回落到系统宋体/苹方 */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Noto+Serif+SC:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
        />

        <div className="relative flex min-h-screen flex-col overflow-x-hidden">
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-ink-900" />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 animate-halo-pulse bg-radial-halo"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 bg-grid-fate opacity-[0.35]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 bg-scanline opacity-[0.12]"
          />
          {/* 平行人生档案馆：1.5%～3% 的极轻 film grain（报告 §28） */}
          <div aria-hidden="true" className="arc-grain" />

          {children}
        </div>
      </body>
    </html>
  );
}
