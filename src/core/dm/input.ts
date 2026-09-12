import { normalizeProfile } from '@/core/dm/profile';
import { clampTotalTurns, clampTurnIndex } from '@/core/run/actRun';

import type { DmTurnInput } from '@/core/dm/prompt';

/**
 * 外部输入的容错归一化。
 *
 * `/api/dm` 收到的是前端传来的 JSON，可能缺字段、类型错、数值越界。
 * 这里把所有字段钳制到安全范围并补默认值，保证下游 `generateTurn`
 * 拿到的永远是一个完整的 `DmTurnInput`，而不是抛异常的半成品。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string, max = 400): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeDmInput(raw: unknown): DmTurnInput {
  const body = isRecord(raw) ? raw : {};

  const statsRaw = isRecord(body.stats) ? body.stats : {};
  const profile = normalizeProfile(body.profile);

  return {
    goal: str(body.goal, '', 200),
    // 第 2-4 回合由客户端回传第一回合解析出的档案，模型据此保持冲突一致
    ...(profile ? { profile } : {}),
    ...(typeof body.profileAnalysis === 'string' && body.profileAnalysis.trim().length > 0
      ? { profileAnalysis: body.profileAnalysis.trim().slice(0, 1200) }
      : {}),
    seed: str(body.seed, 'SEED-2026-XXXXX', 64),
    // 幕数口径的唯一事实源见 core/run/actRun.ts（v2 §14 Phase 0 第 1 条）。
    // 默认仍是 4 幕（预置剧本的人工精调长度），但允许 AI 动态关卡报到上限。
    turnIndex: clampTurnIndex(body.turnIndex),
    totalTurns: clampTotalTurns(body.totalTurns, 4),
    stats: {
      san: num(statsRaw.san, 100, 0, 100),
      skill: num(statsRaw.skill, 15, 0, 100),
      bond: num(statsRaw.bond, 10, 0, 100),
    },
    inventory: array(body.inventory)
      .slice(0, 3)
      .map((item) => {
        const relic = isRecord(item) ? item : {};
        const kind = relic.kind === 'active' ? 'active' : 'passive';
        return {
          name: str(relic.name, '未知遗物', 40),
          kind: kind as 'active' | 'passive',
          remainingCharges:
            kind === 'active' ? num(relic.remainingCharges, 1, 0, 3) : null,
        };
      }),
    zhihuSnippets: array(body.zhihuSnippets)
      .slice(0, 8)
      .map((item) => {
        const snippet = isRecord(item) ? item : {};
        return {
          author: str(snippet.author, '知乎匿名用户', 32),
          quote: str(snippet.quote, '', 200),
          sourceUrl: str(snippet.sourceUrl, 'https://www.zhihu.com', 300),
          title: str(snippet.title, '', 80) || undefined,
        };
      })
      .filter((snippet) => snippet.quote.length > 0),
    history: array(body.history)
      .slice(0, 4)
      .map((item) => {
        const entry = isRecord(item) ? item : {};
        return {
          turnIndex: num(entry.turnIndex, 1, 1, 4),
          choiceText: str(entry.choiceText, '未知选择', 60),
          outcome: str(entry.outcome, '', 60),
        };
      }),
    personaTags: array(body.personaTags)
      .slice(0, 6)
      .map((tag) => str(tag, '', 16))
      .filter((tag) => tag.length > 0),
    // 前世记忆块：由前端从本机存储生成后回传，长度上限与处境分析同级
    ...(typeof body.memoryBlock === 'string' && body.memoryBlock.trim().length > 0
      ? { memoryBlock: body.memoryBlock.trim().slice(0, 1200) }
      : {}),
  };
}
