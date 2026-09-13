import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * 现实记忆仓储（P1-3）。
 *
 * ## 与会话仓储同一套纪律
 *
 * 1. **包在接口后面**：参赛版用文件，赛后换 SQLite / Postgres 时业务代码不动
 *    （`DecisionSessionRepository` 的同一条理由）。
 * 2. **文件名只由哈希派生**：磁盘上不出现身份原文，也不存在路径穿越。
 * 3. **命名空间独立**（`reality-memory`）：与「游戏记忆」「决策会话」分开 ——
 *    生命周期与删除语义都不同（记忆不该随会话删除而消失，它是跨会的）。
 * 4. **单实例硬约束不变**：文件存储意味着多实例会互相覆盖，
 *    这条已经在部署说明里写明，不能被悄悄绕过。
 */

export interface RealityMemoryRepository {
  /** 某个身份的全部记忆（按写入顺序，新的在后）。 */
  listByOwner(ownerId: string): Promise<readonly RealityMemoryEntry[]>;
  /** 覆盖写入某个身份的记忆（去重与升级在 service 层完成）。 */
  save(ownerId: string, entries: readonly RealityMemoryEntry[]): Promise<void>;
}

function baseDir(): string {
  return process.env.REALITY_MEMORY_DIR ?? join(process.cwd(), 'data', 'reality-memory');
}

/** 身份 → 记忆文件路径（只由哈希派生）。 */
function memoryFile(ownerId: string): string {
  const digest = createHash('sha256').update(`reality-memory:${ownerId}`).digest('hex').slice(0, 40);
  return join(baseDir(), `${digest}.json`);
}

function readEntries(path: string): readonly RealityMemoryEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is RealityMemoryEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RealityMemoryEntry).claim === 'string' &&
        typeof (item as RealityMemoryEntry).id === 'string',
    );
  } catch {
    return [];
  }
}

/** 文件存储实现（参赛版默认）。 */
export class FileRealityMemoryRepository implements RealityMemoryRepository {
  async listByOwner(ownerId: string): Promise<readonly RealityMemoryEntry[]> {
    return readEntries(memoryFile(ownerId));
  }

  async save(ownerId: string, entries: readonly RealityMemoryEntry[]): Promise<void> {
    const path = memoryFile(ownerId);
    mkdirSync(baseDir(), { recursive: true });
    writeFileSync(path, JSON.stringify(entries, null, 2), 'utf8');
  }
}

/** 内存实现（测试用；也让「没有持久化目录」的环境不崩）。 */
export class InMemoryRealityMemoryRepository implements RealityMemoryRepository {
  private readonly byOwner = new Map<string, readonly RealityMemoryEntry[]>();

  async listByOwner(ownerId: string): Promise<readonly RealityMemoryEntry[]> {
    return this.byOwner.get(ownerId) ?? [];
  }

  async save(ownerId: string, entries: readonly RealityMemoryEntry[]): Promise<void> {
    this.byOwner.set(ownerId, [...entries]);
  }
}
