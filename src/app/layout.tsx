import type { Metadata, Viewport } from 'next';

import AppearanceBootstrap from '@/components/AppearanceBootstrap';
import ObserverGate from '@/components/session/ObserverGate';
import WechatHint from '@/components/WechatHint';

import './globals.css';
import './silver.css';

/**
 * 站点根地址：只为生成分享卡（`opengraph-image.png`）的**绝对 URL** 用。
 *
 * 不能省。没有 `metadataBase` 时 Next 会把 OG 图输出成相对路径，
 * 微信 / 飞书 / 项目广场抓取时拿不到封面，分享出去就是一条纯文字链接。
 *
 * ## 为什么默认值从 `:8443` 改成标准 443
 *
 * 线上长期用 `https://<host>:8443`。**非标准端口在微信内置浏览器、
 * 企业网与校园网里经常直接打不开** —— 而这条链接是要发到微信群、项目页、
 * 答辩 PPT 里的。443 上同一个应用与同一张有效证书早已就绪，换掉端口没有任何代价。
 * 部署换域名时改 `NEXT_PUBLIC_SITE_URL`，不必动代码。
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://zhihu.xuanyi888.cloud';

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
  themeColor: '#06070b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  /*
    移动端安全区：iPhone 的 Home Indicator 会盖住底部操作条，
    这里让页面自己声明支持，具体留白由各组件的 env(safe-area-inset-*) 负责。
  */
  viewportFit: 'cover',
};

/**
 * 根布局。
 *
 * ## 背景为什么改了
 *
 * 旧版用四层固定装饰叠加：底色 / 顶部光晕（animate-halo-pulse）/ 网格
 * / 扫描线。其中「霓虹光晕 + 网格 + 扫描线动画」是 AI 生成页面最强的三个
 * 视觉指纹；而且 `animate-halo-pulse` 是一个永久运行的动画 ——
 * 它让整页永远在动，恰恰是「看起来廉价」的来源。
 *
 * 现在由 `.sil-darkroom` 一个类承担全部材质：底色渐变 + 相纸颗粒 +
 * 镜头晕影，**全部静态**。页面因此安静下来，内容成为唯一会动的东西。
 *
 * ## 字体为什么改了
 *
 * 旧版从 `fonts.googleapis.com` 外链三套字体（含两套 CJK 全量）。
 * 国内移动网络访问 Google 会超时，首屏被阻塞数秒，且失败时字体回落到
 * 默认宋体，观感崩坏。现在：
 *
 * - 拉丁等宽 **自托管**（`/fonts/`，约 65KB）；
 * - 中文交给系统字体栈（iOS 苹方 / Android Noto CJK / Windows 雅黑）——
 *   它们质量极高且零请求。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <head>
        {/* 自托管等宽字体：preload 让它在首屏就位，且不阻塞渲染 */}
        <link rel="preload" href="/fonts/jetbrains-mono.css" as="style" />
        <link rel="stylesheet" href="/fonts/jetbrains-mono.css" />
      </head>
      <body className="sil-darkroom sil-viewport min-h-full">
        {/* 设置页的「减少动画」：把用户偏好落到 <html data-reduce-motion>，全站生效 */}
        <AppearanceBootstrap />
        {/*
          微信内置浏览器兜底：非标准端口常被拦，明确告诉用户改用系统浏览器。
          只在微信 UA 下出现（普通浏览器零打扰）。
        */}
        <WechatHint />
        {/*
          观测者登录引导。
          挂在根布局而不是首页，因为「一进站就该看到」—— 用户可能直接落在
          /play 或 /session 的分享链接上，只在首页问等于漏掉这些人。
          它自己会判断该不该出现（已登录 / 已选随便逛逛 / OAuth 未配齐都不弹）。
        */}
        <ObserverGate />
        {children}
      </body>
    </html>
  );
}
