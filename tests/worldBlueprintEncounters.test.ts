import { describe, expect, it } from 'vitest';

import { compileWorldBlueprint } from '@/features/game-world/compileWorld';
import { buildExperienceCases } from '@/features/experience/cases';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { WorldBlueprint } from '@/features/game-world/domain';
import type {
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * WorldBlueprint 的 Encounter 接线（玩法线程 §34 / §82）。
 *
 * 三条纪律：
 * 1. 三幕结构不变（不因为玩法增强变成五幕）；
 * 2. `encounters` 可选，旧 snapshot 缺字段仍然有效；
 * 3. 每一条 Encounter 都必须能通过诚实校验（引用真实证据）。
 */

let seq = 0;
function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact:${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: '我先做了一个 48 小时的最小 Demo 再决定。',
    type: 'action',
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

const unknown: UnknownVariable = {
  id: 'unknown-hours',
  label: '每周能否稳定投入 8 小时',
  whyItMatters: '它决定高强度比赛是否成立。',
  kind: 'time-capacity',
  origin: 'missing-user-context',
  priority: 1,
};

function frame(overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛，但怕影响课程',
    currentSituation: '大二在读',
    desiredChange: '参加一次比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '想积累作品 vs 每周只有 8 小时',
    unknowns: [unknown],
    parseConfidence: 0.6,
    ...overrides,
  };
}

function path(overrides: Partial<ExperiencePath> = {}): ExperiencePath {
  return {
    id: 'path-1',
    label: '先做小样再决定',
    summary: '用小交付替代空想。',
    supportingCaseIds: ['case:src-a'],
    opposingCaseIds: ['case:src-b'],
    supportingFactIds: [],
    opposingFactIds: [],
    observedConditions: [],
    observedActions: [],
    observedCosts: [],
    observedOutcomes: [],
    differencesFromUser: [
      {
        variable: '固定队友',
        relation: 'different',
        userValue: '没有',
        experienceValue: '有固定队友',
        evidenceFactIds: [],
      },
    ],
    unknowns: [],
    origin: 'model-clustered',
    ...overrides,
  };
}

function realisticFacts(): readonly ExperienceFact[] {
  return [
    fact({ id: 'act-main', type: 'action', sourceId: 'src-1' }),
    fact({ id: 'a-a', type: 'action', sourceId: 'src-a', exactQuote: '边做边学，直接报名' }),
    fact({ id: 'a-b', type: 'action', sourceId: 'src-b', exactQuote: '没准备好就报了名' }),
    fact({ id: 'o-a', type: 'outcome', sourceId: 'src-a', exactQuote: '最后拿了省二' }),
    fact({ id: 'o-b', type: 'outcome', sourceId: 'src-b', exactQuote: '中途退出，拖累了队友' }),
  ];
}

describe('compileWorldBlueprint × Encounter', () => {
  it('仍然三幕（§29），encounters 只是一个附加数组', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path()],
      facts: realisticFacts(),
    });
    expect(blueprint.acts).toHaveLength(3);
    expect(Array.isArray(blueprint.encounters)).toBe(true);
  });

  it('没有证据时不强行生成（允许空数组）', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame({ unknowns: [] }),
      paths: [],
      facts: [],
    });
    expect(blueprint.encounters).toEqual([]);
  });

  it('每条 Encounter 都能通过诚实校验（引用真实证据）', () => {
    const facts = realisticFacts();
    const paths = [path({ supportingFactIds: ['act-main'] })];
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths, facts });

    const cases = buildExperienceCases(facts);
    const input = {
      facts,
      cases,
      differences: paths.flatMap((item) => item.differencesFromUser),
      unknownIds: [unknown.id],
    };

    expect(blueprint.encounters!.length).toBeGreaterThan(0);
    for (const plan of blueprint.encounters!) {
      expect(validateEncounterPlan(plan, input)).toEqual([]);
    }
  });

  it('旧 snapshot（无 encounters 字段）仍然有效（§34 / §82）', () => {
    const legacy: WorldBlueprint = {
      version: 'world-blueprint-v1',
      sessionId: 's-legacy',
      problemFrame: frame(),
      centralTension: 'tension',
      paths: [],
      keyUnknown: null,
      acts: [],
      experienceFacts: [],
      unlocks: [],
      forbiddenClaims: ['不得宣称成功概率'],
    };
    // 运行时按 `?? []` 降级，不因为缺字段而崩
    expect(legacy.encounters ?? []).toEqual([]);
  });

  it('确定性：同输入两次编译逐字节一致（含 encounters）', () => {
    const build = () =>
      compileWorldBlueprint({
        sessionId: 's1',
        frame: frame(),
        paths: [path({ supportingFactIds: ['act-main'] })],
        facts: realisticFacts(),
      });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
