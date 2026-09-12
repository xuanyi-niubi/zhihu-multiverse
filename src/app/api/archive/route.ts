import { NextResponse } from 'next/server';

import { anonymousStorageKey, existingAnonymousId } from '@/core/anonymousId';
import {
  constraintHintFrom,
  dueSummary,
  ledgerFrom,
  readAccountCommitments,
} from '@/core/decision/commitmentStore';
import { readAccountMemory, toArchiveRuns } from '@/core/memoryStore';
import { sessionUrlToken } from '@/core/oauth/zhihu';

/**
 * 命运档案馆数据源（v3 §15 / §23 P2-6）。
 *
 * ## 为什么合成一个接口而不是让前端打两个
 *
 * 档案馆要展示的是**一条时间线**：推演记录与承诺回执必须按时间交错排列。
 * 如果前端分别打 `/api/memory` 与 `/api/commitment`，它就得自己做合并
 * 与排序 —— 而排序口径（按什么时间、缺失时间怎么办）只应该有一处定义。
 *
 * ## 两条数据源的身份口径**刻意不同**（必须知情）
 *
 * | 数据 | 身份 | 原因 |
 * |---|---|---|
 * | 推演记录（memory） | **只认知乎账号** | 那是「你的宇宙记得你」的产品承诺，跨设备可见 |
 * | 承诺回执（commitment） | 账号或匿名身份 | 它是行为闭环，匿名也该能用 |
 *
 * 因此未登录时：`runs` 为空、但 `commitments` 可能有 —— 这不是 bug，
 * 而是两个系统的设计差异。界面必须如实反映（未登录时说明记录需要登录）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const urlToken = sessionUrlToken(request);

    // 推演记录：只认账号（未登录则空）
    const archive = urlToken
      ? toArchiveRuns(readAccountMemory(urlToken))
      : { totalRuns: 0, runs: [] as const };

    // 承诺回执：账号与匿名身份都能读（各自隔离）
    const anonId = existingAnonymousId(request);
    const identityKey = urlToken ?? (anonId ? anonymousStorageKey(anonId) : null);
    const commitments = identityKey ? readAccountCommitments(identityKey).commitments : [];

    const summary = dueSummary(commitments);
    const ledger = ledgerFrom(commitments);

    return NextResponse.json(
      {
        ok: true,
        authenticated: urlToken !== null,
        totalRuns: archive.totalRuns,
        runs: archive.runs,
        commitments,
        resolvedCount: ledger.resolvedCommitments.length,
        dueCount: summary.due.length,
        overdueDays: summary.overdueDays,
        /**
         * 下一局的约束建议：只在有真回执时非空。
         * 档案馆展示它，是因为「过去改变未来」这件事必须被看见 ——
         * 否则记忆只是存档，不是机制。
         */
        hint: constraintHintFrom(ledger),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    // 与项目其余接口一致：永不 500
    return NextResponse.json(
      { ok: true, authenticated: false, totalRuns: 0, runs: [], commitments: [], resolvedCount: 0, dueCount: 0, overdueDays: 0, hint: null },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
}
