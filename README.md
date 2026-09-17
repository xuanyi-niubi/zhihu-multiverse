# 知乎平行宇宙 · Zhihu Multiverse

> 把别人真实走过的人生，显影成你自己能验证的一局。

说出你正在经历的那件事，系统会先在知乎寻找**完整同路经历**；如果样本不足，
再逐层放宽到相似起点、同类背景、相同终点与相邻路径。每一层都标明差异，
不会把不相关的故事伪装成答案。

**知乎黑客松 2026 · 校园新锐季** | 主赛道：跨次元游乐场 | 关联方向：知识炼金场

> **部署状态：公网体验已下线。**
> 比赛结束后按要求清除了线上部署（容器、数据卷、发行目录、nginx 站点配置与域名解析都已撤除），
> 本仓库即为完整作品：代码、测试、设计文档与部署脚本都保留，按下面的「本地运行」即可完整复现。
> 拆除过程本身也留档在 `.github/workflows/teardown-vps.yml`（可重复执行、幂等）。

<!--
  截图按**画面内容**命名（文件名即内容）。重拍请走真实主链：
  建局 → 澄清 → 编译 → 对局，拍完自检文件哈希（防止两张拍到同一画面）。

  桌面 1440×900 与手机 390×844 各一套，共 6 张：
    home(.jpg / -mobile.jpg)               首页 · 命运观象厅
    experience-reveal(...)                 体验揭示 · 筛出可核验亲历者后逐段看
    play-act1(...)                         推演 · 第一幕「走进去」

  仓库里没有真实可稳定复现的终局截图，所以这里不摆一张冒充终局的图。
-->
<p align="center">
  <strong>桌面 1440×900</strong><br />
  <a href="./public/screenshots/home.jpg"><img src="./public/screenshots/home.jpg" width="32%" alt="首页 · 命运观象厅" /></a>
  <a href="./public/screenshots/experience-reveal.jpg"><img src="./public/screenshots/experience-reveal.jpg" width="32%" alt="体验揭示 · 筛出可核验的亲历者，逐段看他们真正走过的部分" /></a>
  <a href="./public/screenshots/play-act1.jpg"><img src="./public/screenshots/play-act1.jpg" width="32%" alt="推演 · 第一幕：走进去" /></a>
</p>
<p align="center">
  <strong>手机 390×844</strong><br />
  <a href="./public/screenshots/home-mobile.jpg"><img src="./public/screenshots/home-mobile.jpg" width="18%" alt="首页 · 手机" /></a>
  <a href="./public/screenshots/experience-reveal-mobile.jpg"><img src="./public/screenshots/experience-reveal-mobile.jpg" width="18%" alt="体验揭示 · 手机" /></a>
  <a href="./public/screenshots/play-act1-mobile.jpg"><img src="./public/screenshots/play-act1-mobile.jpg" width="18%" alt="推演第一幕 · 手机" /></a>
</p>

<p align="center"><sub>桌面 1440×900 与手机 390×844 实拍，非静态拼图 · 点击任意一张可看原图</sub></p>

---

## 为什么必须是知乎

普通 AI 问答给你一段建议；这里的**知乎内容不是参考资料，而是世界的规则**。

| 机制 | 玩家能感觉到什么 | 代码落点 |
|---|---|---|
| **先找人，再谈相似** —— 先查精确起点；不够时先跑**零成本**的「丢起点保目标」，再从这一轮**真实返回的标题与作者徽章里学起点词**去放宽（有模型时额外做一次短语义扩展，真词优先），最后按相似起点 / 同类背景 / 相同终点 / 相邻路径逐层放宽。每局检索预算 10 条（`APP_MAX_SEARCH_REQUESTS` 可调，硬上限 12） | 找不到完全相同的人时，也能看清“哪里相同、哪里不同”；放宽用的是语料里的真词，不是模型编的行业大词 | `features/experience/originTerms.ts` · `features/experience/transitionIntent.ts` · `features/experience/qualification.ts` · `features/experience/retrieve.ts` |
| **逐字引用** —— `exactQuote` 必须是原回答的连续子串，改一个字整条丢弃 | 每句话都能点回那一篇真实回答 | `features/experience/validate.ts` |
| **Experience Unlock** —— 一条真实经历会在某一幕解锁一个此前不存在的行动 | 「他的做法我原来根本没想到」 | `features/game-world/experienceUnlock.ts` |
| **反例驱动第三幕** —— 找不到真实反例就诚实留空，不编 | 「原来看起来对的路，有人是这样走坏的」 | `features/game-world/compileWorld.ts` |
| **Unknown Lock** —— 只有现实能回答的事，在游戏里永远锁着 | 「这个不是 AI 能替我猜的」 | `features/game-mechanics/unknownLock.ts` |
| **Reality Pass** —— 终局不判卷，给一条带成功信号与停止信号的现实支线 | 「我知道接下来该验证什么了」 | `features/game-world/questView.ts` |

一条贯穿全链的纪律：**不替玩家编答案**。没有证据就留空，并把它显式标成「未显影」。

### 我们刻意不做的事，以及它怎么被代码固定

一句「我们不会编」不值钱，值钱的是**它写在代码里、还有测试拦着**。

| 承诺 | 实现方式 |
|---|---|
| **AI 不能改写知乎原文** | `ExperienceFact.exactQuote` 必须是来源原文的**连续子串**，多一字少一字整条丢弃（`features/experience/validate.ts` · `features/experience/invariants.ts`） |
| **查不到就留空，不补齐** | 相似 / 替代 / 反例三条轨道都允许为空；`unrelated` 永不进入经验层；找不到真实反例时第三幕如实空着（`features/experience/queryPlan.ts` · `features/experience/qualification.ts` · `features/game-world/compileWorld.ts`） |
| **未知就是未知** | 只有现实能回答的事在游戏里始终锁着 `REALITY REQUIRED`，并转成一条现实实验（`features/game-mechanics/unknownLock.ts`） |
| **不给成功率 / 匹配度 / 推荐分** | 终局不判卷；内部相似等级只用于排序，从不展示成分数（`features/game-world/questView.ts` · `features/experience/similarityCopy.ts`） |
| **不把旧快照伪装成实时结果** | 检索来源分 `live / snapshot / curated / offline` 四档并如实显示；没有 key 时走人工校验过的快照，界面标注来源（`features/decision-session/service.ts`） |
| **不把「没人讨论」说成「查过了没有」** | 上游失败记 `upstream-error`、没有候选记 `no-result`、搜到但不合格记 `no-qualified-person`，三种文案互不相同（`features/decision-session/service.ts`） |
| **不把「今天不查了」说成「没人讨论」** | 知乎检索有全站日预算（`APP_MAX_SEARCHES_PER_DAY`，默认 900）：用满**不报错**，只是停下并记成 `budget` 档，页面如实说「今天的检索额度已用完」——与「上游失败」「没搜到」「搜到但没人合格」三档互不混淆（`core/usage/searchBudget.ts`） |

### 上线前的一次实测调整（如实记录）

最初我们把这类问题的目标词直接当检索条件，结果很多页面显示「0 位可核验亲历者」。实测后发现根因**不是「门槛太高」，而是门槛判错了词**：目标被解析成了 `当导游` 这样的动词碎片，而资格门槛要求来源正文逐字包含它 —— 于是「机械 / 电气 / 会计转导游」这些完全合格的经历全被判成了无关。

改法是**不动门槛、只修词**：端点只从用户原话里抽取，并加一条「必须是原话连续子串」的不变量；再加一条零成本的「丢起点保目标」查询（其他背景进入同一目标）；只有还没拿到「完全同路 / 相似起点 / 同类背景」时，才花那一次模型扩展。现在同一句话线上能筛出 3 位可核验亲历者，并诚实标注「已放宽到相同终点」。

## 一局怎么走

```
首页输入困惑
   ↓  0~2 个澄清问题（只问会改变结论的条件；你说过的绝不重复问）
三视角检索 → 逐字提取 → 校验 exactQuote
   ↓  World Forge：相似 / 另一种 / 反例三条轨道各自 materialize
三幕平行世界（第一幕引入、第二幕解锁、第三幕由真实反例驱动）
   ↓  每次抉择消耗「借来的经验」，未显影区永不补全
终局：问题被重写 → 交还一条现实支线
```

## 快速开始

```bash
npm install
cp .env.example .env.local     # 填 APP_LLM_API_KEY 与 APP_ZHIHU_ACCESS_SECRET
npm run dev                    # http://localhost:3000
```

没有 key 时也能跑：检索会退回离线快照，界面保持「剧本模拟引用」，**不会编造赞同数**。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_LLM_API_KEY` | 是 | 模型密钥，只在服务端读取（敏感凭证统一由 `src/config/serverEnv.ts` 管理） |
| `APP_LLM_BASE_URL` | 是 | 兼容 OpenAI 协议的端点 |
| `APP_LLM_FAST_MODEL` / `APP_LLM_DEEP_MODEL` | 否 | 不配则两者都用同一模型 |
| `APP_LLM_JSON_MODE` | 否 | 默认 `true`；端点不支持 `json_object` 时才关 |
| `APP_ZHIHU_ACCESS_SECRET` | 否 | 知乎开放平台 Access Secret，用于真实站内语料 |

> ⚠️ 密钥绝不入库。仓库带 `scripts/check-secrets.mjs` 闸门，配合
> `git config core.hooksPath .githooks` 后每次提交自动拦截。

### 拉取真实来源快照

```bash
npm run sync:zhihu     # 需 ZHIHU_ACCESS_SECRET；落盘成可核查的快照（含 retrievedAt）
```

## 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建（standalone 产物）
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run test:stats   # 重新生成 scripts/test-stats.json
npm run smoke        # 主链 HTTP 冒烟
npm run verify       # typecheck + test + build + smoke
```

## 测试

当前实测（`scripts/test-stats.json`，由 `npm run test:stats` 生成，不手写数字）：

```
以 `scripts/test-stats.json` 为准 · CI 全部通过
```

契约覆盖三条主线：**产品纪律**（三视角检索、逐字引用、未知永不补全）、
**主链技术身份**（陌生问题 → 动态澄清 → 检索 → 逐字片段 → 三幕蓝图 → 经验卡 → DM 逐字引用，全程 fake 注入不碰真网络）、
**设计系统**（单一 token 体系、无霓虹外发光、reduced-motion 降级）。

## 目录结构

```
src/
├── app/                      # Next.js App Router
│   ├── page.tsx              # 首页：命运观象厅 + 唯一入口
│   ├── play/page.tsx         # 推演舱
│   ├── session/[id]/page.tsx # 世界生成中转：澄清 → prepare-world → World Forge
│   ├── journal/ · settings/ · about/
│   └── api/                  # dm / sessions / settings / profile / health / memory / zhihu / oauth
├── core/
│   ├── evidence/             # 检索规划 / 证据网格 / 事实强度
│   ├── dm/                   # AI DM 五层容错防御
│   ├── decision/ · run/ · usage/ · oauth/ · zhihu/
│   ├── memory.ts             # 跨周期记忆 / 决策画像
│   └── observability.ts      # 结构化日志（技术细节只进日志，不进页面）
├── features/
│   ├── experience/           # 澄清 / 检索计划 / 逐字校验 / 提取
│   ├── game-world/           # 三幕编译 / 经验解锁 / 现实支线
│   ├── game-mechanics/       # 行动空间 / 遭遇 / 未知锁定
│   └── decision-session/ · reality-memory/ · run/
├── components/
│   ├── visual/               # 观象厅：AstralDial / WorldForge / CelestialBackdrop / RealityPass …
│   ├── game/                 # 经验卡 / 来源角标 / session 推演屏
│   ├── characters/ · scenes/ · session/
│   # 注：visual/ 里的 OrbitField 与 Kanshan 是设计留档（不再挂载，由 observatory 契约守护）
│   └── AppearanceBootstrap.tsx
├── config/serverEnv.ts       # APP_* 的唯读入口（浏览器里调用会直接抛错）
├── data/                     # 角色 / 场景 / 黄金案例 / 知乎来源快照
└── types/                    # 类型契约
```

## 设计系统：银盐观象台

视觉只有一个事实源 —— `src/app/silver.css`，一套 `--sil-*` token，**不保留别名**。

三条不可违反的纪律：

1. **材质先于配色。** 暗房是物理空间：相纸有纤维、镜头有晕影、显影液有密度。颜色只用来区分证据的三种意图，不用来装饰。
2. **未知永不补全。** 未显影区没有 hover、没有估值、没有「暂无数据」的占位数字 —— 它只有一种状态：还没显影。
3. **暖色只属于现实层。** 相纸暖白只出现在终局那张「要带走的纸」上。

三个机制：**显影** Development（620ms 入场）· **极光带** Aurora（全站唯一的情绪指示器）· **三层世界** Three Planes。
中文正文走系统字体栈（不额外下载 Noto Serif SC）；自托管只有拉丁等宽（JetBrains Mono，6 个 woff2 / 约 65KB），因为「仪器读数」需要它。

## 部署

```bash
cp .env.production.example .env.production   # 填真实密钥（.gitignore 已忽略）
docker compose up -d --build
```

- 镜像基于 `output: standalone` 多阶段构建；容器**只监听回环** `127.0.0.1:3000`，由宿主 Nginx 反代。
- 根文件系统 `read_only`，账号记忆通过命名卷 `memory-data` 落盘。
- 生产密钥由 `env_file` 在运行时注入，**不进镜像层**（`.dockerignore` 已排除 `.env*`）。
- Nginx 在 TLS 终止处做边缘限流：`/api/dm` 与 `/api/sessions` 是最紧的两道闸（这两条会真实消耗额度）。
- 应用层另有四道配额闸（每局模型调用 / 每身份每小时 / 每身份每日 / 全站每日 / 每 IP），见 `core/usage/`。

> ⚠️ 不要横向扩容。OAuth 会话在 Node 进程内存里，多副本会导致「刚授权成功，刷新就掉了」。

## 致谢

- 中文衬线体使用系统字体栈；动效全部为原生 CSS keyframes，未引入动画库。
- 运行时依赖只有 React 与 Next.js。
