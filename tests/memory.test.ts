import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEGACY_RELIC_ID,
  clearMemory,
  deriveArchetypes,
  legacyRelicFrom,
  legacySkillBonus,
  memoryEchoLine,
  memoryToPromptBlock,
  readMemory,
  writeMemory,
  type RunMemory,
} from '@/core/memory';

import { RELIC_LIBRARY } from '@/data/prebuiltScenarios';

/**
 * 跨周期记忆测试。
 *
 * 关注两件事：损坏数据不能导致崩溃，以及文案要把「前世结局」说清楚。
 */

const KEY = 'zhihu_multiverse_last_run';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });

  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function basePatch(): Omit<RunMemory, 'totalRuns' | 'savedAt'> {
  return {
    goal: '大三法学，想转计算机',
    originId: 'assassin',
    lastAct: 3,
    status: 'OVER_SAN_DEPLETED',
    causeOfDeath: '大厂算法连环追问导致心智崩盘',
    finalWords: '千万不要盲目背八股文',
    personalityTags: ['死磕型'],
  };
}

describe('readMemory', () => {
  it('没有记录时返回 null', () => {
    stubStorage();
    expect(readMemory()).toBeNull();
  });

  it('损坏的 JSON 返回 null 而不抛异常', () => {
    stubStorage({ [KEY]: '{不是合法 JSON' });

    expect(() => readMemory()).not.toThrow();
    expect(readMemory()).toBeNull();
  });

  it('字段类型不对时用安全默认值兜底', () => {
    stubStorage({
      [KEY]: JSON.stringify({ totalRuns: 'abc', lastAct: 'x', personalityTags: 'oops' }),
    });

    const memory = readMemory();

    expect(memory).not.toBeNull();
    expect(memory?.totalRuns).toBe(1);
    expect(memory?.lastAct).toBe(1);
    expect(memory?.personalityTags).toEqual([]);
  });

  it('正常记录能读回', () => {
    stubStorage({
      [KEY]: JSON.stringify({ ...basePatch(), totalRuns: 3, savedAt: '2026-09-09T00:00:00.000Z' }),
    });

    const memory = readMemory();

    expect(memory?.totalRuns).toBe(3);
    expect(memory?.causeOfDeath).toContain('算法');
  });
});

describe('writeMemory', () => {
  it('首次写入 totalRuns 为 1', () => {
    stubStorage();

    const memory = writeMemory(basePatch());

    expect(memory.totalRuns).toBe(1);
    expect(memory.savedAt).toBeTruthy();
  });

  it('重复写入累加 totalRuns', () => {
    stubStorage();

    writeMemory(basePatch());
    const second = writeMemory({ ...basePatch(), lastAct: 4, status: 'OVER_SUCCESS' });

    expect(second.totalRuns).toBe(2);
    expect(readMemory()?.status).toBe('OVER_SUCCESS');
  });

  it('存储不可用时也不抛异常', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });

    expect(() => writeMemory(basePatch())).not.toThrow();
  });

  it('clearMemory 清空记录', () => {
    stubStorage();
    writeMemory(basePatch());

    clearMemory();

    expect(readMemory()).toBeNull();
  });
});

describe('memoryEchoLine', () => {
  it('暴毙时说明第几幕、因为什么', () => {
    const line = memoryEchoLine({
      ...basePatch(),
      totalRuns: 2,
      savedAt: '',
    });

    expect(line).toContain('第 3 幕');
    expect(line).toContain('大厂算法连环追问导致心智崩盘');
    expect(line).toContain('记忆残响');
  });

  it('通关时说明走到过终点', () => {
    const line = memoryEchoLine({
      ...basePatch(),
      status: 'OVER_SUCCESS',
      totalRuns: 2,
      savedAt: '',
    });

    expect(line).toContain('走到过终点');
  });

  it('带性格标签与遗言时一并播报', () => {
    const line = memoryEchoLine({
      ...basePatch(),
      totalRuns: 2,
      savedAt: '',
    });

    expect(line).toContain('死磕型');
    expect(line).toContain('千万不要盲目背八股文');
  });
});

describe('deriveArchetypes 决策画像', () => {
  const input = (over: Partial<Parameters<typeof deriveArchetypes>[0]> = {}) => ({
    choices: ['稳妥推进', '继续按部就班'],
    survived: false,
    lastAct: 2,
    totalActs: 4,
    sanHistory: [90, 80, 70],
    ...over,
  });

  it('多次冒险选择判为硬刚型', () => {
    const tags = deriveArchetypes(
      input({ choices: ['通宵死磕项目', '赌一把梭哈', '稳妥推进'] }),
    );
    expect(tags).toContain('硬刚型');
  });

  it('多次保守选择判为求稳型', () => {
    const tags = deriveArchetypes(input({ choices: ['稳妥一点', '按部就班继续', '先不急'] }));
    expect(tags).toContain('求稳型');
  });

  it('出现过求助行为判为借力型', () => {
    const tags = deriveArchetypes(input({ choices: ['找学长请教', '稳妥推进'] }));
    expect(tags).toContain('借力型');
  });

  it('从不求助判为独行型', () => {
    const tags = deriveArchetypes(input({ choices: ['自己扛下来', '继续埋头做'] }));
    expect(tags).toContain('独行型');
  });

  it('SAN 大幅下滑判为后程崩盘', () => {
    const tags = deriveArchetypes(input({ sanHistory: [90, 88, 40] }));
    expect(tags).toContain('后程崩盘');
  });

  it('通关判为走完全程', () => {
    const tags = deriveArchetypes(input({ survived: true, lastAct: 4 }));
    expect(tags).toContain('走完全程');
  });

  it('最多返回 3 个标签', () => {
    const tags = deriveArchetypes(
      input({
        choices: ['通宵死磕', '赌一把梭哈', '问学长', '室友都保研了'],
        survived: true,
        sanHistory: [90, 40],
      }),
    );
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it('无选择时返回空数组且不抛异常', () => {
    expect(() => deriveArchetypes(input({ choices: [] }))).not.toThrow();
  });

  it('标签不重复', () => {
    const tags = deriveArchetypes(input({ choices: ['问学长', '找导师请教'] }));
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('legacyRelicFrom 前世遗念', () => {
  const memory = (over: Partial<RunMemory> = {}): RunMemory => ({
    ...basePatch(),
    totalRuns: 2,
    savedAt: '2026-09-10T00:00:00.000Z',
    ...over,
  });

  /** 复用剧本里已有的同名前世卡作为基底。 */
  const base = RELIC_LIBRARY['relic-legacy-note'];

  it('没有记忆时返回 null，不凭空捏造前世', () => {
    expect(legacyRelicFrom(null, base)).toBeNull();
  });

  it('上一局没留遗言时返回 null', () => {
    expect(legacyRelicFrom(memory({ finalWords: '' }), base)).toBeNull();
    expect(legacyRelicFrom(memory({ finalWords: '   ' }), base)).toBeNull();
  });

  it('有遗言时产出一张合法遗物', () => {
    const relic = legacyRelicFrom(memory(), base);

    expect(relic).not.toBeNull();
    expect(relic?.id).toBe(LEGACY_RELIC_ID);
    expect(relic?.kind).toBe('passive');
    expect(relic?.effects).toHaveLength(1);
    expect(relic?.effects[0].type).toBe('check-modifier');
  });

  it('复用剧本已有卡的结构（来源可追溯，I-12）', () => {
    const relic = legacyRelicFrom(memory(), base);

    expect(relic?.source.sourceUrl).toBe(base.source.sourceUrl);
    expect(relic?.source.sourceUrl.startsWith('https://')).toBe(true);
    expect(relic?.name).toBe(base.name);
  });

  it('引文取自玩家真实遗言且不超过 40 字', () => {
    const relic = legacyRelicFrom(memory({ finalWords: '别盲目背八股' }), base);
    expect(relic?.quote).toBe('别盲目背八股');

    const long = legacyRelicFrom(memory({ finalWords: '一'.repeat(80) }), base);
    expect(long?.quote).toBe('一'.repeat(40));
  });

  it('加成幅度随上一局进度递增', () => {
    expect(legacySkillBonus(memory({ status: 'OVER_SUCCESS' }))).toBe(12);
    expect(legacySkillBonus(memory({ status: 'OVER_SAN_DEPLETED', lastAct: 3 }))).toBe(8);
    expect(legacySkillBonus(memory({ status: 'OVER_SAN_DEPLETED', lastAct: 1 }))).toBe(5);
  });

  it('修正值随进度变化并落在 ±20 合法区间内', () => {
    const effectOf = (m: RunMemory) => {
      const relic = legacyRelicFrom(m, base);
      const effect = relic?.effects[0];
      return effect && effect.type === 'check-modifier' ? effect.modifier : null;
    };

    expect(effectOf(memory({ status: 'OVER_SUCCESS' }))).toBe(12);
    expect(effectOf(memory({ status: 'OVER_SAN_DEPLETED', lastAct: 3 }))).toBe(8);
    expect(effectOf(memory({ status: 'OVER_SAN_DEPLETED', lastAct: 1 }))).toBe(5);

    [12, 8, 5].forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(20));
  });
});

describe('memoryToPromptBlock 注入 AI 的记忆块', () => {
  it('没有记忆时返回 null', () => {
    expect(memoryToPromptBlock(null)).toBeNull();
  });

  it('包含次数、结局与反思', () => {
    const block = memoryToPromptBlock({
      ...basePatch(),
      totalRuns: 3,
      savedAt: '',
    });

    expect(block).toContain('第 3 次');
    expect(block).toContain('大厂算法连环追问导致心智崩盘');
    expect(block).toContain('千万不要盲目背八股文');
    expect(block).toContain('死磕型');
  });

  it('明确要求 AI 用老友口吻点出上局挫折', () => {
    const block = memoryToPromptBlock({ ...basePatch(), totalRuns: 2, savedAt: '' });
    expect(block).toContain('老友');
  });

  it('通关的记忆块不出现「心智归零」', () => {
    const block = memoryToPromptBlock({
      ...basePatch(),
      status: 'OVER_SUCCESS',
      totalRuns: 2,
      savedAt: '',
    });

    expect(block).not.toContain('心智归零');
    expect(block).toContain('走完全程');
  });
});
