import { NextResponse } from 'next/server';

import { attachReceipt, dueSummary, ledgerFrom, readAccountCommitments } from '@/core/decision/commitmentStore';
import { sessionUrlToken } from '@/core/oauth/zhihu';

import type { CommitmentOutcome } from '@/types/evidence';

/**
 * 回执接口（方案 §7.2）：七天后的那一问的接收端。
 *
 * **这是「建议 → 数据」的转折点**：没有这个接口，产品只是一次性输出；
 * 有了它，才有真实的完成率可以写进计划书、答评委的「有人用吗」。
 *
 * 幂等：同一承诺重复提交回执，结果逐字节一致（后一次覆盖前一次，
 * 且 `attachReceipt` 是纯函数式的重建而非追加）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUTCOMES: readonly CommitmentOutcome[] = ['done', 'partial', 'missed'];

function asOutcome(value: unknown): CommitmentOutcome | null {
  return OUTCOMES.includes(value as CommitmentOutcome) ? (value as CommitmentOutcome) : null;
}

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
      { ok: true, authenticated: false, recorded: false, reason: 'not-signed-in' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const commitmentId = typeof record.commitmentId === 'string' ? record.commitmentId.trim().slice(0, 64) : '';
  const outcome = asOutcome(record.outcome);

  if (commitmentId.length === 0 || !outcome) {
    return NextResponse.json(
      { ok: false, authenticated: true, recorded: false, reason: 'invalid-receipt' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const note = typeof record.note === 'string' ? record.note.trim().slice(0, 200) : '';
  const blocker = typeof record.blocker === 'string' ? record.blocker.trim().slice(0, 80) : '';

  const { result, commitment } = attachReceipt(urlToken, commitmentId, {
    reportedAt: new Date().toISOString(),
    outcome,
    note,
    blocker: blocker.length > 0 ? blocker : null,
  });

  if (!result || !commitment) {
    return NextResponse.json(
      { ok: false, authenticated: true, recorded: false, reason: 'commitment-not-found' },
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
      // 与记忆层一致：recorded 反映「请求被正常处理」，persisted 反映「真的写进去了」
      recorded: true,
      persisted: result.persisted,
      reason: result.reason,
      commitment,
      // 回执直接改变下一局的建议：这是闭环真正合上的地方
      resolvedCount: ledger.resolvedCommitments.length,
      dueCount: summary.due.length,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/** GET：列出当前待回收的承诺（首页提示与「赛博契约」页用）。 */
export async function GET(request: Request): Promise<Response> {
  const urlToken = sessionUrlToken(request);
  if (!urlToken) {
    return NextResponse.json(
      { ok: true, authenticated: false, due: [], upcoming: [] },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const account = readAccountCommitments(urlToken);
  const summary = dueSummary(account.commitments);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      due: summary.due,
      upcoming: summary.upcoming,
      overdueDays: summary.overdueDays,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
