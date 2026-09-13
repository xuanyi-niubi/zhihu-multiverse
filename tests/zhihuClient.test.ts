import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createZhihuClient,
  resolveZhihuFromEnv,
  type ZhihuConfig,
} from '@/core/zhihu/client';

/**
 * 知乎开放平台客户端测试。
 *
 * 重点：所有方法**永不抛出**，失败返回结构化结果；以及配额保护
 * （同一 query 在 TTL 内只打一次真实请求）。
 */

function config(over: Partial<ZhihuConfig> = {}): ZhihuConfig {
  return {
    accessSecret: 'test-secret',
    baseUrl: 'https://developer.zhihu.com',
    timeoutMs: 5000,
    cacheTtlMs: 60_000,
    ...over,
  };
}

function stubFetch(payload: unknown, status = 200) {
  const calls: string[] = [];

  vi.stubGlobal('fetch', async (url: string | URL) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  });

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveZhihuFromEnv', () => {
  it('没有 Access Secret 时返回 null', () => {
    expect(resolveZhihuFromEnv({})).toBeNull();
  });

  it('空白字符不算配置', () => {
    expect(resolveZhihuFromEnv({ ZHIHU_ACCESS_SECRET: '   ' })).toBeNull();
  });

  it('也接受 ZHIHU_API_KEY 作为别名', () => {
    expect(resolveZhihuFromEnv({ ZHIHU_API_KEY: 'abc' })?.accessSecret).toBe('abc');
  });

  it('缓存 TTL 被钳制在合法区间', () => {
    const negative = resolveZhihuFromEnv({ ZHIHU_ACCESS_SECRET: 'x', ZHIHU_CACHE_TTL_MS: '-100' });
    expect(negative?.cacheTtlMs).toBe(0);

    const huge = resolveZhihuFromEnv({
      ZHIHU_ACCESS_SECRET: 'x',
      ZHIHU_CACHE_TTL_MS: '999999999',
    });
    expect(huge?.cacheTtlMs).toBe(24 * 3600_000);
  });
});

describe('search', () => {
  it('成功时解析条目并过滤空标题', async () => {
    stubFetch({
      Code: 0,
      Data: {
        Items: [
          { Title: '有效标题', ContentText: '内容', Url: 'https://zhihu.com/a', VoteUpCount: 5 },
          { Title: '', ContentText: '无标题' },
        ],
      },
    });

    const result = await createZhihuClient(config()).search('转码');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].Title).toBe('有效标题');
    }
  });

  it('Code 非 0 时返回结构化失败而不抛', async () => {
    stubFetch({ Code: 403, Message: '无权限' });

    const result = await createZhihuClient(config()).search('转码');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('zhihu-403');
      expect(result.message).toBe('无权限');
    }
  });

  it('空 query 直接拒绝，不浪费配额', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });

    const result = await createZhihuClient(config()).search('   ');

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('Count 被钳制在 1-10', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });

    await createZhihuClient(config()).search('x', 999);

    expect(calls[0]).toContain('Count=10');
  });

  it('同一 query 在 TTL 内只打一次真实请求（配额保护）', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });
    const client = createZhihuClient(config());

    await client.search('转码');
    await client.search('转码');
    await client.search('转码');

    expect(calls).toHaveLength(1);
  });

  it('不同 query 各自打请求', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });
    const client = createZhihuClient(config());

    await client.search('转码');
    await client.search('考研');

    expect(calls).toHaveLength(2);
  });

  it('失败结果不进缓存', async () => {
    const calls = stubFetch({ Code: 500, Message: '服务异常' });
    const client = createZhihuClient(config());

    await client.search('转码');
    await client.search('转码');

    expect(calls).toHaveLength(2);
  });

  it('网络异常返回 network-error 而不抛', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection reset');
    });

    const result = await createZhihuClient(config()).search('转码');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network-error');
    }
  });

  it('响应不是 JSON 对象时返回结构化失败', async () => {
    stubFetch('纯文本响应');

    const result = await createZhihuClient(config()).search('转码');

    expect(result.ok).toBe(false);
  });
});

describe('hotList', () => {
  it('解析热榜条目', async () => {
    stubFetch({
      Code: 0,
      Data: { Items: [{ Title: '热榜话题', Url: 'https://zhihu.com/h', Summary: '摘要' }] },
    });

    const result = await createZhihuClient(config()).hotList(5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].Title).toBe('热榜话题');
    }
  });

  it('Limit 被钳制在上限 30', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });

    await createZhihuClient(config()).hotList(999);

    expect(calls[0]).toContain('Limit=30');
  });

  it('热榜同样有缓存', async () => {
    const calls = stubFetch({ Code: 0, Data: { Items: [] } });
    const client = createZhihuClient(config());

    await client.hotList(5);
    await client.hotList(5);

    expect(calls).toHaveLength(1);
  });
});
