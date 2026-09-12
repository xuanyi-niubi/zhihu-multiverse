import { toModifier } from '@/core/brand';

import type { ZhihuRelic } from '@/types/game';

/**
 * 跨周期本地记忆。
 *
 * 只用 localStorage 存一条最近战局记录，不上传、不联网——数据主权在用户手里。
 * 所有读写都包在 try/catch 里：隐私模式或存储被禁用时静默降级，不影响游戏。
 */

const STORAGE_KEY = 'zhihu_multiverse_last_run';

export interface RunMemory {
  readonly totalRuns: number;
  readonly goal: string;
  readonly originId: string;
  /** 上一局走到第几幕。 */
  readonly lastAct: number;
  readonly status: 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED';
  /** 暴毙原因 / 结局描述。 */
  readonly causeOfDeath: string;
  /** 玩家留下的反思短评（后续可接入输入框）。 */
  readonly finalWords: string;
  readonly personalityTags: readonly string[];
  readonly savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** 读取上一局记忆；没有、损坏或不可用时返回 null。 */
export function readMemory(): RunMemory | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    const status = parsed.status === 'OVER_SUCCESS' ? 'OVER_SUCCESS' : 'OVER_SAN_DEPLETED';

    return {
      totalRuns: typeof parsed.totalRuns === 'number' && parsed.totalRuns > 0 ? parsed.totalRuns : 1,
      goal: safeString(parsed.goal, '一次没有名字的推演'),
      originId: safeString(parsed.originId, 'assassin'),
      lastAct: typeof parsed.lastAct === 'number' ? parsed.lastAct : 1,
      status,
      causeOfDeath: safeString(parsed.causeOfDeath, '在关键的一幕没能顶住'),
      finalWords: safeString(parsed.finalWords),
      personalityTags: Array.isArray(parsed.personalityTags)
        ? parsed.personalityTags.filter((tag): tag is string => typeof tag === 'string').slice(0, 6)
        : [],
      savedAt: safeString(parsed.savedAt),
    };
  } catch {
    return null;
  }
}

/** 写入记忆；传入的上局记录会合并进 totalRuns 计数。 */
export function writeMemory(patch: Omit<RunMemory, 'totalRuns' | 'savedAt'>): RunMemory {
  const previous = readMemory();

  const memory: RunMemory = {
    ...patch,
    totalRuns: (previous?.totalRuns ?? 0) + 1,
    savedAt: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
      // 存储不可用时静默降级
    }
  }

  return memory;
}

export function clearMemory(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* -------------------------------------------------------------------------- */
/* 决策画像：从一局的经历提炼性格标签                                          */
/* -------------------------------------------------------------------------- */

/**
 * 性格标签的判定输入。
 *
 * 全部来自一局的客观记录，不做主观臆测——这是「画像」可信的前提。
 */
export interface ArchetypeInput {
  /** 本次所有选择的文本。 */
  readonly choices: readonly string[];
  /** 是否最终通关。 */
  readonly survived: boolean;
  readonly lastAct: number;
  readonly totalActs: number;
  /** 最后三幕的 SAN 快照，用于判断后期是否崩盘。 */
  readonly sanHistory: readonly number[];
}

interface ArchetypeRule {
  readonly tag: string;
  readonly test: (input: ArchetypeInput) => boolean;
}

/**
 * 标签规则。
 *
 * 刻意保持可解释：每个标签都能被玩家在结算页看到时「对得上自己的行为」，
 * 而不是黑箱打分。顺序即优先级，命中上限 3 个。
 */
const ARCHETYPE_RULES: readonly ArchetypeRule[] = [
  {
    tag: '硬刚型',
    test: (input) =>
      input.choices.filter((text) => /赌|拼|死磕|硬刚|梭哈|豁出去|通宵|推翻|推倒/.test(text))
        .length >= 2,
  },
  {
    tag: '求稳型',
    test: (input) =>
      input.choices.filter((text) => /稳妥|稳一点|按部就班|先不急|保守|继续推进|维持/.test(text))
        .length >= 2,
  },
  {
    tag: '借力型',
    test: (input) => input.choices.some((text) => /找|问|请教|学长|学姐|导师|家人|爸妈|朋友/.test(text)),
  },
  {
    tag: '独行型',
    test: (input) => input.choices.length >= 2 && !input.choices.some((text) => /找|问|请教|学长|学姐|导师|求助/.test(text)),
  },
  {
    tag: '同辈焦虑',
    test: (input) => input.choices.some((text) => /室友|同学|别人|同辈|比较|羡慕/.test(text)),
  },
  {
    tag: '后程崩盘',
    test: (input) => {
      if (input.sanHistory.length < 2) {
        return false;
      }
      const last = input.sanHistory[input.sanHistory.length - 1];
      const peak = Math.max(...input.sanHistory);
      return peak - last >= 40;
    },
  },
  {
    tag: '走完全程',
    test: (input) => input.survived,
  },
  {
    tag: '中途折戟',
    test: (input) => !input.survived && input.lastAct <= input.totalActs - 1,
  },
];

/** 从一局经历里提炼性格标签，最多 3 个。 */
export function deriveArchetypes(input: ArchetypeInput): string[] {
  const tags: string[] = [];

  for (const rule of ARCHETYPE_RULES) {
    if (tags.length >= 3) {
      break;
    }
    try {
      if (rule.test(input) && !tags.includes(rule.tag)) {
        tags.push(rule.tag);
      }
    } catch {
      // 规则异常不影响主流程
    }
  }

  return tags;
}

/* -------------------------------------------------------------------------- */
/* 前世遗念：把上一局的遗言变成这一局的初始卡牌                                  */
/* -------------------------------------------------------------------------- */

/**
 * 「前世遗念」卡牌。
 *
 * 设计意图（来自方案）：完成真正的 Roguelike 循环——玩家用自己踩过的坑
 * 作为下一世的垫脚石。
 *
 * 实现说明：卡牌定义复用 `RELIC_LIBRARY['relic-legacy-note']`
 * （剧本里已有这张【前世的避坑顿悟】，此前只是没有接上跨局记忆）。
 * 这里只做两件事：把引文换成玩家上一局**真的写下**的那句话，
 * 并按上一局走得多远调整加成幅度——走得越远，那一世的教训越值钱。
 */
export const LEGACY_RELIC_ID = 'relic-legacy-note';

/** 由上一局记忆换算出的专业力加成幅度。 */
export function legacySkillBonus(memory: RunMemory): number {
  if (memory.status === 'OVER_SUCCESS') {
    return 12;
  }
  if (memory.lastAct >= 3) {
    return 8;
  }
  return 5;
}

/**
 * 由上一局记忆生成初始遗物。
 *
 * 没有记忆、或上一局没留下遗言时返回 null——不凭空捏造「前世」。
 * 返回的是 `ZhihuRelic`，可直接交给 `equipRelic` 装入遗物栏。
 */
export function legacyRelicFrom(
  memory: RunMemory | null,
  base: ZhihuRelic,
): ZhihuRelic | null {
  if (!memory || memory.finalWords.trim().length === 0) {
    return null;
  }

  const bonus = legacySkillBonus(memory);

  // 只替换引文与加成数值，其余结构（来源、kind、效果形状）沿用原定义
  return {
    ...base,
    quote: memory.finalWords.trim().slice(0, 40),
    effects: [
      {
        effectId: 'effect-legacy-skill',
        stackRule: 'once-per-check',
        type: 'check-modifier',
        targetStat: 'skill',
        modifier: toModifier(bonus),
      },
    ],
  };
}

/**
 * 生成「记忆残响」文案。
 *
 * 第二次开局时插入第一幕，让产品从「一次性玩具」变成「记得你的那个东西」。
 */
export function memoryEchoLine(memory: RunMemory): string {
  // 去掉结尾标点，避免拼进「因「…。」折戟」这种叠标点
  const cause = memory.causeOfDeath.replace(/[。！？.!?\s]+$/, '');
  const verdict =
    memory.status === 'OVER_SUCCESS'
      ? '走到过终点'
      : `在第 ${memory.lastAct} 幕因「${cause}」折戟`;

  const tagLine =
    memory.personalityTags.length > 0 ? `上一世的你是${memory.personalityTags.join('、')}。` : '';

  const wordsLine =
    memory.finalWords.trim().length > 0 ? `你留下过一句话：「${memory.finalWords.trim()}」。` : '';

  return `记忆残响载入中……检测到前世${verdict}。${tagLine}${wordsLine}这一世，你再次站在了十字路口。`;
}

/**
 * 生成给 AI DM 的记忆上下文块。
 *
 * 这是「前世遗念」真正生效的地方：让 AI 以老友口吻在第一幕点出上局挫折，
 * 而不只是前端弹一句话。
 */
export function memoryToPromptBlock(memory: RunMemory | null): string | null {
  if (!memory) {
    return null;
  }

  const lines = [
    '【玩家前世记忆（跨局持久化，来自本机存储）】',
    `- 累计推演次数：第 ${memory.totalRuns} 次`,
    `- 上一次目标：${memory.goal}`,
    memory.status === 'OVER_SUCCESS'
      ? `- 上一次结局：走完全程`
      : `- 上一次结局：在第 ${memory.lastAct} 幕因「${memory.causeOfDeath}」心智归零`,
  ];

  if (memory.personalityTags.length > 0) {
    lines.push(`- 上一次的决策画像：${memory.personalityTags.join('、')}`);
  }

  if (memory.finalWords.trim().length > 0) {
    lines.push(`- 上一次留下的反思：${memory.finalWords.trim()}`);
  }

  lines.push(
    '',
    '【前世记忆使用要求】',
    '1. 如果这不是第一次推演，第一幕的 storyText 必须用知乎老友的口吻，一句话点出他上一次的挫折或选择，并追问这一次是否要改变做法。',
    '2. 不要直接复述上面的字段名，要把它变成自然的第二人称叙述。',
    '3. 如果玩家这一次的选择与上次的反思明显矛盾，可以在结算反馈里轻轻点一下，但不要说教。',
  );

  return lines.join('\n');
}
