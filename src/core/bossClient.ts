import type { WorldState } from '@/core/run/worldState';

/**
 * 终端 Boss 判卷的客户端封装。
 *
 * 与 `memoryClient` 同一套纪律：**永不抛异常**，一切失败都收敛成结构化结果，
 * 由调用方决定如何如实告知玩家（而不是让终局卡在 loading）。
 */

export type BossVerdictSource = 'model' | 'fallback' | 'cached';

export interface BossVerdictView {
  readonly source: BossVerdictSource;
  readonly dimensions: {
    readonly specificity: number;
    readonly evidenceUse: number;
    readonly feasibility: number;
    readonly selfAwareness: number;
  };
  readonly modifier: number;
  readonly feedback: string;
  readonly issues: readonly string[];
  readonly dc: number;
  readonly dice: number;
  readonly total: number;
  readonly outcome: 'success' | 'failure';
  readonly critical: 'none' | 'critical-success' | 'critical-failure';
  readonly baseModifier: number;
  readonly relicModifier: number;
  readonly bossModifier: number;
  /** 引用本局素材带来的加成（规范：「知识就是力量」）。 */
  readonly knowledgeModifier: number;
  readonly modelIssue: string | null;
}

export interface BossSubmitInput {
  readonly runId: string;
  readonly seed: string;
  readonly scenarioRevision: string;
  readonly turnIndex: number;
  readonly answer: string;
  readonly world: WorldState;
  readonly sources: readonly { readonly id: string; readonly quote: string }[];
  readonly relicModifier?: number;
  readonly signal?: AbortSignal;
}

export type BossSubmitResult =
  | { readonly ok: true; readonly verdict: BossVerdictView }
  | { readonly ok: false; readonly reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 把接口响应转成视图；形状不对就当作失败（不猜、不兜默认值）。 */
export function parseBossVerdict(raw: unknown): BossVerdictView | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const evaluation = asRecord(record.evaluation);
  const dimensions = asRecord(evaluation?.dimensions);
  const adjudication = asRecord(record.adjudication);
  if (!evaluation || !dimensions || !adjudication) {
    return null;
  }

  const source = record.source;
  const outcome = adjudication.outcome;

  return {
    source: source === 'model' || source === 'cached' ? source : 'fallback',
    dimensions: {
      specificity: num(dimensions.specificity),
      evidenceUse: num(dimensions.evidenceUse),
      feasibility: num(dimensions.feasibility),
      selfAwareness: num(dimensions.selfAwareness),
    },
    modifier: num(evaluation.modifier),
    feedback: typeof evaluation.feedback === 'string' ? evaluation.feedback : '',
    issues: Array.isArray(evaluation.issues)
      ? evaluation.issues.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    dc: num(adjudication.dc),
    dice: num(adjudication.dice),
    total: num(adjudication.total),
    outcome: outcome === 'success' ? 'success' : 'failure',
    critical:
      adjudication.critical === 'critical-success' || adjudication.critical === 'critical-failure'
        ? adjudication.critical
        : 'none',
    baseModifier: num(adjudication.baseModifier),
    relicModifier: num(adjudication.relicModifier),
    bossModifier: num(adjudication.bossModifier),
    knowledgeModifier: num(adjudication.knowledgeModifier),
    modelIssue: typeof record.modelIssue === 'string' ? record.modelIssue : null,
  };
}

/** 提交终局方案并取回判卷。 */
export async function submitBossAnswer(input: BossSubmitInput): Promise<BossSubmitResult> {
  try {
    const response = await fetch('/api/boss/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      signal: input.signal,
      body: JSON.stringify({
        runId: input.runId,
        seed: input.seed,
        scenarioRevision: input.scenarioRevision,
        turnIndex: input.turnIndex,
        answer: input.answer,
        world: input.world,
        sources: input.sources,
        relicModifier: input.relicModifier ?? 0,
      }),
    });

    if (!response.ok) {
      return { ok: false, reason: `http-${response.status}` };
    }

    const payload: unknown = await response.json();
    const record = asRecord(payload);
    if (!record) {
      return { ok: false, reason: 'invalid-response' };
    }
    if (record.ok !== true) {
      return { ok: false, reason: typeof record.reason === 'string' ? record.reason : 'unknown' };
    }

    const verdict = parseBossVerdict(record);
    return verdict ? { ok: true, verdict } : { ok: false, reason: 'invalid-verdict' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: /abort/i.test(message) ? 'aborted' : 'network-error' };
  }
}
