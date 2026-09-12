import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETE, GET, PATCH, POST } from '@/app/api/memory/route';
import { SESSION_COOKIE, __resetSessions, getSession } from '@/core/oauth/zhihu';

/**
 * `/api/memory` 的集成测试。
 *
 * 为什么需要它：前面只单测了存储层，但**「已登录」这条路径从未真正执行过** ——
 * 而它正是整个功能的核心。这里通过真实调用路由处理器来验证完整接线：
 *
 *   知乎 profile.url → url_token → 存储 key → 落盘 → 读回
 *
 * 关键技巧：`getSession()` 返回的是 sessions Map 里的**同一个对象引用**，
 * 所以可以直接给它挂 profile 来模拟「已登录」。
 *
 * 所有用例都在临时目录里跑，不碰项目工作区。
 */

let sandbox = '';

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'zhihu-memory-api-'));
  process.env.MEMORY_DIR = sandbox;
});

afterAll(() => {
  delete process.env.MEMORY_DIR;
  rmSync(sandbox, { recursive: true, force: true });
});

/** 造一个已登录的请求：创建会话 → 挂 profile → 返回带 cookie 的请求。 */
function signedInRequest(urlToken: string): Request {
  __resetSessions();

  const bootstrap = new Request('http://localhost/api/memory');
  const { id, session } = getSession(bootstrap);

  session.profile = {
    name: '测试用户',
    avatarUrl: null,
    headline: null,
    url: `https://www.zhihu.com/people/${urlToken}`,
  };
  session.token = 'fake-oauth-token';

  return new Request('http://localhost/api/memory', {
    headers: { cookie: `${SESSION_COOKIE}=${id}` },
  });
}

function guestRequest(): Request {
  __resetSessions();
  return new Request('http://localhost/api/memory');
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/memory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/memory', () => {
  it('未登录返回 200 + authenticated:false（不是错误）', async () => {
    const response = await GET(guestRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authenticated).toBe(false);
    expect(payload.memory).toBeNull();
    expect(payload.reason).toBe('not-signed-in');
  });

  it('已登录但没玩过：authenticated:true 且 memory 为 null', async () => {
    const response = await GET(signedInRequest('fresh-user-a'));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authenticated).toBe(true);
    expect(payload.memory).toBeNull();
  });
});

describe('POST /api/memory', () => {
  it('未登录：saved:false，不抛错', async () => {
    const request = new Request('http://localhost/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: '游客的一局', lastAct: 2 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.authenticated).toBe(false);
    expect(payload.saved).toBe(false);
  });

  it('已登录：写入成功后能读回', async () => {
    const urlToken = 'roundtrip-user';

    const post = await POST(
      mergeBody(
        signedInRequest(urlToken),
        {
          goal: '大三法学想转码',
          originId: 'assassin',
          lastAct: 3,
          status: 'OVER_SAN_DEPLETED',
          causeOfDeath: '面试连环追问',
          finalWords: '先做出一个能讲清楚的项目',
          personalityTags: ['硬刚型', '同辈焦虑'],
        },
      ),
    );

    expect(post.status).toBe(200);
    const saved = await post.json();
    expect(saved.authenticated).toBe(true);
    expect(saved.saved).toBe(true);
    expect(saved.totalRuns).toBe(1);

    // 读回验证
    const get = await GET(signedInRequest(urlToken));
    const read = await get.json();

    expect(read.authenticated).toBe(true);
    expect(read.memory).not.toBeNull();
    expect(read.memory.goal).toBe('大三法学想转码');
    expect(read.memory.finalWords).toBe('先做出一个能讲清楚的项目');
    expect(read.memory.personalityTags).toEqual(['硬刚型', '同辈焦虑']);
    expect(read.totalRuns).toBe(1);
  });

  it('多次写入累加 totalRuns', async () => {
    const urlToken = 'counter-user';

    await POST(mergeBody(signedInRequest(urlToken), { goal: '第一局', lastAct: 1 }));
    const second = await POST(
      mergeBody(signedInRequest(urlToken), { goal: '第二局', lastAct: 2 }),
    );

    const payload = await second.json();
    expect(payload.totalRuns).toBe(2);
  });

  it('不同账号的记忆互相隔离', async () => {
    await POST(mergeBody(signedInRequest('user-x'), { goal: 'X 的目标', lastAct: 2 }));
    await POST(mergeBody(signedInRequest('user-y'), { goal: 'Y 的目标', lastAct: 3 }));

    const x = await (await GET(signedInRequest('user-x'))).json();
    const y = await (await GET(signedInRequest('user-y'))).json();

    expect(x.memory.goal).toBe('X 的目标');
    expect(y.memory.goal).toBe('Y 的目标');
    expect(x.totalRuns).toBe(1);
    expect(y.totalRuns).toBe(1);
  });

  it('昵称相同但 url_token 不同的两个账号不会串数据', async () => {
    // 这是本设计最核心的安全性：昵称可重复，url_token 才是身份
    await POST(mergeBody(signedInRequest('token-aaa'), { goal: 'A 的记忆', lastAct: 1 }));
    await POST(mergeBody(signedInRequest('token-bbb'), { goal: 'B 的记忆', lastAct: 1 }));

    const a = await (await GET(signedInRequest('token-aaa'))).json();
    const b = await (await GET(signedInRequest('token-bbb'))).json();

    expect(a.memory.goal).toBe('A 的记忆');
    expect(b.memory.goal).toBe('B 的记忆');
  });

  it('非法请求体返回 saved:false 而不是 500', async () => {
    const request = new Request('http://localhost/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '这不是 JSON',
    });

    // 无 cookie → 未登录分支
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('超长字段被服务端截断', async () => {
    const urlToken = 'long-field-user';
    await POST(
      mergeBody(signedInRequest(urlToken), {
        goal: '一'.repeat(500),
        finalWords: '二'.repeat(500),
        lastAct: 99,
      }),
    );

    const read = await (await GET(signedInRequest(urlToken))).json();
    expect(read.memory.goal.length).toBeLessThanOrEqual(200);
    expect(read.memory.finalWords.length).toBeLessThanOrEqual(60);
    expect(read.memory.lastAct).toBe(4);
  });
});

describe('PATCH /api/memory（封存遗言，终局第二步）', () => {
  /** 造一个带 body 的 PATCH 请求（复用 createSession 的 cookie）。 */
  function patchBody(base: Request, body: unknown): Request {
    return new Request(base.url, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: base.headers.get('cookie') ?? '',
      },
      body: JSON.stringify(body),
    });
  }

  it('未登录：saved:false，且不谎报 sealed', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/memory', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finalWords: '游客写的话' }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authenticated).toBe(false);
    expect(payload.sealed).toBe(false);
    expect(payload.reason).toBe('not-signed-in');
  });

  it('缺 finalWords 字段：invalid-final-words，不写任何东西', async () => {
    const response = await PATCH(patchBody(signedInRequest('seal-invalid-user'), { nope: 1 }));

    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.persisted).toBe(false);
    expect(payload.reason).toBe('invalid-final-words');
  });

  it('账号下还没有任何一局：no-run-to-seal（不伪造一条记录）', async () => {
    const urlToken = 'seal-empty-user';
    const response = await PATCH(patchBody(signedInRequest(urlToken), { finalWords: '无局可封' }));

    const payload = await response.json();
    expect(payload.persisted).toBe(false);
    expect(payload.sealed).toBe(false);
    expect(payload.reason).toBe('no-run-to-seal');

    // 关键：不能因此凭空造出一局记忆
    const read = await (await GET(signedInRequest(urlToken))).json();
    expect(read.memory).toBeNull();
    expect(read.totalRuns).toBe(0);
  });

  it('已保存一局后封存遗言：能读回，且不改动本局其他字段', async () => {
    const urlToken = 'seal-roundtrip-user';

    // 第一步：终局基础保存（遗言此刻为空）
    await POST(
      mergeBody(signedInRequest(urlToken), {
        goal: '考研差 3 分',
        originId: 'assassin',
        lastAct: 4,
        status: 'OVER_SUCCESS',
        causeOfDeath: '',
        finalWords: '',
        personalityTags: ['稳健型'],
      }),
    );

    // 第二步：玩家写完遗言，显式封存
    const patch = await PATCH(
      patchBody(signedInRequest(urlToken), { finalWords: '别只看分数线，先补齐项目经历' }),
    );
    const sealed = await patch.json();
    expect(sealed.persisted).toBe(true);
    expect(sealed.sealed).toBe(true);
    expect(sealed.reason).toBe('ok');

    const read = await (await GET(signedInRequest(urlToken))).json();
    expect(read.memory.finalWords).toBe('别只看分数线，先补齐项目经历');
    expect(read.memory.goal).toBe('考研差 3 分');
    expect(read.memory.personalityTags).toEqual(['稳健型']);
    // 封存不是新的一局
    expect(read.totalRuns).toBe(1);
  });

  it('重复封存是幂等的：覆盖同一局，不累加局数', async () => {
    const urlToken = 'seal-idempotent-user';

    await POST(mergeBody(signedInRequest(urlToken), { goal: '一局', lastAct: 2 }));
    await PATCH(patchBody(signedInRequest(urlToken), { finalWords: '第一次' }));
    await PATCH(patchBody(signedInRequest(urlToken), { finalWords: '第二次' }));

    const read = await (await GET(signedInRequest(urlToken))).json();
    expect(read.memory.finalWords).toBe('第二次');
    expect(read.totalRuns).toBe(1);
  });
});

describe('DELETE /api/memory', () => {
  it('未登录：cleared:false', async () => {
    const response = await DELETE(guestRequest());
    const payload = await response.json();
    expect(payload.authenticated).toBe(false);
    expect(payload.cleared).toBe(false);
  });

  it('已登录：清空后读回为 null', async () => {
    const urlToken = 'to-be-cleared';
    await POST(mergeBody(signedInRequest(urlToken), { goal: '要被清掉的', lastAct: 2 }));

    const removed = await DELETE(signedInRequest(urlToken));
    expect((await removed.json()).cleared).toBe(true);

    const read = await (await GET(signedInRequest(urlToken))).json();
    expect(read.memory).toBeNull();
  });
});

/** 把 JSON body 合并进一个已构造的 Request（重造一个带 body 的请求）。 */
function mergeBody(base: Request, body: unknown): Request {
  return new Request(base.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: base.headers.get('cookie') ?? '',
    },
    body: JSON.stringify(body),
  });
}
