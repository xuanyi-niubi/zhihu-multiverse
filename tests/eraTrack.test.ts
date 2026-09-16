import { describe, expect, it } from 'vitest';

import { editedYearOf, eraTrackOf } from '@/features/experience/eraTrack';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 平行的时间（时代对照）。
 *
 * 前提已被真实语料验证：本地 39 次实时检索缓存里有 312 条带年份来源，
 * 单个问题的时间跨度可达 13 年（2013–2026）。这组测试守的是**诚实**：
 * 年份是最后编辑时间、凑不出两个时代就说没有对照、没有年份就不猜。
 */

function fact(id: string, year: number | null, overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  return {
    id,
    sourceId: `src-${id}`,
    sourceUrl: `https://www.zhihu.com/answer/${id}`,
    author: `答主-${id}`,
    sourceTitle: null,
    ...(year === null ? {} : { sourceEditTime: Math.floor(Date.UTC(year, 5, 1) / 1000) }),
    exactQuote: `${year ?? '未知'} 年我做了这件事，后来发现它跟当时的环境关系很大。`,
    type: 'action',
    relevance: 0.5,
    purposes: ['similar-person'],
    ...overrides,
  };
}

describe('年份读取', () => {
  it('从 sourceEditTime 取年份', () => {
    expect(editedYearOf(fact('a', 2016))).toBe(2016);
  });

  it('没有时间信息时返回 null（不猜）', () => {
    expect(editedYearOf(fact('a', null))).toBeNull();
  });

  it('明显越界的秒数当作无效', () => {
    expect(editedYearOf(fact('a', null, { sourceEditTime: 0 }))).toBeNull();
    expect(editedYearOf(fact('a', null, { sourceEditTime: Number.NaN }))).toBeNull();
  });
});

describe('时代分桶', () => {
  it('跨 13 年的真实形态：分出两个以上时代，并算出跨度', () => {
    const track = eraTrackOf([fact('a', 2013), fact('b', 2016), fact('c', 2023), fact('d', 2026)]);

    expect(track.comparable).toBe(true);
    expect(track.gapYears).toBe(13);
    expect(track.earliestYear).toBe(2013);
    expect(track.latestYear).toBe(2026);
    // 以最晚年份为锚：≤2018 / 2019–2022 / ≥2023
    expect(track.buckets.map((bucket) => bucket.id)).toEqual(['early', 'recent']);
    expect(track.buckets[0]!.label).toContain('2018');
    expect(track.buckets[1]!.label).toContain('2023');
    expect(track.note).toContain('最后编辑时间');
    expect(track.note).not.toMatch(/成功率|匹配度/);
  });

  it('同一个时代的人 → 不算对照，并如实说明', () => {
    const track = eraTrackOf([fact('a', 2025), fact('b', 2026)]);

    expect(track.comparable).toBe(false);
    expect(track.buckets).toHaveLength(1);
    expect(track.note).toContain('只在');
    expect(track.note).toContain('不为了凑');
  });

  it('完全没有时间信息 → 空轨道 + 不猜年代', () => {
    const track = eraTrackOf([fact('a', null), fact('b', null)]);

    expect(track.buckets).toHaveLength(0);
    expect(track.comparable).toBe(false);
    expect(track.note).toContain('没有可用的时间信息');
  });

  it('每个时代最多取 2 条，且桶内按年份从早到晚', () => {
    const track = eraTrackOf(
      [fact('a', 2013), fact('b', 2014), fact('c', 2015), fact('d', 2026)],
      { maxPerBucket: 2 },
    );
    const early = track.buckets.find((bucket) => bucket.id === 'early')!;
    expect(early.items).toHaveLength(2);
    expect(early.items.map((item) => item.year)).toEqual([2013, 2014]);
  });

  it('片段太短 / 没有作者 / 没有链接的来源不进时代轨道', () => {
    const track = eraTrackOf([
      fact('short', 2014, { exactQuote: '太短了' }),
      fact('noauthor', 2014, { author: '  ' }),
      fact('nolink', 2014, { sourceUrl: '' }),
      fact('ok', 2026),
    ]);

    const ids = track.buckets.flatMap((bucket) => bucket.items.map((item) => item.fact.id));
    expect(ids).toEqual(['ok']);
    expect(track.comparable).toBe(false);
  });

  it('纯函数：同一输入两次结果逐字节一致', () => {
    const input = [fact('a', 2013), fact('b', 2026)];
    expect(JSON.stringify(eraTrackOf(input))).toBe(JSON.stringify(eraTrackOf(input)));
  });
});
