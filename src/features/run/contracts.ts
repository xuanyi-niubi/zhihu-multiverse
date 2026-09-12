/**
 * Run / Challenge / Boss 的公共契约（V3 P0：先定协议，不改玩法）。
 *
 * 这一层刻意只放**类型 + 纯校验函数**，不碰任何 IO：它是后续 P1（确定性因果内核）、
 * P2（终端 Boss）、P3（知识证据链）共同依赖的地基。三条贯穿全篇的约束写在这里：
 *
 * 1. **规则确定性**：事件、骰面、掉落、状态变化只由 `seed + scenarioRevision + stableId` 决定。
 * 2. **AI 不得决定胜负**：模型只能给 `-3..+5` 的有限修正，骰面、DC、掉落、属性变化一律由代码裁决。
 * 3. **来源必须可指认**：一切引用只存 `sourceId`，模型不能凭空造链接或答主。
 */

/* -------------------------------------------------------------------------- */
/* 1. RunManifest：一局的身份与可复现指纹                                      */
/* -------------------------------------------------------------------------- */

/**
 * 一局推演的身份。
 *
 * `eventPlanHash` / `sourceSetHash` 是**可复现性**的关键：同一份 Manifest
 * 必须推出同一套事件计划与同一组来源，否则「挑战链接」在 AI 剧本下就是空话。
 */
export interface RunManifest {
  readonly version: 3;
  readonly runId: string;
  readonly seed: string;
  readonly scenarioId: string;
  /** 剧本修订号：改过剧本内容就要 +1，否则老挑战会静默变味道。 */
  readonly scenarioRevision: string;
  /** 事件计划（选了哪些模板、什么顺序）的哈希。 */
  readonly eventPlanHash: string;
  /** 本局引用到的来源集合哈希。 */
  readonly sourceSetHash: string;
  /** AI 剧本的挑战必须带上它 —— 服务端据此取回不可变快照。 */
  readonly challengeId?: string;
}

/** 校验用的宽松输入形状（外部数据一律按 unknown 处理）。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** 哈希位：只接受十六进制，长度固定 16/40/64 —— 不放行任意字符串。 */
function isHexHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value);
}

export type ManifestParse =
  | { readonly ok: true; readonly manifest: RunManifest }
  | { readonly ok: false; readonly reason: string };

/**
 * 解析 RunManifest。
 *
 * 严格是有意的：挑战链接要经手用户，任何字段被篡改都意味着「同一场推演」不再成立，
 * 这时宁可拒绝，也不要静默降级成一场看似可比的推演。
 */
export function parseRunManifest(raw: unknown): ManifestParse {
  const record = asRecord(raw);
  if (!record) {
    return { ok: false, reason: 'not-an-object' };
  }
  if (record.version !== 3) {
    return { ok: false, reason: 'unsupported-version' };
  }

  const runId = asString(record.runId, 64);
  const seed = asString(record.seed, 64);
  const scenarioId = asString(record.scenarioId, 64);
  const scenarioRevision = asString(record.scenarioRevision, 32);

  if (!runId) return { ok: false, reason: 'invalid-runId' };
  if (!seed) return { ok: false, reason: 'invalid-seed' };
  if (!scenarioId) return { ok: false, reason: 'invalid-scenarioId' };
  if (!scenarioRevision) return { ok: false, reason: 'invalid-scenarioRevision' };
  if (!isHexHash(record.eventPlanHash)) return { ok: false, reason: 'invalid-eventPlanHash' };
  if (!isHexHash(record.sourceSetHash)) return { ok: false, reason: 'invalid-sourceSetHash' };

  const challengeId = record.challengeId === undefined ? undefined : asString(record.challengeId, 64);
  if (record.challengeId !== undefined && !challengeId) {
    return { ok: false, reason: 'invalid-challengeId' };
  }

  return {
    ok: true,
    manifest: {
      version: 3,
      runId,
      seed,
      scenarioId,
      scenarioRevision,
      eventPlanHash: record.eventPlanHash,
      sourceSetHash: record.sourceSetHash,
      ...(challengeId ? { challengeId } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 2. WorldState：隐藏状态只通过信号暴露，不直接给玩家看数值                     */
/* -------------------------------------------------------------------------- */

export interface WorldStats {
  readonly san: number;
  readonly skill: number;
  readonly bond: number;
}

/** 隐藏状态：玩家看不到原始值，只看得到「身体开始报警」这类定性信号。 */
export interface WorldHidden {
  readonly bodyAlarm: number;
  readonly peerPressure: number;
  readonly runway: number;
  readonly mentorTrust: number;
  readonly socialDebt: number;
}

export type HiddenSignal = 'calm' | 'watch' | 'alert' | 'critical';

/**
 * 把隐藏值压成定性信号 —— **这是隐藏状态唯一的对外出口**。
 * 任何 UI 都不应该直接渲染 `bodyAlarm` 的裸数值。
 */
export function toHiddenSignal(value: number): HiddenSignal {
  if (value >= 75) return 'critical';
  if (value >= 50) return 'alert';
  if (value >= 25) return 'watch';
  return 'calm';
}

/* -------------------------------------------------------------------------- */
/* 3. BossEvaluation：AI 只提议，规则引擎裁决                                   */
/* -------------------------------------------------------------------------- */

export type BossDimensionScore = 0 | 1 | 2;

export interface BossEvaluation {
  readonly dimensions: {
    readonly specificity: BossDimensionScore;
    readonly evidenceUse: BossDimensionScore;
    readonly feasibility: BossDimensionScore;
    readonly selfAwareness: BossDimensionScore;
  };
  /** 服务端钳制到 -3..+5 的思路修正。 */
  readonly modifier: number;
  /** 80 字以内的反馈。 */
  readonly feedback: string;
  /** 只能引用本局真实存在的来源 id。 */
  readonly citedSourceIds: readonly string[];
  readonly issues: readonly string[];
}

/** 模型允许给出的修正区间。 */
export const BOSS_MODIFIER_MIN = -3;
export const BOSS_MODIFIER_MAX = 5;

/**
 * 终局方案的字数区间（蓝图 §3.3：20 至 240 字）。
 *
 * 放在契约层而不是路由里：客户端也要用它做即时校验，
 * 而路由模块会 import `next/server`，不能被客户端组件引用。
 */
export const BOSS_ANSWER_MIN = 20;
export const BOSS_ANSWER_MAX = 240;

/** 分数只允许 0/1/2，别的一律压到边界。 */
export function clampDimensionScore(value: unknown): BossDimensionScore {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  if (num <= 0) return 0;
  if (num >= 2) return 2;
  return 1;
}

/**
 * 钳制思路修正。
 *
 * **这一条是「AI 不决定胜负」的执行点**：无论模型返回 ±999 还是 NaN，
 * 落到规则引擎时都只能在 -3..+5 之间，最终胜负仍由 D20 + 属性 + 遗物 + DC 决定。
 */
export function clampBossModifier(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(Math.max(num, BOSS_MODIFIER_MIN), BOSS_MODIFIER_MAX);
}

export type BossParse =
  | { readonly ok: true; readonly evaluation: BossEvaluation }
  | { readonly ok: false; readonly reason: string };

/**
 * 解析并清洗 Boss 判卷结果。
 *
 * @param allowedSourceIds 本局真实存在的来源 id 白名单；模型引用白名单之外的 id 会被丢弃。
 */
export function parseBossEvaluation(raw: unknown, allowedSourceIds: readonly string[]): BossParse {
  const record = asRecord(raw);
  if (!record) {
    return { ok: false, reason: 'not-an-object' };
  }

  const dimensions = asRecord(record.dimensions);
  if (!dimensions) {
    return { ok: false, reason: 'missing-dimensions' };
  }

  const allowed = new Set(allowedSourceIds);
  const cited = Array.isArray(record.citedSourceIds)
    ? record.citedSourceIds
        .filter((id): id is string => typeof id === 'string')
        .filter((id) => allowed.has(id))
        .slice(0, 12)
    : [];

  return {
    ok: true,
    evaluation: {
      dimensions: {
        specificity: clampDimensionScore(dimensions.specificity),
        evidenceUse: clampDimensionScore(dimensions.evidenceUse),
        feasibility: clampDimensionScore(dimensions.feasibility),
        selfAwareness: clampDimensionScore(dimensions.selfAwareness),
      },
      modifier: clampBossModifier(record.modifier),
      feedback: (asString(record.feedback, 200) ?? '').slice(0, 80),
      citedSourceIds: cited,
      issues: Array.isArray(record.issues)
        ? record.issues.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [],
    },
  };
}

/** 四维总分（0..8），用于展示与复盘，不参与胜负计算。 */
export function bossDimensionTotal(evaluation: BossEvaluation): number {
  const d = evaluation.dimensions;
  return d.specificity + d.evidenceUse + d.feasibility + d.selfAwareness;
}
