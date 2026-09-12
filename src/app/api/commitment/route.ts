import { NextResponse } from 'next/server';

import {
  addCommitment,
  constraintHintFrom,
  dueAtFrom,
  dueSummary,
  ledgerFrom,
  normalizeCommitment,
  readAccountCommitments,
  removeCommitment,
} from '@/core/decision/commitmentStore';
import { sessionUrlToken } from '@/core/oauth/zhihu';

import type { Commitment } from '@/types/evidence';

/**
 * 承诺接口（方案 §7.2 / §10.3）。
 *
 * 契约沿用 `/api/memory` 的三条纪律：
 *
 * - **未登录是正常态**：返回 `authenticated: false` 且 HTTP 200，
 *   前端据此提示「登录后才会提醒你」，而不是弹错误框。
 * - **`ok` 与 `persisted` 分开**：磁盘只读时不能宣称已保存。
 * - **永不 500**：最坏情况是「没存下」，不是打不开页面。
 *
 * 隐私：承诺只在账号目录内，不公开、不排行；DELETE 是真删。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET：读该账号的承诺、到期概览与下一局建议。 */
export async function GET(request: Request): Promise<Response> {
  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      { ok: true, authenticated: false, commitments: [], due: { count: 0, overdueDays: 0 }, hint: null },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const account = readAccountCommitments(urlToken);
  const summary = dueSummary(account.commitments);
  const ledger = ledgerFrom(account.commitments);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      commitments: account.commitments,
      due: { count: summary.due.length, overdueDays: summary.overdueDays, items: summary.due },
      upcomingCount: summary.upcoming.length,
      // 下一局的约束建议：只在有真回执时给出，没回执就是 null
      hint: constraintHintFrom(ledger),
      resolvedCount: ledger.resolvedCommitments.length,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/** POST：认下一条承诺（可多选，逐条提交）。 */
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
        persisted: false,
        reason: 'not-signed-in',
        commitment: null,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const committedAt = new Date().toISOString();

  /**
   * 承诺 id 由**客户端指定**（清单条目 id），服务端只在缺失时兜底生成。
   *
   * 为什么不让服务端全权生成：撤销（DELETE）与认下（POST）必须指向同一条，
   * 而清单是客户端确定性生成的 —— 让 id 从一开始就稳定，
   * 比让客户端记住「服务端给我的那个 id」更不容易在刷新后失联。
   */
  const requestedId =
    typeof record.commitmentId === 'string' && record.commitmentId.trim().length > 0
      ? record.commitmentId.trim().slice(0, 64)
      : undefined;

  const commitment = normalizeCommitment(
    {
      ...record,
      ...(requestedId ? { commitmentId: requestedId } : {}),
      committedAt,
      // 客户端可以指定期限（如 3 天 / 14 天），但默认七天
      dueAt: dueAtFrom(committedAt, clampDays(record.windowDays)),
    },
    urlToken,
  );

  if (!commitment) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: true,
        saved: false,
        persisted: false,
        reason: 'invalid-commitment',
        commitment: null,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const result = addCommitment(urlToken, commitment);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      saved: result.persisted,
      persisted: result.persisted,
      reason: result.reason,
      commitment,
      dueAt: commitment.dueAt,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/** DELETE：真删一条承诺。 */
export async function DELETE(request: Request): Promise<Response> {
  const urlToken = sessionUrlToken(request);

  if (!urlToken) {
    return NextResponse.json(
      { ok: true, authenticated: false, removed: false, reason: 'not-signed-in' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const url = new URL(request.url);
  const commitmentId = url.searchParams.get('id');
  if (!commitmentId || commitmentId.trim().length === 0) {
    return NextResponse.json(
      { ok: false, authenticated: true, removed: false, reason: 'missing-id' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const result = removeCommitment(urlToken, commitmentId.trim().slice(0, 64));

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      removed: result.persisted,
      persisted: result.persisted,
      reason: result.reason,
      remaining: result.account.commitments.length,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/** 期限：3–30 天，非法值退回默认七天。 */
function clampDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 7;
  }
  return Math.min(30, Math.max(3, Math.round(parsed)));
}

export type { Commitment };
