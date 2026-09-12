import { NextResponse } from 'next/server';

import { createZhihuClient } from '@/core/zhihu/client';
import { resolveZhihuConfigForRequest } from '@/features/run/keyResolution';

/**
 * 知乎热榜代理。
 *
 * 产品用途：给「命运发令台」提供当天的真实热点作为推演目标的灵感来源——
 * 玩家不必凭空想一个迷茫，可以直接从今日知乎热榜里挑一个正在被讨论的议题。
 *
 * 契约与项目其余接口一致：**永远返回 200**。未配置凭证或接口失败时返回空数组，
 * 前端据此隐藏该模块，而不是弹错误。
 *
 * 配额：热榜 100 次/天。这里靠 client 内部的 LRU + TTL 缓存（默认 10 分钟）
 * 保护，同一时间窗内多次访问只打一次真实请求。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limitParam = new URL(request.url).searchParams.get('limit');
  const limit = Math.min(Math.max(Number(limitParam) || 6, 1), 20);

  const config = resolveZhihuConfigForRequest(request);
  if (!config) {
    return NextResponse.json(
      { ok: true, items: [], configured: false },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const result = await createZhihuClient(config).hotList(limit);

    if (!result.ok) {
      return NextResponse.json(
        { ok: true, items: [], configured: true, error: result.message },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        configured: true,
        items: result.data.map((item) => ({
          title: item.Title,
          url: item.Url,
          summary: item.Summary,
        })),
      },
      {
        status: 200,
        // 热榜本身变化不快，允许浏览器侧缓存 5 分钟，进一步省配额
        headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=600' },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: true, items: [], configured: true },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
}
