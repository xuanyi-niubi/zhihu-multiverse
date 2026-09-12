import { NextResponse } from 'next/server';

import { extractProfile, generateProfile } from '@/core/dm/profile';
import { createOpenAiCompatibleClient } from '@/core/dm/provider';
import { resolveModelConfigForRequest } from '@/features/run/keyResolution';

/**
 * 处境解析接口。
 *
 * 开放路径：让模型读完玩家原话后给出结构化档案。
 * 模型不可用或输出不合规时回落到确定性解析——**永远返回 200 与一份可用档案**。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let goal = '';

  try {
    const body: unknown = await request.json();
    if (typeof body === 'object' && body !== null) {
      const raw = (body as { goal?: unknown }).goal;
      goal = typeof raw === 'string' ? raw.slice(0, 200) : '';
    }
  } catch {
    // 请求体不是 JSON：按空目标处理
  }

  const fallback = extractProfile(goal);

  try {
    const config = resolveModelConfigForRequest(request);
    if (!config) {
      return NextResponse.json(
        { ok: true, source: 'fallback', profile: fallback, analysis: null },
        { status: 200, headers: { 'x-profile-source': 'fallback', 'cache-control': 'no-store' } },
      );
    }

    const result = await generateProfile(goal, {
      client: createOpenAiCompatibleClient(config),
    });

    return NextResponse.json(
      {
        ok: true,
        source: result.source,
        profile: result.profile,
        analysis: result.analysis,
      },
      {
        status: 200,
        headers: {
          'x-profile-source': result.source,
          'cache-control': 'no-store',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: true, source: 'fallback', profile: fallback, analysis: null },
      { status: 200, headers: { 'x-profile-source': 'fallback', 'cache-control': 'no-store' } },
    );
  }
}
