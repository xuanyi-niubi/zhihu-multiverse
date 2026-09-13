import { RELIC_LIBRARY } from '@/data/prebuiltScenarios';

import { profileToPromptBlock, type PlayerProfile } from '@/core/dm/profile';

import type { DmExperienceUnlock, DmWorldContext } from '@/features/game-world/dmContext';
import type { RelicKind } from '@/types/game';

/**
 * AI 地下城主（Dynamic Game Master）系统级 Prompt 工程。
 *
 * 设计原则：
 * 1. 输出契约写在最前面并声明「违反即任务失败」——模型对前置强约束的服从度最高。
 * 2. Schema 只出现一次（`DM_TURN_JSON_SCHEMA`），Prompt 内嵌的文本由它序列化而来，
 *    避免手写 Schema 与代码漂移。
 * 3. 数值平衡用「区间」而不是「示例」，减少模型在边界上自由发挥。
 * 4. Few-shot 覆盖三种最容易崩的形态：无检索片段、带遗物掉落、双失败分支。
 * 5. Prompt 只是第一层防线；真正的 100% 保证由 parse/validate/generate 三层代码兜底。
 */

/* -------------------------------------------------------------------------- */
/* 输入契约                                                                    */
/* -------------------------------------------------------------------------- */

export interface DmStatsSnapshot {
  readonly san: number;
  readonly skill: number;
  readonly bond: number;
}

export interface DmRelicSnapshot {
  readonly name: string;
  readonly kind: RelicKind;
  readonly remainingCharges: number | null;
}

export interface DmZhihuSnippet {
  readonly author: string;
  readonly quote: string;
  readonly sourceUrl: string;
  readonly title?: string;
  /** 站内赞同数；来自知乎搜索 API，用于溯源角标展示。 */
  readonly upvotes?: number;
  /** 站内内容 ID；显示为「知乎高赞索引 #<answerId>」。 */
  readonly answerId?: string;
}

export interface DmHistoryEntry {
  readonly turnIndex: number;
  readonly choiceText: string;
  readonly outcome: string;
}

export interface DmTurnInput {
  /** 玩家自由输入的现实困惑。 */
  readonly goal: string;
  /**
   * 从 `goal` 解析出的结构化处境档案。
   * 有它时，每一幕的冲突必须从档案里的约束/恐惧长出来，而不是套通用桥段。
   */
  readonly profile?: PlayerProfile;
  /**
   * AI 读完玩家原话后写的处境分析（自由文本）。
   * 这是主路径：比结构化字段更能承载细节，直接作为上下文交给模型。
   */
  readonly profileAnalysis?: string;
  readonly seed: string;
  /** 1..4 */
  readonly turnIndex: number;
  readonly totalTurns: number;
  readonly stats: DmStatsSnapshot;
  readonly inventory: readonly DmRelicSnapshot[];
  readonly zhihuSnippets: readonly DmZhihuSnippet[];
  readonly history: readonly DmHistoryEntry[];
  /** 跨局持久化画像标签，例如 ["高风险赌徒流", "同辈焦虑重度患者"]。 */
  readonly personaTags: readonly string[];
  /**
   * 跨局「前世记忆」上下文块（由 `memoryToPromptBlock` 生成）。
   *
   * 与 personaTags 的区别：personaTags 只是几个标签，这里是一整段
   * 「上一局发生了什么 + 该怎么用」的指令，让 AI 能以老友口吻开场。
   * 首次游玩时为 undefined。
   */
  readonly memoryBlock?: string;
  /**
   * 本局世界蓝图上下文（P0-G / Phase 13）。
   *
   * 有它时：本幕的冲突、允许引用的真实经验、与玩家的差异、
   * 现实边界全部来自 Session 编译好的 WorldBlueprint ——
   * DM 在蓝图**里面**创作，不重新发明现实。
   */
  readonly worldContext?: DmWorldContext;
  /** 经验解锁（P0-H / Phase 14）：一条真实经验解锁的新选项。 */
  readonly experienceUnlock?: DmExperienceUnlock;
}

export interface DmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/* -------------------------------------------------------------------------- */
/* JSON Schema：单一事实源                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 关卡 JSON Schema。
 *
 * 同时用于两处：
 * - 序列化后内嵌进 System Prompt，作为模型的唯一结构参照；
 * - 交给支持结构化输出的 provider（OpenAI / DeepSeek 的 json_object 模式）。
 *
 * 注意：这不是一个严格的 JSON Schema draft，而是「契约描述」。
 * 真正的强制校验在 `validate.ts`，它比 JSON Schema 更宽容（会钳制与修复）。
 */
export const DM_TURN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['turnIndex', 'title', 'storyText', 'zhihuBullet', 'choices'],
  properties: {
    turnIndex: { type: 'integer', minimum: 1, maximum: 8 },
    title: { type: 'string', minLength: 4, maxLength: 24 },
    storyText: { type: 'string', minLength: 40, maxLength: 200 },
    zhihuBullet: {
      type: 'object',
      additionalProperties: false,
      required: ['author', 'quote', 'sourceUrl'],
      properties: {
        author: { type: 'string', minLength: 1, maxLength: 32 },
        /**
         * 上限 160：蓝图模式要求 quote **逐字**引用真实片段，
         * 而片段本身最长 160 字。上限若停在 120，模型会把原文截短，
         * 截短就破坏了逐字性（校验层随后只能整条替换）。
         */
        quote: { type: 'string', minLength: 8, maxLength: 160 },
        sourceUrl: { type: 'string', pattern: '^https://' },
      },
    },
    choices: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'hint', 'ghostEchoStat', 'onSuccess'],
        properties: {
          id: { type: 'string', enum: ['a', 'b', 'c'] },
          text: { type: 'string', minLength: 4, maxLength: 40 },
          hint: { type: 'string', minLength: 4, maxLength: 48 },
          ghostEchoStat: {
            type: 'string',
            minLength: 6,
            maxLength: 32,
            description:
              '同路人的氛围短句：中文 8-24 字，禁止出现任何数字或百分号（真实聚合数据上线前，具体比例一律视为编造）',
          },
          check: {
            type: 'object',
            additionalProperties: false,
            required: ['targetStat', 'difficulty'],
            properties: {
              targetStat: { type: 'string', enum: ['san', 'skill', 'bond'] },
              difficulty: { type: 'integer', minimum: 1, maximum: 30 },
            },
          },
          onSuccess: {
            type: 'object',
            additionalProperties: false,
            required: ['feedback', 'statDeltas'],
            properties: {
              feedback: { type: 'string', minLength: 12, maxLength: 140 },
              statDeltas: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  san: { type: 'integer', minimum: -40, maximum: 40 },
                  skill: { type: 'integer', minimum: -40, maximum: 40 },
                  bond: { type: 'integer', minimum: -40, maximum: 40 },
                },
              },
              relicId: { type: 'string', enum: Object.keys(RELIC_LIBRARY) },
            },
          },
          onFail: {
            type: 'object',
            additionalProperties: false,
            required: ['feedback', 'statDeltas'],
            properties: {
              feedback: { type: 'string', minLength: 12, maxLength: 140 },
              statDeltas: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  san: { type: 'integer', minimum: -40, maximum: 40 },
                  skill: { type: 'integer', minimum: -40, maximum: 40 },
                  bond: { type: 'integer', minimum: -40, maximum: 40 },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

/* -------------------------------------------------------------------------- */
/* 系统 Prompt                                                                 */
/* -------------------------------------------------------------------------- */

const DC_BANDS = [
  '第 1 回合 11-13',
  '第 2 回合 13-15',
  '第 3 回合 15-17',
  '第 4 回合 16-18',
].join('；');

const RELIC_IDS = Object.keys(RELIC_LIBRARY);

export const DM_SYSTEM_PROMPT = `你是「知乎平行宇宙」的 AI 地下城主（Dungeon Master），代号 DM-ZHIHU。
你的唯一职责：根据玩家的现实困惑与提供的知乎检索片段，生成下一回合的关卡事件。
你不是助手，不回答问题，不解释自己。

# 一、输出契约（最高优先级，违反即视为任务失败）
1. 只输出【一个】JSON 对象：第一个非空白字符必须是 {，最后一个非空白字符必须是 }。
2. 严禁输出 markdown 代码块、\`\`\` 围栏、任何解释文字、任何前后缀、任何思考过程、任何礼貌用语。
3. 严禁输出 JSON 注释、尾随逗号、单引号字符串、未加引号的键名。
4. 字符串一律使用标准双引号；内部换行写成 \\n 转义。
5. 字段名与层级必须与下方 Schema 完全一致，不得新增、删除、重命名任何字段。
6. 所有数值必须是 JSON number，不得写成 "13" 这种字符串。
7. 信息不足时用 Schema 允许的默认值补齐；不得输出 null，不得省略必填字段。
8. 只输出 JSON 本身。你的第一个输出字符就是 {。

# 二、输出 Schema
${JSON.stringify(DM_TURN_JSON_SCHEMA)}

# 三、数值平衡（必须遵守）
- choices 给 1 到 3 个，id 依次为 "a""b""c"：
  · 日常事件给 1 个「推进」选项；
  · 危机事件给 2 个，形成明确的风险对比（a 稳妥无检定、b 有检定）；
  · 特殊事件可以给 3 个，体现多线可能。
  choices[0] 永远是不带 check 的稳妥项；带 check 的选项从 choices[1] 开始。
- choices[0]（稳妥选项）：【不得】出现 check 字段。statDeltas 建议区间：san -12..0、skill 0..12、bond 0..6。
- choices[1]（高风险选项）：【必须】包含 check。difficulty 按回合递增：${DC_BANDS}。
- check.targetStat 只能是 "san" | "skill" | "bond"，且必须与本回合的核心矛盾一致：
  技术/专业能力焦虑 → "skill"；家庭、人际、导师或同伴压力 → "bond"；自我怀疑、崩溃、撑不住 → "san"。
- 失败分支的 statDeltas.san 必须为负，区间 -34..-8；成功分支 san 建议 -6..+16。
- 任一 statDeltas 数值的绝对值不得超过 40。
- relicId 只能出现在 choices[1].onSuccess，且必须是下列 id 之一，否则【不要写这个字段】：
  ${RELIC_IDS.map((id) => `"${id}"`).join('、')}
- ghostEchoStat 是**氛围短句**：中文 8-24 字，不得出现任何数字、百分比，也不要用「XX% 的人」这类统计口吻。
  我们还没有真实的聚合数据，任何具体比例都是编造，会被校验层改写并标记。写「很多人在这里都会犹豫」，不要写「62% 的人会犹豫」。
- title 4-24 字，不要带书名号。
- storyText 60-140 字，第二人称，必须落到具体时间、地点和一个可感知的细节。
- feedback 30-80 字，直接回应玩家的选择；【禁止】出现「你成功了」「你失败了」这类判定词——成功与失败由系统界面显示。
- 若提供了【玩家处境档案】：每一幕的核心冲突必须直接来自档案里的「客观约束」或「主观恐惧」，并按档案给出的分幕设计推进；【禁止】套用与档案无关的通用校园桥段（例如给法学转码的人安排「室友保研」）。

# 四、知乎生态约束
- **若【本局世界蓝图】给出了【允许引用的真实经验】**：zhihuBullet.quote 必须**逐字等于**其中一条原文，一个字都不能改（不得缩写、不得补标点、不得换同义词）；author 与 sourceUrl 必须取自**同一条**。没有特别贴切的那条，就挑一条并原样引用 —— 概括就等于伪造。
- **否则（只有【知乎检索片段】的 legacy 模式）**：zhihuBullet.quote 必须改写自【知乎检索片段】中提供的内容，不得编造答主、观点或数据；author 使用片段中给出的作者名；sourceUrl 必须直接使用片段中的 https 链接。
- 两者都为空：quote 写该领域公认的普适经验，author 写「知乎匿名用户」，sourceUrl 写 "https://www.zhihu.com"。
- 不得编造点赞数、收藏数、评论数等任何站内统计数据。

# 五、禁止项
- 禁止输出真实姓名、手机号、身份证号、学校全称、公司内推码等个人隐私信息。
- 禁止对医疗、法律、投资给出确定性承诺。
- 禁止输出违法、自伤、歧视、低俗内容。
- 禁止把选项写成「全都做」「都不做」「再看看」这类无实质差异的描述。

# 六、自检清单（输出前在心里过一遍，不要写出来）
- 我输出的是否是纯 JSON，且以 { 开头、以 } 结尾？
- choices 数量在 1 到 3 之间，且 choices[0] 无 check？
- 所有数值是否在允许区间内，且都是 number 类型？
- sourceUrl 是否以 https:// 开头？
- 是否没有输出任何多余文字？`;

/* -------------------------------------------------------------------------- */
/* Few-shot                                                                    */
/* -------------------------------------------------------------------------- */

const FEW_SHOT_TURN_1_GOAL = {
  goal: '大三法学，想转计算机，但怕脱产找不到工作',
  seed: 'SEED-2026-X89',
  turnIndex: 1,
  totalTurns: 4,
  stats: { san: 100, skill: 15, bond: 10 },
  inventory: [],
  zhihuSnippets: [],
  history: [],
  personaTags: [],
} satisfies DmTurnInput;

const FEW_SHOT_TURN_1_OUTPUT = `{
  "turnIndex": 1,
  "title": "秋招倒计时 30 天",
  "storyText": "10 月的图书馆，你的力扣还停在第 30 题。室友的律所 Offer 已经躺进邮箱，而你刚把《深入理解计算机系统》翻到第三章。深夜 1 点，屏幕蓝光把宿舍照成一片海。",
  "zhihuBullet": {
    "author": "知乎匿名用户",
    "quote": "转码最大的成本不是学不会，是你在能学会之前就先耗光了心气。",
    "sourceUrl": "https://www.zhihu.com"
  },
  "choices": [
    {
      "id": "a",
      "text": "按部就班刷题，先把八股背熟",
      "hint": "稳妥：小幅提升专业力，但心智持续消耗",
      "ghostEchoStat": "很多人在这里都会妥协",
      "onSuccess": {
        "feedback": "你按计划推进，进度慢得让人心慌，但至少没有崩盘，八股在脑子里慢慢连成了线。",
        "statDeltas": { "san": -8, "skill": 8, "bond": 0 }
      }
    },
    {
      "id": "b",
      "text": "通宵手撕分布式开源项目",
      "hint": "高危：需要专业力检定",
      "ghostEchoStat": "敢硬刚的人不多",
      "check": { "targetStat": "skill", "difficulty": 13 },
      "onSuccess": {
        "feedback": "凌晨四点你提交了人生第一个 PR，三天后维护者回复 LGTM，你把截图存进了相册。",
        "statDeltas": { "san": 6, "skill": 22, "bond": 5 },
        "relicId": "relic-pr-fragment"
      },
      "onFail": {
        "feedback": "环境依赖报错到天亮，你盯着满屏红字，第一次认真怀疑自己是不是在浪费时间。",
        "statDeltas": { "san": -26, "skill": 4, "bond": 0 }
      }
    }
  ]
}`;

const FEW_SHOT_TURN_3_GOAL = {
  goal: '考研复试线差 3 分，要不要二战',
  seed: 'SEED-2026-K21',
  turnIndex: 3,
  totalTurns: 4,
  stats: { san: 46, skill: 52, bond: 34 },
  inventory: [
    { name: '大 V 答主反卷箴言', kind: 'passive', remainingCharges: null },
    { name: '盐选速记秘卷', kind: 'active', remainingCharges: 1 },
  ],
  zhihuSnippets: [
    {
      author: '二战上岸的学长',
      title: '跟父母解释你的选择，比考上更难',
      quote: '跟父母解释你的选择，比考上更难，但也更值得。',
      sourceUrl: 'https://www.zhihu.com/question/293352359',
    },
  ],
  history: [
    { turnIndex: 1, choiceText: '二战，继续冲击目标院校', outcome: 'san -6 / skill +14' },
    { turnIndex: 2, choiceText: '熬夜冲名校真题，逼自己一把', outcome: 'san -25 / skill +5' },
  ],
  personaTags: ['死磕型', '同辈焦虑重度患者'],
} satisfies DmTurnInput;

const FEW_SHOT_TURN_3_OUTPUT = `{
  "turnIndex": 3,
  "title": "父母的电话",
  "storyText": "电话那头，爸爸欲言又止：隔壁老王家孩子已经工作了，我们不是催你，就是问问。你握着手机，看着桌上摊开的专业课笔记，突然不知道该说什么。",
  "zhihuBullet": {
    "author": "二战上岸的学长",
    "quote": "跟父母解释你的选择，比考上更难，但也更值得。",
    "sourceUrl": "https://www.zhihu.com/question/293352359"
  },
  "choices": [
    {
      "id": "a",
      "text": "妥协，先去找一份实习",
      "hint": "稳妥：缓解家庭压力，但打断复习",
      "ghostEchoStat": "先工作再看机会，是常见走法",
      "onSuccess": {
        "feedback": "你去了一家小公司实习，工资不高，但家里的电话少了，复习的时间被切成碎片。",
        "statDeltas": { "san": 6, "bond": 8, "skill": 4 }
      }
    },
    {
      "id": "b",
      "text": "坚持备考，认真向家人解释",
      "hint": "高危：需要羁绊检定",
      "ghostEchoStat": "坦白沟通需要勇气",
      "check": { "targetStat": "bond", "difficulty": 16 },
      "onSuccess": {
        "feedback": "你把计划表拍照发给爸妈，一条条讲清楚，妈妈最后说那你照顾好自己。",
        "statDeltas": { "san": 10, "bond": 14, "skill": 2 },
        "relicId": "relic-anti-involution"
      },
      "onFail": {
        "feedback": "话说到一半就变成了争吵，挂断电话后你翻了两页书，一个字也没进脑子。",
        "statDeltas": { "san": -18, "bond": -8, "skill": 0 }
      }
    }
  ]
}`;

const FEW_SHOT_TURN_2_GOAL = {
  goal: '双非本科怎么冲大厂实习',
  seed: 'SEED-2026-M07',
  turnIndex: 2,
  totalTurns: 4,
  stats: { san: 78, skill: 28, bond: 18 },
  inventory: [],
  zhihuSnippets: [
    {
      author: '秋招上岸的学姐',
      title: '把 30 场面试画成一张图',
      quote: '简历不是把你的经历写得好看，是让面试官一眼看到你能解决什么问题。',
      sourceUrl: 'https://www.zhihu.com/question/293352359',
    },
  ],
  history: [{ turnIndex: 1, choiceText: '按部就班刷题，先把八股背熟', outcome: 'san -8 / skill +8' }],
  personaTags: ['极度厌恶风险'],
} satisfies DmTurnInput;

const FEW_SHOT_TURN_2_OUTPUT = `{
  "turnIndex": 2,
  "title": "简历投出去的第 47 天",
  "storyText": "邮箱里躺着 46 封感谢您的投递。HR 说你的履历和岗位不匹配，面试官问你为什么想做后端。你盯着屏幕上那份单薄的简历，手指悬在编辑按钮上。",
  "zhihuBullet": {
    "author": "秋招上岸的学姐",
    "quote": "简历不是把你的经历写得好看，是让面试官一眼看到你能解决什么问题。",
    "sourceUrl": "https://www.zhihu.com/question/293352359"
  },
  "choices": [
    {
      "id": "a",
      "text": "老老实实补一个完整项目",
      "hint": "稳妥：专业力稳步上升，时间成本高",
      "ghostEchoStat": "先把项目补齐，再谈选择",
      "onSuccess": {
        "feedback": "你用两周写了一个带鉴权的短链服务，虽然朴素，但每一行你都能讲清楚。",
        "statDeltas": { "san": -6, "skill": 12, "bond": 0 }
      }
    },
    {
      "id": "b",
      "text": "包装经历，硬刚大厂算法岗",
      "hint": "高危：需要专业力检定",
      "ghostEchoStat": "直接硬刚是少数派",
      "check": { "targetStat": "skill", "difficulty": 15 },
      "onSuccess": {
        "feedback": "你把文本检索讲成了信息检索问题，面试官眼睛亮了，说这个视角有意思。",
        "statDeltas": { "san": 8, "skill": 18, "bond": 6 },
        "relicId": "relic-salt-digest"
      },
      "onFail": {
        "feedback": "面试官追问了三个底层问题，你答得越来越小声，挂断电话时窗外天已经亮了。",
        "statDeltas": { "san": -22, "skill": 5, "bond": 0 }
      }
    }
  ]
}`;

/** 三组 input→output 示范，覆盖无片段、带遗物掉落、双失败分支三种形态。 */
export const DM_FEW_SHOT: readonly DmMessage[] = [
  { role: 'user', content: formatDmUserMessage(FEW_SHOT_TURN_1_GOAL) },
  { role: 'assistant', content: FEW_SHOT_TURN_1_OUTPUT },
  { role: 'user', content: formatDmUserMessage(FEW_SHOT_TURN_3_GOAL) },
  { role: 'assistant', content: FEW_SHOT_TURN_3_OUTPUT },
  { role: 'user', content: formatDmUserMessage(FEW_SHOT_TURN_2_GOAL) },
  { role: 'assistant', content: FEW_SHOT_TURN_2_OUTPUT },
];

/* -------------------------------------------------------------------------- */
/* 用户消息构造                                                                */
/* -------------------------------------------------------------------------- */

function dcBandFor(turnIndex: number): string {
  const bands = ['11-13', '13-15', '15-17', '16-18', '17-19', '18-20', '18-20', '19-21'];
  return bands[Math.min(Math.max(turnIndex, 1), bands.length) - 1];
}

function formatInventory(input: DmTurnInput): string {
  if (input.inventory.length === 0) {
    return '无';
  }

  return input.inventory
    .map((relic) => {
      const charges =
        relic.kind === 'active' && relic.remainingCharges !== null
          ? `（剩余 ${relic.remainingCharges} 次）`
          : '';
      return `${relic.name}${charges}`;
    })
    .join('、');
}

function formatHistory(input: DmTurnInput): string {
  if (input.history.length === 0) {
    return '无';
  }

  return input.history
    .map((entry) => `第 ${entry.turnIndex} 回合选择「${entry.choiceText}」，结果 ${entry.outcome}`)
    .join('；');
}

function formatSnippets(input: DmTurnInput): string {
  if (input.zhihuSnippets.length === 0) {
    return '（本次无检索结果，请按第四节规则使用通用表述）';
  }

  return input.zhihuSnippets
    .map(
      (snippet, index) =>
        `${index + 1}. 作者：${snippet.author}｜标题：${snippet.title ?? '（无）'}｜赞同：${snippet.upvotes ?? '（未知）'}｜链接：${snippet.sourceUrl}｜摘要：${snippet.quote}`,
    )
    .join('\n');
}

/** 把一次生成请求渲染成模型可读的 user 消息。Few-shot 与真实请求共用同一模板。 */
export function formatDmUserMessage(input: DmTurnInput): string {
  const analysisBlock = input.profileAnalysis
    ? `\n【AI 处境分析（已读过玩家原话，冲突必须从它里面长出来）】\n${input.profileAnalysis}\n`
    : '';
  // 有 AI 分析时不再塞结构化兜底档案：词典误读会与分析冲突，反而干扰模型
  const profileBlock =
    !input.profileAnalysis && input.profile ? `\n${profileToPromptBlock(input.profile)}\n` : '';

  // 前世记忆只在第一幕注入：后续幕次的上下文已经包含了玩家本局的选择，
  // 再塞上一局的信息会让模型分不清「这一世」和「上一世」。
  const memoryBlock =
    input.memoryBlock && input.turnIndex === 1 ? `\n${input.memoryBlock}\n` : '';

  /**
   * 世界蓝图块（Phase 13 / P0-G）。
   *
   * 有蓝图时本幕冲突**必须**从 actConflict 长出来；允许引用的真实经验
   * 是逐字原文 —— 引用它们时 quote 不得改写（这是新主链「原文忠实」的落点，
   * 覆盖系统 prompt 里「改写自」的 legacy 规则）。
   */
  const world = input.worldContext;
  /**
   * 幕级纪律（P0-7）。
   *
   * 第三幕是「遇见反例」——它必须真的让玩家撞上一个**不同的经验逻辑**，
   * 而不是把支持性内容换个说法再说一遍。没有真实反例时**不得虚构**：
   * 如实演出「这一局没有找到反例」本身就是产品的诚实。
   */
  const actDiscipline =
    world?.actObjective === 'meet-counterexample'
      ? '本幕是最后一幕，两件事同时做到：① 必须让玩家遇见一个与前两幕不同的经验逻辑；② 不再引入新的现实主张，只收敛「这一局看清了什么、还剩哪个未知必须由现实回答」。如果【允许引用的真实经验】里没有任何反例，不得虚构反例、不得拿支持性内容冒充 —— 如实呈现「我们没找到反例」这件事本身。'
      : null;
  const worldBlock = world
    ? `
【本局世界蓝图】
核心矛盾：${world.centralTension || '（未提供）'}
本幕目标：${world.actObjective}
本幕冲突：${world.actConflict || '（未提供，请从核心矛盾长出来）'}
${actDiscipline ? `本幕纪律：${actDiscipline}\n` : ''}${world.keyUnknown ? `玩家最大未知：${world.keyUnknown}\n` : ''}
【允许引用的真实经验（quote 必须逐字使用其中原文，禁止改写）】
${
  world.sourceFacts.length > 0
    ? world.sourceFacts.map((fact) => `· ${fact.author}：「${fact.quote}」(${fact.sourceUrl})`).join('\n')
    : '（本幕没有可引用的真实经验 —— 不要编造任何「知乎用户说…」）'
}
【与玩家的差异】
${
  world.differences.length > 0
    ? world.differences
        .map((difference) => {
          if (difference.relation === 'different') {
            return `· 不同：${difference.variable}（玩家：${difference.userValue ?? '？'} / 经历：${difference.experienceValue ?? '？'}）—— 他的结果未必会发生在玩家身上`;
          }
          if (difference.relation === 'same') {
            return `· 相同：${difference.variable}`;
          }
          return `· 未知：${difference.variable}`;
        })
        .join('\n')
    : '（暂无可对照的差异）'
}
【现实边界（违反即任务失败）】
${world.forbiddenClaims.map((claim) => `· ${claim}`).join('\n')}
`
    : '';

  /** 经验解锁块（Phase 14 / P0-H）：让模型把这条新选择织进本幕叙事。 */
  const unlock = input.experienceUnlock;
  const unlockBlock = unlock
    ? `
【经验解锁的新选择（必须作为 choices 中的一项原样保留）】
id 线索：${unlock.unlockId}
选项文本：${unlock.choiceText}
给玩家的提示：${unlock.hint}
这一项来自玩家在上一幕获得的一条真实经验；请在 storyText 里给玩家「想起来了什么」的感觉，但不要替玩家选它。
`
    : '';

  return `【玩家目标】${input.goal || '（未提供，请生成一个普遍适用的校园抉择）'}${analysisBlock}${profileBlock}${memoryBlock}${worldBlock}${unlockBlock}
【宇宙种子】${input.seed}
【回合】第 ${input.turnIndex} / ${input.totalTurns} 回合
【当前属性】SAN ${input.stats.san} / 专业力 ${input.stats.skill} / 羁绊 ${input.stats.bond}
【已装备遗物】${formatInventory(input)}
【历史选择】${formatHistory(input)}
【玩家性格画像】${input.personaTags.length > 0 ? input.personaTags.join('、') : '无'}
【知乎检索片段】
${formatSnippets(input)}
【本回合要求】生成第 ${input.turnIndex} 回合。choices[0] 稳妥且不得有 check；choices[1] 必须带 check，difficulty 落在 ${dcBandFor(input.turnIndex)}；turnIndex 必须等于 ${input.turnIndex}。
现在直接输出 JSON。`;
}

/** 组装完整对话：system + few-shot + 真实请求。 */
export function buildDmMessages(input: DmTurnInput): DmMessage[] {
  return [
    { role: 'system', content: DM_SYSTEM_PROMPT },
    ...DM_FEW_SHOT,
    { role: 'user', content: formatDmUserMessage(input) },
  ];
}

/**
 * 修复轮消息。
 *
 * 把「上一轮原始输出」与「校验错误清单」一起回喂，要求只输出修正后的 JSON。
 * 注意：即使这一轮再失败，外层还有离线剧本兜底，所以这里可以放心严格。
 */
export function buildRepairMessages(
  input: DmTurnInput,
  previousRaw: string,
  issues: readonly { path: string; message: string }[],
): DmMessage[] {
  const issueList = issues
    .slice(0, 12)
    .map((issue, index) => `${index + 1}. [${issue.path}] ${issue.message}`)
    .join('\n');

  const truncated = previousRaw.length > 2000 ? `${previousRaw.slice(0, 2000)}…` : previousRaw;

  return [
    { role: 'system', content: DM_SYSTEM_PROMPT },
    { role: 'user', content: formatDmUserMessage(input) },
    {
      role: 'user',
      content: `你上一次的输出没有通过结构校验。

【你上一次的原始输出】
${truncated}

【校验发现的问题】
${issueList || '1. 输出不是合法的单一 JSON 对象。'}

请只输出【修正后的单个 JSON 对象】，不要任何解释、不要 markdown 围栏、不要注释。
必须满足：choices 在 1 到 3 个之间、id 依次为 a/b/c；choices[0] 无 check；带 check 的选项 difficulty 在 ${dcBandFor(input.turnIndex)}；turnIndex = ${input.turnIndex}；所有数值为 number；sourceUrl 以 https:// 开头。`,
    },
  ];
}
