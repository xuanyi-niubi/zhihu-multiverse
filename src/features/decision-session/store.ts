import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { removeFile } from '@/core/fsSafe';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { DecisionSession } from '@/features/decision-session/domain';

/**
 * 决策会话仓储（重构方案 §6.5）。
 *
 * ## 为什么先做接口
 *
 * 方案要求参赛版用文件存储，但**必须包在 Repository 接口后**：
 * 赛后换成 SQLite / Postgres 时，业务代码一行都不用改。
 * 把 `writeFileSync` 直接写进 use case，等于把「只能单实例」焊死在业务逻辑里 ——
 * 那是旧版本的问题之一（方案 §1.3 E）。
 *
 * ## 两个存储决定
 *
 * 1. **会话文件名只由 `id` 派生**，因此 `getById` 是 O(1) 读取。
 *    （初版让文件名同时依赖 ownerId，于是读取时必须遍历目录反查 ——
 *    那是自找的复杂度。）
 * 2. **归属校验在 API 层做**，不在存储层。存储层只管存取；
 *    「能不能看这个会话」是授权问题，混进存储会让它变成两个地方的半套逻辑。
 *
 * ## 隔离
 *
 * 与会话/记忆存储一致：**只把哈希写进文件名**，磁盘上不出现身份原文，
 * 也不存在路径穿越。命名空间独立（`decision-session`），不与旧存储混用 ——
 * 旧的是「游戏记忆」，新的是「决策会话」，删除语义与生命周期都不同。
 */

export interface DecisionSessionRepository {
  create(session: DecisionSession): Promise<void>;
  getById(id: string): Promise<DecisionSession | null>;
  save(session: DecisionSession): Promise<void>;
  /** 列出某个身份的全部会话（选择日志用）。 */
  listByOwner(ownerId: string): Promise<readonly DecisionSession[]>;
  /** 删除一个会话（方案 §6.5 要求提供删除入口）。 */
  remove(id: string): Promise<boolean>;
}

function baseDir(): string {
  return process.env.DECISION_SESSION_DIR ?? join(process.cwd(), 'data', 'decision-sessions');
}

/** 会话 id → 文件路径（只由 id 派生，读取是 O(1)）。 */
function sessionFile(id: string): string {
  const digest = createHash('sha256').update(`decision-session:${id}`).digest('hex').slice(0, 40);
  return join(baseDir(), `${digest}.json`);
}

/** 身份 → 该身份的会话 id 索引。 */
function ownerIndexFile(ownerId: string): string {
  const digest = createHash('sha256').update(`decision-session-owner:${ownerId}`).digest('hex').slice(0, 40);
  return join(baseDir(), `owner-${digest}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(baseDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * 会话 id：`s-` + 12 位十六进制。
 *
 * 用可读前缀而不是纯 UUID，是为了在 URL 与日志里一眼看出「这是会话」。
 * 随机源用 `randomUUID`（而不是 `Math.random`）—— 会话 id 会出现在 URL 里，
 * 可预测的 id 意味着任何人可以猜别人的会话地址。
 */
export function newSessionId(): string {
  const hex = createHash('sha256').update(randomUUID()).digest('hex');
  return `s-${hex.slice(0, 12)}`;
}

export function isSessionId(value: string): boolean {
  return /^s-[0-9a-f]{12}$/.test(value);
}

/** 文件实现（72 小时参赛版）。 */
export class FileDecisionSessionRepository implements DecisionSessionRepository {
  async create(session: DecisionSession): Promise<void> {
    writeJson(sessionFile(session.id), session);
    this.indexAdd(session.ownerId, session.id);
  }

  async getById(id: string): Promise<DecisionSession | null> {
    return readJson<DecisionSession>(sessionFile(id));
  }

  async save(session: DecisionSession): Promise<void> {
    writeJson(sessionFile(session.id), session);
    this.indexAdd(session.ownerId, session.id);
  }

  async listByOwner(ownerId: string): Promise<readonly DecisionSession[]> {
    const index = readJson<{ ids: string[] }>(ownerIndexFile(ownerId));
    if (!index) {
      return [];
    }
    const sessions: DecisionSession[] = [];
    for (const id of index.ids) {
      const session = readJson<DecisionSession>(sessionFile(id));
      // 二次核对归属：索引损坏或被手工改动时，不能把别人的会话读出来
      if (session && session.ownerId === ownerId) {
        sessions.push(session);
      }
    }
    return sessions.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  }

  async remove(id: string): Promise<boolean> {
    const session = await this.getById(id);
    if (!session) {
      return false;
    }
    // 先从索引摘除再删文件：顺序反了会留下指向不存在文件的悬挂索引
    const path = ownerIndexFile(session.ownerId);
    const index = readJson<{ ids: string[] }>(path);
    if (index) {
      index.ids = index.ids.filter((item) => item !== id);
      writeJson(path, index);
    }
    // 用 removeFile 而不是 rmSync(force)：后者在本机会静默失败（见 fsSafe.ts）
    removeFile(sessionFile(id));
    return true;
  }

  private indexAdd(ownerId: string, id: string): void {
    const path = ownerIndexFile(ownerId);
    const index = readJson<{ ids: string[] }>(path) ?? { ids: [] };
    if (!index.ids.includes(id)) {
      index.ids.push(id);
      writeJson(path, index);
    }
  }
}

/** 内存实现（测试用）。 */
export class InMemoryDecisionSessionRepository implements DecisionSessionRepository {
  private readonly byId = new Map<string, DecisionSession>();

  async create(session: DecisionSession): Promise<void> {
    this.byId.set(session.id, session);
  }

  async getById(id: string): Promise<DecisionSession | null> {
    return this.byId.get(id) ?? null;
  }

  async save(session: DecisionSession): Promise<void> {
    this.byId.set(session.id, session);
  }

  async listByOwner(ownerId: string): Promise<readonly DecisionSession[]> {
    return [...this.byId.values()]
      .filter((session) => session.ownerId === ownerId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  }

  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}
