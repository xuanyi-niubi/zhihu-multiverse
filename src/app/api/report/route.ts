import { NextResponse } from 'next/server';

import { generateReport, type RunReportInput } from '@/core/dm/report';
import { createOpenAiCompatibleClient } from '@/core/dm/provider';
import { clampTotalTurns, clampTurnIndex, MAX_TURNS } from '@/core/run/actRun';
import { resolveModelConfigForRequest } from '@/features/run/keyResolution';

/**
 * 终局复盘接口。
 *
 * 与 `/api/dm` 同样的契约：**永远返回 HTTP 200 与一段可用文本**。
 * 模型不可用或超时就回落到确定性模板，前端不需要处理错误分支。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = '', max = 300): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : fallback;
}

function normalizeReportInput(raw: unknown): RunReportInput {
  const body = isRecord(raw) ? raw : {};
  const stats = isRecord(body.stats) ? body.stats : {};

  return {
    goal: str(body.goal, '一次没有名字的推演', 120),
    originName: str(body.originName, '未知出身', 24),
    success: body.success === true,
    // 幕数口径的唯一事实源：core/run/actRun.ts（v2 §14 Phase 0）
    survivedActs: clampTurnIndex(body.survivedActs),
    totalActs: clampTotalTurns(body.totalActs, 4),
    stats: {
      san: num(stats.san, 0, 0, 100),
      skill: num(stats.skill, 0, 0, 100),
      bond: num(stats.bond, 0, 0, 100),
    },
    choices: Array.isArray(body.choices)
      ? body.choices.slice(0, MAX_TURNS).map((item) => {
          const choice = isRecord(item) ? item : {};
          return { act: clampTurnIndex(choice.act), text: str(choice.text, '未知选择', 60) };
        })
      : [],
    relics: Array.isArray(body.relics)
      ? body.relics.slice(0, 3).map((item) => str(item, '', 24)).filter((item) => item.length > 0)
      : [],
    sanHistory: Array.isArray(body.sanHistory)
      ? body.sanHistory.slice(0, 8).map((item) => num(item, 100, 0, 100))
      : [100],
  };
}

export async function POST(request: Request): Promise<Response> {
  let input: RunReportInput = normalizeReportInput(null);

  try {
    const body: unknown = await request.json();
    input = normalizeReportInput(body);
  } catch {
    // 请求体不是 JSON：用默认输入继续
  }

  try {
    const config = resolveModelConfigForRequest(request);
    const client = config ? createOpenAiCompatibleClient(config) : null;

    const result = await generateReport(input, { client });

    return NextResponse.json(
      { ok: true, text: result.text, source: result.source },
      { status: 200, headers: { 'x-report-source': result.source, 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: true, text: '复盘生成失败，但这一局已经结束了。回去看看你的命途树，那里记着每一个岔路。', source: 'fallback' },
      { status: 200, headers: { 'x-report-source': 'fallback', 'cache-control': 'no-store' } },
    );
  }
}
