import { NextResponse } from 'next/server';

import { createTrace } from '@/core/observability';
import { modelConfigForIdentity, readOwnSettings, resolveIdentity } from '@/features/run/identity';
import {
  clearSettings,
  readSettings,
  toPublicSettings,
  writeSettings,
  SETTINGS_FIELDS,
  type SettingsField,
} from '@/core/settingsStore';

/**
 * 应用内密钥配置接口。
 *
 * ## 本接口的两条关键设计（2026-09-13 修订）
 *
 * ### 1. **不再要求登录**
 *
 * 原本必须登录知乎账号才能保存配置 —— 那对「配置我自己的 AI key」
 * 是过度约束。现在登录用户按 `url_token` 隔离，
 * **未登录用户按匿名 cookie 隔离**（见 `core/anonymousId.ts`）。
 * 于是「不登陆账号也能配置 AI，自己玩耍」成立。
 *
 * ### 2. **不再回退到服务端环境变量**
 *
 * 这是本次修订的真正原因，也是一个成本与安全问题：
 *
 * > 若服务端 env 里留着一把共享 key，而访客没配时回退到它，
 * > 那**任何访问者都能白用那把 key** —— 花的是部署者的钱。
 *
 * 因此 `envFallback` 一律报 false（界面据此提示「需要你自己填」），
 * 运行时也绝不读 `process.env`。部署者不配 key 不会让站点打不开：
 * 没有 key 时自动走 DEMO MODE（离线剧本 + 已落盘的真实快照）。
 *
 * ## 既有安全约束（未变）
 *
 * - **GET 永不回明文**：只有「是否已配置 + 长度 + sha256 前 8 位」；
 * - **PUT 只接受白名单字段**，非法值整条拒绝，不做「尽力保存」；
 * - **DELETE 是真删**：支持删单项或删整份，返回删除后的状态供界面确认。
 *
 * ⚠️ 本文件只允许导出 HTTP 方法与路由配置（Next.js 会校验 route.ts 的导出）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 环境兜底一律为 false。
 *
 * 保留这个函数而不是直接删掉，是为了让「我们从不为访客付账」这件事
 * 在代码里是一个**显式声明**，而不是一处被遗漏的分支。
 */
function envFallback(): { zhihu: boolean; model: boolean } {
  return { zhihu: false, model: false };
}

function json(
  body: unknown,
  traceId: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: { 'cache-control': 'no-store', 'x-trace-id': traceId, ...extraHeaders },
  });
}

/** 该身份的公开配置视图。 */
function viewFor(key: string, authenticated: boolean) {
  return toPublicSettings(readSettings(key), {
    authenticated,
    envFallback: envFallback(),
  });
}

export async function GET(request: Request): Promise<Response> {
  const trace = createTrace();
  const identity = resolveIdentity(request);
  trace.note(identity.authenticated ? 'signed-in' : 'anonymous');
  trace.finish({ action: 'get' });

  return json(
    {
      ok: true,
      authenticated: identity.authenticated,
      // 未登录不再是「拒绝」，而是「按匿名身份正常服务」
      anonymous: !identity.authenticated,
      settings: viewFor(identity.key, identity.authenticated),
    },
    trace.traceId,
    identity.setCookie ? ({ 'set-cookie': identity.setCookie } as Record<string, string>) : {},
  );
}

/** 允许写入的字段（其余一律忽略，不报错也不落盘）。 */
function pickPatch(body: Record<string, unknown>): Partial<Record<SettingsField, string | boolean>> {
  const patch: Partial<Record<SettingsField, string | boolean>> = {};
  for (const field of SETTINGS_FIELDS) {
    const value = body[field];
    if (typeof value === 'string' || typeof value === 'boolean') {
      patch[field] = value;
    }
  }
  return patch;
}

export async function PUT(request: Request): Promise<Response> {
  const trace = createTrace();
  const identity = resolveIdentity(request);
  const headers: Record<string, string> = identity.setCookie ? { 'set-cookie': identity.setCookie } : {};

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.json();
    body =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    body = null;
  }

  if (!body) {
    trace.note('invalid-body');
    trace.finish({ action: 'put' });
    return json(
      {
        ok: false,
        authenticated: identity.authenticated,
        reason: 'invalid-body',
        settings: viewFor(identity.key, identity.authenticated),
      },
      trace.traceId,
      headers,
    );
  }

  const patch = pickPatch(body);
  if (Object.keys(patch).length === 0) {
    trace.note('nothing-to-update');
    trace.finish({ action: 'put' });
    return json(
      {
        ok: false,
        authenticated: identity.authenticated,
        reason: 'nothing-to-update',
        settings: viewFor(identity.key, identity.authenticated),
      },
      trace.traceId,
      headers,
    );
  }

  const result = writeSettings(identity.key, patch);
  trace.note(result.persisted ? 'saved' : result.reason);
  trace.finish({ action: 'put', persisted: result.persisted, fields: Object.keys(patch).length });

  return json(
    {
      ok: result.persisted,
      authenticated: identity.authenticated,
      reason: result.reason,
      persisted: result.persisted,
      settings: viewFor(identity.key, identity.authenticated),
    },
    trace.traceId,
    headers,
  );
}

/**
 * 删除：`?field=zhihu|model|all`（缺省 all）。
 *
 * `zhihu` 删知乎 Access Secret；`model` 删模型那几项；`all` 删整份配置。
 */
export async function DELETE(request: Request): Promise<Response> {
  const trace = createTrace();
  const identity = resolveIdentity(request);
  const headers: Record<string, string> = identity.setCookie ? { 'set-cookie': identity.setCookie } : {};

  const raw = new URL(request.url).searchParams.get('field') ?? 'all';
  const field =
    raw === 'zhihu' ? ('zhihuAccessSecret' as const) : raw === 'model' ? ('__model__' as const) : ('all' as const);

  /**
   * 删除实现（**修过一个真 bug**）。
   *
   * 旧写法对 `field=model` 调用 `writeSettings` 并传空串 —— 但
   * `writeSettings` 把空串当作「无值」而不是「删除」，于是
   * `modelApiKey` 原封不动，测试立刻抓到「删了还在」。
   *
   * 正确做法是**逐个字段**走 `clearSettings`（它一次只删一个），
   * 并且每个字段的删除都要真的落盘后才算成功。
   */
  let persisted = true;
  if (field === '__model__') {
    for (const modelField of ['modelApiKey', 'modelBaseUrl', 'modelModel', 'modelJsonMode'] as const) {
      const result = clearSettings(identity.key, modelField);
      persisted = persisted && result.persisted;
    }
  } else {
    const result = clearSettings(identity.key, field);
    persisted = result.persisted;
  }

  trace.note(persisted ? 'cleared' : 'clear-failed');
  trace.finish({ action: 'delete', field: raw });

  return json(
    {
      ok: persisted,
      authenticated: identity.authenticated,
      // 兼容既有消费方：`cleared` 与 `persisted` 同义，表示「真的删掉了」
      cleared: persisted,
      reason: persisted ? 'cleared' : 'storage-write-failed',
      persisted,
      settings: viewFor(identity.key, identity.authenticated),
    },
    trace.traceId,
    headers,
  );
}

/**
 * 探活：报告该身份是否已配好 key（**不回明文、不报 env**）。
 *
 * 界面用它在开局前如实告知玩家「你需要先填自己的 key」。
 */
export async function POST(request: Request): Promise<Response> {
  const trace = createTrace();
  const { identity, stored } = readOwnSettings(request);
  const model = modelConfigForIdentity(stored);

  trace.finish({ action: 'probe', ready: model !== null });

  return json(
    {
      ok: true,
      authenticated: identity.authenticated,
      ready: model !== null,
      // 只报「有没有」，不回明文
      model: model ? { name: model.model, baseUrl: model.baseUrl } : null,
    },
    trace.traceId,
    identity.setCookie ? ({ 'set-cookie': identity.setCookie } as Record<string, string>) : {},
  );
}
