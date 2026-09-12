import type { RunMemory } from '@/core/memory';

/**
 * 跨周期记忆的客户端封装。
 *
 * 与服务端 `/api/memory` 对应。设计要点：
 *
 * 1. **未登录是正常状态**，不是错误。返回 `authenticated: false`，
 *    调用方据此隐藏记忆相关 UI，而不是弹错误。
 * 2. **永不抛异常**：网络错误、超时、响应形状不对都返回结构化结果。
 * 3. 服务端已经做了字段钳制，这里只做形状校验。
 */

export interface MemoryState {
  /** 当前是否已登录知乎账号。 */
  readonly authenticated: boolean;
  /** 上一局记忆；没有则为 null。 */
  readonly memory: RunMemory | null;
  /** 累计推演次数。 */
  readonly totalRuns: number;
}

const EMPTY_STATE: MemoryState = { authenticated: false, memory: null, totalRuns: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMemory(raw: unknown): RunMemory | null {
  if (!isRecord(raw)) {
    return null;
  }

  const status = raw.status === 'OVER_SUCCESS' ? 'OVER_SUCCESS' : 'OVER_SAN_DEPLETED';

  return {
    totalRuns: typeof raw.totalRuns === 'number' && raw.totalRuns > 0 ? raw.totalRuns : 1,
    goal: typeof raw.goal === 'string' ? raw.goal : '一次没有名字的推演',
    originId: typeof raw.originId === 'string' ? raw.originId : 'assassin',
    lastAct: typeof raw.lastAct === 'number' ? raw.lastAct : 1,
    status,
    causeOfDeath:
      typeof raw.causeOfDeath === 'string' ? raw.causeOfDeath : '在关键的一幕没能顶住',
    finalWords: typeof raw.finalWords === 'string' ? raw.finalWords : '',
    personalityTags: Array.isArray(raw.personalityTags)
      ? raw.personalityTags.filter((tag): tag is string => typeof tag === 'string').slice(0, 6)
      : [],
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  };
}

/** 读取当前账号记忆。未登录或失败时返回「未登录」状态。 */
export async function fetchMemory(options: { signal?: AbortSignal } = {}): Promise<MemoryState> {
  try {
    const response = await fetch('/api/memory', {
      method: 'GET',
      cache: 'no-store',
      signal: options.signal,
    });

    if (!response.ok) {
      return EMPTY_STATE;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return EMPTY_STATE;
    }

    const authenticated = payload.authenticated === true;

    return {
      authenticated,
      memory: parseMemory(payload.memory),
      totalRuns: typeof payload.totalRuns === 'number' ? payload.totalRuns : 0,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export interface SaveRunResult {
  readonly authenticated: boolean;
  /** 只有**真的落盘**时才为 true。UI 不得以别的方式宣称已保存。 */
  readonly saved: boolean;
  /** 与 saved 同义，命名更明确。 */
  readonly persisted: boolean;
  readonly totalRuns: number;
  /** 结果码：`ok` / `storage-write-failed` / `no-run-to-seal` / `not-signed-in` / `network-error`。 */
  readonly reason: string;
}

const FAILED_RESULT: SaveRunResult = {
  authenticated: false,
  saved: false,
  persisted: false,
  totalRuns: 0,
  reason: 'network-error',
};

/**
 * 保存一局战绩（终局第一步）。
 *
 * 未登录时服务端返回 200 + `saved: false` —— 这是设计行为，
 * 游客照常结算，只是记忆不保留。调用方据此在结算页显示登录引导。
 *
 * ⚠️ 磁盘只读等情况服务端会返回 `persisted: false`：此时**不得宣称已保存**，
 * 要如实说明这一局没能写进宇宙。
 */
export async function saveRun(
  record: Omit<RunMemory, 'totalRuns' | 'savedAt'>,
): Promise<SaveRunResult> {
  try {
    const response = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      cache: 'no-store',
    });

    if (!response.ok) {
      return FAILED_RESULT;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return FAILED_RESULT;
    }

    const persisted = payload.persisted === true;

    return {
      authenticated: payload.authenticated === true,
      saved: persisted,
      persisted,
      totalRuns: typeof payload.totalRuns === 'number' ? payload.totalRuns : 0,
      reason: typeof payload.reason === 'string' ? payload.reason : persisted ? 'ok' : 'unknown',
    };
  } catch {
    return FAILED_RESULT;
  }
}

/**
 * 封存遗言（终局第二步）。
 *
 * 只有 `persisted === true` 时才允许展示「已封存」——
 * 遗言是这一局唯一会被下一局读到的东西，谎报等于直接毁掉记忆闭环。
 */
export async function sealFinalWords(finalWords: string): Promise<SaveRunResult> {
  try {
    const response = await fetch('/api/memory', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ finalWords }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return FAILED_RESULT;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return FAILED_RESULT;
    }

    const persisted = payload.persisted === true;

    return {
      authenticated: payload.authenticated === true,
      saved: persisted,
      persisted,
      totalRuns: 0,
      reason: typeof payload.reason === 'string' ? payload.reason : persisted ? 'ok' : 'unknown',
    };
  } catch {
    return FAILED_RESULT;
  }
}
