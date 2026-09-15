/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data: https://*.zhimg.com https://*.zhihu.com; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },

  /**
   * 生产部署用 standalone 产物。
   *
   * 它会产出 `.next/standalone/server.js`（自带被裁剪过的 node_modules），
   * 镜像里不需要再装一遍依赖，体积从 ~500MB 降到 ~150MB。
   *
   * 注意：standalone **不会**自动带上 `public/` 与 `.next/static`，
   * 必须由 Dockerfile 显式拷贝，否则页面能开但立绘 GIF 与 CSS 全 404。
   * 这一点在 Dockerfile 里有对应步骤，改动时勿删。
   */
  output: 'standalone',

  /**
   * 关闭构建期的 ESLint 阻断。
   *
   * 代码质量由 `npm run typecheck` + `npm test` 保证（CI/本地都跑），
   * 不让 lint 风格问题阻断一次紧急的线上部署。
   */
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
