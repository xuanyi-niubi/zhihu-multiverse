import type { DmSource } from '@/core/dm/generate';
import type { PlayerProfile } from '@/core/dm/profile';
import type { DmTurnInput } from '@/core/dm/prompt';

import type { ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * 前端调用 AI DM 的客户端封装。
 *
 * 与服务端一样保持「永不抛」：超时、网络错误、响应形状不对都返回 null，
 * 由调用方决定是显示加载失败还是继续用离线关卡。
 */

export interface DmClientResult {
  readonly turn: ScenarioTurn;
  readonly source: DmSource;
  /** 第一回合解析出的处境档案；后续回合带回服务端以保持冲突一致。 */
  readonly profile: PlayerProfile | null;
}

function isScenarioTurnLike(value: unknown): value is ScenarioTurn {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.storyText === 'string' &&
    Array.isArray(candidate.choices) &&
    candidate.choices.length >= 2
  );
}

export interface FetchDmTurnOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * 前端超时必须**严格长于**服务端的内部超时，否则会出现「服务端还在正常生成、
 * 前端已经放弃」的竞态：`/api/dm` 要跑知乎搜索 + 最多两轮模型生成，
 * `/api/profile` 要跑最多两次模型调用（先 JSON 后散文）。
 * 服务端在这些情况下都会自行降级并返回 200，前端只要等得住就一定拿得到合法关卡。
 */
const TURN_TIMEOUT_MS = 60_000;
const PROFILE_TIMEOUT_MS = 70_000;
const REPORT_TIMEOUT_MS = 60_000;

export async function fetchDmTurn(
  input: DmTurnInput,
  options: FetchDmTurnOptions = {},
): Promise<DmClientResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? TURN_TIMEOUT_MS);

  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });

  try {
    const response = await fetch('/api/dm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();

    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const turn = (payload as { turn?: unknown }).turn;

    if (!isScenarioTurnLike(turn)) {
      return null;
    }

    const rawSource = (payload as { source?: unknown }).source;
    const source: DmSource =
      rawSource === 'model' || rawSource === 'model-repaired' ? rawSource : 'fallback';

    const profile = (payload as { profile?: unknown }).profile;
    const normalizedProfile =
      typeof profile === 'object' && profile !== null ? (profile as PlayerProfile) : null;

    return { turn, source, profile: normalizedProfile };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}

export interface ProfileClientResult {
  readonly profile: PlayerProfile;
  /** 模型写的处境分析原文；没有则为 null。 */
  readonly analysis: string | null;
  readonly source: 'model' | 'fallback';
}

/** 请求处境解析；失败返回 null，调用方回落到本地确定性解析。 */
export async function fetchProfile(
  goal: string,
  options: FetchDmTurnOptions = {},
): Promise<ProfileClientResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? PROFILE_TIMEOUT_MS);

  try {
    const response = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const profile = (data as { profile?: unknown }).profile;
    if (typeof profile !== 'object' || profile === null) {
      return null;
    }

    const source = (data as { source?: unknown }).source;
    const analysis = (data as { analysis?: unknown }).analysis;

    return {
      profile: profile as PlayerProfile,
      analysis: typeof analysis === 'string' && analysis.trim().length > 0 ? analysis.trim() : null,
      source: source === 'model' ? 'model' : 'fallback',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface RunReportClientResult {
  readonly text: string;
  readonly source: 'model' | 'fallback';
}

/** 请求终局复盘；失败返回 null，由调用方决定是否隐藏该卡片。 */
export async function fetchRunReport(
  payload: unknown,
  options: FetchDmTurnOptions = {},
): Promise<RunReportClientResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? REPORT_TIMEOUT_MS);

  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });

  try {
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const text = (data as { text?: unknown }).text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    const source = (data as { source?: unknown }).source;

    return { text: text.trim(), source: source === 'model' ? 'model' : 'fallback' };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}
