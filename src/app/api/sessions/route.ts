import { NextResponse } from 'next/server';

import { fail, newTrace, ok, readBody } from '@/features/decision-session/api';
import { liveSearchWith } from '@/features/decision-session/liveSearch';
import { createSession } from '@/features/decision-session/service';
import { FileDecisionSessionRepository } from '@/features/decision-session/store';
import { extractProfile, generateProfile } from '@/core/dm/profile';
import { createOpenAiCompatibleClient } from '@/core/dm/provider';
import { observedClaimsOf } from '@/features/reality-memory/service';
import { FileRealityMemoryRepository } from '@/features/reality-memory/store';
import { resolveModelConfigForRequest } from '@/features/run/keyResolution';
import { readOwnSettings, zhihuConfigForIdentity } from '@/features/run/identity';

import type { RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * 决策会话集合接口（重构方案 §6.2 / §6.4）。
 *
 * - `POST /api/sessions`：从一个问题建会话（第一步）
 * - `GET  /api/sessions`：列出我的会话（选择日志用）
 *
 * ⚠️ 本文件只允许导出 HTTP 方法与路由配置。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repository = new FileDecisionSessionRepository();

export async function POST(request: Request): Promise<Response> {
  const trace = newTrace();
  const body = await readBody(request);

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (question.length === 0) {
    return fail({ code: 'bad-request', message: '先写下一句你现在卡住的选择。', traceId: trace.traceId });
  }
  if (question.length > 200) {
    return fail({
      code: 'bad-request',
      message: '问题太长了（上限 200 字），请把它压缩成一句话。',
      traceId: trace.traceId,
    });
  }

  /**
   * 身份：登录用户按 url_token，未登录按匿名 cookie（与 `keyResolution` 同口径）。
   * **不要求登录** —— 方案 §2.4：不要求登录后才能获得第一次价值。
   */
  const { identity, stored } = readOwnSettings(request);

  /**
   * 现实记忆（P1-3）：这个身份已经**观测到**的事实，这一局当硬条件用。
   *
   * 读取失败就是空数组 —— 记忆是加分项，不该让「新建会话」失败。
   */
  let observedClaims: readonly string[] = [];
  try {
    const memory = await new FileRealityMemoryRepository().listByOwner(identity.key);
    observedClaims = observedClaimsOf(memory);
  } catch {
    observedClaims = [];
  }

  /**
   * 实时检索能力由**用户自己的**知乎凭证提供；没有就只走黄金案例快照。
   *
   * 这不是缺陷：方案 §6.6 明确要求「黄金问题使用审核过的来源快照，保证稳定」。
   */
  const zhihu = zhihuConfigForIdentity(stored);
  const liveSearch = zhihu ? liveSearchWith(zhihu) : undefined;

  /**
   * 处境档案（Phase 2）：**复用现有管线，不新造第二套画像**。
   *
   * 与 `/api/profile` 完全同一套纪律：
   * 有模型配置 → `generateProfile()`（模型解析）；
   * 没有、或模型失败 → `extractProfile()`（确定性规则兜底）。
   *
   * 之所以在**建会话时**就算好：这样 `/play` 后面不需要再
   * `fetchProfile(goal)` 一次 —— 档案跟着会话走，只有一份。
   */
  const modelConfig = resolveModelConfigForRequest(request);
  let profile = extractProfile(question);
  let profileAnalysis: string | null = null;
  if (modelConfig) {
    try {
      const generated = await generateProfile(question, {
        client: createOpenAiCompatibleClient(modelConfig),
      });
      profile = generated.profile;
      profileAnalysis = generated.analysis;
      trace.note(`profile-${generated.source}`);
    } catch {
      // 模型失败不阻断：确定性档案已经在那儿了
      trace.note('profile-model-failed-fallback');
    }
  } else {
    trace.note('profile-deterministic');
  }

  const session = await createSession({
    ownerId: identity.key,
    question,
    profile,
    profileAnalysis,
    /**
     * P0-5：创建会话时**不再做实时检索**。
     *
     * 两个原因：
     * 1. 检索要等澄清答完才定得准 —— 用户的回答会改变检索意图
     *    （该找相似处境、替代走法、还是反例）；
     * 2. 旧 `retrieveFor()` 与 `prepare-world` 的 multi-intent 检索
     *    叠在一起，一局会打 4 次知乎接口，白耗配额。
     *
     * 检索统一推迟到 `prepare-world` —— 那时 `SearchPlan` 才拿得到
     * 澄清后的条件。
     */
    deferRetrieval: true,
    /**
     * 现实记忆回灌（P1-3）：上一局**实验观测到**的事实，这一局当硬条件用。
     *
     * 读取失败就当没有记忆 —— 记忆是加分项，不该让「新建会话」失败。
     */
    ...(observedClaims.length > 0 ? { observedClaims } : {}),
    ...(liveSearch ? { liveSearch } : {}),
  });

  await repository.create(session);

  trace.finish({
    action: 'create-session',
    provenance: session.retrievalRun?.provenance,
    paths: session.pathClusters.length,
  });

  return ok(
    {
      id: session.id,
      question: session.question,
      provenance: session.retrievalRun?.provenance ?? 'offline',
      pathCount: session.pathClusters.length,
    },
    {
      traceId: trace.traceId,
      degraded: session.retrievalRun?.provenance === 'offline',
      // 首次访问必须把匿名身份写回，否则下一个请求会变成另一个人
      setCookie: identity.setCookie,
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const trace = newTrace();
  const { identity } = readOwnSettings(request);
  const sessions = await repository.listByOwner(identity.key);

  /**
   * 跨会话的现实记忆（P1-3）：日志页要能回答
   * 「现实里验证过的事，有哪些已经被记住」。读不到就是空数组。
   */
  let realityMemory: readonly RealityMemoryEntry[] = [];
  try {
    realityMemory = await new FileRealityMemoryRepository().listByOwner(identity.key);
  } catch {
    realityMemory = [];
  }

  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  // 与 POST 同理：首次访问的匿名身份要写回，否则日志页永远读不到自己的会话
  if (identity.setCookie) {
    headers['set-cookie'] = identity.setCookie;
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        sessions: sessions.map((session) => ({
          id: session.id,
          question: session.question,
          status: session.status,
          pathCount: session.pathClusters.length,
          createdAt: session.createdAt,
          provenance: session.retrievalRun?.provenance ?? 'offline',
          followUp: session.followUp,
          /**
           * 日志页要回答的不只是「我当时问了什么」，还有
           * 「我看见了哪些真实经历」与「我真正不知道什么」（P1-4）。
           *
           * `pathLabels` 取的是**经验引擎**合成出来的走法（不是旧
           * pathClusters）—— 那才是这一局真正喂给玩家与世界蓝图的东西。
           */
          experiencePathCount: (session.experiencePaths ?? []).length,
          pathLabels: (session.experiencePaths ?? []).map((path) => path.label).slice(0, 3),
          keyUnknown: session.worldBlueprint?.keyUnknown?.label ?? null,
          experiment: session.experiment
            ? {
                action: session.experiment.action,
                timebox: session.experiment.timebox,
                successSignal: session.experiment.successSignal,
              }
            : null,
        })),
        /** 跨会话记忆：现实里验证过的事（P1-3）。 */
        realityMemory,
      },
      meta: { traceId: trace.traceId },
    },
    { status: 200, headers },
  );
}


