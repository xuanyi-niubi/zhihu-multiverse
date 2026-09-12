# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 知乎平行宇宙 · 生产镜像
#
# 两阶段构建：builder 装全量依赖并编译，runner 只带 standalone 产物。
#
# 关键约束（改这个文件前务必读）：
#
# 1. standalone 产物 **不含** `public/` 与 `.next/static`，必须手动拷贝。
#    漏掉会导致「页面能打开但立绘 GIF、CSS、JS 全 404」。
#
# 2. **必须单实例运行**。OAuth 会话存在 Node 进程内存里
#    （见 src/core/oauth/zhihu.ts 的 `sessions` Map），多副本或 PM2 cluster
#    会让授权状态在实例间丢失，表现为「授权成功后状态又变回未授权」。
#    需要横向扩展时，得先把会话换成 Redis 之类的共享存储。
# ---------------------------------------------------------------------------

# ---------- 阶段 1：构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先只拷清单文件，让依赖层可被 Docker 缓存复用
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码
COPY . .

# 构建期的环境变量占位。
# 说明：本项目所有密钥都在**服务端运行时**读取（route handler 内的
# process.env），不会被内联进客户端产物，所以这里不需要也不能传真实密钥。
# 若将来引入 NEXT_PUBLIC_* 变量，必须改用 build args 在此注入。
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 阶段 2：运行 ----------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# 账号记忆的落盘目录。
#
# ⚠️ 这一行不能省。Docker 在挂载命名卷时，会把**镜像里该路径的所有权**
# 复制到卷上；若镜像里没有这个目录，Docker 会用 root 创建它，
# 于是以 uid 1001 运行的进程写不进去 —— 表现为「记忆功能看起来正常，
# 但每次都是第一次玩」，且日志里没有任何错误。实测踩过这个坑。
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# standalone 产物（含精简后的 node_modules 与 server.js）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 静态资源与 public —— standalone 不会自动带，漏了会 404
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# 容器内探活：首页应返回 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
