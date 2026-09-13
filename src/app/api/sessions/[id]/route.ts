import { NextResponse } from 'next/server';

import { createProviderRouter } from '@/agents/providerRouter';
import { tieredProvidersFromConfig, TIERED_ROUTING } from '@/agents/tieredRouting';
import { fail, newTrace, ok, readBody } from '@/features/decision-session/api';
import { experienceSearchWith, liveSearchWith } from '@/features/decision-session/liveSearch';
import {
  answerFollowUp,
  applyClarify,
  applyDynamicClarification,
  commitExperiment,
  designExperiment,
  loadOwnedSession,
  prepareExperienceSession,
  questionsForSession,
  selectUnknown,
} from '@/features/decision-session/service';
import { FileDecisionSessionRepository, isSessionId } from '@/features/decision-session/store';
import { withExperienceSearchCache } from '@/features/experience/searchCache';
import { memoryEntriesFromResult } from '@/features/reality-memory/service';
import { FileRealityMemoryRepository } from '@/features/reality-memory/store';
import { readOwnSettings, zhihuConfigForIdentity } from '@/features/run/identity';
import { resolveModelConfigForRequest } from '@/features/run/keyResolution';

import type { DecisionSession } from '@/features/decision-session/domain';
import type { ExperimentResult } from '@/features/reality-memory/domain';

/**
 * 单个决策会话（重构方案 §6.2 / §6.4）。
 *
 * - `GET   /api/sessions/[id]`：读取会话
 * - `PATCH /api/sessions/[id]`：推进流程（澄清 / 选未知 / 设计实验 / 认领 / 回访）
 * - `DELETE /api/sessions/[id]`：删除会话（方案 §6.5 要求的删除入口）
 *
 * 状态码语义见 `api.ts`：参数错 400 / 未登录 401 / 不存在或不属于你 404。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repository = new FileDecisionSessionRepository();

/** 会话对客户端的视图：**不含 ownerId**（那是服务端概念）。 */
function viewOf(session: DecisionSession, ownerId: string) {
  return {
    id: session.id,
    status: session.status,
    question: session.question,
    userContext: session.userContext,
    /**
     * 问题框定与处境档案（Phase 2）。
     *
     * 一起下发是刻意的：界面要能回答「系统到底把你哪句话当成了事实」——
     * `problemFrame.constraints[].origin` 就是这个问题的答案。
     */
    problemFrame: session.problemFrame,
    profile: session.profile,
    profileAnalysis: session.profileAnalysis,
    retrievalRun: session.retrievalRun,
    evidenceFacts: session.evidenceFacts,
    pathClusters: session.pathClusters,
    /** 经验引擎产物（P0-C~F）：路径、差异与世界蓝图都在这里。 */
    experienceFacts: session.experienceFacts ?? [],
    experienceCases: session.experienceCases ?? [],
    experiencePaths: session.experiencePaths ?? [],
    worldBlueprint: session.worldBlueprint ?? null,
    selectedUnknown: session.selectedUnknown,
    experiment: session.experiment,
    followUp: session.followUp,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    /**
     * 澄清问题（Phase 3）：动态生成、0～2 条，且**不含用户已说过的**。
     *
     * 旧 `questionsForSession()` 是 Phase 3 之前落盘会话的 fallback
     * —— 那些会话没有 `clarificationNeeds` 字段，仍按固定三问答复。
     */
    questions: session.clarificationNeeds ?? questionsForSession(session),
    ownerId,
  };
}

async function resolve(request: Request, id: string) {
  const { identity } = readOwnSettings(request);
  if (!isSessionId(id)) {
    return { identity, session: null as DecisionSession | null };
  }
  const session = await loadOwnedSession(repository, id, identity.key);
  return { identity, session };
}

export async function GET(request: Request, context: { params: { id: string } }): Promise<Response> {
  const trace = newTrace();
  const { identity, session } = await resolve(request, context.params.id);

  if (!session) {
    // 刻意不区分「不存在」与「不属于你」——不泄露他人会话是否存在
    return fail({ code: 'not-found', message: '没有找到这个会话。', traceId: trace.traceId });
  }

  return ok(viewOf(session, identity.key), {
    traceId: trace.traceId,
    degraded: session.retrievalRun?.provenance === 'offline',
    // 匿名身份首次出现时写回，否则「建了会话却打不开」
    setCookie: identity.setCookie,
  });
}

export async function PATCH(request: Request, context: { params: { id: string } }): Promise<Response> {
  const trace = newTrace();
  const { identity, session } = await resolve(request, context.params.id);

  if (!session) {
    return fail({ code: 'not-found', message: '没有找到这个会话。', traceId: trace.traceId });
  }

  const body = await readBody(request);
  const action = typeof body?.action === 'string' ? body.action : '';
  let next = session;

  switch (action) {
    case 'clarify': {
      const raw = body?.answers;
      const answers: Record<string, string | undefined> = {};
      if (typeof raw === 'object' && raw !== null) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          answers[key] = typeof value === 'string' ? value : undefined;
        }
      }
      /**
       * 有动态问题时走动态落地（按 missingVariable 分派）；
       * 没有则回退旧实现 —— 保证 Phase 3 之前建的会话仍能被答复。
       */
      next =
        (session.clarificationNeeds ?? []).length > 0
          ? applyDynamicClarification(session, answers)
          : applyClarify(session, answers);
      break;
    }
    case 'prepare-world': {
      /**
       * prepare-world（P0-F）：把已澄清的会话编译成世界蓝图。
       *
       * 澄清没答完就 400 —— 蓝图消费的是用户补进 frame 的硬条件，
       * 跳过澄清等于让系统继续靠猜。
       */
      if ((session.clarificationNeeds ?? []).length > 0) {
        return fail({
          code: 'bad-request',
          message: '还有澄清问题没有回答，先回答它们再生成世界。',
          traceId: trace.traceId,
        });
      }
      if (!session.problemFrame) {
        return fail({ code: 'bad-request', message: '这个会话缺少问题框定，无法生成世界。', traceId: trace.traceId });
      }

      // 与 POST /api/sessions 同一模式：检索与模型能力由用户自己的凭证决定
      const { identity: own, stored } = readOwnSettings(request);
      const zhihu = zhihuConfigForIdentity(stored);
      const modelConfig = resolveModelConfigForRequest(request);
      const router = modelConfig
        ? createProviderRouter({
            providers: tieredProvidersFromConfig({
              apiKey: modelConfig.apiKey,
              baseUrl: modelConfig.baseUrl,
              jsonMode: modelConfig.jsonMode,
              timeoutMs: modelConfig.timeoutMs,
              temperature: modelConfig.temperature,
              maxTokens: modelConfig.maxTokens,
            }),
            routing: TIERED_ROUTING,
          })
        : null;

      next = await prepareExperienceSession(session, {
        // 多意图检索 + 持久化缓存：同一问题整局只搜一次（Phase 5）
        ...(zhihu ? { search: withExperienceSearchCache(experienceSearchWith(zhihu)) } : {}),
        ...(router ? { router } : {}),
      });
      break;
    }
    case 'select-unknown': {
      const unknown = typeof body?.unknown === 'string' ? body.unknown.trim() : '';
      if (unknown.length === 0) {
        return fail({ code: 'bad-request', message: '请选择一个你想先弄清的未知。', traceId: trace.traceId });
      }
      next = selectUnknown(session, unknown);
      break;
    }
    case 'design-experiment':
      next = designExperiment(session.selectedUnknown ? session : selectUnknown(session, fallbackUnknown(session)));
      break;
    case 'commit':
      next = commitExperiment(session);
      break;
    case 'follow-up': {
      const outcome = body?.outcome;
      if (outcome !== 'done' && outcome !== 'partial' && outcome !== 'changed-plan') {
        return fail({
          code: 'bad-request',
          message: '回访结果只能是 done / partial / changed-plan。',
          traceId: trace.traceId,
        });
      }
      next = answerFollowUp(session, {
        outcome,
        ...(typeof body?.note === 'string' && body.note.length > 0 ? { note: body.note } : {}),
      });

      /**
       * 现实记忆（P1-3）：把这次**观测**写下来，让下一次会话能用到。
       *
       * 旧结构只留 `outcome`（做到了 / 做了一部分 / 改了计划）—— 那是结论，
       * 不足以在下一局当条件用。带结构化 `result` 时额外记录：
       * 实际投入、实际产出、是否命中信号、以及用户自己写下的判断。
       *
       * 写入失败**不影响回访本身**：回访已经保存，记忆是可选的附加值。
       */
      const result = parseExperimentResult(body?.result);
      if (result) {
        try {
          const repo = new FileRealityMemoryRepository();
          const existing = await repo.listByOwner(identity.key);
          const { merged } = memoryEntriesFromResult({
            sessionId: session.id,
            result,
            createdAt: new Date().toISOString(),
            existing,
          });
          await repo.save(identity.key, merged);
        } catch {
          // 记忆写不进去不该让用户的回访失败；下一次观测还有机会补上
        }
      }
      break;
    }
    default:
      return fail({ code: 'bad-request', message: `不认识的动作：${action}`, traceId: trace.traceId });
  }

  await repository.save(next);
  trace.finish({ action, status: next.status });

  return ok(viewOf(next, identity.key), { traceId: trace.traceId, setCookie: identity.setCookie });
}

export async function DELETE(request: Request, context: { params: { id: string } }): Promise<Response> {
  const trace = newTrace();
  const { identity, session } = await resolve(request, context.params.id);

  if (!session) {
    return fail({ code: 'not-found', message: '没有找到这个会话。', traceId: trace.traceId });
  }

  await repository.remove(session.id);
  return NextResponse.json(
    { ok: true, data: { removed: session.id }, meta: { traceId: trace.traceId } },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * 没选未知时，从路径里挑第一个 unknowns 作为默认。
 *
 * 这是**唯一的兜底**，且它不发明内容：只是替用户点了第一条。
 * 找不到任何未知时给一句诚实的占位，而不是编一个。
 */
function fallbackUnknown(session: DecisionSession): string {
  for (const cluster of session.pathClusters) {
    const first = cluster.unknowns[0];
    if (first) {
      return first;
    }
  }
  return '这件事适不适合我，目前还没有可核对的信息';
}

/**
 * 解析回访时提交的结构化实验结果（P1-3）。
 *
 * **宽进严出**：字段缺就缺（`null` / 空数组），但类型不对的值一律丢弃 ——
 * 我们宁可少记一条观测，也不把模型或用户随手写的字符串当成事实。
 * `status` 必须是四个合法值之一，否则整条结果视为无效。
 */
function parseExperimentResult(raw: unknown): ExperimentResult | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (status !== 'completed' && status !== 'partial' && status !== 'stopped' && status !== 'abandoned') {
    return null;
  }

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  const optionalText = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  const triState = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

  return {
    status,
    observations: strings(record.observations),
    ...(optionalText(record.actualTime) ? { actualTime: optionalText(record.actualTime)! } : {}),
    ...(optionalText(record.producedArtifact)
      ? { producedArtifact: optionalText(record.producedArtifact)! }
      : {}),
    hitSuccessSignal: triState(record.hitSuccessSignal),
    hitStopSignal: triState(record.hitStopSignal),
    whatChanged: optionalText(record.whatChanged) ?? '',
    newUnknowns: strings(record.newUnknowns),
  };
}
