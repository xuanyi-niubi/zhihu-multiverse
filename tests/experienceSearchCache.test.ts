import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cacheKeyFor,
  readCachedSearch,
  withExperienceSearchCache,
} from '@/features/experience/searchCache';

import type { ExperienceSearch } from '@/features/experience/retrieve';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 持久化搜索缓存（Phase 5）。
 *
 * 锁失败纪律：坏缓存被忽略、真搜索结果优先落盘、
 * 真实失败时有未过期缓存可顶 —— 但过期缓存绝不顶。
 */

const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const FRESH_CACHED_AT = '2026-09-12T08:00:00.000Z'; // 4 小时前，未过期
const STALE_CACHED_AT = '2026-09-10T08:00:00.000Z'; // 两天前，已过期

function source(url: string): KnowledgeSource {
  return {
    id: `src-${url}`,
    author: '某位走过这条路的人',
    quote: '我当时大二，基础一般，边上课边做项目，最后拿了省二。',
    upvotes: 42,
    url,
    retrievedAt: FRESH_CACHED_AT,
    status: 'verified',
    editTime: 1756684800,
    authority: 3,
  };
}

/** 把一份缓存按 key 直接写进目录（模拟「上次运行时留下的缓存」）。 */
function seedCache(dir: string, query: string, count: number, cachedAt: string, sources: readonly KnowledgeSource[]): void {
  writeFileSync(
    join(dir, `${cacheKeyFor(query, count)}.json`),
    JSON.stringify({ query, count, cachedAt, sources }),
    'utf-8',
  );
}

describe('跨进程缓存命中', () => {
  const dirs: string[] = [];
  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'exp-cache-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('未过期缓存命中 → 真搜索一次都不跑', async () => {
    const dir = scratch();
    seedCache(dir, '大二想参加比赛 经历', 8, FRESH_CACHED_AT, [source('https://www.zhihu.com/cached')]);
    let calls = 0;
    const search: ExperienceSearch = async () => {
      calls += 1;
      return [];
    };
    const wrapped = withExperienceSearchCache(search, { dir, now: () => NOW });
    const result = await wrapped('大二想参加比赛  经历', 8); // 多余空白也命中
    expect(calls).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://www.zhihu.com/cached');
  });

  it('缓存过期 → 照常真实搜索，并把新结果落盘', async () => {
    const dir = scratch();
    seedCache(dir, '大二想参加比赛 经历', 8, STALE_CACHED_AT, [source('https://www.zhihu.com/stale')]);
    const fresh = [source('https://www.zhihu.com/fresh')];
    const search: ExperienceSearch = async () => fresh;
    const wrapped = withExperienceSearchCache(search, { dir, now: () => NOW });
    const result = await wrapped('大二想参加比赛 经历', 8);
    expect(result).toEqual(fresh);

    // 下一次（哪怕进程重启）应该吃到刚落盘的缓存
    const reread = readCachedSearch('大二想参加比赛 经历', 8, { dir, now: NOW });
    expect(reread?.sources.map((item) => item.url)).toEqual(['https://www.zhihu.com/fresh']);
  });

  it('缓存文件坏掉 → 忽略，继续真实搜索', async () => {
    const dir = scratch();
    writeFileSync(join(dir, `${cacheKeyFor('任意问题', 8)}.json`), '{{{不是JSON', 'utf-8');
    const search: ExperienceSearch = async () => [source('https://www.zhihu.com/recovered')];
    const wrapped = withExperienceSearchCache(search, { dir, now: () => NOW });
    const result = await wrapped('任意问题', 8);
    expect(result.map((item) => item.url)).toEqual(['https://www.zhihu.com/recovered']);
  });

  it('真实搜索失败但缓存未过期 → 顶部已命中，不会走到搜索', async () => {
    const dir = scratch();
    seedCache(dir, '同问题', 8, FRESH_CACHED_AT, [source('https://www.zhihu.com/fallback')]);
    const search: ExperienceSearch = async () => {
      throw new Error('限流');
    };
    const wrapped = withExperienceSearchCache(search, { dir, now: () => NOW });
    const result = await wrapped('同问题', 8);
    expect(result.map((item) => item.url)).toEqual(['https://www.zhihu.com/fallback']);
  });

  it('真搜索空且无缓存 → 如实返回空（诚实降级）', async () => {
    const dir = scratch();
    const wrapped = withExperienceSearchCache(async () => [], { dir, now: () => NOW });
    expect(await wrapped('从没搜过的问题', 8)).toHaveLength(0);
  });
});
