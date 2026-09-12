import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 跨周期记忆的服务端存储层。
 *
 * ---------------------------------------------------------------------------
 * 设计决策
 * ---------------------------------------------------------------------------
 *
 * **为什么不用 localStorage（旧实现的局限）**
 *
 * 旧版把记忆写在浏览器里，导致：
 * - 换设备 / 换浏览器 → 记忆消失
 * - 清理缓存 → 记忆消失
 * - 未登录也能有记忆（与「记忆绑定身份」的产品设计相悖）
 *
 * 现在改为服务端按账号存储：登录后记忆跟着知乎账号走，跨设备可见。
 *
 * **用户标识怎么来**
 *
 * 用知乎个人主页 URL 里的 url_token（`zhihu.com/people/<token>`）。
 * 这是知乎的用户永久标识，改昵称不变、不会重名。
 *
 * 绝不能用昵称做 key —— 昵称可改且可重复，两个同名的用户会互相读到对方的记忆。
 * profile 里取不到 url_token 时宁可不存，也不退化成昵称。
 *
 * **存储介质：JSON 文件**
 *
 * 单机单实例部署（见 docker-compose.yml 的说明），JSON 文件足够且零依赖。
 * 文件写入用「临时文件 + rename」保证原子性，避免写入中断产生半个 JSON。
 *
 * ⚠️ 已知边界：容器根文件系统是 read_only（见 docker-compose.yml），
 * 所以记忆目录必须挂载为可写卷，否则写入会失败并降级为「无记忆」。
 * 部署时挂载 /app/data。
 */

/**
 * 记忆存储目录。
 *
 * **惰性求值**，不在模块加载时固化 —— 这样测试可以在运行前设置
 * `MEMORY_DIR` 指向临时目录，避免把测试数据写进项目工作区。
 *
 * （早期版本用模块级 const，结果单元测试把 `data/memory/` 写进了项目根目录，
 * 又被 Next 的 standalone 产物一起打包进镜像。改为函数后这类污染不会再发生。）
 *
 * 容器里通过 compose 的 `MEMORY_DIR: /app/data/memory` 指向挂载卷，
 * 因为根文件系统是只读的。
 */
function dataDir(): string {
  return process.env.MEMORY_DIR ?? join(process.cwd(), 'data', 'memory');
}

/** 单个用户的记忆条数上限，防止文件无限增长。 */
const MAX_RUNS_STORED = 20;

/** 单条记忆的字段长度上限（防御性：字段值来自客户端）。 */
const LIMITS = {
  goal: 200,
  originId: 32,
  causeOfDeath: 120,
  finalWords: 60,
  tag: 16,
  maxTags: 6,
} as const;

/** 一局推演的结果记录。 */
export interface RunRecord {
  readonly goal: string;
  readonly originId: string;
  /** 走到第几幕（1..4）。 */
  readonly lastAct: number;
  readonly status: 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED';
  readonly causeOfDeath: string;
  /** 玩家写下的反思短评，会成为下一局的「前世遗念」。 */
  readonly finalWords: string;
  readonly personalityTags: readonly string[];
  readonly finishedAt: string;
}

/** 一个账号的完整记忆档案。 */
export interface AccountMemory {
  readonly version: 1;
  /** 累计推演次数（含未登录时期的本地局数，导入时合并）。 */
  readonly totalRuns: number;
  /** 最近一局；没有则为 null。 */
  readonly lastRun: RunRecord | null;
  /** 历史战绩（最新的在前），用于未来的「知识图谱复盘」。 */
  readonly history: readonly RunRecord[];
  readonly updatedAt: string;
}

export const EMPTY_MEMORY: AccountMemory = {
  version: 1,
  totalRuns: 0,
  lastRun: null,
  history: [],
  updatedAt: '',
};

/* -------------------------------------------------------------------------- */
/* 用户标识                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 从知乎主页 URL 抽取 url_token。
 *
 * 输入形如 `https://www.zhihu.com/people/zhang-san-12`，返回 `zhang-san-12`。
 * 取不到时返回 null —— 调用方必须据此拒绝存储，而不是退化成昵称。
 */
export function extractUrlToken(profileUrl: string | null | undefined): string | null {
  if (typeof profileUrl !== 'string') {
    return null;
  }

  const match = /zhihu\.com\/people\/([A-Za-z0-9_-]{1,64})/.exec(profileUrl);
  return match ? match[1] : null;
}

/**
 * 把 url_token 映射成文件名。
 *
 * 用 sha256 而不是直接用 token 的原因：token 来自外部输入，
 * 直接拼进路径会有路径穿越风险（`../`）。哈希后只剩十六进制字符，安全。
 */
export function memoryFileFor(urlToken: string): string {
  const hash = createHash('sha256').update(`zhihu-memory:${urlToken}`).digest('hex').slice(0, 32);
  return join(dataDir(), `${hash}.json`);
}

/* -------------------------------------------------------------------------- */
/* 校验与清洗                                                                  */
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

function clipInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function clipTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((tag) => clip(tag, LIMITS.tag))
    .filter((tag) => tag.length > 0)
    .slice(0, LIMITS.maxTags);
}

/**
 * 把不可信输入清洗成合法的 RunRecord。
 *
 * 客户端可以伪造任何字段，所以这里逐项钳制：类型、长度、枚举、数值区间。
 * 不合法就丢弃整条 —— 宁可没有记忆，也不要存进脏数据。
 */
export function normalizeRunRecord(raw: unknown): RunRecord | null {
  if (!isRecord(raw)) {
    return null;
  }

  const goal = clip(raw.goal, LIMITS.goal, '一次没有名字的推演');
  const status =
    raw.status === 'OVER_SUCCESS' ? 'OVER_SUCCESS' : 'OVER_SAN_DEPLETED';
  const finishedAt = clip(raw.finishedAt, 40) || new Date().toISOString();

  return {
    goal,
    originId: clip(raw.originId, LIMITS.originId, 'assassin'),
    lastAct: clipInt(raw.lastAct, 1, 4, 1),
    status,
    causeOfDeath: clip(raw.causeOfDeath, LIMITS.causeOfDeath, '在关键的一幕没能顶住'),
    finalWords: clip(raw.finalWords, LIMITS.finalWords),
    personalityTags: clipTags(raw.personalityTags),
    finishedAt,
  };
}

/** 把磁盘上读到的 JSON 清洗成合法档案。损坏时返回空档案而非抛异常。 */
export function normalizeAccountMemory(raw: unknown): AccountMemory {
  if (!isRecord(raw)) {
    return EMPTY_MEMORY;
  }

  const historyRaw = Array.isArray(raw.history) ? raw.history : [];
  const history = historyRaw
    .map(normalizeRunRecord)
    .filter((record): record is RunRecord => record !== null)
    .slice(0, MAX_RUNS_STORED);

  const lastRunRaw = normalizeRunRecord(raw.lastRun);
  const lastRun = lastRunRaw ?? history[0] ?? null;

  return {
    version: 1,
    totalRuns: clipInt(raw.totalRuns, 0, 100_000, history.length),
    lastRun,
    history,
    updatedAt: clip(raw.updatedAt, 40) || new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* 读写                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 写入结果。
 *
 * **为什么必须有 persisted**：早期实现里 `appendRun()` 把写错误吞掉后照旧返回
 * 合并结果，API 于是无条件回 `saved: true` —— 磁盘只读时页面照样宣称
 * 「已存入你的宇宙」，实际什么都没落盘。这种「假成功」比直接报错更伤：
 * 玩家以为记忆在，下一局却没有。
 *
 * 现在写入失败返回 `persisted: false` + 可诊断 reason，
 * 调用方**只有在 persisted 为 true 时**才允许宣称已保存。
 */
export type PersistReason =
  /** 写入成功。 */
  | 'ok'
  /** 磁盘只读、空间或权限不足：内存结果有效，但没落盘。 */
  | 'storage-write-failed'
  /** 账号下还没有任何一局，无从封存遗言。 */
  | 'no-run-to-seal';

export interface PersistResult {
  /** 合并后的档案（即使没落盘，也是内存里正确的结果）。 */
  readonly memory: AccountMemory;
  /** 是否真的写进了存储。**UI 只能据此宣称「已保存」。** */
  readonly persisted: boolean;
  readonly reason: PersistReason;
}

/**
 * 原子写入一份档案。
 *
 * 先写临时文件再 rename：直接覆盖的话，写入中途进程被杀会留下半个 JSON，
 * 那份记忆就永久损坏了。rename 在同一文件系统内是原子操作。
 */
function persistAccountMemory(urlToken: string, memory: AccountMemory): PersistResult {
  try {
    mkdirSync(dataDir(), { recursive: true });

    const file = memoryFileFor(urlToken);
    const temp = `${file}.${process.pid}.tmp`;

    writeFileSync(temp, JSON.stringify(memory, null, 2), 'utf8');
    renameSync(temp, file);
    return { memory, persisted: true, reason: 'ok' };
  } catch {
    // 只读 / 空间不足 / 权限不足：内存结果依然正确，但如实标记未落盘。
    return { memory, persisted: false, reason: 'storage-write-failed' };
  }
}

/** 读取账号记忆。没有记录、文件损坏、无权限时一律返回空档案，永不抛异常。 */
export function readAccountMemory(urlToken: string): AccountMemory {
  try {
    const file = memoryFileFor(urlToken);
    if (!existsSync(file)) {
      return EMPTY_MEMORY;
    }

    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return normalizeAccountMemory(parsed);
  } catch {
    // 损坏或不可读：当作没有记忆，不影响游戏
    return EMPTY_MEMORY;
  }
}

/**
 * 追加一局战绩。
 *
 * @returns 合并后的档案 + **真实持久化状态**（调用方不得忽略 persisted）。
 */
export function appendRun(urlToken: string, record: RunRecord): PersistResult {
  const previous = readAccountMemory(urlToken);

  const history = [record, ...previous.history].slice(0, MAX_RUNS_STORED);

  const next: AccountMemory = {
    version: 1,
    totalRuns: previous.totalRuns + 1,
    lastRun: record,
    history,
    updatedAt: new Date().toISOString(),
  };

  return persistAccountMemory(urlToken, next);
}

/**
 * 封存遗言：把玩家在终局写下的话写进**最近一局**。
 *
 * 拆成独立一步的原因：终局一出现就要先把本局基础记录存下来（否则中途关页面就丢了），
 * 而遗言是玩家随后才输入的。早期实现只在终局那一刻写一次，
 * 于是「玩家后来写的遗言永远进不了记忆」—— 功能看着在，实际不生效。
 */
export function updateLastRunFinalWords(urlToken: string, finalWords: string): PersistResult {
  const previous = readAccountMemory(urlToken);

  if (!previous.lastRun) {
    return { memory: previous, persisted: false, reason: 'no-run-to-seal' };
  }

  const sealed: RunRecord = {
    ...previous.lastRun,
    finalWords: clip(finalWords, LIMITS.finalWords),
  };

  const history =
    previous.history.length > 0 ? [sealed, ...previous.history.slice(1)] : [sealed];

  const next: AccountMemory = {
    ...previous,
    lastRun: sealed,
    history,
    updatedAt: new Date().toISOString(),
  };

  return persistAccountMemory(urlToken, next);
}

/** 清空账号记忆（用于「重置我的宇宙」这类功能）。 */
export function clearAccountMemory(urlToken: string): boolean {
  try {
    const file = memoryFileFor(urlToken);
    if (!existsSync(file)) {
      return true;
    }

    // 用写空档案代替删除，避免误删与权限纠缠
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(EMPTY_MEMORY, null, 2), 'utf8');
    renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* 供前端消费的视图                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 把服务端档案转成前端认识的形状。
 *
 * 前端的 `RunMemory` 是「上一局」的视角，这里做一次映射，
 * 让前端不必知道服务端存了 history 这件事。
 */
/**
 * 命运档案馆用的历史出口（v3 §15）。
 *
 * 与 `toClientMemory` 刻意分开，因为两者用途不同：
 * - `toClientMemory` 是**开局注入**用的（只要最近一局，形状窄、够喂 prompt）；
 * - 本函数是**展馆用的**（要完整历史，用于时间线）。
 *
 * 合成一个函数会让「只管最近一局」的窄契约被撑大，
 * 进而让开局路径多读不需要的数据。
 */
export function toArchiveRuns(memory: AccountMemory): {
  readonly totalRuns: number;
  readonly runs: readonly RunRecord[];
} {
  return {
    totalRuns: memory.totalRuns,
    // 最新的在前：档案馆是「回看」，不是「按时间读小说」
    runs: [...memory.history].sort((left, right) =>
      left.finishedAt < right.finishedAt ? 1 : left.finishedAt > right.finishedAt ? -1 : 0,
    ),
  };
}
export function toClientMemory(memory: AccountMemory): {
  totalRuns: number;
  goal: string;
  originId: string;
  lastAct: number;
  status: 'OVER_SUCCESS' | 'OVER_SAN_DEPLETED';
  causeOfDeath: string;
  finalWords: string;
  personalityTags: string[];
  savedAt: string;
} | null {
  if (!memory.lastRun) {
    return null;
  }

  return {
    totalRuns: memory.totalRuns,
    goal: memory.lastRun.goal,
    originId: memory.lastRun.originId,
    lastAct: memory.lastRun.lastAct,
    status: memory.lastRun.status,
    causeOfDeath: memory.lastRun.causeOfDeath,
    finalWords: memory.lastRun.finalWords,
    personalityTags: [...memory.lastRun.personalityTags],
    savedAt: memory.updatedAt || memory.lastRun.finishedAt,
  };
}
