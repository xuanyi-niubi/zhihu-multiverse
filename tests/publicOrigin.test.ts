import { afterEach, describe, expect, it } from 'vitest';

import { publicOrigin, publicUrl } from '@/core/oauth/zhihu';

/**
 * 对外来源解析。
 *
 * ## 这条契约守的是一个「本地全绿、线上打不开」的 bug
 *
 * 线上形态是 Nginx 反代 → 容器内 Next standalone。standalone 的
 * `request.url` 用的是容器自己的 `HOSTNAME` / `PORT`
 * （compose 里为 `0.0.0.0` / `3000`），**不是**客户端请求的那条 URL。
 *
 * 于是授权成功后 `new URL('/oauth?oauth=success', request.url)` 会生成
 * `https://0.0.0.0:3000/oauth?oauth=success` —— 手机浏览器打开是
 * `ERR_CONNECTION_REFUSED`。用户看到「网页无法打开」，尽管授权其实成功了。
 *
 * 这个 bug 有个讨厌的性质：**本地怎么测都是好的**（dev / 直连时
 * request.url 就是访问地址）。所以只能靠这个测试把取值优先级钉住。
 */

/** 造一个「容器内部视角」的请求：url 指向 0.0.0.0，转发头指向公网。 */
function containerRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://0.0.0.0:3000/auth/callback', { headers });
}

const PUBLIC = 'https://zhihu.xuanyi888.cloud:8443';

afterEach(() => {
  delete process.env.APP_PUBLIC_ORIGIN;
});

describe('publicOrigin：对外来源', () => {
  it('显式配置优先于一切（部署时最可靠）', () => {
    process.env.APP_PUBLIC_ORIGIN = PUBLIC;
    expect(
      publicOrigin(
        containerRequest({
          'x-forwarded-host': 'wrong.example.com',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toBe(PUBLIC);
  });

  it('配置里带尾部斜杠也要规范化（否则拼出 //oauth）', () => {
    process.env.APP_PUBLIC_ORIGIN = `${PUBLIC}///`;
    expect(publicOrigin(containerRequest())).toBe(PUBLIC);
  });

  it('没有配置时用 x-forwarded-host —— 且必须保留端口', () => {
    // 这里刻意断言 :8443 存在：反代若传 `$host`（不含端口）就会丢它，
    // 用户会被送回 443，而那条路在移动网络下是被拦的。
    expect(
      publicOrigin(
        containerRequest({
          'x-forwarded-host': 'zhihu.xuanyi888.cloud:8443',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(PUBLIC);
  });

  it('转发头有多个值时只取第一个（代理链）', () => {
    expect(
      publicOrigin(
        containerRequest({
          'x-forwarded-host': 'zhihu.xuanyi888.cloud:8443, inner.proxy',
          'x-forwarded-proto': 'https, http',
        }),
      ),
    ).toBe(PUBLIC);
  });

  it('转发头缺 proto 时按 https 处理（本站只有 https 入口）', () => {
    expect(
      publicOrigin(containerRequest({ 'x-forwarded-host': 'zhihu.xuanyi888.cloud:8443' })),
    ).toBe(PUBLIC);
  });

  it('既没配置也没转发头 → 回落到 request.url（本地开发）', () => {
    expect(publicOrigin(containerRequest())).toBe('http://0.0.0.0:3000');
  });
});

describe('publicUrl：跳转地址', () => {
  it('相对路径被解析到公网来源，而不是容器的 0.0.0.0', () => {
    process.env.APP_PUBLIC_ORIGIN = PUBLIC;
    expect(publicUrl(containerRequest(), '/oauth?oauth=success').toString()).toBe(
      `${PUBLIC}/oauth?oauth=success`,
    );
  });

  it('绝对 URL 原样保留（知乎授权页地址不该被改写）', () => {
    process.env.APP_PUBLIC_ORIGIN = PUBLIC;
    const authorize = 'https://openapi.zhihu.com/authorize?client_id=659&response_type=code';
    expect(publicUrl(containerRequest(), authorize).toString()).toBe(authorize);
  });

  it('失败分支的相对路径同样落在公网来源上', () => {
    process.env.APP_PUBLIC_ORIGIN = PUBLIC;
    expect(publicUrl(containerRequest(), '/?oauth=error&reason=CODE_MISSING').toString()).toBe(
      `${PUBLIC}/?oauth=error&reason=CODE_MISSING`,
    );
  });

  it('没有配置时按转发头拼（保留 :8443）', () => {
    expect(
      publicUrl(
        containerRequest({
          'x-forwarded-host': 'zhihu.xuanyi888.cloud:8443',
          'x-forwarded-proto': 'https',
        }),
        '/oauth?oauth=success',
      ).toString(),
    ).toBe(`${PUBLIC}/oauth?oauth=success`);
  });
});
