import { NextResponse } from 'next/server';

import { extractProfile, generateProfile } from '@/core/dm/profile';
import { createOpenAiCompatibleClient } from '@/core/dm/provider';
import { resolveModelConfigForRequest, secretOriginFor } from '@/features/run/keyResolution';
import { appDailyLlmBudget } from '@/core/usage/budget';
import { appIpLlmWindow, clientIpFromHeaders } from '@/core/usage/ipRateLimit';

/**
 * 处境解析接口。
 *
 * 开放路径：让模型读完玩家原话后给出结构化档案。
 * 模型不可用或输出不合规时回落到确定性解析——**永远返回 200 与一份可用档案**。
 *
 * 防刷纪律（方案 §7）：本端点不带会话上下文，是「逐次白嫖服务器 key」
 * 最顺手的入口 —— 所以花服务器钱（`origin.model === 'app'`）之前必须先过
 * IP 窗口 + 全站每日预算；超限不报错，直接回落确定性档案（`fallback`）。
 * 自带 key 的访客不经过任何一道闸。
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
  const respondFallback = () =>
    NextResponse.json(
      { ok: true, source: 'fallback', profile: fallback, analysis: null },
      { status: 200, headers: { 'x-profile-source': 'fallback', 'cache-control': 'no-store' } },
    );

  try {
    const config = resolveModelConfigForRequest(request);
    if (!config) {
      return respondFallback();
    }

    // 只对花服务器钱的请求计数；超限 = 静默降级，不是错误
    if (secretOriginFor(request).model === 'app') {
      const ipDecision = appIpLlmWindow.consume(clientIpFromHeaders(request.headers));
      if (!ipDecision.allowed) {
        return respondFallback();
      }
      if (!appDailyLlmBudget.consume().allowed) {
        return respondFallback();
      }
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
    return respondFallback();
  }
}
