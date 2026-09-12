import { normalizeConstraints, AXES } from '@/core/decision/axis';
import { buildSandwich, type ConstraintGap } from '@/core/decision/sandwich';

import type { Commitment, CommitmentOutcome, ConstraintProfile, EvidenceMesh, Sandwich } from '@/types/evidence';

/**
 * 证据网格客户端。
 *
 * 与 `core/dmClient.ts` 同一套纪律：**永不抛出**，失败返回 null 让调用方兜底。
 * 前端因此不需要写 try/catch 分支，也不会因为一次网络抖动白屏。
 *
 * **双牌对比刻意没有对应的 HTTP 接口**：网格与约束在浏览器里都有，
 * 裁决是纯函数，所以直接在本地算（`sandwichLocally`）——
 * 这是「机制裁决是纯函数」这个架构决定的第二次兑现：滑杆拖动时零请求。
 */

export interface MeshResult {
  readonly mesh: EvidenceMesh;
  readonly source: 'model' | 'cached' | 'fallback';
  readonly diagnostics: readonly string[];
  /** 实际走的降级路径（v2 §15.1 的 provenance 链）。 */
  readonly retrievedFrom: 'live' | 'snapshot' | 'offline';
  /** 运行模式（v2 §11）。 */
  readonly mode: 'full' | 'ai' | 'demo';
}

export async function fetchMesh(
  input: {
    readonly goal: string;
    readonly background?: string | null;
    /** 黄金 Case id：带上它则服务端走离线档案（已核验快照，零配额）。 */
    readonly caseId?: string;
  },
  options: { readonly signal?: AbortSignal } = {},
): Promise<MeshResult | null> {
  try {
    const response = await fetch('/api/mesh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const mesh = record.mesh;
    if (typeof mesh !== 'object' || mesh === null || !Array.isArray((mesh as EvidenceMesh).paths)) {
      return null;
    }

    const source = record.source;
    const retrievedFrom = record.retrievedFrom;
    const mode = record.mode;

    return {
      mesh: mesh as EvidenceMesh,
      source: source === 'model' || source === 'cached' ? source : 'fallback',
      diagnostics: Array.isArray(record.diagnostics)
        ? record.diagnostics.filter((item): item is string => typeof item === 'string')
        : [],
      retrievedFrom:
        retrievedFrom === 'live' || retrievedFrom === 'snapshot' ? retrievedFrom : 'offline',
      mode: mode === 'full' || mode === 'ai' ? mode : 'demo',
    };
  } catch {
    return null;
  }
}

/**
 * 约束画像的本地存储键。
 *
 * 约束是「玩家自己的条件」，比账号记忆更敏感也更常用 ——
 * 存本地让下一次打开时滑杆停在原位，减少重复输入。
 */
const CONSTRAINT_STORAGE_KEY = 'zhihu-multiverse:constraints:v1';

export function loadConstraints(): ConstraintProfile {
  if (typeof window === 'undefined') {
    return normalizeConstraints(null);
  }
  try {
    const raw = window.localStorage.getItem(CONSTRAINT_STORAGE_KEY);
    if (!raw) {
      return normalizeConstraints(null);
    }
    return normalizeConstraints(JSON.parse(raw));
  } catch {
    return normalizeConstraints(null);
  }
}

export function saveConstraints(constraints: ConstraintProfile): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CONSTRAINT_STORAGE_KEY, JSON.stringify(constraints));
  } catch {
    // 存储不可用（隐私模式）时静默失败：约束不是关键路径
  }
}

/** 轴区间的百分比位置，供滑杆与应力条共用。 */
export function axisPercent(axisId: (typeof AXES)[number]['id'], value: number): number {
  const axis = AXES.find((item) => item.id === axisId);
  if (!axis) {
    return 0;
  }
  const span = axis.max - axis.min;
  if (span <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((value - axis.min) / span) * 100));
}

/* -------------------------------------------------------------------------- */
/* 运行模式与引擎健康状态                                                        */
/* -------------------------------------------------------------------------- */

export interface HealthView {
  readonly mode: 'full' | 'ai' | 'demo';
  /** 该身份是否已登录知乎账号（不影响能否配置 key，只影响记忆）。 */
  readonly authenticated: boolean;
  /** 该身份是否需要自己去 `/settings` 填 key 才能用 AI（v3 之后站点不回退 env）。 */
  readonly needsOwnKey: boolean;
  readonly title: string;
  readonly notice: string;
  readonly evidenceCanJudge: boolean;
  readonly lights: { readonly ai: string; readonly zhihu: string; readonly world: string };
  readonly modelName: string | null;
  readonly tiering: string | null;
}

const EMPTY_HEALTH: HealthView = {
  mode: 'demo',
  // 保守默认：拿不到健康状态时按「没配 key」处理，避免误导访客以为能用 AI
  authenticated: false,
  needsOwnKey: true,
  title: '离线演示模式',
  notice: '未检测到引擎状态，按离线模式运行。',
  evidenceCanJudge: false,
  lights: { ai: 'AI ENGINE       ○ OFFLINE', zhihu: 'ZHIHU EVIDENCE  ○ OFFLINE', world: 'WORLD ENGINE    ● READY' },
  modelName: null,
  tiering: null,
};

/**
 * 读取运行模式（v2 §11 / §20.1）。
 *
 * 只拿「在线 / 离线」这类布尔结论，**永远不拿密钥值** —— 这是 v2 §24 的硬规则。
 * 失败时保守地按 demo 处理：宁可少宣称能力，不要谎报在线。
 */
export async function fetchHealth(
  options: { readonly signal?: AbortSignal } = {},
): Promise<HealthView> {
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      return EMPTY_HEALTH;
    }
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return EMPTY_HEALTH;
    }
    const record = payload as Record<string, unknown>;
    const lights = (typeof record.lights === 'object' && record.lights !== null
      ? record.lights
      : {}) as Record<string, unknown>;
    const model = (typeof record.model === 'object' && record.model !== null
      ? record.model
      : {}) as Record<string, unknown>;
    const tiering = (typeof record.tiering === 'object' && record.tiering !== null
      ? record.tiering
      : {}) as Record<string, unknown>;

    const mode = record.mode === 'full' || record.mode === 'ai' ? record.mode : 'demo';

    return {
      mode,
      authenticated: record.authenticated === true,
      needsOwnKey: record.needsOwnKey !== false,
      title: typeof record.title === 'string' ? record.title : EMPTY_HEALTH.title,
      notice: typeof record.notice === 'string' ? record.notice : EMPTY_HEALTH.notice,
      evidenceCanJudge: record.evidenceCanJudge === true,
      lights: {
        ai: typeof lights.ai === 'string' ? lights.ai : EMPTY_HEALTH.lights.ai,
        zhihu: typeof lights.zhihu === 'string' ? lights.zhihu : EMPTY_HEALTH.lights.zhihu,
        world: typeof lights.world === 'string' ? lights.world : EMPTY_HEALTH.lights.world,
      },
      modelName: typeof model.name === 'string' ? model.name : null,
      tiering: typeof tiering.description === 'string' ? tiering.description : null,
    };
  } catch {
    return EMPTY_HEALTH;
  }
}

/* -------------------------------------------------------------------------- */
/* 证据网格 → AI 回合输入（v2 §1「知乎真正成为游戏核心」）                        */
/* -------------------------------------------------------------------------- */

/** AI DM prompt 消费的语料片段形状（与 `core/dm/prompt.ts` 的 DmZhihuSnippet 同形）。 */
export interface TurnSnippet {
  readonly author: string;
  readonly quote: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly upvotes?: number;
  readonly answerId?: string;
}

/**
 * 把证据网格的**真实路径卡**转成 AI 回合生成可消费的语料片段。
 *
 * 这是 v2 §1 第 1 条的落点：替掉 `play/page.tsx` 里那个 `zhihuSnippets: []`，
 * 让「知乎」真正进入回合生成，而不是只在角标里出现。
 *
 * 两条纪律：
 * - **只取有样本的路线**（`thin` 路线没有卡片，自然不会产生片段）；
 * - **按证据强度排序**，让模型先看到最有据的内容（而不是随机顺序）。
 */
export function meshToTurnSnippets(
  mesh: EvidenceMesh,
  options: { readonly limit?: number } = {},
): readonly TurnSnippet[] {
  const { limit = 5 } = options;
  const seen = new Set<string>();
  const snippets: TurnSnippet[] = [];

  for (const path of mesh.paths) {
    if (path.sampleSize === 0) {
      continue;
    }
    for (const card of path.cards) {
      if (seen.has(card.cardId)) {
        continue;
      }
      seen.add(card.cardId);
      snippets.push({
        author: card.author,
        quote: card.quote,
        sourceUrl: card.sourceUrl,
        title: card.title,
        ...(card.upvotes !== null ? { upvotes: card.upvotes } : {}),
        answerId: card.sourceId,
      });
    }
  }

  return snippets.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* 双牌对比：本地计算，零请求                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 在浏览器里直接算双牌对比。
 *
 * 不调 `/api/sandwich` 的理由：网格（`EvidenceMesh`）与约束都在前端，
 * 裁决是纯函数且 O(路线数)。走网络只会给滑杆加上一次往返延迟，
 * 而「拖动时立刻看到结论翻转」正是这个产品最该丝滑的地方。
 */
export function sandwichLocally(
  mesh: EvidenceMesh,
  constraints: ConstraintProfile,
  gapB?: ConstraintGap,
): Sandwich {
  return buildSandwich({
    meshId: mesh.meshId,
    paths: mesh.paths,
    constraints,
    ...(gapB ? { gapB } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* 承诺回执                                                                     */
/* -------------------------------------------------------------------------- */

export interface CommitmentView {
  readonly authenticated: boolean;
  readonly commitments: readonly Commitment[];
  readonly due: readonly Commitment[];
  readonly overdueDays: number;
  /** 下一局的约束建议：只在有真回执时非空。 */
  readonly hint: string | null;
  readonly resolvedCount: number;
}

const EMPTY_VIEW: CommitmentView = {
  authenticated: false,
  commitments: [],
  due: [],
  overdueDays: 0,
  hint: null,
  resolvedCount: 0,
};

export async function fetchCommitments(
  options: { readonly signal?: AbortSignal } = {},
): Promise<CommitmentView> {
  try {
    const response = await fetch('/api/commitment', {
      method: 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      return EMPTY_VIEW;
    }
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return EMPTY_VIEW;
    }
    const record = payload as Record<string, unknown>;
    return {
      authenticated: record.authenticated === true,
      commitments: Array.isArray(record.commitments) ? (record.commitments as Commitment[]) : [],
      due: Array.isArray(record.due) && typeof record.due === 'object' && record.due !== null
        ? ((record.due as { items?: Commitment[] }).items ?? [])
        : [],
      overdueDays: typeof record.due === 'object' && record.due !== null && typeof (record.due as { overdueDays?: number }).overdueDays === 'number'
        ? ((record.due as { overdueDays: number }).overdueDays)
        : 0,
      hint: typeof record.hint === 'string' ? record.hint : null,
      resolvedCount: typeof record.resolvedCount === 'number' ? record.resolvedCount : 0,
    };
  } catch {
    return EMPTY_VIEW;
  }
}

export interface CommitResult {
  readonly saved: boolean;
  readonly authenticated: boolean;
  readonly reason: string;
  readonly dueAt: string | null;
}

/**
 * 认下一条承诺。
 *
 * 未登录时服务端返回 `saved: false` + `authenticated: false`，
 * 这不是错误 —— 界面据此提示「登录后才会提醒你」，而不是弹错误框。
 */
export async function createCommitment(input: {
  readonly commitmentId: string;
  readonly runId: string;
  readonly action: string;
  readonly timeBox: string;
  readonly signal: string;
  readonly verifyHint: string;
  readonly pathId: string | null;
  readonly windowDays?: number;
}): Promise<CommitResult> {
  try {
    const response = await fetch('/api/commitment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload: unknown = await response.json().catch(() => null);
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

    return {
      saved: record.saved === true,
      authenticated: record.authenticated === true,
      reason: typeof record.reason === 'string' ? record.reason : 'unknown',
      dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
    };
  } catch {
    return { saved: false, authenticated: false, reason: 'network-error', dueAt: null };
  }
}

export async function submitReceipt(input: {
  readonly commitmentId: string;
  readonly outcome: CommitmentOutcome;
  readonly note: string;
  readonly blocker: string;
}): Promise<{ readonly recorded: boolean; readonly persisted: boolean; readonly reason: string }> {
  try {
    const response = await fetch('/api/commitment/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload: unknown = await response.json().catch(() => null);
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    return {
      recorded: record.recorded === true,
      persisted: record.persisted === true,
      reason: typeof record.reason === 'string' ? record.reason : 'unknown',
    };
  } catch {
    return { recorded: false, persisted: false, reason: 'network-error' };
  }
}

/** 删除一条承诺（真删；界面必须提供，否则承诺成了甩不掉的负担）。 */
export async function removeCommitmentById(commitmentId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/commitment?id=${encodeURIComponent(commitmentId)}`, {
      method: 'DELETE',
    });
    const payload: unknown = await response.json().catch(() => null);
    return typeof payload === 'object' && payload !== null && (payload as { removed?: boolean }).removed === true;
  } catch {
    return false;
  }
}
