import { NextResponse } from 'next/server';

import { resolveModelConfigForRequest, secretOriginFor } from '@/features/run/keyResolution';
import { ANSWER_MAX, ANSWER_MIN, CACHE, handleBossEvaluate } from '@/features/run/bossRoute';

/**
 * 终端 Boss 判卷路由（P2）。
 *
 * ⚠️ 本文件只允许导出 HTTP 方法与路由配置：Next.js 会对 `route.ts` 做类型校验，
 * 多导出任何东西（哪怕是工具函数）都会让 `next build` 失败。
 * 因此全部逻辑放在 `features/run/bossRoute.ts`，这里保持极薄。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleBossEvaluate(request);
}

/** 探活：只报告配置状态与缓存条数，不含任何凭证明文。 */
export async function GET(request: Request): Promise<Response> {
  const config = resolveModelConfigForRequest(request);
  return NextResponse.json(
    {
      ok: true,
      provider: config ? { model: config.model, baseUrl: config.baseUrl, jsonMode: config.jsonMode } : null,
      origin: secretOriginFor(request),
      cacheEntries: CACHE.size,
      answerRange: { min: ANSWER_MIN, max: ANSWER_MAX },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
