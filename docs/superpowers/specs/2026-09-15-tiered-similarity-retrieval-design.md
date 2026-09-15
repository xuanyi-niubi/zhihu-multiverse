# 分层相似经历检索设计

日期：2026-09-15

状态：产品与视觉方向已确认，待实施

范围：Experience Engine 的意图理解、查询规划、来源资格审查、结果呈现、叙事型星系背景与回归测试

## 1. 背景与问题

当前检索会把用户问题中的通用二字词组当作主要相关性信号。例如“我是电工专业，想转导游”可能因为“专业、转行、工作、选择”等弱词命中大量无关回答。与此同时，检索轨道按照查询目的分配，某条来源只要来自 `similar-person` 查询且命中任意宽泛条件，就可能被展示为“与你相似”。

这个行为违反产品的证据纪律：查询目的只能说明“为什么搜它”，不能证明“它与用户有多相似”。系统也不应为了填满相似、替代、反例三条轨道，把普通转行故事冒充同路经历。

本次改造的目标是：优先寻找完全同路者；找不到时有秩序地放宽起点身份，继续提供真实且有用的相邻经验；始终保留目标方向与逐字引用，不允许 AI 编造经历。

## 2. 产品原则

1. **目标优先**：对于“电工转导游”，`导游`是相似经验的硬条件。只有起点可以分层放宽。
2. **一次只放宽一层**：依次从“电工”放宽为“电气类”“工科”“其他背景”，不能直接退化为任意转行。
3. **查询不等于结论**：来源的相似等级由其正文内容独立判定，不能继承查询的 `purpose`。
4. **证据仍来自知乎**：AI 只负责理解问题、归一化概念和辅助分类；用户可见的经历、作者、原文和链接必须来自可核验来源。
5. **找不到也说清楚**：没有完全同路者时明确提示，同时展示已找到的较低等级来源及其差异；没有达到最低门槛的来源就不展示。
6. **反例独立**：相似等级与“支持、替代、反例”是两条正交维度。反例不能因为结局不同就被判为不相似。

## 3. 相似等级

新增用户可理解、内部可计算的 `SimilarityTier`：

| 等级 | 定义 | “电工转导游”示例 | 用户文案 |
|---|---|---|---|
| `exact` | 起点与目标都精确命中，并存在亲历转变 | 电工转导游 | 完全同路 |
| `same-family` | 目标精确命中，起点属于同一职业/专业族 | 电气、自动化转导游 | 相似起点 |
| `same-domain` | 目标精确命中，起点属于同一上位领域 | 机械、土木等工科转导游 | 同类背景 |
| `same-target` | 目标精确命中，但起点属于其他领域 | 教师、会计转导游 | 相同终点 |
| `adjacent-target` | 目标为明确相邻职业，且是亲历转变 | 工科转领队或旅游从业者 | 相邻路径 |
| `unrelated` | 未满足以上任一条件 | 普通转行、人生建议 | 不展示 |

最低准入规则：`same-target` 及以上优先进入相似经历层；只有这些结果不足时，才允许用 `adjacent-target` 补充，并明确标为“相邻路径”。`unrelated` 永不进入经验层。

等级不是成功概率，也不显示伪精确百分比。

## 4. 意图模型

在 `ProblemFrame` 与 `SearchPlan` 之间增加独立的 `TransitionIntent`：

```ts
interface TransitionIntent {
  origin: ConceptTerms;
  target: ConceptTerms;
  transition: 'career-change' | 'major-change' | 'entry' | 'choice' | 'other';
}

interface ConceptTerms {
  exact: readonly string[];
  family: readonly string[];
  domain: readonly string[];
  adjacent: readonly string[];
}
```

以“我是电工专业，想转导游”为例：

- `origin.exact`：电工、电工专业
- `origin.family`：电气、电气工程、自动化、维修电工
- `origin.domain`：工科、工程类、技术工种
- `target.exact`：导游、导游员
- `target.adjacent`：领队、旅行社、旅游从业
- `transition`：career-change

确定性解析只识别通用语言结构，例如“我是 X，想转 Y”“要不要做 Y”“从 X 换到 Y”，不保存职业、专业或人生主题清单。它只从用户原话得到 `exact`。

首次精确检索不足时，才调用一次低成本模型生成 `family/domain/adjacent`。模型输出只是检索提示，必须经过数组数量、词长、泛词和重复项校验；不能被提升为用户硬条件。模型不可用时只保留用户原词，不凭空猜测相似领域。

`TransitionIntent` 只服务检索与来源分类，不能被提升为用户硬约束，也不能改变 `ProblemFrame` 中事实来源的纪律。

## 5. 查询规划

查询规划改为“精确优先、结果不足才扩展”，每个查询携带预期层级，但预期层级不决定最终分类：

1. 精确同路：`电工 转导游 亲身经历 后来`
2. 同族起点：`电气 自动化 转导游 亲身经历`
3. 同域起点：`工科 转导游 亲身经历`
4. 相同终点/反例：`非旅游专业 做导游 后悔 退出 经历`

为保护知乎与模型配额，单次准备世界仍受 `MAX_SEARCH_REQUESTS=4` 限制：

1. 立即执行一条 exact 查询，同时不调用模型。
2. exact 得到至少两位合格亲历者时，跳过 AI，只执行 alternative 与 counterexample，总计三条知乎请求。
3. exact 不足时，调用一次短 JSON 语义扩展，再执行 relaxed-origin、alternative、counterexample，总计不超过四条知乎请求。
4. 扩展调用最多等待 4 秒，输出不超过约 250 tokens；同一归一化问题缓存 24 小时。

语义扩展结果同时供查询、来源分级、反例词和结果文案使用，不对每条知乎回答分别调用模型。

`SearchQuery` 增加：

```ts
expectedTier?: SimilarityTier;
```

它只用于日志和诊断，不能直接写进来源资格结果。

## 6. 来源资格审查

资格审查拆成三个独立判断：

1. **真实性**：是否为第一人称亲历、是否包含行动或结果、是否存在高风险推广。
2. **转变相关性**：是否明确提及目标、进入/转向动作，以及起点或背景。
3. **相似等级**：根据正文真实命中的起点与目标概念计算 `SimilarityTier`。

相似来源的硬规则：

- `exact`：命中 `origin.exact` + `target.exact` + 转变动作。
- `same-family`：命中 `origin.family` + `target.exact` + 转变动作。
- `same-domain`：命中 `origin.domain` + `target.exact` + 转变动作。
- `same-target`：命中 `target.exact` + 转变动作，并且正文能确认作者来自其他背景。
- `adjacent-target`：命中 `target.adjacent` + 转变动作。
- 只命中“转行、选择、工作、专业”等通用词时为 `unrelated`。

现有字符二元组分数可以保留为同等级内排序信号，但不再决定准入。`topicRelation: partial` 也不能单独让来源进入经验层。

`SourceQualification` 增加：

```ts
similarityTier: SimilarityTier;
matchedOriginTerms: readonly string[];
matchedTargetTerms: readonly string[];
```

`assignedTrack` 仍表达“相似/替代/反例”叙事角色，但必须在相似等级判定之后生成。来自相似查询却被判为 `unrelated` 的来源直接淘汰。

## 7. 选择与降级策略

`retrieveExperienceSources` 不再按轨道硬凑数量，改为：

1. 合并去重全部候选。
2. 独立资格审查并计算相似等级。
3. 淘汰 `unrelated`、非亲历和高风险推广。
4. 相似轨道按 `exact → same-family → same-domain → same-target → adjacent-target` 依次选择。
5. 同一作者仍只保留一条。
6. 替代与反例从合格来源中独立选择；缺少某轨道就如实留空。

推荐相似轨道最多三人：优先放入最高等级，只有人数不足时才进入下一等级。系统不得因为数量不足跳过更高等级来源，也不得用不合格来源补满。

检索结果增加聚合状态：

```ts
interface SimilaritySummary {
  exactCount: number;
  bestAvailableTier: SimilarityTier | null;
  widened: boolean;
}
```

它用于生成诚实的运行记录和 UI 文案，不参与世界结论。

## 8. 用户体验

真实人生显影页按最优可用层级说明结果：

- 有 `exact`：`找到 2 位与你走过同一转变的人。`
- 无 `exact`、有 `same-family/same-domain`：`没有找到“电工转导游”的完整亲历；先看工科背景进入导游行业的人。`
- 只有 `same-target`：`没有找到相似起点；这里是其他背景进入导游行业的经历。`
- 只有 `adjacent-target`：`没有找到导游亲历；以下是进入相邻旅游职业的经验。`
- 全部为空：`暂未找到达到最低相关门槛的亲历，我们不会用普通转行故事补齐。`

每张来源卡显示一个简短标签：完全同路、相似起点、同类背景、相同终点或相邻路径。详情弹层继续展示“与你相同 / 与你不同 / 尚不确定”，并增加实际命中的起点和目标词，帮助用户判断是否值得参考。

第三幕和 Reality Pass 可以使用较低层级的真实来源，但报告必须保留相似等级，不能把“相同终点”改写成“与你一样的人”。

## 9. 失败与回退

- 画像模型不可用：使用确定性解析；认识的概念按词典扩展，不认识的概念只做精确检索。
- 知乎某一路失败：记录 `failed`，其余查询继续；不能把上游错误描述成“知乎上不存在”。
- 有候选但全部不合格：记录 `no-qualified-person`，展示“搜到了内容，但没有可核验亲历者”。
- 精确层为空但低层有结果：记录 `widened: true`，页面明确说明已经放宽起点。
- 所有层为空：保留 Unknown Lock，并把“寻找真实从业者核实”编成现实实验，不生成假经历。

## 10. 代码边界

预计涉及：

- `src/core/dm/profile.ts`：增加不依赖主题词典的通用“当前处境 → 目标”句式提取。
- `src/features/experience/domain.ts`：增加 `TransitionIntent`、`SimilarityTier` 和结果摘要类型。
- `src/features/experience/transitionIntent.ts`：新增通用端点提取、模型扩展校验与 24 小时缓存；不保存主题词典。
- `src/features/experience/queryPlan.ts`：生成精确与分层放宽查询。
- `src/features/experience/qualification.ts`：以端点命中为硬门槛，独立计算相似等级。
- `src/features/experience/retrieve.ts`：按等级渐进选择，不再用弱相关结果补轨道。
- `src/features/decision-session/service.ts`：记录最优层级、是否放宽以及诚实文案。
- `src/components/visual/ExperienceReveal.tsx`、来源详情组件：显示等级与降级原因。

不改动知乎 OAuth、逐字引用校验、经验事实结构、三幕编译规则和部署架构。

## 11. 测试与验收

新增或更新纯函数测试：

1. “电工专业想转导游”被解析为起点电工、目标导游。
2. 查询顺序包含精确、工科放宽、替代、反例，且不出现泛化的“做出改变”。
3. “电工转导游”来源为 `exact`。
4. “自动化专业转导游”为 `same-family` 或 `same-domain`（按词典定义固定）。
5. “机械专业转导游”为 `same-domain`。
6. “会计转导游”为 `same-target`。
7. “程序员转产品经理”对该问题为 `unrelated` 并被淘汰。
8. 只命中查询目的、未命中正文端点的来源不能进入相似轨道。
9. exact 为空时按层级选择相似来源，并生成 `widened: true`。
10. 三条轨道任何一路为空时不补造来源。
11. 来源逐字引用、作者去重、请求预算与失败隔离的既有测试继续通过。
12. ExperienceReveal 在各种最优层级下显示对应的诚实文案。
13. exact 已有两位合格亲历者时模型调用为 0；不足时最多调用 1 次；缓存命中时为 0。
14. “搬宿舍、结束关系、休学创业”等非职业问题同样能生成开放式端点，不依赖预设主题。

最终验收场景：输入“我是电工专业，想转导游”。如果知乎没有电工转导游，页面不得出现无关转行经历；可以依次展示电气/工科转导游、其他背景转导游和明确标注的相邻旅游职业经历，并能打开知乎原文核验。

## 12. 非目标

- 不让 AI 生成、补写或改写知乎经历。
- 不引入向量数据库或新的长期存储。
- 不取消相似、替代、反例三视角。
- 不把内部相似等级展示为成功率或人生匹配分。
- 不为了凑数量扩大到与目标职业无关的泛转行内容。

## 13. 叙事型星系背景

### 13.1 目标

背景不再只是静态暗色材质，而要参与“寻找真实人生 → 编译平行宇宙 → 回到现实”的叙事。它仍然是内容的背景，不能抢走正文层级，也不能重现高负载动画造成的等待感。

参考 `shisui04-rgb/galaxy` 的空间层次、轨道和星体概念，但不复制其 2000 个 DOM 星星与逐帧位置更新实现。项目是手机端优先，所有持续动画必须保持轻量、确定性并可停止。

### 13.2 页面状态

同一个 `CelestialBackdrop` 组件通过场景参数表达不同阶段：

| 场景 | 视觉内容 | 叙事作用 |
|---|---|---|
| `observatory` | 偏心暗色主星、两层轨道、稀疏星尘、低饱和青蓝星云 | 用户正在观测可能的人生 |
| `retrieving` | 三颗轨道星体分别对应相似、替代、反例，并随真实检索状态点亮 | 让检索进度有真实含义 |
| `simulation` | 背景整体降暗，只保留远处星球弧面和世界线 | 保持推演文字可读 |
| `returning` | 星空向边缘退去，中央让位给暖色纸式 Reality Pass | 表达从平行宇宙返回现实 |

星体点亮必须来自已经结算的检索状态，不能伪造进度。没有找到某一类来源时，对应轨道保持暗淡或出现断线，不用假成功动画补齐。

### 13.3 技术方案

新增一个 SVG/CSS 背景组件，而不是 Canvas 粒子引擎：

- 星点使用一组固定坐标的 SVG `circle`，确保服务端与客户端一致且每次刷新构图稳定。
- 星球使用 SVG 圆、径向渐变与遮罩形成明暗面。
- 轨道使用少量 SVG path；运动只改变外层 `transform` 与 `opacity`。
- 星云使用最多两层 CSS radial-gradient，不使用实时 blur 计算和外部位图。
- 不监听鼠标移动；桌面端可保留极弱的 CSS 层差，不运行逐帧 JavaScript。
- 组件 `pointer-events: none`、`aria-hidden: true`，不干扰交互和读屏。

现有 `OrbitField` 和 `WorldlineField` 的路径语言应被复用或收敛进该组件，避免背景层继续叠加。页面只能挂一个主要空间背景，`AuroraBand` 作为状态色可以保留，但必须降低不透明度。

### 13.4 性能预算

手机端为硬约束：

- 360–430px 宽度下最多 36 个星点、2 条主轨道和 2 个可见星体。
- 桌面端最多 72 个星点、3 条主轨道和 3 个可见星体。
- 不创建持续 `requestAnimationFrame` 循环。
- 持续动画只允许 `transform` 与 `opacity`，单轮时长不少于 45 秒。
- 页面处于后台时依靠 CSS/浏览器调度自然暂停，不注册全局计时器。
- `prefers-reduced-motion: reduce` 或站内减少动画设置开启时，取消公转、闪烁和星云漂移，仅保留静态构图。
- 背景不得引入外部图片、字体或运行时网络请求。

### 13.5 视觉纪律

- 主色仍以 `--sil-*` 为唯一事实源，不引入另一套调色板。
- 已验证相似来源用知乎蓝；替代路径用青绿；反例用暗红。
- 星球保持低饱和、大面积阴影和细轨道，禁止彩虹色随机星球。
- 页面正文与交互层必须维持现有对比度，背景在内容区域自动压暗。
- Reality Pass 暖色纸张内部不出现星尘；星空只留在纸张外沿，突出“交还现实”。

### 13.6 预计代码边界

- `src/components/visual/CelestialBackdrop.tsx`：新增统一空间背景及场景契约。
- `src/features/visual/celestial.ts`：固定星点、星体与场景配置的纯数据。
- `src/app/silver.css`：补充星体、轨道和场景过渡样式及完整 reduced-motion 降级。
- `src/app/page.tsx`：以 `observatory` 替换当前叠加的独立背景层。
- `src/components/visual/WorldForge.tsx` 或会话编译页：接入 `retrieving` 和真实三轨状态。
- `src/components/game/session/SessionPlayScreen.tsx`：接入低干扰的 `simulation`。
- `src/components/visual/RealityPass.tsx`：接入 `returning` 外沿效果，不修改暖色纸主体。

### 13.7 视觉验收

1. 首页在手机宽度下第一屏仍以标题和输入为主，星球不会压住文字。
2. 编译页三个星体的明暗与真实 `found` 状态一致。
3. 推演页长文阅读时没有高亮星体穿过文字区域。
4. 暖色终局纸张与黑色星空有明确材质对比。
5. 360px、390px、430px 三档手机宽度没有横向溢出。
6. 减少动画模式下画面完全静止且信息不丢失。
7. 背景组件不创建 rAF、定时器或外部请求。
8. 构建后的首页 First Load JS 不因背景增加超过 5KB gzip。
