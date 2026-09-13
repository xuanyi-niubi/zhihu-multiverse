import { createTrace } from '@/core/observability';
import { hasFabricatedStat } from '@/core/dm/validate';

import {
  clampCheckDifficulty,
  type AgentOutput,
  type CheckRequest,
  type ChoiceTags,
  type NarrativeContext,
  type PlotBrief,
  type PlotChoice,
} from '@/agents/types';
import { resolveCheckDifficulty, type DifficultyAdjustment } from '@/agents/difficultyAdapter';
import { styleInstruction } from '@/agents/styleStylist';

import type { ProviderRouter } from '@/agents/providerRouter';

/**
 * Plot Director（规范 §4.2 / 重构计划 §4「Role 1: Plot Director」）。
 *
 * **这是"剧情不再定死"的落点**：由它决定这一幕发生了什么、有哪些选项、
 * 以及哪个选项会触发检定。约束同样明确：
 *
 * - AI 只能提"直觉难度"，最终 DC 由引擎按动态难度偏移钳制（`resolveCheckDifficulty`）；
 * - AI **不能**输出骰面、胜负、掉落、属性变化——schema 是白名单，写了也会被丢掉；
 * - AI 引用的知乎素材必须在白名单内，否则丢弃（不能凭空造来源）；
 * - 文案里不许出现编造的社区数字（沿用既有 `hasFabricatedStat` 纪律）；
 * - 任何一步失败都退回**本地情节模板**，游戏永不卡住。
 */

export const PLOT_SCHEMA_HINT = `{
  "title": "幕标题（6-12 字）",
  "scene": "场景名（4-10 字）",
  "dilemma": "这一幕的两难处境（40-120 字，第二人称）",
  "choices": [
    {
      "id": "a | b | c | d（互不重复）",
      "text": "选项文案（8-20 字，祈使或决断语气）",
      "hint": "代价提示（10-24 字，写清要付出什么）",
      "tags": { "moral": "good|neutral|dark", "efficiency": "direct|indirect|risky", "social": "ally|neutral|antagonize" },
      "check": { "stat": "san|skill|bond", "difficulty": 10到20的整数, "flavor": "成败风味（可选）" }
    }
  ],
  "referencedKnowledgeIds": ["只能引用给出的素材 id"],
  "threadIds": ["可以推进的线索 id"]
}`;

export const PLOT_SYSTEM_PROMPT = [
  '你是一场平行宇宙人生推演的叙事导演。你负责决定「这一幕发生了什么」，不是负责写散文。',
  '严格输出 JSON，不要 markdown 围栏、不要任何解释文字。',
  '输出 schema：',
  PLOT_SCHEMA_HINT,
  '',
  '【硬性约束】',
  '1. choices 必须 3 到 4 个，且彼此是**真正不同的取舍**（不要同一个意思换说法）。',
  '2. 每个选项都要有代价：hint 必须写清"你会失去什么"，不要写成好处清单。',
  '3. 只有这次行动真的需要一次检验时才给 check（可以有多个、也可以一个都没有）；不要把「稳/险」当作固定搭配。',
  '4. 处境必须使用玩家给出的目标、出身、当前世界状态与近期记忆，不能写成通用鸡汤。',
  '5. 允许引用给出的知乎素材 id；**不得编造**答主、赞同数、百分比或任何统计数据。',
  '6. 绝对不要输出：骰面、DC、成功失败、掉落、属性数值变化——那些由规则引擎决定。',
  '7. 不要替玩家做决定，不要把结局写完。',
].join('\n');

export function buildPlotUserPrompt(context: NarrativeContext, allowedThreadIds: readonly string[]): string {
  const memoryLines =
    context.memories.length > 0 ? context.memories.map((m) => `- ${m.content}`).join('\n') : '- （这一局还没有值得记住的事）';

  const knowledgeLines =
    context.knowledge.length > 0
      ? context.knowledge.map((k) => `- id=${k.id}｜${k.title}：${k.quote}`).join('\n')
      : '- （本幕没有可引用的站内素材，referencedKnowledgeIds 必须为空数组）';

  return [
    '【世界模型】',
    `- 第 ${context.world.act} / ${context.world.totalActs} 幕｜场景：${context.world.sceneName}｜时间：${context.world.timeLabel}`,
    `- 定性状态：${context.world.signals.length > 0 ? context.world.signals.join('、') : '平稳'}`,
    context.world.relics.length > 0
      ? `- 携带遗物：${context.world.relics.map((r) => (r.hook ? `${r.name}（${r.hook}）` : r.name)).join('、')}`
      : '- 携带遗物：无',
    '',
    '【玩家画像】',
    `- 出身：${context.player.originName}`,
    `- 目标：${context.player.goal}`,
    context.player.archetypes.length > 0 ? `- 上一局的决策画像：${context.player.archetypes.join('、')}` : '- 上一局的决策画像：无',
    context.player.legacyWords ? `- 上一局留下的遗念：${context.player.legacyWords}` : '- 上一局留下的遗念：无',
    '',
    '【近期记忆】（这是"你"记得的事，叙事里应当有所回响）',
    memoryLines,
    '',
    '【可用知乎素材】',
    knowledgeLines,
    '',
    '【本幕可推进的线索】',
    allowedThreadIds.length > 0 ? allowedThreadIds.map((id) => `- ${id}`).join('\n') : '- （无）',
    '',
    '【风格指令】',
    styleInstruction(context.style),
    '',
    '请输出这一幕的 JSON。',
  ].join('\n');
}

const MORAL = new Set(['good', 'neutral', 'dark']);
const EFFICIENCY = new Set(['direct', 'indirect', 'risky']);
const SOCIAL = new Set(['ally', 'neutral', 'antagonize']);
const STATS = new Set(['san', 'skill', 'bond']);

/** 去掉编造的社区数字（沿用项目纪律：允许改写，但不允许发布）。 */
export function stripFabricatedStats(text: string): string {
  return text
    .replace(/\d+(?:\.\d+)?\s*[%％]/g, '很多')
    .replace(/\d+\s*成(?:的人)?/g, '不少人')
    .replace(/\d+\s*分之[一二三四五六七八九十\d]+/g, '一部分');
}

function clip(text: unknown, max: number): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface NormalizeContext {
  readonly allowedKnowledgeIds: readonly string[];
  readonly allowedThreadIds: readonly string[];
  readonly adjustment: DifficultyAdjustment;
}

export interface NormalizeResult {
  readonly ok: boolean;
  readonly brief: PlotBrief | null;
  readonly issues: readonly string[];
}

/**
 * 规范化情节简报：**白名单式**——只保留我们认识的字段，其余一律丢弃。
 * 这是"AI 不能改数值"的结构性保证，而不是靠提示词自觉。
 */
export function normalizePlotBrief(raw: unknown, context: NormalizeContext): NormalizeResult {
  const record = asRecord(raw);
  if (!record) {
    return { ok: false, brief: null, issues: ['not-an-object'] };
  }

  const issues: string[] = [];

  const title = clip(record.title, 20);
  const scene = clip(record.scene, 24);
  const dilemmaRaw = clip(record.dilemma, 160);
  if (!title || !scene || !dilemmaRaw) {
    return { ok: false, brief: null, issues: ['missing-core-fields'] };
  }

  const sanitize = (text: string, field: string): string => {
    if (!hasFabricatedStat(text)) {
      return text;
    }
    issues.push(`fabricated-stat-stripped:${field}`);
    return stripFabricatedStats(text);
  };

  const choicesRaw = Array.isArray(record.choices) ? record.choices : [];
  const seenIds = new Set<string>();
  const choices: PlotChoice[] = [];

  for (const item of choicesRaw) {
    const choice = asRecord(item);
    if (!choice) {
      continue;
    }
    const id = clip(choice.id, 8);
    const text = clip(choice.text, 40);
    const hint = clip(choice.hint, 60);
    if (!id || !text || !hint || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const tagsRaw = asRecord(choice.tags) ?? {};
    const tags: ChoiceTags = {
      moral: MORAL.has(String(tagsRaw.moral)) ? (tagsRaw.moral as ChoiceTags['moral']) : 'neutral',
      efficiency: EFFICIENCY.has(String(tagsRaw.efficiency))
        ? (tagsRaw.efficiency as ChoiceTags['efficiency'])
        : 'indirect',
      social: SOCIAL.has(String(tagsRaw.social)) ? (tagsRaw.social as ChoiceTags['social']) : 'neutral',
    };

    let check: CheckRequest | undefined;
    const checkRaw = asRecord(choice.check);
    if (checkRaw) {
      const stat = String(checkRaw.stat);
      if (STATS.has(stat)) {
        const aiDifficulty = typeof checkRaw.difficulty === 'number' ? checkRaw.difficulty : 14;
        check = {
          stat: stat as CheckRequest['stat'],
          // 引擎拥有最终解释权：AI 的直觉难度只作为输入
          difficulty: resolveCheckDifficulty(aiDifficulty, context.adjustment),
          ...(typeof checkRaw.flavor === 'string' ? { flavor: sanitize(checkRaw.flavor.slice(0, 80), 'flavor') } : {}),
        };
      } else {
        issues.push('check-stat-unknown');
      }
    }

    choices.push({
      id,
      text: sanitize(text, 'text'),
      hint: sanitize(hint, 'hint'),
      tags,
      ...(check ? { check } : {}),
    });
  }

  if (choices.length < 2) {
    return { ok: false, brief: null, issues: [...issues, 'too-few-choices'] };
  }
  if (choices.length > 4) {
    choices.length = 4;
    issues.push('choices-truncated');
  }

  const knowledgeIds = (Array.isArray(record.referencedKnowledgeIds) ? record.referencedKnowledgeIds : [])
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => context.allowedKnowledgeIds.includes(id))
    .slice(0, 2);
  if (Array.isArray(record.referencedKnowledgeIds) && record.referencedKnowledgeIds.length > knowledgeIds.length) {
    issues.push('unknown-knowledge-id-dropped');
  }

  const threadIds = (Array.isArray(record.threadIds) ? record.threadIds : [])
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => context.allowedThreadIds.includes(id))
    .slice(0, 3);

  return {
    ok: true,
    issues,
    brief: {
      title: sanitize(title, 'title'),
      scene: sanitize(scene, 'scene'),
      dilemma: sanitize(dilemmaRaw, 'dilemma'),
      choices,
      referencedKnowledgeIds: knowledgeIds,
      threadIds,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 本地情节模板：模型不可用时的兜底（也是"离线可玩"的基石）                     */
/* -------------------------------------------------------------------------- */

interface LocalPlot {
  readonly title: string;
  readonly scene: string;
  readonly dilemma: string;
  readonly choices: readonly PlotChoice[];
}

const LOCAL_PLOTS: readonly LocalPlot[] = [
  {
    title: '时间不够用',
    scene: '自习室',
    dilemma: '你面前摊着两份东西：一份是必须交的作业，一份是能让你往前走的机会。今天只够做一件。',
    choices: [
      { id: 'a', text: '先交作业，机会下次再抓', hint: '稳，但机会不一定有下一次', tags: { moral: 'neutral', efficiency: 'direct', social: 'neutral' } },
      { id: 'b', text: '赌机会，作业拖到明天', hint: '可能拿到关键进展，也可能两头空', tags: { moral: 'neutral', efficiency: 'risky', social: 'neutral' }, check: { stat: 'skill', difficulty: 15 } },
      { id: 'c', text: '找人换班，把两件事错开', hint: '要欠下人情', tags: { moral: 'good', efficiency: 'indirect', social: 'ally' }, check: { stat: 'bond', difficulty: 13 } },
    ],
  },
  {
    title: '没人看好',
    scene: '宿舍',
    dilemma: '你说出计划的那一刻，屋里安静了两秒。有人笑了一声，有人低头继续刷手机。',
    choices: [
      { id: 'a', text: '不解释，做出来再说', hint: '省下力气，但要独自扛住怀疑', tags: { moral: 'neutral', efficiency: 'direct', social: 'antagonize' }, check: { stat: 'san', difficulty: 14 } },
      { id: 'b', text: '拉一个人一起做', hint: '有人陪，但要分出主导权', tags: { moral: 'good', efficiency: 'indirect', social: 'ally' }, check: { stat: 'bond', difficulty: 12 } },
      { id: 'c', text: '当场把计划讲清楚', hint: '可能说服他们，也可能更尴尬', tags: { moral: 'neutral', efficiency: 'direct', social: 'neutral' }, check: { stat: 'skill', difficulty: 16 } },
    ],
  },
  {
    title: '代价清单',
    scene: '深夜走廊',
    dilemma: '你已经连续很多天没有好好睡觉。要继续，就得接受身体先垮；要停，就得接受被人超过。',
    choices: [
      { id: 'a', text: '再撑一周，把节点做完', hint: '进度保住，身体记账', tags: { moral: 'neutral', efficiency: 'risky', social: 'neutral' }, check: { stat: 'san', difficulty: 15 } },
      { id: 'b', text: '今晚就睡，明天早起补', hint: '状态回来，进度慢一点', tags: { moral: 'good', efficiency: 'indirect', social: 'neutral' } },
      { id: 'c', text: '找人替你顶一晚', hint: '欠人情，但能喘口气', tags: { moral: 'neutral', efficiency: 'indirect', social: 'ally' }, check: { stat: 'bond', difficulty: 13 } },
    ],
  },
  {
    title: '最后一问',
    scene: '会议室',
    dilemma: '对面把话挑明了：这条路要给一个答复，今天就得给。你手上的信息还不够多。',
    choices: [
      { id: 'a', text: '接，先上车再补票', hint: '机会到手，风险全担', tags: { moral: 'neutral', efficiency: 'risky', social: 'neutral' }, check: { stat: 'skill', difficulty: 16 } },
      { id: 'b', text: '问清楚条件再答复', hint: '信息更全，但可能被换人', tags: { moral: 'good', efficiency: 'indirect', social: 'neutral' }, check: { stat: 'bond', difficulty: 12 } },
      { id: 'c', text: '坦白自己还没准备好', hint: '诚实，但把主动权交出去了', tags: { moral: 'good', efficiency: 'direct', social: 'ally' }, check: { stat: 'san', difficulty: 14 } },
    ],
  },
];

/** 按幕次与状态挑一个本地情节（确定性：同一幕同一状态永远同一套）。 */
export function fallbackPlotBrief(context: NarrativeContext): PlotBrief {
  const index = Math.min(LOCAL_PLOTS.length - 1, Math.max(0, context.world.act - 1));
  const plot = LOCAL_PLOTS[index] ?? LOCAL_PLOTS[0];

  // 抖音…不，难度仍要经过动态适配：模板给的是基准值
  const offset = context.difficultyOffset;
  const choices = plot.choices.map((choice) => ({
    ...choice,
    ...(choice.check
      ? { check: { ...choice.check, difficulty: clampCheckDifficulty(choice.check.difficulty, offset) } }
      : {}),
  }));

  return {
    title: plot.title,
    scene: plot.scene,
    dilemma: plot.dilemma,
    choices,
    referencedKnowledgeIds: context.knowledge.slice(0, 1).map((item) => item.id),
    threadIds: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Director：一次完整调用                                                       */
/* -------------------------------------------------------------------------- */

export interface DirectInput {
  readonly context: NarrativeContext;
  readonly adjustment: DifficultyAdjustment;
  readonly router: ProviderRouter | null;
  readonly allowedThreadIds?: readonly string[];
  readonly now?: () => number;
}

export async function directPlot(input: DirectInput): Promise<AgentOutput> {
  const startedAt = (input.now ?? Date.now)();
  const timings: { stage: string; ms: number }[] = [];
  const allowedThreadIds = input.allowedThreadIds ?? [];
  const allowedKnowledgeIds = input.context.knowledge.map((item) => item.id);

  if (!input.router || input.router.providers.length === 0) {
    timings.push({ stage: 'fallback', ms: 0 });
    return {
      brief: fallbackPlotBrief(input.context),
      source: 'fallback',
      issue: 'no-provider',
      provider: null,
      model: null,
      timings,
    };
  }

  const trace = createTrace();
  const modelStart = (input.now ?? Date.now)();
  const routed = await input.router.complete('plot-director', [
    { role: 'system', content: PLOT_SYSTEM_PROMPT },
    { role: 'user', content: buildPlotUserPrompt(input.context, allowedThreadIds) },
  ]);
  timings.push({ stage: 'plot-director', ms: (input.now ?? Date.now)() - modelStart });

  if (!routed.ok) {
    trace.note('plot-model-failed');
    trace.finish({ phase: 'fallback', attempts: routed.attempts.length });
    timings.push({ stage: 'fallback', ms: (input.now ?? Date.now)() - startedAt });
    return {
      brief: fallbackPlotBrief(input.context),
      source: 'fallback',
      issue: routed.attempts.at(-1)?.code ?? 'model-failed',
      provider: null,
      model: null,
      timings,
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(routed.text);
  } catch {
    parsed = null;
  }

  const normalized = normalizePlotBrief(parsed, {
    allowedKnowledgeIds,
    allowedThreadIds,
    adjustment: input.adjustment,
  });

  if (!normalized.ok || !normalized.brief) {
    trace.note(`plot-invalid:${normalized.issues[0] ?? 'unknown'}`);
    trace.finish({ phase: 'fallback', provider: routed.provider });
    timings.push({ stage: 'fallback', ms: (input.now ?? Date.now)() - startedAt });
    return {
      brief: fallbackPlotBrief(input.context),
      source: 'fallback',
      issue: normalized.issues[0] ?? 'invalid-brief',
      provider: routed.provider,
      model: routed.model,
      timings,
    };
  }

  trace.note(routed.provider ?? 'model');
  trace.finish({ phase: 'ok', choices: normalized.brief.choices.length, issues: normalized.issues.length });

  return {
    brief: normalized.brief,
    source: 'model',
    issue: normalized.issues.length > 0 ? normalized.issues[0] : null,
    provider: routed.provider,
    model: routed.model,
    timings,
  };
}
