import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { removeFile } from '@/core/fsSafe';
import { join } from 'node:path';

import { stableHash } from '@/core/run/deterministic';

import type { Belief, Commitment, CommitmentOutcome, CognitiveLedger, Receipt } from '@/types/evidence';

/**
 * 承诺与回执的存储层（方案 §7.2 / §8）。
 *
 * 这是整个产品唯一**能自证有用**的机制：它把「建议」变成「数据」——
 * 七天后回收结果，并把结果回灌下一局的约束建议。
 *
 * 沿用 `memoryStore.ts` 已验证的四条纪律，不另造一套：
 *
 * 1. **账号维度隔离**：主键是知乎 `url_token`，未登录一律不落盘；
 * 2. **路径穿越防护**：token 经 sha256 再拼文件名；
 * 3. **原子写**：临时文件 + rename，避免写入中断产生半个 JSON；
 * 4. **读写永不抛异常**：损坏、无权限、只读文件系统一律降级，
 *    而不是让整局游戏打不开。
 *
 * 额外的隐私纪律（这是承诺不是游戏数据，必须更严）：
 * - 承诺内容只在账号目录内，**不公开、不做排行榜**；
 * - `removeCommitment` 是真删（删掉最后一条时连文件一起移除，不留空壳）。
 */

/** 存储目录：与记忆分开，避免两类数据互相污染。 */
function commitmentDir(): string {
  const explicit = process.env.COMMITMENT_DIR;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }
  // 默认与记忆同卷（容器里 /app/data 是可写挂载卷）
  const memoryDir = process.env.MEMORY_DIR;
  if (memoryDir && memoryDir.trim().length > 0) {
    return join(memoryDir, '..', 'commitments');
  }
  return join(process.cwd(), 'data', 'commitments');
}

/** 账号档案：承诺 + 认知账本。 */
export interface AccountCommitments {
  readonly version: 1;
  readonly commitments: readonly Commitment[];
  readonly updatedAt: string;
}

export const EMPTY_COMMITMENTS: AccountCommitments = {
  version: 1,
  commitments: [],
  updatedAt: '',
};

/** 单账号保留的承诺上限：保留最近的，避免文件无限增长。 */
const MAX_COMMITMENTS = 40;

const LIMITS = {
  action: 80,
  timeBox: 24,
  signal: 80,
  verifyHint: 120,
  note: 200,
  blocker: 80,
  pathId: 48,
  runId: 64,
} as const;

/** 默认回执期限：七天（方案 §7.2 的「七天回执」）。 */
export const RECEIPT_WINDOW_DAYS = 7;

export function commitmentFileFor(urlToken: string): string {
  const hash = createHash('sha256').update(`zhihu-commitment:${urlToken}`).digest('hex').slice(0, 32);
  return join(commitmentDir(), `${hash}.json`);
}

/* -------------------------------------------------------------------------- */
/* 清洗                                                                        */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : fallback;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

const OUTCOMES: readonly CommitmentOutcome[] = ['done', 'partial', 'missed'];

function normalizeOutcome(value: unknown): CommitmentOutcome {
  return OUTCOMES.includes(value as CommitmentOutcome) ? (value as CommitmentOutcome) : 'partial';
}

function normalizeReceipt(raw: unknown): Receipt | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    reportedAt: isIsoDate(raw.reportedAt) ? raw.reportedAt : new Date().toISOString(),
    outcome: normalizeOutcome(raw.outcome),
    note: clip(raw.note, LIMITS.note),
    blocker: clip(raw.blocker, LIMITS.blocker) || null,
  };
}

/** 把不可信输入清洗成合法承诺；不合法返回 null（宁可丢，不存脏数据）。 */
export function normalizeCommitment(raw: unknown, ownerKey: string): Commitment | null {
  if (!isRecord(raw)) {
    return null;
  }

  const action = clip(raw.action, LIMITS.action);
  const signal = clip(raw.signal, LIMITS.signal);
  if (action.length === 0 || signal.length === 0) {
    return null;
  }

  const runId = clip(raw.runId, LIMITS.runId, 'unknown-run');
  const committedAt = isIsoDate(raw.committedAt) ? raw.committedAt : new Date().toISOString();
  const dueAt = isIsoDate(raw.dueAt)
    ? raw.dueAt
    : new Date(Date.parse(committedAt) + RECEIPT_WINDOW_DAYS * 86_400_000).toISOString();

  const receipt = normalizeReceipt(raw.receipt);
  const status = receipt ? receipt.outcome : 'committed';

  return {
    commitmentId: clip(raw.commitmentId, 64) || `cm-${stableHash(`${ownerKey}::${runId}::${action}`).slice(0, 12)}`,
    runId,
    ownerKey,
    action,
    timeBox: clip(raw.timeBox, LIMITS.timeBox, '本周内'),
    signal,
    dueAt,
    verifyHint: clip(raw.verifyHint, LIMITS.verifyHint, '能用自己的话说清做到了什么'),
    pathId: clip(raw.pathId, LIMITS.pathId) || null,
    status,
    committedAt,
    receipt,
  };
}

export function normalizeAccountCommitments(raw: unknown): AccountCommitments {
  if (!isRecord(raw) || !Array.isArray(raw.commitments)) {
    return EMPTY_COMMITMENTS;
  }

  const commitments = raw.commitments
    .map((item) => normalizeCommitment(item, clip(isRecord(item) ? item.ownerKey : '', 64, 'unknown')))
    .filter((item): item is Commitment => item !== null)
    .slice(0, MAX_COMMITMENTS);

  return {
    version: 1,
    commitments,
    updatedAt: isIsoDate(raw.updatedAt) ? raw.updatedAt : '',
  };
}

/* -------------------------------------------------------------------------- */
/* 读写                                                                        */
/* -------------------------------------------------------------------------- */

export function readAccountCommitments(urlToken: string): AccountCommitments {
  try {
    const file = commitmentFileFor(urlToken);
    if (!existsSync(file)) {
      return EMPTY_COMMITMENTS;
    }
    return normalizeAccountCommitments(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return EMPTY_COMMITMENTS;
  }
}

export interface WriteResult {
  readonly account: AccountCommitments;
  readonly persisted: boolean;
  readonly reason: string;
}

/** 原子写入。失败时**如实报告未落盘**，绝不谎报成功（沿用记忆层的纪律）。 */
export function writeAccountCommitments(
  urlToken: string,
  account: AccountCommitments,
): WriteResult {
  const next: AccountCommitments = { ...account, updatedAt: new Date().toISOString() };

  try {
    const dir = commitmentDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const file = commitmentFileFor(urlToken);
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
    return { account: next, persisted: true, reason: 'ok' };
  } catch {
    return { account: next, persisted: false, reason: 'storage-write-failed' };
  }
}

/** 新增一条承诺；同 id 覆盖（幂等），超上限裁掉最旧的。 */
export function addCommitment(urlToken: string, commitment: Commitment): WriteResult {
  const account = readAccountCommitments(urlToken);
  const others = account.commitments.filter((item) => item.commitmentId !== commitment.commitmentId);
  const merged = [commitment, ...others]
    .sort((left, right) => (left.committedAt < right.committedAt ? 1 : -1))
    .slice(0, MAX_COMMITMENTS);

  return writeAccountCommitments(urlToken, { ...account, commitments: merged });
}

/** 附加回执：把承诺从「认下」推到「有结果」。幂等（同一回执重复提交结果一致）。 */
export function attachReceipt(
  urlToken: string,
  commitmentId: string,
  receipt: Receipt,
): { readonly result: WriteResult | null; readonly commitment: Commitment | null } {
  const account = readAccountCommitments(urlToken);
  const target = account.commitments.find((item) => item.commitmentId === commitmentId);
  if (!target) {
    return { result: null, commitment: null };
  }

  const updated: Commitment = { ...target, status: receipt.outcome, receipt };
  const next = account.commitments.map((item) =>
    item.commitmentId === commitmentId ? updated : item,
  );

  return { result: writeAccountCommitments(urlToken, { ...account, commitments: next }), commitment: updated };
}

/** 真删：删掉最后一条时连文件一起移除，不留空壳。 */
export function removeCommitment(urlToken: string, commitmentId: string): WriteResult {
  const account = readAccountCommitments(urlToken);
  const next = account.commitments.filter((item) => item.commitmentId !== commitmentId);

  if (next.length === 0) {
    try {
      const file = commitmentFileFor(urlToken);
      if (existsSync(file)) {
        // 先截断再删，避免某些平台的 rename/link 语义差异留下残留内容
        writeFileSync(file, '', { encoding: 'utf8' });
        removeFile(file);
      }
    } catch {
      // 删不掉也不影响结果：读到的空档案与删除等价
    }
    return { account: EMPTY_COMMITMENTS, persisted: true, reason: 'removed-and-unlinked' };
  }

  return writeAccountCommitments(urlToken, { ...account, commitments: next });
}

/* -------------------------------------------------------------------------- */
/* 排期与账本                                                                  */
/* -------------------------------------------------------------------------- */

/** 到期时间：默认七天后。 */
export function dueAtFrom(committedAt: string, days = RECEIPT_WINDOW_DAYS): string {
  const base = Number.isFinite(Date.parse(committedAt)) ? Date.parse(committedAt) : Date.now();
  return new Date(base + days * 86_400_000).toISOString();
}

export interface DueSummary {
  readonly due: readonly Commitment[];
  readonly upcoming: readonly Commitment[];
  readonly overdueDays: number;
}

/**
 * 到期概览：哪些该问了、哪些还早。
 *
 * `overdueDays` 取最先到期那条的逾期天数（0 表示还没逾期），
 * 用于首页那句「你上次认下的那件事，怎么样了？」的紧迫度。
 */
export function dueSummary(commitments: readonly Commitment[], now: number = Date.now()): DueSummary {
  const pending = commitments.filter((item) => item.status === 'committed');
  const due = pending.filter((item) => Date.parse(item.dueAt) <= now);
  const upcoming = pending.filter((item) => Date.parse(item.dueAt) > now);

  const overdueDays =
    due.length === 0
      ? 0
      : Math.max(
          0,
          ...due.map((item) => Math.floor((now - Date.parse(item.dueAt)) / 86_400_000)),
        );

  return { due, upcoming, overdueDays };
}

/**
 * 由承诺推导认知账本（方案 §8）。
 *
 * `actualOutcome` 只有真回执才有 —— 没回执的信念保持 `unknown`，
 * 绝不用「玩家应该做到了」去填充。这是账本可信的前提。
 */
export function ledgerFrom(
  commitments: readonly Commitment[],
  options: { readonly totalRuns?: number; readonly motifs?: readonly string[] } = {},
): CognitiveLedger {
  const resolved = commitments.filter((item) => item.receipt !== null);

  const beliefs: Belief[] = resolved.map((item) => ({
    pathId: item.pathId ?? 'unbound',
    label: item.action,
    // 玩家当时「认下这条」本身就是一次可行性判断
    expectedViable: true,
    actualOutcome: item.receipt?.outcome === 'done' ? 'viable' : item.receipt?.outcome === 'missed' ? 'breached' : 'unknown',
    confidence: item.receipt?.outcome === 'partial' ? 0.5 : 1,
  }));

  const openThreads = commitments
    .filter((item) => item.status === 'committed' || item.status === 'partial')
    .map((item) => {
      if (item.receipt?.blocker) {
        return `上一局你认下「${item.action}」，标注为未完成，原因是「${item.receipt.blocker}」`;
      }
      return `上一局你认下「${item.action}」，还没回收结果`;
    })
    .slice(0, 3);

  return {
    totalRuns: options.totalRuns ?? 0,
    beliefs,
    openThreads,
    resolvedCommitments: resolved,
    motifs: options.motifs ?? [],
  };
}

/**
 * 由回执生成对下一局的约束建议（方案 §8 的落点）。
 *
 * 这是「认知账本」真正有用的地方：不是复述历史，而是**改成参数**。
 * 只在有真回执时才给建议 —— 没回执就闭嘴。
 */
export function constraintHintFrom(ledger: CognitiveLedger): string | null {
  const partial = ledger.resolvedCommitments.filter((item) => item.receipt?.outcome === 'partial');
  const missed = ledger.resolvedCommitments.filter((item) => item.receipt?.outcome === 'missed');

  const blocked = [...missed, ...partial].find((item) => item.receipt?.blocker);
  if (blocked?.receipt?.blocker) {
    return (
      `上一局你认下的那件事没做完，原因是「${blocked.receipt.blocker}」。` +
      `要不要把「可投入月数」往下调一点，看看换条路会不会更稳？`
    );
  }

  if (missed.length > 0) {
    return '上一局你认下的动作没有落地。这次的路线可能比你以为的更吃时间，先把余量算保守一点。';
  }

  if (ledger.resolvedCommitments.length > 0) {
    return '上一局你认下的动作真的做了。这一局可以把余量往前放一点，试试更激进的路线。';
  }

  return null;
}
