import { NextResponse } from 'next/server';

import { sessionUrlToken } from '@/core/oauth/zhihu';
import {
  appendRun,
  clearAccountMemory,
  normalizeRunRecord,
  readAccountMemory,
  toClientMemory,
  updateLastRunFinalWords,
} from '@/core/memoryStore';

/**
 * 跨周期记忆接口。
 *
 * 契约（与项目其余接口一致的「永不 500」风格，但有例外，见下）：
 *
 * - **未登录**返回 `{ authenticated: false, memory: null }` 且 HTTP 200。
 *   这是**正常状态**，不是错误 —— 游客本来就没有账号记忆。
 *   前端据此隐藏「记忆残响」与「前世遗念」，而不是弹错误框。
 * - **已登录但还没玩过**返回 `{ authenticated: true, memory: null }`。
 * - **已登录且有记忆**返回完整档案。
 *
 * 之所以不把未登录做成 401：这个接口会被游玩过程中的每次读写调用，
 * 401 会让浏览器控制台刷满红色错误，干扰真实问题的排查。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET：读取当前账号的记忆。 */
export async function GET(request: Request): Promise<Response> {
  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      {
        ok: true,
        authenticated: false,
        memory: null,
        reason: 'not-signed-in',
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const memory = readAccountMemory(urlToken);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      memory: toClientMemory(memory),
      totalRuns: memory.totalRuns,
      /** 历史战绩条数，供将来做「知识图谱复盘」。 */
      historyCount: memory.history.length,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * POST：追加一局战绩。
 *
 * 未登录时**静默成功**并返回 `saved: false`——游客照常结算，
 * 只是这份记忆不会被保存。前端不弹错误，只在结算页温和提示「登录后可保留」。
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 请求体不是 JSON：下面按空处理
  }

  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      {
        ok: true,
        authenticated: false,
        saved: false,
        memory: null,
        reason: 'not-signed-in',
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const record = normalizeRunRecord(body);
  if (!record) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: true,
        saved: false,
        memory: null,
        reason: 'invalid-record',
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const result = appendRun(urlToken, record);

  return NextResponse.json(
    {
      // ok 反映「请求被正常处理」，persisted 反映「真的写进去了」——
      // 两者必须分开，否则磁盘只读时页面会宣称已保存。
      ok: true,
      authenticated: true,
      saved: result.persisted,
      persisted: result.persisted,
      reason: result.reason,
      memory: toClientMemory(result.memory),
      totalRuns: result.memory.totalRuns,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * PATCH：封存遗言（终局第二步）。
 *
 * 终局出现时先 POST 保存本局基础记录；玩家随后写下的遗言走这里写入**最近一局**。
 * 只接受 `finalWords`（长度由存储层钳制），其余字段不容许被客户端改写。
 */
export async function PATCH(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 请求体不是 JSON：下面按空处理
  }

  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      {
        ok: true,
        authenticated: false,
        saved: false,
        persisted: false,
        sealed: false,
        reason: 'not-signed-in',
        memory: null,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const words =
    typeof body === 'object' && body !== null && typeof (body as { finalWords?: unknown }).finalWords === 'string'
      ? (body as { finalWords: string }).finalWords
      : null;

  if (words === null) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: true,
        saved: false,
        persisted: false,
        sealed: false,
        reason: 'invalid-final-words',
        memory: null,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const result = updateLastRunFinalWords(urlToken, words);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      saved: result.persisted,
      persisted: result.persisted,
      sealed: result.persisted,
      reason: result.reason,
      memory: toClientMemory(result.memory),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/** DELETE：清空当前账号的记忆（「重置我的宇宙」）。 */
export async function DELETE(request: Request): Promise<Response> {
  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      { ok: true, authenticated: false, cleared: false, reason: 'not-signed-in' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const cleared = clearAccountMemory(urlToken);

  return NextResponse.json(
    { ok: true, authenticated: true, cleared },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
