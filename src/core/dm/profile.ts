import { safeParseJson } from '@/core/dm/parse';

import type { DmModelClient } from '@/core/dm/provider';

/**
 * 玩家处境解析。
 *
 * 产品逻辑：用户输入的是一句自然语言（「大三法学，想转计算机，但怕脱产找不到工作」），
 * 但剧情不该直接拿这句话去套通用桥段——应该先把这句话**读成一份处境档案**，
 * 再让每一幕的冲突都从这份档案里长出来。终局报告同理，只有报告贴着玩家真实处境写，
 * 才有「这份指南是给我的」的感觉。
 *
 * 两条路径（按优先级）：
 * 1. **结构化路径（主路径）**：让模型直接输出 JSON 处境档案。适用于指令服从度高、
 *    支持 `json_object` 的模型（DeepSeek / OpenAI 等）——见 `PROFILE_JSON_PROMPT`。
 * 2. **自由文本路径（回退）**：模型不肯给 JSON 时，换一段散文分析 Prompt 再问一次，
 *    把它写的分析原文直接当上下文注入剧情 Prompt；若它恰好按逐行键值写了，
 *    顺手用 `parseProfileText` 解析成结构化档案。
 * 3. **确定性兜底**：模型不可用或输出过短时，用下面的关键词规则现算一份结构化档案，
 *    保证「没有模型也能玩」，同时让这层逻辑可以单测。
 */

export type RiskAppetite = 'low' | 'medium' | 'high';

export interface PlayerProfile {
  /** 现状：专业 / 身份 / 年级，例如「法学 大三学生」。 */
  readonly background: string;
  /** 目标：想做什么，例如「转计算机」。 */
  readonly target: string;
  /** 客观约束：脱产风险、家庭期待、时间窗口等。 */
  readonly constraints: readonly string[];
  /** 主观恐惧：怕什么、焦虑什么。 */
  readonly fears: readonly string[];
  /** 可动用资源：已学过什么、有什么底牌。 */
  readonly resources: readonly string[];
  /** 核心矛盾一句话，用于提示模型「这一幕要围着它转」。 */
  readonly keyTension: string;
  readonly riskAppetite: RiskAppetite;
  /** 四幕的冲突主题，由约束与恐惧推导。 */
  readonly arc: readonly string[];
}

const BACKGROUNDS: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['法学', '法律'], label: '法学' },
  { match: ['中文', '汉语言', '文科', '历史', '哲学', '新闻'], label: '文科' },
  { match: ['计算机', '软件', '计科', 'cs', 'CS'], label: '计算机' },
  { match: ['机械', '车辆', '材料', '土木', '船舶', '航空', '农学', '农业', '化工'], label: '工科' },
  { match: ['医学', '临床', '护理', '药学'], label: '医学' },
  { match: ['会计', '金融', '经济', '管理', '工商'], label: '商科' },
  { match: ['英语', '日语', '外语', '翻译'], label: '外语' },
  { match: ['数学', '物理', '化学', '生物'], label: '理科' },
  { match: ['专科', '大专', '职高'], label: '专科' },
  { match: ['双非', '二本', '三本'], label: '双非本科' },
];

const GRADES: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['大一'], label: '大一' },
  { match: ['大二'], label: '大二' },
  { match: ['大三'], label: '大三' },
  { match: ['大四'], label: '大四' },
  { match: ['研一', '硕士一年级'], label: '研一' },
  { match: ['研二', '研三'], label: '研究生' },
  { match: ['应届', '毕业'], label: '应届/刚毕业' },
  { match: ['工作', '在职', '跳槽'], label: '在职' },
];

const TARGETS: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['转码', '转计算机', '做程序员', '后端', '前端', '算法'], label: '转入技术岗' },
  { match: ['产品经理', '做产品', '产品岗'], label: '转产品方向' },
  { match: ['考研', '二战', '调剂', '上岸'], label: '考研上岸' },
  { match: ['保研', '推免'], label: '争取保研' },
  { match: ['实习', '秋招', '春招', '求职', '找工作', '大厂', 'offer'], label: '拿到理想 offer' },
  { match: ['留学', '出国', '申请', '雅思', '托福'], label: '出国留学' },
  { match: ['考公', '考编', '公务员', '事业编'], label: '考公考编' },
  { match: ['跳槽', '涨薪', '晋升'], label: '职业跃迁' },
];

const CONSTRAINT_RULES: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['脱产', '全职备考'], label: '不能脱产，需要一边维持收入/学业一边准备' },
  { match: ['家里', '父母', '家人', '妈妈', '爸爸'], label: '家庭期待构成压力' },
  { match: ['经济', '钱', '学费', '贷款', '负担'], label: '经济条件不允许试错太久' },
  { match: ['年龄', '快 30', '快30', '不小了'], label: '年龄窗口在收窄' },
  { match: ['时间', '来不及', '只剩', '没时间'], label: '时间窗口紧' },
  { match: ['绩点', '成绩', '排名'], label: '成绩排名不占优' },
  { match: ['双非', '专科', '二本', '三本'], label: '第一学历不占优' },
  { match: ['二战', '复读'], label: '已经失败过一次，心理与时间成本更高' },
  { match: ['跨专业', '跨考', '非科班', '零基础'], label: '跨专业，缺少体系化基础' },
];

const FEAR_RULES: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['怕找不到', '找不到工作', '就业'], label: '怕投入之后仍然找不到工作' },
  { match: ['怕', '担心', '焦虑', '慌'], label: '对结果的不确定性感到焦虑' },
  { match: ['迷茫', '不知道', '纠结', '犹豫'], label: '方向未定，怕选错' },
  { match: ['后悔', '沉没成本', '白费'], label: '怕之前的投入变成沉没成本' },
  { match: ['卷', '内卷', '同辈', '室友', '同学都'], label: '同辈压力让你怀疑自己的节奏' },
  { match: ['撑不住', '崩', '抑郁', '心态'], label: '担心自己扛不住这段压力' },
];

const RESOURCE_RULES: readonly { readonly match: readonly string[]; readonly label: string }[] = [
  { match: ['有基础', '学过', '自学', '刷题', '力扣', 'leetcode'], label: '已经有一点自学基础' },
  { match: ['项目', '开源', 'github', 'PR'], label: '手上有可讲的项目' },
  { match: ['实习'], label: '有过实习经历' },
  { match: ['offer'], label: '手上有其他选择作为底牌' },
  { match: ['竞赛', '比赛', '获奖'], label: '有竞赛/获奖经历' },
  { match: ['英语好', '雅思', '托福'], label: '英语是加分项' },
  { match: ['导师', '学长', '学姐', '朋友'], label: '有可以请教的人' },
];

function collect(
  text: string,
  rules: readonly { readonly match: readonly string[]; readonly label: string }[],
): string[] {
  const hits: string[] = [];
  rules.forEach((rule) => {
    if (rule.match.some((keyword) => text.includes(keyword)) && !hits.includes(rule.label)) {
      hits.push(rule.label);
    }
  });
  return hits;
}

function firstLabel(
  text: string,
  rules: readonly { readonly match: readonly string[]; readonly label: string }[],
): string | null {
  for (const rule of rules) {
    if (rule.match.some((keyword) => text.includes(keyword))) {
      return rule.label;
    }
  }
  return null;
}

/** 从自由文本里抽出结构化处境。纯函数，无网络调用。 */
export function extractProfile(goal: string): PlayerProfile {
  const text = goal.trim();

  const backgroundLabel = firstLabel(text, BACKGROUNDS);
  const gradeLabel = firstLabel(text, GRADES);
  const targetLabel = firstLabel(text, TARGETS);

  const background = [backgroundLabel, gradeLabel].filter(Boolean).join(' ') || '背景未明确';
  const target = targetLabel ?? (text.length > 0 ? '做出一个改变现状的决定' : '尚未明确');

  const constraints = collect(text, CONSTRAINT_RULES);
  const fears = collect(text, FEAR_RULES);
  const resources = collect(text, RESOURCE_RULES);

  const riskAppetite: RiskAppetite =
    /(怕|不敢|稳妥|保守|保险|求稳)/.test(text)
      ? 'low'
      : /(赌|拼|死磕|硬刚|梭哈|豁出去)/.test(text)
        ? 'high'
        : 'medium';

  const keyTension =
    constraints.length > 0 && fears.length > 0
      ? `想${target}，但${constraints[0]}；同时${fears[0]}。`
      : constraints.length > 0
        ? `想${target}，但${constraints[0]}。`
        : fears.length > 0
          ? `想${target}，但${fears[0]}。`
          : `想${target}，但不确定自己配不配得上。`;

  const arc = [
    `起步：在「${background}」的现状里迈出第一步，直面${fears[0] ?? '对未知的恐惧'}`,
    `现实打击：${constraints[0] ?? '准备不足'}带来的第一次具体挫败`,
    `外部压力：${constraints[1] ?? fears[1] ?? '身边人的节奏'}逼近，必须在取舍间做决定`,
    `收束：把${target}落地，并回应「${keyTension}」`,
  ];

  return { background, target, constraints, fears, resources, keyTension, riskAppetite, arc };
}

/** 渲染成 Prompt 里的一段，供 AI DM 与复盘共用。 */
export function profileToPromptBlock(profile: PlayerProfile): string {
  const list = (items: readonly string[]): string => (items.length > 0 ? items.join('；') : '未提及');

  return `【结构化处境档案（确定性解析，作为补充）】
- 现状：${profile.background}
- 目标：${profile.target}
- 客观约束：${list(profile.constraints)}
- 主观恐惧：${list(profile.fears)}
- 可动用资源：${list(profile.resources)}
- 核心矛盾：${profile.keyTension}
- 风险偏好：${profile.riskAppetite === 'low' ? '偏低（怕输）' : profile.riskAppetite === 'high' ? '偏高（敢赌）' : '中性'}
- 四幕冲突设计（按序推进，不得跳步或套用无关桥段）：
  1. ${profile.arc[0]}
  2. ${profile.arc[1]}
  3. ${profile.arc[2]}
  4. ${profile.arc[3]}`;
}

/** 给报告用的一句话处境摘要。 */
export function profileToSummary(profile: PlayerProfile): string {
  return `${profile.background}，想${profile.target}。${profile.keyTension}`;
}

/* -------------------------------------------------------------------------- */
/* 开放路径：让模型读懂玩家原话                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 结构化处境解析 Prompt。
 *
 * 给「指令服从度高、支持 json_object」的模型用（DeepSeek / OpenAI 等）。
 * 知乎直答不认这套（实测它会写成 1400 字 markdown 长文），那里走自由文本路径。
 */
export const PROFILE_JSON_PROMPT = `你负责把用户的一句自我描述读成一份结构化处境档案。

只输出一个 JSON 对象，不要 markdown 围栏、不要任何解释：
{
  "background": "现状：专业/身份/年级，用他自己的领域词，2-20 字",
  "target": "目标：他真正想做的事，2-20 字",
  "constraints": ["客观限制，0-4 条"],
  "fears": ["主观恐惧，0-4 条"],
  "resources": ["可动用底牌，0-4 条，没有就空数组"],
  "keyTension": "一句话点出核心矛盾（想做什么 × 卡在哪里），10-40 字",
  "riskAppetite": "low | medium | high",
  "arc": ["第1幕冲突主题", "第2幕", "第3幕", "第4幕"]
}

要求：用他原话里的具体信息，不要泛化成「学生」；arc 四幕要围绕 constraints/fears，第 4 幕回应 keyTension；没提到的不要编造。`;

/** 自由文本处境分析 Prompt（知乎直答等对话模型用）。 */
export const PROFILE_ANALYSIS_PROMPT = `你是一位做过多年校园生涯咨询的知乎答主。用户会用一句话描述自己当下的处境。

请写一段 150-250 字的处境分析，帮后面生成推演剧情的人看懂这个人。内容必须覆盖：
1. 他的现状与真正想去的地方（用他自己提到的领域词，不要泛化成「学生」）。
2. 客观约束（钱、时间、家庭、学历、专业门槛等）。
3. 主观恐惧（他最怕什么）。
4. 可动用的底牌。
5. 核心矛盾一句话。
6. 他这四步大概会怎么走：起步 → 第一次受挫 → 外部压力 → 收束。

直接写正文，不要标题、不要 markdown、不要分点符号、不要问他问题。`;

export function buildProfileUserMessage(goal: string): string {
  return `用户原话：${goal.trim() || '（空）'}

请写这段处境分析。`;
}

function truncateText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function splitList(value: string | null, cap = 4): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;；、,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, cap);
}

/**
 * 解析「逐行键值」格式。模型偶尔会主动这么写，这时能顺手拿到结构化档案。
 * 容错：markdown 粗体/标题符号、全角冒号、列表符号、分号或顿号分隔。
 */
export function parseProfileText(raw: unknown): PlayerProfile | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const text = raw.replace(/\*/g, '').replace(/^#+\s*/gm, '');
  const fields = new Map<string, string>();

  text.split(/\r?\n/).forEach((line) => {
    const match = /^\s*[-•]?\s*([\u4e00-\u9fa5]{2,6})\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (match) {
      fields.set(match[1], match[2]);
    }
  });

  const get = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = fields.get(key);
      if (value && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  };

  const background = get('背景', '现状');
  const target = get('目标', '方向');
  const keyTension = get('核心矛盾', '矛盾');

  if (!background || !target || !keyTension) {
    return null;
  }

  const arc = splitList(get('四幕', '幕'), 4);
  if (arc.length !== 4) {
    return null;
  }

  const riskRaw = (get('风险偏好', '风险') ?? '').toLowerCase();
  const riskAppetite: RiskAppetite =
    riskRaw.includes('low') || riskRaw.includes('低')
      ? 'low'
      : riskRaw.includes('high') || riskRaw.includes('高')
        ? 'high'
        : 'medium';

  return {
    background: truncateText(background, 40),
    target: truncateText(target, 40),
    constraints: splitList(get('约束', '限制')),
    fears: splitList(get('恐惧', '担心')),
    resources: splitList(get('资源', '底牌')),
    keyTension: truncateText(keyTension, 60),
    riskAppetite,
    arc: arc.map((item) => truncateText(item, 60)),
  };
}

export interface DmProfileDeps {
  readonly client: DmModelClient;
}

export type ProfileSource = 'model-json' | 'model-prose' | 'fallback';

export interface ProfileGenerationResult {
  readonly source: ProfileSource;
  /** 模型写的处境分析（自由文本）；仅在模型不肯输出 JSON 时有值。 */
  readonly analysis: string | null;
  /** 结构化档案：模型没给可用结构时由确定性规则兜底。 */
  readonly profile: PlayerProfile;
}

/**
 * 让模型读懂处境。
 *
 * 返回两样东西：
 * - `analysis`：模型写的分析原文，直接当上下文喂给关卡与复盘
 * - `profile`：结构化档案，模型没给就用确定性规则算，保证永远可用
 */
export async function generateProfile(
  goal: string,
  deps: DmProfileDeps,
): Promise<ProfileGenerationResult> {
  const fallbackProfile = extractProfile(goal);

  try {
    // 第一优先：结构化 JSON（DeepSeek / OpenAI 等支持 json_object 的模型）
    const jsonAttempt = await deps.client.complete(
      [
        { role: 'system', content: PROFILE_JSON_PROMPT },
        { role: 'user', content: buildProfileUserMessage(goal) },
      ],
      { jsonMode: true },
    );

    if (jsonAttempt.ok) {
      const structured = normalizeProfileFromJson(jsonAttempt.text);
      if (structured) {
        return { source: 'model-json', analysis: null, profile: structured };
      }
    }

    // 第二优先：模型不肯给 JSON 时，把它写的东西当处境分析用
    const proseAttempt = await deps.client.complete(
      [
        { role: 'system', content: PROFILE_ANALYSIS_PROMPT },
        { role: 'user', content: buildProfileUserMessage(goal) },
      ],
      { jsonMode: false },
    );

    if (!proseAttempt.ok) {
      return { source: 'fallback', analysis: null, profile: fallbackProfile };
    }

    const analysis = proseAttempt.text.trim();
    if (analysis.length < 40) {
      return { source: 'fallback', analysis: null, profile: fallbackProfile };
    }

    // 模型若恰好按逐行键值写了，顺手也用上
    const structured = parseProfileText(analysis);

    return { source: 'model-prose', analysis, profile: structured ?? fallbackProfile };
  } catch {
    return { source: 'fallback', analysis: null, profile: fallbackProfile };
  }
}

/* -------------------------------------------------------------------------- */
/* 模型返回的结构化 profile 归一化                                              */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 40): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function stringList(value: unknown, max = 40, cap = 4): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => text(item, max))
    .filter((item): item is string => item !== null)
    .slice(0, cap);
}

/**
 * 把模型给的 JSON profile 钳制成合法结构。
 *
 * 必填三项（background / target / keyTension）缺失或 arc 不是 4 条时返回 null，
 * 由调用方回落到 `extractProfile`。
 */
export function normalizeProfile(raw: unknown): PlayerProfile | null {
  if (!isRecord(raw)) {
    return null;
  }

  const background = text(raw.background);
  const target = text(raw.target);
  const keyTension = text(raw.keyTension, 60);

  if (!background || !target || !keyTension) {
    return null;
  }

  const arc = stringList(raw.arc, 60, 4);
  if (arc.length !== 4) {
    return null;
  }

  const riskRaw = text(raw.riskAppetite, 10);
  const riskAppetite: RiskAppetite =
    riskRaw === 'low' || riskRaw === 'high' ? riskRaw : 'medium';

  return {
    background,
    target,
    constraints: stringList(raw.constraints),
    fears: stringList(raw.fears),
    resources: stringList(raw.resources),
    keyTension,
    riskAppetite,
    arc,
  };
}

/** 兼容模型偶尔仍输出 JSON 的情况。 */
function normalizeProfileFromJson(raw: string): PlayerProfile | null {
  const parsed = safeParseJson(raw);
  return parsed.ok ? normalizeProfile(parsed.value) : null;
}
