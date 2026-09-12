import { NextResponse } from 'next/server';

import { fail, newTrace, ok, readBody } from '@/features/decision-session/api';
import {
  answerFollowUp,
  applyClarify,
  commitExperiment,
  designExperiment,
  loadOwnedSession,
  questionsForSession,
  selectUnknown,
} from '@/features/decision-session/service';
import { FileDecisionSessionRepository, isSessionId } from '@/features/decision-session/store';
import { readOwnSettings } from '@/features/run/identity';

import type { DecisionSession } from '@/features/decision-session/domain';

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
    selectedUnknown: session.selectedUnknown,
    experiment: session.experiment,
    followUp: session.followUp,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    /** 澄清问题由服务端给出，保证与判定问题类型的逻辑同一份。 */
    questions: questionsForSession(session),
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
      next = applyClarify(session, answers);
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
