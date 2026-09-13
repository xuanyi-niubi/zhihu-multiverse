import { NextResponse } from 'next/server';

import { generateTurn, MINIMAL_TURN, type DmDiagnostic, type DmSource } from '@/core/dm/generate';
import { normalizeDmInput } from '@/core/dm/input';
import { createOpenAiCompatibleClient } from '@/core/dm/provider';
import { withDirectedPlot } from '@/agents/dmOrchestration';
import { createProviderRouter } from '@/agents/providerRouter';
import { TIERED_ROUTING, tieredProvidersFromConfig } from '@/agents/tieredRouting';
import {
  resolveModelConfigForRequest,
  resolveZhihuConfigForRequest,
  secretOriginFor,
} from '@/features/run/keyResolution';
import { createTrace } from '@/core/observability';
import { createZhihuClient } from '@/core/zhihu/client';
import { buildSearchQuery } from '@/core/zhihu/query';
import { toDmSnippets } from '@/core/zhihu/snippets';
import { getFallbackTurn } from '@/data/prebuiltScenarios';

import { injectExperienceUnlock } from '@/features/game-world/experienceUnlock';

import type { DmTurnInput } from '@/core/dm/prompt';
import type { ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * AI DM 关卡生成接口。
 *
 * 硬性契约：**永远返回 HTTP 200 与一个合法 ScenarioTurn**。
 * 前端因此不需要处理任何错误分支——最坏情况也只是拿到离线兜底关卡，
 * 并在 `x-dm-source: fallback` 里看到原因。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallbackTurnFor(input: DmTurnInput): ScenarioTurn {
  return getFallbackTurn(input.turnIndex);
}

export async function POST(request: Request): Promise<Response> {
  let input: DmTurnInput = normalizeDmInput(null);

  try {
    const body: unknown = await request.json();
    input = normalizeDmInput(body);
  } catch {
    // 请求体不是 JSON：保留默认输入，仍然走下面的正常管线
  }

  // 每个请求一条 trace：阶段耗时与降级原因码，响应头回传 traceId 便于对账
  const trace = createTrace({ turnIndex: input.turnIndex });

  try {
    // 调试开关：注入人工延迟，用于验证「真实网络延迟期间舞台不假死」的加载动效
    const debugDelay = Number(process.env.DM_DEBUG_DELAY_MS ?? 0);
    if (Number.isFinite(debugDelay) && debugDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(debugDelay, 15_000)));
    }

    const preDiagnostics: DmDiagnostic[] = [];

    // 世界蓝图优先（Phase 13 / P0-G）：蓝图里编译好的真实经验直接转成
    // 引用片段 —— 整局复用 Session 那一次检索，**不再逐幕烧知乎搜索配额**。
    // 只有既无蓝图 sourceFacts、也无客户端片段时，才走 legacy 的逐幕搜索兜底。
    if (input.worldContext && input.worldContext.sourceFacts.length > 0 && input.zhihuSnippets.length === 0) {
      input = {
        ...input,
        zhihuSnippets: input.worldContext.sourceFacts.map((fact) => ({
          author: fact.author,
          quote: fact.quote,
          sourceUrl: fact.sourceUrl,
        })),
      };
      trace.note('world-context-grounded');
    }

    // 用知乎搜索为这一回合补充真实站内语料：DM 据此生成，前端据此展示溯源角标
    const zhihuConfig = resolveZhihuConfigForRequest(request);
    if (zhihuConfig && input.zhihuSnippets.length === 0) {
      const zhihu = createZhihuClient(zhihuConfig);
      // 按幕次派生差异化 query：四幕都用玩家原话会命中同一批语料，
      // 导致溯源角标反复指向同一答主（详见 core/zhihu/query.ts）
      const query = buildSearchQuery(input);

      const searchStartedAt = Date.now();
      const found = await zhihu.search(query, 5);
      trace.stage('zhihu-search', Date.now() - searchStartedAt);

      if (found.ok) {
        const snippets = toDmSnippets(found.data, { limit: 5 });
        input = { ...input, zhihuSnippets: snippets };
        preDiagnostics.push({
          stage: 'provider',
          code: 'zhihu-search',
          message: `知乎搜索命中 ${found.data.length} 条，采用 ${snippets.length} 条高权威片段（query: ${query}）`,
        });
        trace.note('zhihu-search-ok');
      } else {
        preDiagnostics.push({
          stage: 'provider',
          code: `zhihu-search-${found.code}`,
          message: `知乎搜索失败：${found.message}`,
        });
        trace.note(`zhihu-search-${found.code}`);
      }
    }

    const config = resolveModelConfigForRequest(request);
    const client = config ? createOpenAiCompatibleClient(config) : null;

    const generateStartedAt = Date.now();
    const result = await generateTurn(input, { client, fallback: fallbackTurnFor });
    trace.stage('dm-generate', Date.now() - generateStartedAt);

    // 情节导演：由 AI 决定「这一幕发生了什么」（结构），正文仍用上面的文本层产出。
    // 没配 provider 时 withDirectedPlot 原样返回，保证零回归。
    const router = config
      ? createProviderRouter({
          // 快慢双流（方案 §2）：逐幕叙事走快流（延迟优先），
          // 证据拆解与情节结构走深流（推理优先）。
          // 两者同名时只注册一个 provider，路由表自动退化为单流 —— 零回归。
          providers: tieredProvidersFromConfig({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            jsonMode: config.jsonMode,
            timeoutMs: config.timeoutMs,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          }),
          routing: TIERED_ROUTING,
        })
      : null;

    const directed = await withDirectedPlot({ turn: result.turn, dmInput: input, router });
    trace.note(`plot-${directed.plotSource}`);
    if (directed.plotProvider) {
      trace.note(`plot-provider-${directed.plotProvider}`);
    }

    // 来源与修复信息进日志（只记 code，不记玩家原文与模型原文）
    trace.note(result.source);
    for (const diagnostic of [...preDiagnostics, ...result.diagnostics]) {
      trace.note(diagnostic.code);
    }

    trace.finish({
      source: result.source,
      snippetCount: input.zhihuSnippets.length,
      diagnosticCount: preDiagnostics.length + result.diagnostics.length,
    });

    // 经验解锁（P0-H）：把 Session 蓝图派生的新选项织进本幕（不足 3 项才注入）
    const turn = injectExperienceUnlock({
      choices: directed.turn.choices,
      unlock: input.experienceUnlock ?? null,
      /**
       * `act` 是 **1 基**，而 `DmTurnInput.turnIndex` 本身就是 1 基。
       *
       * 原来写的是 `input.turnIndex + 1`（多加了 1），于是解锁项的
       * `availableFromAct` 判定整体晚一幕生效 —— 与 P0-1 是同一类错位。
       */
      act: input.turnIndex,
    });
    const finalTurn = turn === directed.turn.choices ? directed.turn : { ...directed.turn, choices: turn };

    return NextResponse.json(
      {
        ok: true,
        source: result.source,
        turn: finalTurn,
        plotSource: directed.plotSource,
        plotProvider: directed.plotProvider,
        // 第一回合解析出的处境档案回传前端，后续回合由前端带回来
        profile: result.profile,
        diagnostics: [...preDiagnostics, ...result.diagnostics],
      },
      {
        status: 200,
        headers: {
          'x-dm-source': result.source,
          'x-plot-source': directed.plotSource,
          'x-trace-id': trace.traceId,
          'cache-control': 'no-store',
        },
      },
    );
  } catch (error) {
    // generateTurn 已保证不抛；这里只是最后一道防线，确保路由不会 500。
    trace.note('route-catch');
    trace.finish({ source: 'fallback', snippetCount: input.zhihuSnippets.length });

    return NextResponse.json(
      {
        ok: true,
        source: 'fallback' satisfies DmSource,
        turn: fallbackTurnFor(input),
        diagnostics: [
          {
            stage: 'internal',
            code: 'route-catch',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
      {
        status: 200,
        headers: {
          'x-dm-source': 'fallback',
          'x-trace-id': trace.traceId,
          'cache-control': 'no-store',
        },
      },
    );
  }
}

/** 供前端与运维探活：返回当前 provider 与知乎搜索的配置（不含密钥）。 */
export async function GET(request: Request): Promise<Response> {
  const config = resolveModelConfigForRequest(request);
  const zhihuConfig = resolveZhihuConfigForRequest(request);

  return NextResponse.json(
    {
      ok: true,
      provider: config
        ? {
            model: config.model,
            baseUrl: config.baseUrl,
            jsonMode: config.jsonMode,
            timeoutMs: config.timeoutMs,
          }
        : null,
      zhihuSearch: zhihuConfig ? { baseUrl: zhihuConfig.baseUrl } : null,
      minimalTurnTitle: MINIMAL_TURN.title,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
