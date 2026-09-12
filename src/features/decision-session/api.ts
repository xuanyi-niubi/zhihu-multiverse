import { NextResponse } from 'next/server';

import { createTrace } from '@/core/observability';

/**
 * 统一 API 语义（重构方案 §6.4）。
 *
 * ## 为什么必须改
 *
 * 旧接口「无论成功失败都返回 HTTP 200，再把错误藏在 body 里」
 * （方案 §1.3 E）。后果很具体：
 *
 * - 前端只能靠**解析文本**判断失败类型，任何文案改动都会让判断失效；
 * - 监控看不出真实错误率（全是 200）；
 * - 日志里 5xx 为空，但用户其实一直在看错误。
 *
 * ## 新契约
 *
 * ```ts
 * { ok: true,  data, meta?: { degraded?, traceId } }
 * { ok: false, error: { code, message, retryable }, traceId }
 * ```
 *
 * 状态码：
 *
 * | 情况 | 码 |
 * |---|---|
 * | 参数错误 | 400 |
 * | 未登录但请求私有资源 | 401 |
 * | 会话不存在或不属于你 | 404 |
 * | 上游（知乎／模型）失败 | 502 / 503 |
 * | **业务成功但数据降级** | 200 + `meta.degraded = true` |
 *
 * 最后一行是关键：降级**不是错误**（我们有离线路径），但它必须可见。
 */

export interface ApiMeta {
  readonly degraded?: boolean;
  readonly traceId: string;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta?: ApiMeta }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean };
      readonly traceId: string;
    };

export const ERROR_STATUS: Readonly<Record<string, number>> = {
  'bad-request': 400,
  unauthorized: 401,
  'not-found': 404,
  'upstream-failed': 502,
  'upstream-unavailable': 503,
};

function statusFor(code: string): number {
  return ERROR_STATUS[code] ?? 400;
}

/**
 * 成功（可带降级标记）。
 *
 * `setCookie` 不是可选项的装饰：**首次访问的匿名身份必须在这里写回**，
 * 否则下一个请求会被当成另一个人。
 *
 * 实测踩过这个坑：`POST /api/sessions` 建会话成功，紧接着
 * `GET /api/sessions/[id]` 返回 404 —— 因为创建时生成的匿名 id
 * 没有随响应下发，第二次请求拿到了一个全新的匿名身份，
 * 于是「这个会话不属于你」。**未登录用户（也就是评委）会完全用不了。**
 */
export function ok<T>(
  data: T,
  extras: { readonly traceId: string; readonly degraded?: boolean; readonly setCookie?: string | null },
): NextResponse {
  const meta: ApiMeta = {
    traceId: extras.traceId,
    ...(extras.degraded ? { degraded: true } : {}),
  };
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (extras.setCookie) {
    headers['set-cookie'] = extras.setCookie;
  }
  return NextResponse.json({ ok: true, data, meta }, { status: 200, headers });
}

/**
 * 失败。
 *
 * `retryable` 显式声明「再试一次有没有意义」——
 * 参数错误重试一万次也没用，上游抖动则值得重试。
 * 让前端去猜这件事是旧设计的另一个问题。
 */
export function fail(input: {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly traceId: string;
  /** 需要写回 cookie 时（匿名身份首次出现）。 */
  readonly setCookie?: string | null;
}): NextResponse {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (input.setCookie) {
    headers['set-cookie'] = input.setCookie;
  }
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        retryable: input.retryable ?? false,
      },
      traceId: input.traceId,
    },
    { status: statusFor(input.code), headers },
  );
}

/** 建 trace 并返回它（路由入口统一用这个）。 */
export function newTrace() {
  return createTrace();
}

/** 安全解析 JSON body。 */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
