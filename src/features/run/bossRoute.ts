import { NextResponse } from 'next/server';

import { createOpenAiCompatibleClient, type DmModelClient } from '@/core/dm/provider';
import { resolveModelConfigForRequest, secretOriginFor } from '@/features/run/keyResolution';
import { createTrace } from '@/core/observability';
import { appDailyLlmBudget } from '@/core/usage/budget';
import { appIpLlmWindow, clientIpFromHeaders } from '@/core/usage/ipRateLimit';
import { createBossCache, evaluateBoss, type BossCache, type BossVerdict } from '@/core/run/bossJudge';
import { clampUnit, type WorldState } from '@/core/run/worldState';

/**
 * 终端 Boss 判卷的**处理器实现**。
 *
 * 为什么逻辑不写在 `route.ts` 里：Next.js 会对路由文件做类型校验，
 * 只允许导出 HTTP 方法与少量配置项（`runtime` / `dynamic` …）。
 * 把可复用逻辑放这里，路由文件保持极薄 —— 顺带让测试可以直接注入
 * 假的模型客户端与独立缓存，不必去 mock 整个 HTTP 层。
 *
 * 契约与项目其余接口一致：**永不 500**，一切失败都以结构化结果返回，
 * 最坏情况是本地降级判卷 —— 终局绝不能因为模型不可用而卡住。
 */

/** 单实例共享缓存（docker-compose 明确单副本运行，见其顶部说明）。 */
export const CACHE: BossCache = createBossCache();

import { BOSS_ANSWER_MAX, BOSS_ANSWER_MIN } from '@/features/run/contracts';

/** 答案长度区间（来自契约层，客户端与服务端共用同一份定义）。 */
export const ANSWER_MIN = BOSS_ANSWER_MIN;
export const ANSWER_MAX = BOSS_ANSWER_MAX;

export interface BossDeps {
  readonly client?: DmModelClient | null;
  readonly cache?: BossCache;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 校验并钳制客户端传来的世界状态；形状不对就返回 null（不猜、不补默认值）。 */
export function normalizeWorld(raw: unknown): WorldState | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const stats = asRecord(record.stats);
  const hidden = asRecord(record.hidden);
  if (!stats || !hidden) {
    return null;
  }

  const num = (source: Record<string, unknown>, key: string): number | null => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const san = num(stats, 'san');
  const skill = num(stats, 'skill');
  const bond = num(stats, 'bond');
  const bodyAlarm = num(hidden, 'bodyAlarm');
  const peerPressure = num(hidden, 'peerPressure');
  const runway = num(hidden, 'runway');
  const mentorTrust = num(hidden, 'mentorTrust');
  const socialDebt = num(hidden, 'socialDebt');

  if (
    san === null ||
    skill === null ||
    bond === null ||
    bodyAlarm === null ||
    peerPressure === null ||
    runway === null ||
    mentorTrust === null ||
    socialDebt === null
  ) {
    return null;
  }

  return {
    stats: { san: clampUnit(san), skill: clampUnit(skill), bond: clampUnit(bond) },
    hidden: {
      bodyAlarm: clampUnit(bodyAlarm),
      peerPressure: clampUnit(peerPressure),
      runway: clampUnit(runway),
      mentorTrust: clampUnit(mentorTrust),
      socialDebt: clampUnit(socialDebt),
    },
    flags: Array.isArray(record.flags)
      ? record.flags.filter((flag): flag is string => typeof flag === 'string').slice(0, 32)
      : [],
  };
}

/**
 * 解析模型客户端：**账号配置优先，环境变量兜底**（见 `keyResolution`）。
 * 没配任何 key 时返回 null —— 判卷自动走本地规则，终局不会卡住。
 *
 * 防刷纪律（方案 §7 补充层）：本端点不带会话上下文，任何人都能反复 POST
 * 让服务器 key 逐次判卷。所以 `origin.model === 'app'` 时必须先过
 * IP 窗口 + 全站每日预算 —— 超限**不报错**，直接返回 null 让判卷走
 * 本地规则（与「模型不可用」同一条降级路径，终局绝不因此卡住）。
 * 自带 key 的访客不经过任何一道闸。
 */
export function resolveBossClient(request: Request): DmModelClient | null {
  const config = resolveModelConfigForRequest(request);
  if (!config) {
    return null;
  }
  if (secretOriginFor(request).model === 'app') {
    const ipDecision = appIpLlmWindow.consume(clientIpFromHeaders(request.headers));
    if (!ipDecision.allowed) {
      return null;
    }
    if (!appDailyLlmBudget.consume().allowed) {
      return null;
    }
  }
  return createOpenAiCompatibleClient(config);
}

/** 判卷主体。抽成函数是为了让测试注入假客户端与独立缓存。 */
export async function handleBossEvaluate(request: Request, deps: BossDeps = {}): Promise<Response> {
  const trace = createTrace();

  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await request.json());
  } catch {
    body = null;
  }

  const reject = (reason: string): Response => {
    trace.note(reason);
    trace.finish({ phase: 'reject' });
    return NextResponse.json(
      { ok: false, reason, evaluation: null, adjudication: null },
      { status: 200, headers: { 'cache-control': 'no-store', 'x-trace-id': trace.traceId } },
    );
  };

  if (!body) {
    return reject('invalid-body');
  }

  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
  const seed = typeof body.seed === 'string' ? body.seed.trim() : '';

  if (runId.length === 0) {
    return reject('missing-runId');
  }
  if (seed.length === 0) {
    return reject('missing-seed');
  }
  if (answer.length < ANSWER_MIN) {
    return reject('answer-too-short');
  }
  if (answer.length > ANSWER_MAX) {
    return reject('answer-too-long');
  }

  const world = normalizeWorld(body.world);
  if (!world) {
    return reject('invalid-world');
  }

  const sources = Array.isArray(body.sources)
    ? body.sources
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          quote: typeof item.quote === 'string' ? item.quote : '',
        }))
        .filter((item) => item.id.length > 0 && item.quote.length > 0)
        .slice(0, 8)
    : [];

  const scenarioRevision = typeof body.scenarioRevision === 'string' ? body.scenarioRevision : '1';
  const turnIndex = typeof body.turnIndex === 'number' && Number.isFinite(body.turnIndex) ? body.turnIndex : 4;
  const relicModifier =
    typeof body.relicModifier === 'number' && Number.isFinite(body.relicModifier) ? body.relicModifier : 0;

  const client = deps.client !== undefined ? deps.client : resolveBossClient(request);
  const cache = deps.cache ?? CACHE;

  try {
    const startedAt = Date.now();
    const verdict: BossVerdict = await evaluateBoss({
      answer,
      runId,
      world,
      seed,
      scenarioRevision,
      allowedSourceIds: sources.map((source) => source.id),
      sources,
      relicModifier,
      turnIndex,
      client,
      cache,
    });

    trace.stage('boss-judge', Date.now() - startedAt);
    trace.note(verdict.source);
    if (verdict.modelIssue) {
      trace.note(`model-${verdict.modelIssue}`);
    }
    trace.finish({ source: verdict.source, answerLength: answer.length, dc: verdict.adjudication.dc });

    return NextResponse.json(
      {
        ok: true,
        source: verdict.source,
        evaluation: verdict.evaluation,
        adjudication: verdict.adjudication,
        modelIssue: verdict.modelIssue,
        answerHash: verdict.answerHash,
      },
      {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'x-boss-source': verdict.source,
          'x-trace-id': trace.traceId,
        },
      },
    );
  } catch (error) {
    // 判卷层已保证不抛；这里是最后一道防线：宁可本地判卷也不让终局卡死
    trace.note('route-catch');
    trace.finish({ phase: 'catch' });
    return NextResponse.json(
      {
        ok: false,
        reason: 'judge-exception',
        message: error instanceof Error ? error.message : String(error),
        evaluation: null,
        adjudication: null,
      },
      { status: 200, headers: { 'cache-control': 'no-store', 'x-trace-id': trace.traceId } },
    );
  }
}
