import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '知乎平行宇宙 · 由真实人生经验驱动的互动人生实验',
  description:
    '把知乎 15 年的真实问答转化为带数值博弈、属性检定与卡牌遗物的文字 Roguelike。用 3 分钟的平行推演，跨越现实中 3 年的人生迷茫。',
  keywords: ['知乎', 'Roguelike', 'D20', '人生推演', '平行宇宙', '校园'],
  authors: [{ name: 'Zhihu Multiverse Team' }],
  openGraph: {
    title: '知乎平行宇宙 · 由真实人生经验驱动的互动人生实验',
    description: '说出一个真实困惑，系统去寻找真正走过不同道路的人，把他们的经历编译成一局属于你的互动故事。',
    type: 'website',
    locale: 'zh_CN',
  },
};

export const viewport: Viewport = {
  themeColor: '#05070D',
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

          {children}
        </div>
      </body>
    </html>
  );
}
