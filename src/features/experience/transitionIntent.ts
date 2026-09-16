import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProviderRouter } from '@/agents/providerRouter';
import { safeParseJson } from '@/core/dm/parse';
import type {
  ConceptTerms,
  ProblemFrame,
  TransitionIntent,
} from '@/features/experience/domain';

export interface TransitionExpansion {
  readonly familyOrigins: readonly string[];
  readonly domainOrigins: readonly string[];
  readonly adjacentTargets: readonly string[];
  readonly counterTerms: readonly string[];
}

export interface ExpandTransitionIntentDeps {
  readonly router: ProviderRouter;
  readonly now?: () => number;
  /** 端点对缓存的落盘目录（单测用临时目录；省略时用生产默认目录）。 */
  readonly cacheDir?: string;
}

const EMPTY_TERMS: ConceptTerms = { exact: [], family: [], domain: [], adjacent: [] };
const EMPTY_EXPANSION: TransitionExpansion = {
  familyOrigins: [], domainOrigins: [], adjacentTargets: [], counterTerms: [],
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_CAP = 256;
const expansionCache = new Map<string, { readonly expiresAt: number; readonly value: TransitionExpansion }>();
const GENERIC = new Set([
  '人生', '选择', '问题', '事情', '情况', '经历', '经验', '建议', '工作', '专业',
  '方向', '改变', '其他', '相似', '相关', '行业', '职业', '改变现状', '做出一个改变现状的决定',
]);

/* -------------------------------------------------------------------------- */
/* 1. 端点抽取：只认用户原话                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 意图词 / 转变动词 / 连接词。
 *
 * 这些是**通用汉语句式**，不是职业、专业或人生主题清单 —— 这一条纪律
 * 与设计文档 §4 一致：确定性解析只从用户原话得到 `exact`，
 * 判断「同族、同域、相邻」是后续按需语义扩展的职责。
 */
const INTENT_WORDS: readonly string[] = [
  '我打算', '我准备', '我考虑', '我希望', '我想要', '我想', '打算', '准备', '考虑',
  '希望', '要不要', '该不该', '是否', '想要', '想',
];

/**
 * 转变动词，**长的在前**（先匹配 `转行当` 再匹配 `转行`，最后才是裸 `转`）。
 *
 * 这里曾经出过一个真实事故：只把裸 `转` 当一个字符剥掉，于是
 * 「想转行当导游」被切成 `当导游`、而「想转计算机」在旧实现里被词典
 * 改写成 `转入技术岗` 再剥成 `入技术岗`。检索词与资格门槛都建在这两个
 * 碎片上，结果是机械/电气/会计转导游这类完全合格的候选全部被判为
 * `unrelated`，页面显示「0 位可核验亲历者」。所以顺序很关键。
 */
const TRANSITION_WORDS: readonly string[] = [
  '转专业到', '转专业', '转行做', '转行去', '转行当', '转行到', '转行',
  '改行做', '改行去', '改行', '跨行做', '跨行', '转去做', '转做', '转到', '转去', '转成',
  '去做', '去当', '去干', '成为', '换成', '换到', '换做', '转',
];

/** 动词后面残留的连接字（`转行` + `当` + `导游`）。 */
const CONNECTORS: readonly string[] = ['当', '做', '干', '去', '到', '为'];

/** 句首虚词与自称：`然后想转导游` 里的 `然后`、`我就是想…` 里的 `我`。 */
const DISCOURSE_WORDS: readonly string[] = [
  '然后', '后来', '之后', '接着', '现在', '目前', '所以', '但是', '只是', '就是', '本人', '我自己', '我', '自己',
];

/** 句内截断词：目标只取到转折之前（「想参加比赛但怕影响课程」→ 参加比赛）。 */
const CLAUSE_CUT = /但|不过|只是|然后|所以|而且|而|只是|同时|又怕|就是/;

const TRAILING_NOISE = /(?:工作|职业|行业|方向|领域|专业|学生|毕业生|从业者|从业|这条路|那条路|吧|呢|了|的)$/;

/** 画像兜底词：这些是「没解析出来」的占位符，绝不能当成端点去检索。 */
const PLACEHOLDER = /未明确|改变现状|做出一个|不知道|说不清/;

const ORIGIN_PATTERN =
  /(?:我是|我现在是|目前是|现在是|我原来是|原来是|之前是|本来是|以前是|我学(?:的)?是|我的专业是|我在做|我从事|从事|我读的是)([^，,。！？；;]{2,20}?)(?=(?:，|,|。|！|？|；|然后|但|想|打算|准备|考虑|希望|要不要|是否|该不该|$))/;

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clausesOf(text: string): readonly string[] {
  return text
    .split(/[，,。！？；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function usable(term: string): boolean {
  return term.length >= 2 && term.length <= 16 && !GENERIC.has(term);
}

/**
 * 剥掉意图词、转变动词与残留连接字，留下**目标/起点的名词本身**。
 *
 * 反复剥（最多 6 轮）直到稳定：「转行当导游」→「导游」，
 * 「想做导游」→「导游」，「转计算机」→「计算机」。
 * 剥完不足 2 字时**退回原词组**（`转正` 不能被剥成 `正`）。
 */
function stripPhrase(raw: string): string {
  const original = raw.trim();
  let value = original;
  for (let round = 0; round < 6; round += 1) {
    const before = value;
    for (const word of DISCOURSE_WORDS) {
      if (value.startsWith(word)) {
        value = value.slice(word.length);
        break;
      }
    }
    for (const word of INTENT_WORDS) {
      if (value.startsWith(word)) {
        value = value.slice(word.length);
        break;
      }
    }
    for (const word of TRANSITION_WORDS) {
      if (value.startsWith(word)) {
        value = value.slice(word.length);
        break;
      }
    }
    for (const connector of CONNECTORS) {
      if (value.startsWith(connector) && value.length - connector.length >= 2) {
        value = value.slice(connector.length);
        break;
      }
    }
    if (value === before) break;
  }
  value = value.replace(/^(?:一个|一位|一名|一种)/, '').trim();
  for (let round = 0; round < 3; round += 1) {
    const stripped = value.replace(TRAILING_NOISE, '').trim();
    if (stripped === value) break;
    value = stripped;
  }
  return value.length >= 2 ? value : original.replace(TRAILING_NOISE, '').trim();
}

/** 目标端点：从含意图/转变动词的子句里取宾语。 */
function targetFromQuestion(question: string): string | null {
  const list = clausesOf(question);
  const withIntent = list.find((clause) => INTENT_WORDS.some((word) => clause.includes(word)));
  const withTransition = list.find((clause) =>
    TRANSITION_WORDS.some((word) => word.length >= 2 && clause.includes(word)),
  );
  const clause = withIntent ?? withTransition;
  if (!clause) return null;
  /**
   * 意图词不一定在句首（`电气工程专业想做导游`）—— 从它出现的位置切起，
   * 否则整句都会被当成目标短语。
   */
  const intentAt = INTENT_WORDS
    .map((word) => clause.indexOf(word))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0];
  const scoped = intentAt === undefined ? clause : clause.slice(intentAt);
  const cut = scoped.split(CLAUSE_CUT)[0] ?? scoped;
  const value = stripPhrase(cut);
  return usable(value) && question.includes(value) ? value : null;
}

/** 起点端点：优先 `我是X` 这类明说句式，其次取没有意图动词的首个子句。 */
function originFromQuestion(question: string): string | null {
  const matched = ORIGIN_PATTERN.exec(question)?.[1];
  if (matched) {
    const value = stripPhrase(matched.replace(/^(?:我|本人)/, ''));
    if (usable(value) && question.includes(value)) return value;
  }
  const list = clausesOf(question);
  const candidate = list.find(
    (clause) =>
      !INTENT_WORDS.some((word) => clause.includes(word)) &&
      !TRANSITION_WORDS.some((word) => word.length >= 2 && clause.includes(word)),
  );
  if (!candidate) return null;
  const value = stripPhrase(candidate.replace(/^(?:我|本人)/, ''));
  return usable(value) && question.includes(value) ? value : null;
}

/**
 * 端点判定（对外可见，便于单测与诊断）。
 *
 * **不变量**：返回的词必须能在用户原话里逐字找到。
 * 这条不变量就是这次事故的永久守卫 —— 词典改写出来的
 * `转入技术岗`、剥字剥出来的 `当导游` 都不可能通过它。
 */
export function endpointTerms(input: {
  readonly question: string;
  readonly side: 'origin' | 'target';
  readonly fallback?: string | undefined;
}): ConceptTerms {
  const fromQuestion =
    input.side === 'origin' ? originFromQuestion(input.question) : targetFromQuestion(input.question);
  if (fromQuestion) return { ...EMPTY_TERMS, exact: [fromQuestion] };
  const fallback = input.fallback?.trim();
  if (!fallback || PLACEHOLDER.test(fallback)) return EMPTY_TERMS;
  const value = stripPhrase(fallback);
  return usable(value) && !PLACEHOLDER.test(value) ? { ...EMPTY_TERMS, exact: [value] } : EMPTY_TERMS;
}

/* -------------------------------------------------------------------------- */
/* 2. 意图模型                                                                 */
/* -------------------------------------------------------------------------- */

function transitionOf(frame: ProblemFrame): TransitionIntent['transition'] {
  const text = `${frame.rawQuestion} ${frame.desiredChange}`;
  if (/转专业|跨专业/.test(text)) return 'major-change';
  if (/转行|改行|跳槽|跨行|转[^，。！？\s]{2,}/.test(text)) return 'career-change';
  if (/成为|入行|进入|去做|搬|结束|参加|申请/.test(text)) return 'entry';
  if (/还是|选择|要不要|是否/.test(text)) return 'choice';
  return 'other';
}

/**
 * **类别标签的形状特征** —— 这类词是"概括"，不是检索词。
 *
 * 实测（2026-09-16 线上）：模型对「电工转导游」返回 `技能型蓝领` /
 * `职业资格转型` / `技术转服务`。这些词几乎**不会出现在回答原文里**，
 * 于是放宽查询一条都命中不了 —— 等级分布 0 条同族 / 同域，就是这个原因。
 *
 * 判别**只看词形**，不含任何职业 / 专业 / 行业清单：
 * - 「型 / 类」+ 类别名词（`技能型蓝领`、`技术类岗位`）→ 概括；
 * - 以「群体 / 人群 / 类别 / 阶层 / 领域 / 方向 / 岗位 / 职业 / 类」结尾 → 概括；
 * - 含「转型 / 转换 / 转变 / 升级 / 变动 / 过渡」→ 过程短语（不是身份名词）。
 *
 * 刻意**不**因为一个"型"字就全丢：`发型师` 这类含"型"的具体职业要留下。
 */
const CATEGORY_LABEL =
  /(?:型|类)(?:蓝领|白领|人才|员工|人员|岗位|工作|职业|人格|性格|特征|倾向|的)|(?:群体|人群|类别|阶层|领域|方向|岗位|职业|工种|类)$|转型|转换|转变|转岗|升级|变动|过渡/;

/** 检索词长度上限：太长的一律不是"人们会打出来的说法"。 */
const MAX_SEARCH_TERM_LENGTH = 8;

function validTerms(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/[，。！？；、,.!?;:：]/g, '').trim())
      .filter(
        (item) =>
          item.length >= 2 &&
          item.length <= MAX_SEARCH_TERM_LENGTH &&
          !GENERIC.has(item) &&
          !CATEGORY_LABEL.test(item),
      ),
  ).slice(0, 4);
}

function normalizeExpansion(value: unknown): TransitionExpansion {
  if (typeof value !== 'object' || value === null) return EMPTY_EXPANSION;
  const record = value as Record<string, unknown>;
  return {
    familyOrigins: validTerms(record.familyOrigins),
    domainOrigins: validTerms(record.domainOrigins),
    adjacentTargets: validTerms(record.adjacentTargets),
    counterTerms: validTerms(record.counterTerms),
  };
}

export function buildTransitionIntent(
  frame: ProblemFrame,
  expansion: TransitionExpansion = EMPTY_EXPANSION,
): TransitionIntent {
  const origin = endpointTerms({
    question: frame.rawQuestion,
    side: 'origin',
    fallback: frame.currentSituation,
  });
  const target = endpointTerms({
    question: frame.rawQuestion,
    side: 'target',
    fallback: frame.desiredChange,
  });
  return {
    origin: {
      ...origin,
      family: validTerms(expansion.familyOrigins),
      domain: validTerms(expansion.domainOrigins),
    },
    target: { ...target, adjacent: validTerms(expansion.adjacentTargets) },
    transition: transitionOf(frame),
    counterTerms: validTerms(expansion.counterTerms),
  };
}

/* -------------------------------------------------------------------------- */
/* 3. 语义扩展：一次调用 + 端点对缓存                                            */
/* -------------------------------------------------------------------------- */

/**
 * 扩展提示词的版本号：**改提示词时必须 +1**。
 *
 * 缓存键里带上它，否则改了提示词、线上却继续吃旧提示词的缓存结果
 * （内存 + 落盘，TTL 24 小时），改动看起来"完全没生效" —— 这个坑很隐蔽。
 *
 * v2（2026-09-16）：要求"能直接拿去检索的具体相邻工种 / 专业名"，
 * 并禁止「技能型蓝领」「持证技术工种」这类概括标签。
 */
const EXPANSION_VERSION = 'v2';

/**
 * 缓存键 = **归一化端点对 + 提示词版本**，而不是整句问题。
 *
 * 整句作键只能命中「一字不差的重复提问」；端点对作键能让
 * 「电工转导游」「我是电工专业的，想转行做导游」共用同一份扩展，
 * 也让进程重启后仍然白吃缓存（见下面的落盘）。
 */
function cacheKey(intent: TransitionIntent): string {
  const pair = [
    intent.origin.exact[0] ?? '',
    intent.target.exact[0] ?? '',
    intent.transition,
    EXPANSION_VERSION,
  ].join('|');
  return createHash('sha256').update(pair).digest('hex');
}

function diskDir(override?: string): string | null {
  if (override) return override;
  /** 单测不落盘：否则测试会往仓库 `data/` 里写文件。 */
  if (process.env.VITEST) return null;
  return process.env.TRANSITION_INTENT_CACHE_DIR ?? join(process.cwd(), 'data', 'transition-intent');
}

function readDiskCache(key: string, now: number, dir: string | null): TransitionExpansion | null {
  if (!dir) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf-8')) as {
      readonly expiresAt?: number;
      readonly value?: unknown;
    };
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) return null;
    return normalizeExpansion(parsed.value);
  } catch {
    return null;
  }
}

function writeDiskCache(key: string, value: TransitionExpansion, expiresAt: number, dir: string | null): void {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ expiresAt, value }), 'utf-8');
  } catch {
    // 缓存写失败不构成检索失败
  }
}

function putMemoryCache(key: string, value: TransitionExpansion, expiresAt: number): void {
  if (expansionCache.size >= CACHE_CAP) {
    const oldest = expansionCache.keys().next().value;
    if (typeof oldest === 'string') expansionCache.delete(oldest);
  }
  expansionCache.set(key, { expiresAt, value });
}

export async function expandTransitionIntent(
  frame: ProblemFrame,
  deps: ExpandTransitionIntentDeps,
): Promise<TransitionIntent> {
  const now = deps.now?.() ?? Date.now();
  const exact = buildTransitionIntent(frame);
  const key = cacheKey(exact);
  const dir = diskDir(deps.cacheDir);

  const cachedMemory = expansionCache.get(key);
  if (cachedMemory && cachedMemory.expiresAt > now) {
    return buildTransitionIntent(frame, cachedMemory.value);
  }
  if (cachedMemory) expansionCache.delete(key);

  const cachedDisk = readDiskCache(key, now, dir);
  if (cachedDisk) {
    putMemoryCache(key, cachedDisk, now + CACHE_TTL_MS);
    return buildTransitionIntent(frame, cachedDisk);
  }

  const result = await deps.router.complete(
    'orchestrator',
    [
      {
        role: 'system',
        content: `你只负责扩展检索语义，不回答用户问题。输出一个 JSON 对象：
{"familyOrigins":[],"domainOrigins":[],"adjacentTargets":[],"counterTerms":[]}
每组 0-4 个、每个 2-8 字。

familyOrigins：与起点**同属一个行业大类**、但**具体的相邻工种 / 相邻专业 / 相邻岗位名**。
  形状示例（只是说明"具体到什么程度"，不是词表）：起点是某个具体工种时，要给出同行业里相邻的**真实工种名**；起点是某个专业时，给出相邻的**真实专业名**。
domainOrigins：再放宽一层的**具体专业 / 学科 / 岗位大类名**（仍然要具体）。
adjacentTargets：紧邻目标的具体名称（目标的下游岗位 / 近义角色）。
counterTerms：失败、退出或代价线索。

硬要求：每个词都必须是**能直接拿去检索**的具体名称 —— 把它和用户的目标词用空格连起来搜索，应该能搜到真的走过这条路的回答。
不要给概括性的类别标签：「技能型蓝领」「持证技术工种」「跨行业转岗」这类概括词几乎不会出现在回答原文里，拿去检索一条都命中不了。
不要输出「人生、选择、工作、专业、建议」等泛词，不要写句子，不要解释。
适用于任何人生问题，不限职业、学业或关系；不要依赖任何特定行业的词表。`,
      },
      {
        role: 'user',
        content: `用户原话：${frame.rawQuestion}\n明确起点：${exact.origin.exact.join('、') || '未明确'}\n明确目标：${exact.target.exact.join('、') || '未明确'}`,
      },
    ],
    { jsonMode: true, signal: AbortSignal.timeout(8_000) },
  );

  let expansion = EMPTY_EXPANSION;
  if (result.ok) {
    const parsed = safeParseJson(result.text);
    if (parsed.ok) expansion = normalizeExpansion(parsed.value);
  }
  putMemoryCache(key, expansion, now + CACHE_TTL_MS);
  writeDiskCache(key, expansion, now + CACHE_TTL_MS, dir);
  return buildTransitionIntent(frame, expansion);
}

/** 仅供单测隔离缓存状态（进程内；落盘缓存由临时目录隔离）。 */
export function clearTransitionIntentCacheForTests(): void {
  expansionCache.clear();
}
