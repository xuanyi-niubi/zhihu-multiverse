import { RELIC_LIBRARY } from '@/data/prebuiltScenarios';

import type { DmZhihuSnippet } from '@/core/dm/prompt';
import type { ScenarioCheck, ScenarioChoice, ScenarioOutcome, ScenarioTurn } from '@/data/prebuiltScenarios';
import type { TargetStat } from '@/types/game';

/**
 * AI DM 输出校验与确定性修复层。
 *
 * 与常见「校验器」不同，这里的策略是**能修则修、不轻易拒绝**：
 * 模型输出越界数值就钳制、缺可选字段就补默认、结构轻微错位就重排。
 * 只有「有效选项不足 2 个」这类无法安全修复的情况才返回失败，
 * 交给 generate.ts 走重试或离线兜底。
 *
 * 本文件同样是纯函数、零依赖，且永不抛出异常。
 */

export interface DmIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly repaired: boolean;
}

export interface DmValidateContext {
  readonly turnIndex: number;
  readonly totalTurns: number;
  readonly goal: string;
  readonly snippets: readonly DmZhihuSnippet[];
}

export type DmValidationResult =
  | { readonly ok: true; readonly turn: ScenarioTurn; readonly issues: readonly DmIssue[] }
  | { readonly ok: false; readonly issues: readonly DmIssue[] };

const STAT_KEYS: readonly TargetStat[] = ['san', 'skill', 'bond'];
const MAX_DELTA = 40;
const DEFAULT_SOURCE_URL = 'https://www.zhihu.com';

/** 按回合的 DC 区间，与 Prompt 第三节保持一致。 */
const DC_BANDS: readonly { min: number; max: number }[] = [
  { min: 11, max: 13 },
  { min: 13, max: 15 },
  { min: 15, max: 17 },
  { min: 16, max: 18 },
  { min: 17, max: 19 },
  { min: 18, max: 20 },
  { min: 18, max: 20 },
  { min: 19, max: 21 },
];

const CHOICE_IDS = ['a', 'b', 'c'] as const;

function bandFor(turnIndex: number): { min: number; max: number } {
  const index = Math.min(Math.max(turnIndex, 1), DC_BANDS.length) - 1;
  return DC_BANDS[index];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function pickNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function toStatKey(value: unknown): TargetStat | null {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (!key) {
    return null;
  }
  return STAT_KEYS.find((stat) => stat === key) ?? null;
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\/\S+$/.test(value);
}

/* -------------------------------------------------------------------------- */
/* 字段级归一化                                                                */
/* -------------------------------------------------------------------------- */

function normalizeStatDeltas(
  raw: unknown,
  issues: DmIssue[],
  path: string,
): Partial<Record<TargetStat, number>> {
  const out: Partial<Record<TargetStat, number>> = {};

  if (!isRecord(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({
        path,
        code: 'stat-deltas-not-object',
        message: 'statDeltas 不是对象，已置为空',
        repaired: true,
      });
    }
    return out;
  }

  let touched = false;

  Object.keys(raw).forEach((key) => {
    const stat = toStatKey(key);
    if (!stat) {
      touched = true;
      return;
    }

    const num = pickNumber(raw[key]);
    if (num === null) {
      touched = true;
      return;
    }

    const clamped = clampInt(num, -MAX_DELTA, MAX_DELTA);
    if (clamped !== num) {
      touched = true;
    }
    out[stat] = clamped;
  });

  if (touched) {
    issues.push({
      path,
      code: 'stat-deltas-adjusted',
      message: '属性增减存在越界值或非法键，已钳制到 ±40 并丢弃非法键',
      repaired: true,
    });
  }

  return out;
}

function normalizeOutcome(
  raw: unknown,
  issues: DmIssue[],
  path: string,
  allowRelic: boolean,
): ScenarioOutcome | null {
  if (!isRecord(raw)) {
    return null;
  }

  const feedback = pickString(raw.feedback);
  if (!feedback) {
    issues.push({
      path: `${path}.feedback`,
      code: 'missing-feedback',
      message: '缺少 feedback，分支无法成立',
      repaired: false,
    });
    return null;
  }

  const statDeltas = normalizeStatDeltas(raw.statDeltas, issues, `${path}.statDeltas`);
  const relicId = allowRelic ? pickString(raw.relicId) : null;

  if (relicId && RELIC_LIBRARY[relicId]) {
    return { feedback: truncate(feedback, 140), statDeltas, relicId };
  }

  if (relicId && !RELIC_LIBRARY[relicId]) {
    issues.push({
      path: `${path}.relicId`,
      code: 'unknown-relic',
      message: `遗物 id「${relicId}」不在库中，已丢弃该掉落`,
      repaired: true,
    });
  }

  if (!allowRelic && raw.relicId !== undefined && raw.relicId !== null) {
    issues.push({
      path: `${path}.relicId`,
      code: 'relic-not-allowed',
      message: '只有高风险选项的成功分支可以掉落遗物，已移除',
      repaired: true,
    });
  }

  return { feedback: truncate(feedback, 140), statDeltas };
}

function normalizeCheck(
  raw: unknown,
  ctx: DmValidateContext,
  issues: DmIssue[],
  path: string,
): ScenarioCheck | null {
  if (!isRecord(raw)) {
    return null;
  }

  const targetStat = toStatKey(raw.targetStat);
  if (!targetStat) {
    issues.push({
      path: `${path}.targetStat`,
      code: 'invalid-target-stat',
      message: 'targetStat 非法，无法构造检定',
      repaired: false,
    });
    return null;
  }

  const rawDifficulty = pickNumber(raw.difficulty);
  if (rawDifficulty === null) {
    issues.push({
      path: `${path}.difficulty`,
      code: 'invalid-difficulty',
      message: 'difficulty 不是数值，无法构造检定',
      repaired: false,
    });
    return null;
  }

  const band = bandFor(ctx.turnIndex);
  const globalClamped = clampInt(rawDifficulty, 1, 30);
  const banded = clampInt(globalClamped, band.min, band.max);

  if (banded !== rawDifficulty) {
    issues.push({
      path: `${path}.difficulty`,
      code: 'dc-out-of-band',
      message: `DC ${rawDifficulty} 超出第 ${ctx.turnIndex} 回合区间 ${band.min}-${band.max}，已收敛为 ${banded}`,
      repaired: true,
    });
  }

  return { targetStat, difficulty: banded };
}

/**
 * 氛围短句的替代文案（**不含任何数字与百分比**）。
 *
 * 真实聚合数据上线前，任何具体比例都是编造 —— 这里只给确定性、
 * 不冒充统计的氛围句。
 */
const GHOST_ECHO_FALLBACKS = [
  '很多人在这一步都会犹豫',
  '这个岔口，两种走法都有人选',
  '到了这一步，代价开始变得具体',
  '这里没有标准答案，只有取舍',
] as const;

/**
 * 是否含有编造的统计（数字或百分号）。
 *
 * 真实聚合数据上线前，`ghostEchoStat` 里出现任何数字都按「编造」处理：
 * 若只拦模型、不拦自己，校验层会合成「38% 的同路人…」这类数字 ——
 * 那是纯粹的假数据，产品上等于宣称了我们并不拥有的聚合能力。
 */
export function hasFabricatedStat(text: string): boolean {
  return /[0-9０-９]|[%％]/.test(text);
}

function normalizeGhostEcho(
  raw: unknown,
  turnIndex: number,
  issues: DmIssue[],
  path: string,
): string {
  const text = pickString(raw);

  if (text && text.length >= 6 && !hasFabricatedStat(text)) {
    return truncate(text, 32);
  }

  issues.push({
    path,
    code: text ? 'ghost-echo-fabricated-number' : 'ghost-echo-synthesized',
    message: text
      ? 'ghostEchoStat 含数字或百分比（编造统计），已替换为氛围文案'
      : 'ghostEchoStat 缺失，已合成氛围文案',
    repaired: true,
  });

  return GHOST_ECHO_FALLBACKS[turnIndex % GHOST_ECHO_FALLBACKS.length];
}

function normalizeSourceUrl(
  raw: unknown,
  ctx: DmValidateContext,
  issues: DmIssue[],
  path: string,
): `https://${string}` {
  const candidate = pickString(raw);
  if (candidate && isHttpsUrl(candidate)) {
    return candidate as `https://${string}`;
  }

  const fromSnippet = ctx.snippets
    .map((snippet) => snippet.sourceUrl)
    .find((url) => typeof url === 'string' && isHttpsUrl(url));

  if (fromSnippet) {
    issues.push({
      path,
      code: 'source-url-fallback-snippet',
      message: 'sourceUrl 非法，已回退到检索片段中的链接',
      repaired: true,
    });
    return fromSnippet as `https://${string}`;
  }

  issues.push({
    path,
    code: 'source-url-fallback-default',
    message: 'sourceUrl 非法且无可用片段，已回退到知乎首页',
    repaired: true,
  });
  return DEFAULT_SOURCE_URL as `https://${string}`;
}

function normalizeChoice(
  raw: unknown,
  ctx: DmValidateContext,
  issues: DmIssue[],
  index: 0 | 1 | 2,
): ScenarioChoice | null {
  if (!isRecord(raw)) {
    issues.push({
      path: `choices[${index}]`,
      code: 'choice-not-object',
      message: '选项不是对象',
      repaired: false,
    });
    return null;
  }

  const text = pickString(raw.text);
  if (!text) {
    issues.push({
      path: `choices[${index}].text`,
      code: 'missing-text',
      message: '选项缺少 text',
      repaired: false,
    });
    return null;
  }

  const hint =
    pickString(raw.hint) ?? (index === 0 ? '稳妥：收益有限但风险低' : '高危：需要检定，成败悬殊');

  const ghostEchoStat = normalizeGhostEcho(
    raw.ghostEchoStat,
    ctx.turnIndex,
    issues,
    `choices[${index}].ghostEchoStat`,
  );

  const onSuccess = normalizeOutcome(raw.onSuccess, issues, `choices[${index}].onSuccess`, index === 1);
  if (!onSuccess) {
    issues.push({
      path: `choices[${index}].onSuccess`,
      code: 'missing-on-success',
      message: '缺少成功分支，选项不可用',
      repaired: false,
    });
    return null;
  }

  let check: ScenarioCheck | null = null;

  if (index === 0) {
    if (raw.check !== undefined && raw.check !== null) {
      issues.push({
        path: `choices[${index}].check`,
        code: 'safe-has-check',
        message: '稳妥选项不应带 check，已移除',
        repaired: true,
      });
    }
  } else {
    // index ≥ 1 的选项都可以带检定（第三项是「特殊/多线」选项，同样允许）
    check = normalizeCheck(raw.check, ctx, issues, `choices[${index}].check`);
  }

  const onFail =
    index >= 1 ? normalizeOutcome(raw.onFail, issues, `choices[${index}].onFail`, false) : null;

  const base: ScenarioChoice = {
    id: CHOICE_IDS[index],
    text: truncate(text, 40),
    hint: truncate(hint, 48),
    ghostEchoStat,
    onSuccess,
  };

  return {
    ...base,
    ...(check ? { check } : {}),
    ...(onFail ? { onFail } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* 入口                                                                        */
/* -------------------------------------------------------------------------- */

export function validateDmTurn(input: unknown, ctx: DmValidateContext): DmValidationResult {
  const issues: DmIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        { path: '$', code: 'not-object', message: '顶层不是 JSON 对象', repaired: false },
      ],
    };
  }

  // turnIndex：以服务端上下文为准，模型写错只记录不采纳
  const rawTurnIndex = pickNumber(input.turnIndex);
  if (rawTurnIndex !== null && Math.round(rawTurnIndex) !== ctx.turnIndex) {
    issues.push({
      path: 'turnIndex',
      code: 'turn-index-mismatch',
      message: `模型给出 turnIndex=${rawTurnIndex}，已按上下文修正为 ${ctx.turnIndex}`,
      repaired: true,
    });
  }

  const rawTitle = pickString(input.title);
  const rawStory = pickString(input.storyText);

  if (!rawTitle) {
    issues.push({ path: 'title', code: 'missing-title', message: '缺少 title，已用默认标题', repaired: true });
  }
  if (!rawStory) {
    issues.push({
      path: 'storyText',
      code: 'missing-story',
      message: '缺少 storyText，已用默认情境',
      repaired: true,
    });
  }

  const title = truncate(rawTitle ?? `第 ${ctx.turnIndex} 回合`, 24);
  const storyText = truncate(
    rawStory ??
      `第 ${ctx.turnIndex} 回合的抉择摆在面前：${ctx.goal || '你必须为自己的方向做一次决定'}。`,
    200,
  );

  const bulletRaw = isRecord(input.zhihuBullet) ? input.zhihuBullet : {};
  const author = truncate(
    pickString(bulletRaw.author) ?? ctx.snippets[0]?.author ?? '知乎匿名用户',
    32,
  );
  const quote = truncate(
    pickString(bulletRaw.quote) ??
      ctx.snippets[0]?.quote ??
      '别急着下结论，先把信息补齐，再决定要不要下注。',
    120,
  );
  const sourceUrl = normalizeSourceUrl(bulletRaw.sourceUrl, ctx, issues, 'zhihuBullet.sourceUrl');

  // 溯源角标数据：优先用模型给的，缺失时从命中的检索片段补齐
  const matchedSnippet =
    ctx.snippets.find((snippet) => snippet.sourceUrl === sourceUrl) ?? ctx.snippets[0] ?? null;
  const upvotes = pickNumber(bulletRaw.upvotes) ?? matchedSnippet?.upvotes ?? null;
  const answerId = pickString(bulletRaw.answerId) ?? matchedSnippet?.answerId ?? null;

  const rawChoices = Array.isArray(input.choices) ? input.choices : [];
  if (rawChoices.length === 0) {
    return {
      ok: false,
      issues: [
        ...issues,
        { path: 'choices', code: 'empty-choices', message: 'choices 为空，无法生成关卡', repaired: false },
      ],
    };
  }

  if (rawChoices.length > 3) {
    issues.push({
      path: 'choices',
      code: 'too-many-choices',
      message: `模型给出 ${rawChoices.length} 个选项，只保留前 3 个`,
      repaired: true,
    });
  }

  const normalized: ScenarioChoice[] = [];
  for (let index = 0; index < Math.min(3, rawChoices.length); index += 1) {
    const choice = normalizeChoice(rawChoices[index], ctx, issues, index as 0 | 1 | 2);
    if (choice) {
      normalized.push(choice);
    }
  }

  // 最少 1 个（日常事件允许只有"推进"一项）
  if (normalized.length < 1) {
    return {
      ok: false,
      issues: [
        ...issues,
        {
          path: 'choices',
          code: 'insufficient-valid-choices',
          message: `有效选项仅 ${normalized.length} 个，无法构成关卡`,
          repaired: false,
        },
      ],
    };
  }

  // 选项数松绑（最终版 §5）：日常事件可以只有 1 个「推进」选项，
  // 危机事件 2 个形成风险对比，特殊事件可以到 3 个。
  const [safeRaw, ...restRaw] = normalized;
  const safeChoice = { ...safeRaw, id: 'a' as const };
  const others: ScenarioChoice[] = [];

  restRaw.forEach((choice, offset) => {
    let riskChoice = choice;

    // 只有"风险位"（第一个非稳妥选项）需要自动补检定与失败分支
    if (offset === 0) {
      if (!riskChoice.check) {
        const band = bandFor(ctx.turnIndex);
        riskChoice = {
          ...riskChoice,
          check: { targetStat: 'skill', difficulty: clampInt(12 + ctx.turnIndex, band.min, band.max) },
        };
        issues.push({
          path: 'choices[1].check',
          code: 'risk-missing-check',
          message: '高风险选项缺少 check，已按回合补齐',
          repaired: true,
        });
      }

      if (!riskChoice.onFail) {
        riskChoice = {
          ...riskChoice,
          onFail: {
            feedback: '这一步没走通，你花了不少时间收拾残局，心气也掉了一截。',
            statDeltas: { san: -14, skill: 2 },
          },
        };
        issues.push({
          path: 'choices[1].onFail',
          code: 'risk-missing-fail',
          message: '高风险选项缺少失败分支，已合成',
          repaired: true,
        });
      }
    }

    others.push({ ...riskChoice, id: CHOICE_IDS[offset + 1] ?? 'b' });
  });

  return {
    ok: true,
    turn: {
      turnIndex: ctx.turnIndex,
      title,
      storyText,
      zhihuBullet: {
        author,
        quote,
        sourceUrl,
        ...(typeof upvotes === 'number' ? { upvotes } : {}),
        ...(answerId ? { answerId } : {}),
      },
      choices: [safeChoice, ...others],
    },
    issues,
  };
}
