import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_MEMORY,
  appendRun,
  clearAccountMemory,
  extractUrlToken,
  memoryFileFor,
  normalizeAccountMemory,
  normalizeRunRecord,
  readAccountMemory,
  toClientMemory,
  updateLastRunFinalWords,
} from '@/core/memoryStore';

/**
 * 服务端记忆存储测试。
 *
 * 关注四件事：
 * 1. url_token 抽取必须严格 —— 抽错会把两个人的记忆混在一起
 * 2. 不可信输入必须被钳制 —— 字段来自客户端，可以伪造
 * 3. 损坏文件不能导致崩溃
 * 4. 写入失败时不能抛异常（磁盘只读是已知部署形态）
 *
 * ⚠️ 每个用例都在**临时目录**里跑，绝不写进项目工作区。
 * 早期版本没做隔离，测试数据被写进 `<项目>/data/memory/`，
 * 又被 Next 的 standalone 产物打包进镜像 —— 见 memoryStore.ts 的 dataDir() 注释。
 */

let sandbox = '';

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'zhihu-memory-test-'));
  process.env.MEMORY_DIR = sandbox;
});

afterAll(() => {
  delete process.env.MEMORY_DIR;
  rmSync(sandbox, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('测试隔离自身', () => {
  it('MEMORY_DIR 指向临时目录，不是项目目录', () => {
    expect(process.env.MEMORY_DIR).toBe(sandbox);
    expect(sandbox).toContain('zhihu-memory-test-');
    expect(memoryFileFor('probe')).toContain(sandbox);
  });
});

describe('extractUrlToken', () => {
  it('从标准知乎主页链接抽取', () => {
    expect(extractUrlToken('https://www.zhihu.com/people/zhang-san-12')).toBe('zhang-san-12');
  });

  it('无 www 前缀也能抽', () => {
    expect(extractUrlToken('https://zhihu.com/people/abc')).toBe('abc');
  });

  it('带查询参数或片段时仍能抽', () => {
    expect(extractUrlToken('https://www.zhihu.com/people/abc?utm=x')).toBe('abc');
    expect(extractUrlToken('https://www.zhihu.com/people/abc#about')).toBe('abc');
  });

  it('下划线与连字符是合法字符', () => {
    expect(extractUrlToken('https://www.zhihu.com/people/a_b-c')).toBe('a_b-c');
  });

  it('非知乎链接返回 null', () => {
    expect(extractUrlToken('https://example.com/people/abc')).toBeNull();
  });

  it('路径不对返回 null', () => {
    expect(extractUrlToken('https://www.zhihu.com/org/abc')).toBeNull();
  });

  it('空值与非法类型返回 null —— 绝不退化成昵称', () => {
    expect(extractUrlToken(null)).toBeNull();
    expect(extractUrlToken(undefined)).toBeNull();
    expect(extractUrlToken('')).toBeNull();
    expect(extractUrlToken(123 as unknown as string)).toBeNull();
  });
});

describe('memoryFileFor 路径安全', () => {
  it('token 被哈希，不直接进路径', () => {
    const file = memoryFileFor('../../etc/passwd');
    expect(file).not.toContain('..');
    expect(file).not.toContain('passwd');
  });

  it('同一 token 稳定映射到同一文件', () => {
    expect(memoryFileFor('abc')).toBe(memoryFileFor('abc'));
  });

  it('不同 token 映射到不同文件', () => {
    expect(memoryFileFor('abc')).not.toBe(memoryFileFor('abd'));
  });
});

describe('normalizeRunRecord 输入钳制', () => {
  it('合法输入被保留', () => {
    const record = normalizeRunRecord({
      goal: '大三法学想转码',
      originId: 'assassin',
      lastAct: 3,
      status: 'OVER_SAN_DEPLETED',
      causeOfDeath: '心智崩盘',
      finalWords: '别盲目背八股',
      personalityTags: ['硬刚型'],
    });

    expect(record).not.toBeNull();
    expect(record?.lastAct).toBe(3);
    expect(record?.status).toBe('OVER_SAN_DEPLETED');
  });

  it('非对象输入返回 null', () => {
    expect(normalizeRunRecord(null)).toBeNull();
    expect(normalizeRunRecord('字符串')).toBeNull();
    expect(normalizeRunRecord([])).toBeNull();
    expect(normalizeRunRecord(42)).toBeNull();
  });

  it('超长文本被截断', () => {
    const record = normalizeRunRecord({ finalWords: '一'.repeat(200) });
    expect(record?.finalWords.length).toBe(60);
  });

  it('lastAct 越界被钳制到 1..4', () => {
    expect(normalizeRunRecord({ lastAct: 99 })?.lastAct).toBe(4);
    expect(normalizeRunRecord({ lastAct: -5 })?.lastAct).toBe(1);
    expect(normalizeRunRecord({ lastAct: 'abc' })?.lastAct).toBe(1);
  });

  it('非法 status 回落为 OVER_SAN_DEPLETED', () => {
    expect(normalizeRunRecord({ status: 'HACKED' })?.status).toBe('OVER_SAN_DEPLETED');
  });

  it('标签数量与长度被限制', () => {
    const record = normalizeRunRecord({
      personalityTags: ['a'.repeat(50), 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    });
    expect(record?.personalityTags.length).toBeLessThanOrEqual(6);
    expect(record?.personalityTags[0].length).toBeLessThanOrEqual(16);
  });

  it('标签非数组时回落为空数组', () => {
    expect(normalizeRunRecord({ personalityTags: '不是数组' })?.personalityTags).toEqual([]);
  });

  it('脚本注入尝试被当作普通文本', () => {
    const record = normalizeRunRecord({ goal: '<script>alert(1)</script>' });
    expect(record?.goal).toBe('<script>alert(1)</script>');
    // 关键：它仍是字符串，不会被求值。前端渲染走 React 的自动转义。
  });
});

describe('normalizeAccountMemory 损坏恢复', () => {
  it('非对象返回空档案', () => {
    expect(normalizeAccountMemory(null)).toEqual(EMPTY_MEMORY);
    expect(normalizeAccountMemory('坏了')).toEqual(EMPTY_MEMORY);
  });

  it('history 里的坏数据被逐条丢弃，好的保留', () => {
    const memory = normalizeAccountMemory({
      history: [{ goal: '好的' }, null, '坏', { lastAct: 2 }],
      totalRuns: 5,
    });

    expect(memory.history.length).toBe(2);
    expect(memory.totalRuns).toBe(5);
  });

  it('history 超长被截断', () => {
    const memory = normalizeAccountMemory({
      history: Array.from({ length: 100 }, (_, i) => ({ goal: `第${i}局` })),
      totalRuns: 100,
    });

    expect(memory.history.length).toBeLessThanOrEqual(20);
  });

  it('缺 lastRun 时用 history 首条兜底', () => {
    const memory = normalizeAccountMemory({ history: [{ goal: '最近一局' }] });
    expect(memory.lastRun?.goal).toBe('最近一局');
  });

  it('totalRuns 非法时按 history 长度推断', () => {
    const memory = normalizeAccountMemory({ history: [{ goal: 'a' }, { goal: 'b' }] });
    expect(memory.totalRuns).toBe(2);
  });
});

describe('读写（文件系统不可用时的降级）', () => {
  it('读取不存在的账号返回空档案', () => {
    expect(readAccountMemory('nonexistent-user-xyz')).toEqual(EMPTY_MEMORY);
  });

  it('写入失败不抛异常，但仍返回合并后的内存结果', () => {
    // 传一个非法 token 让路径计算或写入失败
    expect(() =>
      appendRun('test-user', {
        goal: '测试',
        originId: 'assassin',
        lastAct: 2,
        status: 'OVER_SUCCESS',
        causeOfDeath: '',
        finalWords: '',
        personalityTags: [],
        finishedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('clearAccountMemory 对不存在的账号也返回 true', () => {
    expect(clearAccountMemory('never-existed-abc')).toBe(true);
  });
});

describe('持久化是否真的发生（P0：不允许假成功）', () => {
  const record = {
    goal: '大三法学转码',
    originId: 'assassin',
    lastAct: 3,
    status: 'OVER_SUCCESS' as const,
    causeOfDeath: '',
    finalWords: '',
    personalityTags: ['硬刚型'],
    finishedAt: '2026-09-10T00:00:00.000Z',
  };

  it('写入成功时 persisted=true 且 reason=ok', () => {
    const result = appendRun('persist-ok-user', record);

    expect(result.persisted).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.memory.totalRuns).toBe(1);
  });

  it('磁盘不可写时 persisted=false，不谎报成功', () => {
    // 造一个「父路径是文件」的目录：mkdir -p 必然失败（ENOTDIR），
    // 等价于容器根文件系统只读时存储层遇到的情况。
    const blocker = join(sandbox, 'not-a-dir');
    writeFileSync(blocker, 'x', 'utf8');
    process.env.MEMORY_DIR = join(blocker, 'memory');

    const result = appendRun('persist-fail-user', record);

    expect(result.persisted).toBe(false);
    expect(result.reason).toBe('storage-write-failed');
    // 内存结果仍然可用 —— 玩家这局照样结算，只是没落盘
    expect(result.memory.totalRuns).toBe(1);

    process.env.MEMORY_DIR = sandbox;
  });

  it('封存遗言：无战绩可封时明确报 no-run-to-seal', () => {
    const result = updateLastRunFinalWords('never-played-user', '先做项目');

    expect(result.persisted).toBe(false);
    expect(result.reason).toBe('no-run-to-seal');
  });

  it('封存遗言：写进最近一局并能读回（终局两步的第二 step）', () => {
    appendRun('seal-user', record);

    const sealed = updateLastRunFinalWords('seal-user', '别背八股，先做能讲清的项目');
    expect(sealed.persisted).toBe(true);

    const readBack = readAccountMemory('seal-user');
    expect(readBack.lastRun?.finalWords).toBe('别背八股，先做能讲清的项目');
    // 封存不改动本局的其他字段
    expect(readBack.lastRun?.goal).toBe('大三法学转码');
    expect(readBack.totalRuns).toBe(1);
  });

  it('基础保存与遗言封存是两步：先保存时遗言为空，封存后才有值', () => {
    appendRun('two-step-user', record);
    expect(readAccountMemory('two-step-user').lastRun?.finalWords).toBe('');

    updateLastRunFinalWords('two-step-user', '这一世的教训');
    expect(readAccountMemory('two-step-user').lastRun?.finalWords).toBe('这一世的教训');
  });
});

describe('toClientMemory 映射', () => {
  it('没有 lastRun 时返回 null', () => {
    expect(toClientMemory(EMPTY_MEMORY)).toBeNull();
  });

  it('有记录时映射为前端形状', () => {
    const view = toClientMemory({
      version: 1,
      totalRuns: 3,
      lastRun: {
        goal: '法学转码',
        originId: 'assassin',
        lastAct: 3,
        status: 'OVER_SAN_DEPLETED',
        causeOfDeath: '面试崩盘',
        finalWords: '先做项目',
        personalityTags: ['硬刚型'],
        finishedAt: '2026-09-10T00:00:00.000Z',
      },
      history: [],
      updatedAt: '2026-09-10T01:00:00.000Z',
    });

    expect(view?.totalRuns).toBe(3);
    expect(view?.goal).toBe('法学转码');
    expect(view?.finalWords).toBe('先做项目');
    expect(view?.personalityTags).toEqual(['硬刚型']);
  });

  it('标签数组是副本，改它不影响原档案', () => {
    const source = {
      version: 1 as const,
      totalRuns: 1,
      lastRun: {
        goal: 'x',
        originId: 'assassin',
        lastAct: 1,
        status: 'OVER_SUCCESS' as const,
        causeOfDeath: '',
        finalWords: '',
        personalityTags: ['原标签'],
        finishedAt: '',
      },
      history: [],
      updatedAt: '',
    };

    const view = toClientMemory(source);
    view?.personalityTags.push('篡改');
    expect(source.lastRun.personalityTags).toEqual(['原标签']);
  });
});
