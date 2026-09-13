# 知乎平行宇宙 · Zhihu Multiverse

> 🔗 **在线体验**：https://zhihu.xuanyi888.cloud:8443

> **经验，就是关卡。差异，就是冲突。行动解锁，就是成长。现实问题变清楚，就是结局。**

**知乎平行宇宙是一款由知乎真实人生经验驱动的互动人生实验。** 用户输入一个真实困惑，系统去寻找真正走过不同道路的人，把这些经历编译成一段可以亲自进入的互动故事；玩家不会得到一个 AI 替自己做出的答案，而会在真实经验、行动解锁和反例中，看见原本没想到的选择，并最终把问题变得更清楚。

每一句引用都是原文逐字片段，都能点回站内原回答；模型只有挑选权，没有改写权。

**知乎黑客松 2026 · 校园新锐季** | 主赛道：跨次元游乐场 | 副赛道：知识炼金场

---

## 一条主链，其余都是旁路

| | 默认主链（唯一入口） | 开发/降级路径 |
|---|---|---|
| 入口 | 首页「进入我的平行宇宙」→ `/session/[id]` → `/play?session=<id>` | 直接访问 `/play?goal=` · `/play?case=` · `/compare` |
| 做什么 | 动态澄清 → 检索真实经历 → 三幕世界 → 经验卡 → 反例 → 问题重写 → 现实支线 | 旧剧本推演 / 只算账对照（保留代码，不再从首页进入） |
| 玩家看到 | 叙事 + 选项 + 借来的经验 + 终局问题重写 | 数值属性、骰子、遗物、判卷等旧机制 |

### 唯一的核心循环（2026-09-13 收敛）

首页只做一件事：**让你说出一个真实困惑**（产品减法方案 §5）。之后全部自动：

```text
你最近真正纠结什么？（首页唯一输入 + 唯一 CTA）
  → 0～2 条动态澄清：只有答了会改变「搜什么 / 比较谁 / 冲突是什么 / 最后验证什么」才问
  → 「我去找找，有没有人活过你正在纠结的这几种人生。」        ← 刘看山第一次出现
  → 多意图知乎检索：相似处境 / 另一种走法 / 失败与反例（强制三类，禁只搜支持性内容）
  → 逐字经验片段（AI 只有提议权，改一个字就丢）→ 按人聚成经历 → 与你不同的地方（含 unknown）
  → WorldCompiler：编译成**三幕**世界（走进去 → 代价出现 → 反例出现）
  → /play?session=<id>：AI DM 只在蓝图范围内演绎，引用必须逐字
  → 选项由「你原本的想法 / 真实行动 / 反例的替代做法」产生，不再有稳妥-高风险的固定搭配
  → 第二幕：真实经历变成 **Experience Card（借来的经验）**，并解锁一个此前不存在的行动
  → 第三幕：刘看山第二次出现 ——「等等。这个人的结果和前面完全相反。」
  → 终局不是判卷，是**问题重写**：你开始时问的是… 现在真正该验证的是…
  → Reality Quest：一条带成功信号与停止信号的现实支线，复制/保存/截图都能带走
```

**旧机制已退出主路径**（第一阶段只隐藏、不删代码）：数值属性、骰子检定、遗物面板、
命途树、证据网格 UI、现实锚点、清晰度雷达、Boss 判卷、赛博契约、黄金 Case 入口 ——
它们的代码仍在仓库里服务于 legacy 路径与降级，但玩家在新主链上一次都见不到。

### 一条贯穿两条路的纪律：不替玩家编答案

这个作品最容易犯、也最致命的错误，是把有限轶事包装成对个人的预测。
所以代码里锁着几件事：

- **路径属于当前问题**：问「大二要不要参加比赛」，给的是「先做一个小样再决定」这类走法，
  不会出现「在职转型」这种跨场景套用的职业路径；
- **不造伪精确**：`EvidenceFact` 只保存**原文明确写出的值**（原文写「两个月」就记「两个月」），
  没有写就留空并显示 `待验证`，不做区间推导、不做单位换算；
- **展示层只有四种标记**：`原文` / `样本观察` / `AI 归纳` / `待验证`，
  没有「可行 / 不可行 / 成功概率」这类裁决式表达；
- **来源状态不自相矛盾**：使用快照时就说「知乎来源快照 + 来源 N 条」，
  不会在同一屏上写「没有站内样本」。

这些都有测试钉着（见下文「测试覆盖报告」）。

---

## 快速开始

```bash
npm install
cp .env.example .env.local   # 可选：不配置也能跑，会自动走离线兜底
npm run dev                  # http://localhost:3000
```

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式 |
| `npm run build` / `npm run start` | 生产构建与启动 |
| `npm test` | 运行全部测试 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | 主路径冒烟测试（HTTP 级：起生产服务、真发请求、断言闭环） |
| `npm run verify` | **提交前跑这个**：typecheck + 全部测试 + 构建 + 冒烟 |
| `npm run test:stats` | 生成测试统计（`scripts/test-stats.json`，文档数字的唯一口径） |


### 部署上线

自托管用 Docker 一把梭，`Dockerfile` 是多阶段 standalone 构建，`docker-compose.yml` 已内置只读根文件系统与记忆卷挂载：

```bash
cp .env.production.example .env.production   # 填真实值
docker compose up -d --build                 # 首次约 2–4 分钟
```

HTTPS 终结建议交给外层反向代理，注意把 `X-Forwarded-Proto` 透传给应用——
OAuth 会话 Cookie 的 `Secure` 属性依赖它。

**⚠️ 必须单实例运行**：OAuth 会话存在 Node 进程内存（令牌不落盘），多副本会导致「授权成功、刷新就掉」。详见 `docker-compose.yml` 顶部说明。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DM_API_KEY` | 空 | OpenAI 兼容端点密钥（也接受 `OPENAI_API_KEY`）；不配则全部走离线剧本 |
| `DM_BASE_URL` | `https://api.deepseek.com/v1` | 任意 OpenAI 兼容端点 |
| `DM_MODEL` | `deepseek-chat` | 模型名 |
| `DM_JSON_MODE` | `true` | 要求 `response_format: json_object`；端点不支持时设 `false` |
| `DM_TIMEOUT_MS` | `30000` | 单次生成超时，超时自动降级 |
| `DM_TEMPERATURE` | `0.85` | 采样温度（0–2） |
| `DM_MAX_TOKENS` | `1400` | 单次生成上限 |
| `ZHIHU_ACCESS_SECRET` | 空 | 知乎开放平台 Access Secret，用于知乎搜索与用户数据接口 |
| `ZHIHU_CACHE_TTL_MS` | `600000` | 搜索缓存 TTL，用于保护 1000 次/天配额 |
| `ZHIHU_OAUTH_APP_ID` | 空 | **账号登录**：App ID（短数字），来自开放平台应用详情页 |
| `ZHIHU_OAUTH_APP_KEY` | 空 | **账号登录**：OAuth App Key，用于 `/access_token` 换取用户令牌 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 空 | **账号登录**：公网 HTTPS 回调，须与开放平台登记值完全一致 |
| `MEMORY_DIR` | `./data/memory` | 账号记忆的落盘目录。容器里指向挂载卷（根文件系统只读） |
| `DM_DEBUG_DELAY_MS` | 空 | 调试用：给 `/api/dm` 注入人工延迟，验证加载动效 |

**都不配置也能跑**：AI DM 会自动走离线剧本兜底，前端显示「离线兜底」徽标，演示不白屏。
未登录则记忆功能自动隐藏——游客可完整体验完整一局，只是这局不会被记住。

### 知乎开放平台接入

配置 `ZHIHU_ACCESS_SECRET` 后，链路会自动升级：

```
玩家目标 → 知乎搜索 API（过滤权威度 ≥ 2）→ 5 条真实语料注入 Prompt
        → DM 模型生成关卡 → 五层校验 → 舞台渲染
        → 溯源角标显示真实答主 / 赞同数 / 原回答链接
```

| 能力 | 接口 | 配额 |
|---|---|---|
| 知乎站内搜索 | `GET /api/v1/content/zhihu_search` | 1000 次/天（已加 LRU + TTL 缓存） |
| 知乎热榜 | `GET /api/v1/content/hot_list` | 100 次/天 |

**知乎直答（`zhida-*`）已从模型链路移除**：它只保证 `model/messages/stream` 三个字段、不支持结构化输出，实测会把 JSON 指令写成 markdown 长文。知乎开放平台现在只承担「搜索」这一个职责，负责提供真实站内语料；生成关卡交给 DeepSeek 这类支持 `json_object` 的模型。

### 知乎账号登录（OAuth）

`/oauth` 提供知乎账号接入面板，可读取登录账号的公开资料、创作、关注与收藏。

| 路由 | 作用 |
|---|---|
| `GET /oauth` | 账号授权与状态（登录、账号信息、知乎接口连通性自检） |
| `GET /api/oauth/start` | 302 跳转开放平台授权页 |
| `GET /auth/callback` | 接收 `authorization_code` → 换 token → 拉资料 |
| `GET /api/oauth/status` | 配置态与脱敏凭证诊断（无需会话） |
| `GET /api/oauth/session` | 会话级授权状态（读 Cookie） |
| `POST /api/oauth/run-all` | 五项用户接口各打一条 |
| `POST /api/oauth/logout` | 断开连接（清会话内存） |

**三类凭证必须分开，串位会被主动拦下**：

| 凭证 | 用途 | 位置 |
|---|---|---|
| App ID（短数字） | 授权页标识应用 | `ZHIHU_OAUTH_APP_ID` |
| OAuth App Key | `/access_token` 换取令牌 | `ZHIHU_OAUTH_APP_KEY` |
| Access Secret | 用户数据接口 `Authorization: Bearer` | `ZHIHU_ACCESS_SECRET` |

`/api/oauth/status` 会校验三种典型误填（App ID 当 App Key、App Key 当 Access Secret、两个 Secret 相同）并输出 `credentialWarnings`。所有诊断只含**长度与 sha256 前缀**，明文永不出现在响应、页面或日志中。

**本地只能预览，无法完成登录。** 知乎回调要求公网 HTTPS 地址，`127.0.0.1` / `localhost` 一律被拒（`localPreviewOnly: true`，授权按钮禁用）。部署到任何支持公网 HTTPS 的环境后，把 `https://<域名>/auth/callback` 登记到开放平台并写入 `ZHIHU_OAUTH_REDIRECT_URI` 即可。

**已知协议缺口**（不得宣称为生产级登录方案）：回调可能不返回 `state`（此时面板显示「仅适合临时联调」，不假装通过 CSRF 校验）；当前无 PKCE、scope、refresh token、撤销与解绑；`/user` 无正式响应 schema，读取失败不伪造字段、也不阻断五项正式接口。OAuth Token 只存 Node 进程内存，不落盘。

---

## 核心架构：AI DM 的五层容错防御

**结论先行：仅靠 Prompt 无法保证 100% 输出合法 JSON。** 谁承诺能保证都是不成立的。所以本项目把「不崩」这件事放在代码层——只有第 1 层依赖模型自觉，其余四层全是确定性代码，任何一层失败都被下一层接住。

```
┌──────────────────────────────────────────────────────────────────────┐
│  ① Prompt 约束          src/core/dm/prompt.ts                        │
│     系统 Prompt 六节 · JSON Schema 单一事实源 · 3 组 Few-shot         │
│     · 修复 Prompt                                                     │
├──────────────────────────────────────────────────────────────────────┤
│  ② JSON 模式传输        src/core/dm/provider.ts                      │
│     response_format: json_object · AbortController 超时              │
│     · 网络/HTTP/空响应 → 结构化失败（不抛）                            │
├──────────────────────────────────────────────────────────────────────┤
│  ③ 容错解析            src/core/dm/parse.ts                          │
│     strict → 剥围栏 → 括号配平提取 → 损坏修复 → 补齐截断 → 单引号归一   │
│     签名上不返回异常                                                   │
├──────────────────────────────────────────────────────────────────────┤
│  ④ 校验与钳制修复       src/core/dm/validate.ts                       │
│     能修则修：DC 收敛到回合区间 · 属性钳制 ±40 · 稳妥选项摘 check      │
│     · 高风险缺 check 补齐 · 缺失败分支合成 · 非法遗物丢弃              │
├──────────────────────────────────────────────────────────────────────┤
│  ⑤ 编排兜底            src/core/dm/generate.ts                       │
│     重试一轮 → 离线剧本 → 硬编码最小关卡                               │
│     返回类型里没有失败态                                               │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              POST /api/dm  →  永远 HTTP 200 + 合法关卡
```

`/api/dm` 的契约是**永远返回 200 与一个合法 `ScenarioTurn`**，前端不需要写任何错误分支。响应头 `x-dm-source` 标明来源：`model` / `model-repaired` / `fallback`；同时回传 `x-trace-id`，按这个 id 可查到各阶段耗时与全部降级原因码。

## 确定性因果引擎

分支感来自**组合**，不是手写 3^4 条完整剧情。每个场景模板只声明「进入条件 + 权重 + 效果」，具体走哪 4 个模板由种子在合法候选里稳定抽取：

```
Manifest(seed + scenarioRevision)  ──① 种子定优先级──►  每幕模板排名（加权无放回抽样）
世界状态 flags                      ──② 规则筛候选──►  该幕真正使用的模板
```

这两条职责**必须分开**：让种子直接决定「抽哪个」，条件筛选就失去意义；让规则决定优先级，种子挑战就退化成同一条固定路线。

| 不变量 | 落点 | 怎么验的 |
|---|---|---|
| 同一 Manifest ⇒ 同一事件计划 / 骰面 / 状态 | `core/run/scenarioCompiler.ts`、`runEngine.ts` | `runDeterminism.test.ts` 重放 100 次逐字节比对 |
| 骰面只有一处随机源 | 复用 `core/d20.ts` 的 FNV-1a + mulberry32 | 预览与检定共用 `choiceRng()`，避免两处 key 各自漂移 |
| 改文案不改计划，改权重改计划 | 计划哈希只编码模板 id 的排名 | 同一组用例的正反两面 |
| 隐藏状态只给玩家定性信号 | `worldState.hiddenSignals()` | 五个键各有极性（`runway` / `mentorTrust` 越高越好） |
| 被篡改的挑战链接必须拒绝 | `runEngine.verifyManifest()` | `eventPlanHash` 不匹配 → `event-plan-hash-mismatch` |

`RunManifest.scenarioRevision` 是**剧本内容的修订号**：改任何模板数值或文案都要 +1，否则老挑战链接会静默变成味道不同的一局。

## 知乎来源的真实性规则

**只有 `status: 'verified'` 的来源，界面才允许出现赞同数。**

「知乎高赞」这类社区数字必须来自真实检索。规则是：

| 数据来源 | 角标显示 | 浮层 |
|---|---|---|
| 官方 key 检索/落盘（`verified`） | `知乎高赞 9,421` / `知乎来源` | 答主 + 赞同数 + **抓取日期** + 原回答链接 |
| 剧本文案（`scripted`，含缺 status） | `剧本模拟引用`（**不含任何数字**） | `@答主 · 剧本模拟` + 明说「不是检索到的真实回答」 |

真实数据只有一条合法路径 —— **知乎开放平台 Access Secret（不爬站）**：

```bash
# 1) 拿 key：https://developer.zhihu.com 凭证页
# 2) 拉取真实来源，落盘成可核查的快照（含 retrievedAt）
ZHIHU_ACCESS_SECRET=<你的 secret> npm run sync:zhihu
```

脚本行为刻意保守：**没有 key 直接失败**；接口报错（如 `Code=20001 Authorization failed`）
会原样打印；**一次失败不会覆盖上一次的好快照**。`tests/knowledgeSource.test.ts`
会断言预置剧本数据里不存在任何手写数字，防止占位值再溜回来。

## 终端 Boss 判卷

终局幕不再是选项，而是一个终端：玩家写下 20–240 字的破局方案，然后**判卷 + 一次 D20**。

```
POST /api/boss/evaluate  →  { evaluation, adjudication, source }
x-boss-source: model | fallback | cached      x-trace-id: tr-...
```

**红线：AI 提议，规则引擎裁决。**

| 谁来定 | 定什么 |
|---|---|
| 模型 | 四维量表（具体性 / 证据利用 / 可执行性 / 自我认知）与 **-3..+5** 的思路修正 |
| 规则引擎 | 动态 DC（只由 `WorldState` 生成，钳在 11–18）、骰面、胜负、掉落 |

最终结算仍是标准 D20：`D20 + 属性修正 + 遗物修正 + 思路修正 >= DC`，**天然 1 必败 / 天然 20 必成优先级最高** —— 模型给再高的修正也翻不了天然 1。

三条降级链路都已在测试里锁死：

| 条件 | 行为 |
|---|---|
| 模型正常 | `source: model`，越界来源 id 被丢弃，修正被钳制 |
| 模型超时 / HTTP 失败 | `source: fallback`，本地关键词规则给确定性修正，**终局照常完成** |
| 模型返回损坏 JSON | 同上，并留下 `modelIssue: invalid-json` 便于统计降级率 |
| 同一 `runId + answerHash` 重复提交 | `source: cached`，结果逐字节相同（幂等） |

本地降级只看可解释信号：有没有时间单位、有没有可验证动作、有没有引用本局片段、有没有写风险/退出条件、是不是纯口号 —— 于是「没有模型也能玩」这条底线在终局同样成立。

## 现实破壁清单

终局最后给玩家的不是「你失败了」，而是**几条今天就能做的动作**：

```
01  挑一个能讲清的项目补完，并写成可复述的三段说明
    本周内 · 算成：能在三分钟内讲清「解决什么问题 / 怎么做的 / 结果如何」
    [剧本模拟建议] 未绑定站内来源，请当作推演剧本的建议而非真实答主观点
```

每条都必须有三件东西：**祈使句动作 + 时间盒 + 可验证信号**。另外两条硬约束：

| 约束 | 落地方式 |
|---|---|
| **可溯源** | 只与 `status: 'verified'` 的来源做匹配（4 字滑窗重合）；绑上才标「站内来源」并给出答主 / 赞同数 / 抓取日期 / 原回答链接 |
| **不冒充** | 绑不上的一律标「剧本模拟建议」，并明写「不是真实答主观点」；`scripted` 来源**永远进不了** verified 档 |

清单是确定性的：同一局输入重放 20 次得到同一份清单与同一个指纹（`#hash`），所以复盘同一局时这份清单也不会变。判卷点出的缺口会直接变成待补条目 —— 把评价变成下一步动作，而不是停在分数上。

## 应用内密钥配置（`/settings`）

不用改 `.env`、不用重新部署：登录后在 `/settings` 直接填自己的 key。

| 项目 | 说明 |
|---|---|
| 知乎开放平台 Access Secret | 用于站内搜索 / 热榜 → 真实语料注入 + 来源角标 + 破壁清单绑定；页面内置 `developer.zhihu.com` 获取引导与配额说明 |
| 模型 key | **默认 DeepSeek**（`https://api.deepseek.com/v1` + `deepseek-chat`），端点与模型名都可改，因此也支持任意 OpenAI 兼容服务；结构化输出可关 |

四条安全承诺（都有自动化测试盯着）：

1. **接口永不返回明文** —— GET 只给「是否配置 + 长度 + sha256 前 8 位」，改 key 就是整把替换；
2. **明文只落服务器磁盘**（`/app/data/settings/*.json`，权限 0600），且不写日志（失败只记错误码）；
3. **按知乎账号隔离** —— 未登录时接口只提示、不接受写入；账号之间互不可见；
4. **删除是真删** —— 单字段删除后文件里就没有它了；删掉最后一项连文件一起移除，不留空壳。

运行时优先级是 **账号配置 > 环境变量 > 未配置**：`keyResolution.ts` 统一解析，
`/api/dm`、`/api/boss/evaluate`、`/api/profile`、`/api/report`、`/api/zhihu/hot` 都走它，
所以「填了 key 却还在用 env」这种情况不会发生（有测试专门守它）。

### 解析层容错能力（实测语料）

| 畸形形态 | 处理 |
|---|---|
| markdown 代码围栏 / 前置散文 | 剥离后提取 |
| 尾随逗号 / 全角标点 / 注释 | 确定性修复 |
| `NaN` / `undefined` / `-Infinity` 字面量 | 替换为 `null`（先吞正负号） |
| 单引号 JSON / 未加引号的键 | 归一化后重试 |
| 被 `max_tokens` 截断在字符串中间 | 补引号 + 补括号 |
| 字符串内含花括号 `{"a":"}{"}` | 字符串感知扫描，不误截断 |
| 8000 字噪声前缀 / 零宽字符污染 | 定位首个配平对象 |

---

## 确定性设计

同一份输入必须得到同一个结果，否则「种子挑战」不成立。

- **随机源**：`mulberry32`，由 `seed + checkId + turnIndex` 派生。同一局同一回合同一选项，骰面永远一致，刷新页面不改变结果。
- **判定优先级**：天然 1 必败、天然 20 必成，高于 `d20 + 修正 >= DC` 的数值比较。
- **数值钳制**：所有越界值在 `core/brand.ts` 统一收敛，属性 0–100、DC 1–30、单项修正 ±20、总修正 ±60。
- **结算顺序**：先乘出身易伤倍率，再乘遗物减伤，最后四舍五入——顺序固定且被单测锁死。

---

## 测试覆盖报告

**口径只有一个**：`npm run test:stats` 会跑一遍测试并把结果写入
[`scripts/test-stats.json`](scripts/test-stats.json)；README 与产品说明计划书都引用它，
`tests/docsStats.test.ts` 会断言两者一致 —— 手写测试数字必然会漂，所以干脆不手写。

当前实测（`scripts/test-stats.json`）：

```
76 个测试文件 · 1193 个用例 · 通过 1193 · 失败 0
```

| 测试文件 | 覆盖内容 |
|---|---|
| `tests/fullPersonalizedRun.test.ts` | **新主链技术身份证**：陌生问题 → 动态澄清 → 三视角检索 → 逐字片段 → 动态路径 → 差异含 unknown → 三幕蓝图 → 经验卡/解锁 → DM 上下文逐字引用（全 fake 注入，不碰真网络） |
| `tests/problemFrame.test.ts` | 第一道诚实性关卡：`user-explicit` 与 `parser-synthesis` 分开，**推断出来的东西永远拿不到硬条件** |
| `tests/queryPlan.test.ts` | **任何一份检索计划都必须包含失败 / 反例视角** —— 只搜支持性内容就退化成了讨好用户 |
| `tests/experienceRetrieve.test.ts` | 去重合并、来源封顶 12、失败不抛、缺数据不丢 |
| `tests/experienceSearchCache.test.ts` | 坏缓存被忽略、真结果优先落盘、**过期缓存绝不顶** |
| `tests/experienceExtraction.test.ts` | 零模型也能产出；有模型也不能造假（逐字校验兜底）。**每条片段继承自己来源的检索意图**，不合并成全局并集 |
| `tests/experienceCases.test.ts` | 经历聚合只 group / sort，不发明任何内容 |
| `tests/pathSynthesis.test.ts` | 路径只能从真实片段长出来；模型只分组；出现禁词即整条 fallback |
| `tests/userDifference.test.ts` | **不能明确比较就是 unknown**，绝不语义猜测，绝不产出匹配度 |
| `tests/worldBlueprintDomain.test.ts` | 蓝图是把经历编译成游戏、不是生成报告：每一幕都必须挂着真实事实 ID |
| `tests/worldBlueprint.test.ts` | 固定三幕、终局有 keyUnknown、没有事实不伪造、纯函数确定性；**解锁只从行动经验生成** |
| `tests/worldBlueprintCounterexample.test.ts` | 第三幕必须真的由反例驱动：四轮来源优先级（对立片段 → 反例 → 失败经历 → 对立 case），**找不到反例就留空并如实写出来** |
| `tests/playWorldIndexing.test.ts` | Play 1 基幕次 ↔ 蓝图 0 基索引的四个映射，含「不换算会错位」的反例 |
| `tests/experienceUnlock.test.ts` | 经验解锁：先获得经验 → 之后某一幕多出一个此前不存在的选择 |
| `tests/dmWorldContext.test.ts` | 无 session 时 prompt 与旧版完全一致；有蓝图时逐字引用规则生效，反例幕注入「不得虚构反例」 |
| `tests/realityExperimentFromUnknown.test.ts` | 未知的**类型**决定实验形态；时间盒看得见用户自述的可用时间；六要素缺一不可 |
| `tests/realityQuestView.test.ts` | 终局回顾条目必须有出处；**没有实验就不给承诺候选** |
| `tests/realityMemoryDomain.test.ts` | 不许把「随口一说」升级成「反复验证过的事实」 |
| `tests/realityMemoryService.test.ts` | 只记实验真的产出的东西、观测才能升级置信度、**不推断人格** |
| `tests/decisionSession.test.ts` | 路径必须属于当前问题；缺信息就说缺信息 |
| `tests/decisionFlow.test.ts` | 五步闭环真的能走完：建会话 → 澄清 → 选未知 → 实验 → 认领 → 回访 |
| `tests/experienceQuoteIntegrity.test.ts` | 片段诚信底线：AI 改写一个字就拒绝、scripted 来源不进经验层、标点替换不命中 |
| `tests/dynamicClarification.test.ts` | 动态澄清：0/1/2 条、**用户说过的绝不重复问**、每条问题都说清它改变什么 |
| `tests/dmParse.test.ts` | 27 类畸形模型输出语料，逐条断言**永不抛异常** |
| `tests/zhihuOAuth.test.ts` | 本地地址拒判、授权 URL 字段、凭证串位拦截、诊断不泄露明文、会话 Cookie |
| `tests/memoryStore.test.ts` | url_token 抽取、路径穿越防护、输入钳制、损坏恢复、**写失败不谎报成功**、遗言两步封存 |
| `tests/memory.test.ts` | 存储损坏降级、决策画像提炼、前世遗念卡牌、AI 记忆块注入 |
| `tests/zhihuClient.test.ts` | 搜索 / 热榜解析、配额缓存、网络异常不抛 |
| `tests/dmProfile.test.ts` | 处境档案：关键词规则、JSON 归一化、逐行键值容错、降级链 |
| `tests/dmValidate.test.ts` | 越界 DC / 属性、缺字段、非法遗物、非 https 链接的钳制与修复 |
| `tests/memoryApi.test.ts` | `/api/memory` 集成：未登录为正常态、写入读回、**同名不同 token 不串数据**、PATCH 封存遗言幂等 |
| `tests/narrative.test.ts` | SAN 阈值过滤、伏笔占位符替换、同槽位立绘替换、表情随 mood 变化 |
| `tests/origins.test.ts` | 三流派策略差异、易伤倍率作用域、结算顺序锁定 |
| `tests/dmGenerate.test.ts` | 合法 / 损坏 / 垃圾 / 两轮失败 / 客户端抛异常 / 兜底函数抛异常 |
| `tests/dmEcho.test.ts` | 氛围句**不得出现数字或百分比**（编造统计一律替换），含预置剧本数据层回归 |
| `tests/challenge.test.ts` | 挑战链接**必须带 scenario**：少了它被挑战者会静默回落到另一场剧本 |
| `tests/runContracts.test.ts` | Run/Challenge/Boss 契约：Manifest 篡改必须拒绝、AI 修正永远出不了 -3..+5、来源白名单 |
| `tests/runDeterminism.test.ts` | **P1 退出门槛**：同一 Manifest 重放 100 次，事件计划/骰面/状态逐字节一致；改文案不改计划，改权重改计划 |
| `tests/scenarioCompiler.test.ts` | 规则筛合法候选、种子定优先级；头名不合法顺延而不重掷；幽灵线不泄露结果 |
| `tests/worldState.test.ts` | 属性/隐藏状态钳制、NaN 不污染状态、五个隐藏状态的**极性**与定性信号 |
| `tests/scenarioAdapter.test.ts` | 剧本结果 → 隐藏状态的确定性规则；属性有唯一事实源（不双写） |
| `tests/signalText.test.ts` | 信号文案五键×四档全覆盖且**不含任何数字**；警报判定只有一处 |
| `tests/knowledgeSource.test.ts` | **只有 verified 来源能出现赞同数**；`scripted` 文案不含数字；数据层禁止手写 `upvotes` |
| `tests/bossJudge.test.ts` | 终端 Boss：在线 / 超时 / 损坏 JSON / HTTP 失败四条链路都能出终局；修正钳到 -3..+5；天然 1 必败；幂等 |
| `tests/bossTerminal.test.ts` | 终局分解必须摊开四维/属性/遗物/思路/骰面 vs DC 并标明判卷来源；不泄露隐藏状态 |
| `tests/realityChecklist.test.ts` | 破壁清单：祈使句+时间盒+可验证信号；**scripted 来源绝不能变成 verified 条目**；限量去重且同局可复现 |
| `tests/settingsStore.test.ts` | 密钥存储：**接口输出里搜不到明文**、删除是真删、按账号隔离、非法值整条拒绝 |
| `tests/settingsApi.test.ts` | 配置接口：未登录只提示、任何响应无明文、删除后 GET 立刻反映、未知字段不进白名单 |
| `tests/keyResolution.test.ts` | 运行时优先级：**账号配置压过环境变量**、未登录只吃 env、来源三态标记正确 |
| `tests/agentsEngine.test.ts` | AI 叙事引擎：动态难度可解释有界、**模型写骰面/DC/胜负会被结构性丢弃**、主备降级、MAG 记忆注入、选项语义叠加代价 |
| `tests/turnComposer.test.ts` | 结构接线：AI 定结构而数值由合成器算出；**无 key 时回合一字不改**；模型失败不用短模板覆盖正文 |
| `tests/contentScale.test.ts` | 内容规模被测试钉住：遗物 ≥15 件且**每件都有叙事钩子**、三种效果类型齐全、场景骨架 12 个覆盖全部幕次 |
| `tests/actEngine.test.ts` | 动态幕系统**契约**：张力预算驱动幕数（各出身预算 88 / 76 / 84，实测幕数 **7–8 幕**，不再硬编码 4）、终局条件不再固定第 4 幕、难度带由状态而非回合号决定。⚠️ 动态幕目前只在**AI 自由推演**路径生效，预置剧本仍是人工精调的 **4 幕**；详见 `DESIGN.md` §0.5 |
| `tests/worldModel.test.ts` | 世界模型：压力阈值真改 DC、清晰度低看不到 DC、**Boss 判卷影响现实锚点**、锚点<30% 出异常、线索随幕收束、出口无数字 |
| `tests/observability.test.ts` | traceId 与阶段耗时；**日志里绝不出现密钥或玩家原文**，sink 抛异常也不影响主流程 |
| `tests/zhihuSnippets.test.ts` | 权威度过滤与回退、摘要清洗、赞同数排序、条数上限 |
| `tests/d20.test.ts` | 天然 1/20 优先级、修正钳制、同种子确定性、无副作用 |
| `tests/zhihuQuery.test.ts` | 各幕 query 互不相同、目标关键词保留、领域词提取、长度受控 |
| `tests/sprite.test.ts` | 立绘造型 × 表情组合的路径生成与确定性 |
| `tests/docsStats.test.ts` | 文档里的测试数字与 `scripts/test-stats.json` 一致 |

---

## 技术亮点

**参数化 SVG 立绘引擎** — `components/characters/Portrait.tsx`
头型、发型、五官、服装全部由路径绘制，5 种造型 × 7 种表情由「眉 / 眼 / 嘴」三组独立组合驱动。表情可随 SAN 与剧情实时切换，无需为每种情绪各出一张图。原创角色全部使用这套 SVG，不依赖任何外部图片素材。

**刘看山动态立绘** — `components/characters/KanshanSprite.tsx`
刘看山使用赛方提供的官方素材包（`public/kanshan/`，30 个 GIF），按「角色 × 动作」组合播放。素材版权归知乎所有，仅用于本次黑客松活动。

**分层场景舞台** — `components/scenes/SceneStage.tsx`
7 个场景由「色板 + 视差层」描述，三层视差用 rAF 节流只写两个 CSS 变量，单次 repaint。`prefers-reduced-motion` 与触摸设备下自动关闭。

**叙事节拍系统** — `core/narrative.ts`
`NarrativeBeat` 支持场景切换、角色登场退场、SAN 阈值叙述、全屏演出。AI DM 只返回一段文本时自动退化为单个旁白节拍，**离线剧本与动态关卡共用同一套演出管线**。

**经验引擎的诚信链** — `features/experience/` · `features/game-world/`
从提问到世界蓝图，每一步都有一个「不许编」的落点：问题框定把「用户原话」与「解析推断」分开（后者永远拿不到硬条件）；检索计划**强制**包含失败与反例视角；片段提取只有提议权，`exactQuote` 不是原文子串就整条丢弃；路径合成只做分组，出现禁词即整条回落；第三幕有反例来源的四轮优先级，找不到反例就留空并如实写在冲突文案里，而不是拿支持性内容硬充。DM 这一端同样闭环：蓝图模式下 `zhihuBullet.quote` 必须逐字等于某条真实片段，署名与链接取自**同一条**（只改 quote 不修署名，等于把话说对了却挂在别人头上）。

**终局是一次交接，不是一份报告** — `components/game/RealityQuestPanel.tsx`
终局第一屏不再堆指标，而是把「这一局任何人的人生经验都替不了的那个问题」交还给玩家，并给一条带**成功信号与停止信号**的现实支线。认下它复用已有的七天后回访机制；回访结果被记成 `experiment-observed` 的记忆（不是你自我估计的那句话），下一次提问时作为硬条件参与判断 —— 现实里验证过的事，从此回流。

**跨周期记忆闭环** — `core/memoryStore.ts` · `core/memoryClient.ts`
解决文字游戏最致命的「玩一次就再也不来」。三层设计：既视感开场（把上局挫折注入 AI Prompt，让它以老友口吻追问「这次改不改」）、决策画像沉淀（硬刚型 / 求稳型 / 借力型 / 同辈焦虑 / 后程崩盘）、前世遗念卡牌（上局写下的反思变成这一局的开局装备，加成幅度随上局进度递增）。

**记忆绑定知乎账号，不绑定浏览器**：

| | 游客 | 已登录 |
|---|---|---|
| 能否推演 | ✅ 完整可玩 | ✅ 完整可玩 |
| 这一局被记住 | ❌ | ✅ 存入账号 |
| 跨设备可见 | — | ✅ |
| 下一局有前世遗念 | ❌ | ✅ |

身份用知乎的 `url_token`（个人主页永久标识）而非昵称——昵称可改可重复，当主键会让同名用户互相读到对方的记忆；取不到时宁可不存。服务端按账号隔离落盘（原子写入，保留最近 20 局）。

产品取向是**用损失感驱动登录，不用门槛拦人**：游客不被弹窗拦住，但首页与结算页会如实告知代价。

**种子挑战裂变** — `app/challenge/page.tsx`
每一局生成唯一宇宙种子，**同一颗种子 = 同一组骰面**（确定性设计是它成立的前提）。终局复制挑战链接，对方打开看到的是带目标、出身、战绩的挑战卡，点「接受挑战」用同一颗种子进入推演舱，成绩完全可比。

**设计令牌体系** — `DESIGN.md`
9 章设计规范：颜色全部 CSS 变量零硬编码 hex、完整组件状态表、动效档位与性能红线、10 条 Don'ts。代码与规范可逐条对照审计。

---

## 目录结构

```
src/
├── features/
│   ├── decision-session/     # 新主链状态中心：来源 → 事实 → 路径 → 世界蓝图 → 实验
│   │   ├── domain.ts         # EvidenceFact / PathCluster / RealityExperiment / DecisionSession
│   │   ├── facts.ts          # 快照 → 可追溯事实（只记原文写出的值，不造精度）
│   │   ├── routes.ts         # 问题专属路径聚类（按问题类型 + 走法信号）
│   │   ├── clarify.ts        # 固定三问 + 7 天实验生成（已降级为旧会话的 fallback）
│   │   ├── understood.ts     # 「我听懂的是」（确定性复述，不经模型）
│   │   ├── store.ts          # Repository 接口 + 文件 / 内存实现
│   │   ├── service.ts        # 五步闭环用例（create 只框定问题，检索推迟到 prepare-world）
│   │   ├── experiment.ts     # 未知驱动的现实实验（P1-1：类型决定实验形态）
│   │   ├── liveSearch.ts     # 知乎实时检索适配（来源层）
│   │   ├── api.ts            # 统一 ApiResult 与状态码
│   │   └── components/       # UnderstandingPanel / PathCardView / EvidenceDrawer / ExperimentCard
│   ├── experience/           # 经验引擎（新主链）：问题框定 / 动态澄清 / 多意图检索
│   │   ├── frame.ts          # ProblemFrame：区分「用户原话（hard）」与「解析推断」
│   │   ├── clarification.ts  # 动态澄清（0～2 条，说过不问）
│   │   ├── queryPlan.ts      # 检索计划：三种强制意图，预算 3–4
│   │   ├── retrieve.ts       # 多意图检索执行：并发 ≤2、去重合并、封顶 12
│   │   ├── searchCache.ts    # 检索结果落盘缓存（TTL 12h，重启不烧配额）
│   │   ├── extract.ts        # 经验片段提取（模型只有提议权）
│   │   ├── validate.ts       # 逐字校验：exactQuote 必须是原文子串，不过即丢
│   │   ├── cases.ts          # 片段 → 经历（只 group / sort，不发明内容）
│   │   ├── pathSynthesis.ts  # 动态路径：模型只分组，验证不过回落 legacy
│   │   ├── legacyAdapter.ts  # 固定走法表 → ExperiencePath 的 fallback 桥
│   │   └── compare.ts        # 用户差异：数值算术 / 逐字命中，否则 unknown
│   ├── game-world/           # 世界蓝图编译层：经验 → 游戏
│   │   ├── domain.ts         # WorldBlueprint / WorldActSpec / ExperienceChoiceUnlock
│   │   ├── compileWorld.ts   # 纯函数编译：固定三幕（反例幕有四轮来源优先级）+ 经验卡 + 解锁 + 现实边界
│   │   ├── dmContext.ts      # 每幕世界上下文切片 + 解锁时机（纯函数）
│   │   ├── questView.ts      # 终局现实支线视图模型（P1-2：回顾条目必须有出处）
│   │   └── experienceUnlock.ts # 经验解锁注入规则（选项 <3 才插入）
│   ├── reality-memory/       # 现实记忆：实验观测 → 跨局硬条件
│   │   ├── domain.ts         # RealityMemoryEntry / ExperimentResult
│   │   ├── service.ts        # 结果 → 记忆（只有观测才能升级置信度）
│   │   └── store.ts          # 仓储接口 + 文件 / 内存实现
│   └── run/                  # 证据契约、知识来源、现实清单等运行层契约
├── app/
│   ├── page.tsx              # 命运发令台（街机控制台 + 人生裂缝大厅）
│   ├── play/page.tsx         # ★ 推演舱（HUD + 舞台 + 对话框）
│   ├── session/[id]/page.tsx # 世界生成中转站：澄清 → prepare-world → 进入世界（路径与证据折叠在下方）
│   ├── journal/page.tsx      # 选择日志（我在纠结什么、做了什么、结果如何）
│   ├── compare/page.tsx      # 双牌对比：同一份证据、两组条件
│   ├── archive/page.tsx      # 推演档案
│   ├── commitment/page.tsx   # 赛博契约（七天回执）
│   ├── challenge/page.tsx    # 种子挑战落地页
│   ├── oauth/page.tsx        # 知乎账号接入面板
│   ├── settings/page.tsx     # 应用内密钥配置
│   ├── auth/callback/route.ts # OAuth 回调
│   └── api/
│       ├── dm/route.ts       # AI DM 接口（永远 200 + 合法关卡）
│       ├── mesh/route.ts     # 证据网格（含黄金案例快照反查）
│       ├── sessions/route.ts # 建会话 / 列会话
│       ├── sessions/[id]/route.ts # 读会话 / 推进流程（含 prepare-world 编译世界蓝图）/ 删除
│       ├── boss/evaluate/route.ts # 终局判卷
│       ├── commitment/route.ts    # 承诺与回执
│       ├── profile/ · report/ · health/ · memory/ · settings/
│       ├── zhihu/hot/route.ts     # 知乎热榜代理
│       └── oauth/            # status / session / start / run-all / logout
├── components/
│   ├── characters/           # 参数化 SVG 立绘 + 表情库（含刘看山）
│   ├── scenes/               # 分层场景舞台
│   ├── effects/              # 受击飘字 / 幕转场 / 神经信号加载
│   ├── worldline/            # 世界线统一组件 + 临界翻转演出
│   ├── archive/              # 档案形态的证据记录
│   ├── DialogueBox.tsx       # 打字机对话框
│   ├── GameHud.tsx           # HUD（血条 + 分段幕次进度）
│   ├── DiceModal.tsx         # 命运掷骰 / 现实裁决演出
│   ├── FateTree.tsx          # SVG 命运树
│   ├── InventoryBar.tsx      # 三槽位遗物栏
│   ├── SourceBadge.tsx       # 知乎溯源角标
│   └── game/                 # ExperienceSourceModal（经验解锁来源）/ RealityQuestPanel（终局现实支线）
├── core/
│   ├── evidence/             # 检索规划 / 证据网格 / 事实强度
│   ├── decision/             # 四轴 / 裁决 / 认知账本 / 承诺
│   ├── run/                  # 运行模式 / 幕次引擎 / 命运事件牌组
│   ├── d20.ts                # 检定引擎
│   ├── relics.ts             # 遗物与属性结算
│   ├── narrative.ts          # 叙事编排
│   ├── memory.ts             # 跨周期记忆 / 决策画像 / 前世遗念
│   ├── oauth/zhihu.ts        # 知乎 OAuth 协议核心
│   ├── zhihu/                # 搜索 / 热榜客户端
│   └── dm/                   # AI DM 五层防御
├── data/
│   ├── demoCases.ts          # 黄金案例（含口语化匹配短语）
│   ├── zhihuSources.generated.json # 真实抓取的来源快照
│   ├── prebuiltScenarios.ts  # 预置剧本（4 幕）+ 遗物库
│   ├── origins.ts            # 出身流派
│   ├── characters.ts         # 角色库
│   └── scenes.ts             # 场景库
└── types/                    # 类型契约（evidence / game / fate / narrative）

```

根目录与文档：

```
├── DESIGN.md                 # 唯一设计文档：产品定义 + 游戏机制 + 技术架构 + 视觉规范
├── ZhihuRelic-D20-Spec.ts    # D20 与遗物的纯契约规范（12 条不变量）
├── 产品说明计划书.md          # 参赛必交材料
├── Dockerfile                # 多阶段生产镜像（standalone，57MB）
├── docker-compose.yml        # 单实例编排（保 OAuth 内存会话）
├── scripts/test-stats.json   # 测试统计（唯一口径，由 npm run test:stats 生成，不手写数字）
└── tests/
```

---

## 已知限制

- **AI DM 单关耗时受输出长度主导**：一个完整关卡 JSON 约 600 字，生成时间随模型吞吐线性增长。3 分钟演示建议走离线精调剧本（零延迟），自由推演用 CRT 神经信号加载动效承接等待。
- 模型偶尔会编造遗物 id（实测 `relic-code-bible`），校验层会静默丢弃该掉落并保住整个关卡——这是防御正常工作的表现，但也意味着 AI DM 的掉落率偏低。
- 遗物「套装共鸣」、双骰检定、知识图谱复盘、宿命分歧点等机制尚未实现。
- **关注流接口尚未接入**：知乎开放平台只公开了搜索与热榜的绝对路径，关注关系类接口未开放；本作品也不接「盐选故事」——那是虚构文学，混进「真人经历」会直接破坏这个作品最核心的诚信纪律。
- **账号登录需先部署**：OAuth 回调要求公网 HTTPS，本地 `127.0.0.1` 只能预览面板，授权按钮保持禁用。真实登录须先部署并登记回调地址。
- **OAuth Token 存在进程内存**：多实例或 Serverless 冷启动会导致会话丢失，黑客松联调可接受，生产需换共享存储。

---

## 致谢

- 设计规范产出流程参考 `web-design` skill 的两阶段工作流（先 DESIGN.md，后代码）。
- 中文衬线体使用 Noto Serif SC；动效全部为原生 CSS keyframes，未引入动画库。
