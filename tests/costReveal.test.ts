import { describe, expect, it } from 'vitest';

import { buildInitialActionSpace, findAction } from '@/features/game-mechanics/actionSpace';
import {
  applyCostReveal,
  closableUserActions,
  costFacts,
  costRevealCandidate,
} from '@/features/game-mechanics/costReveal';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { ActionOption, EncounterPlan } from '@/features/game-mechanics/domain';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * COST REVEAL（§9-§10 / §57 / §77）。
 *
 * 关键：cost 必须**真正改变行动空间**，而不是只生成一段文案。
 */

let seq = 0;
function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact:${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: '我为了比赛，连续两周没去上专业课。',
    type: 'cost',
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

function action(id: string, overrides: Partial<ActionOption> = {}): ActionOption {
  return { id, label: `行动 ${id}`, source: 'user', sourceFactIds: [], requirements: [], ...overrides };
}

describe('costFacts', () => {
  it('只挑 cost 事实', () => {
    const facts = [fact({ type: 'cost' }), fact({ type: 'action' }), fact({ type: 'outcome' })];
    expect(costFacts(facts)).toHaveLength(1);
  });
});

describe('costRevealCandidate', () => {
  it('没有 cost fact → 不生成', () => {
    expect(costRevealCandidate({ facts: [fact({ type: 'action' })], affectedActionIds: ['a'] })).toBeNull();
  });

  it('有 cost fact 但没有可关闭行动 → 不生成（不能只是文案）', () => {
    expect(costRevealCandidate({ facts: [fact()], affectedActionIds: [] })).toBeNull();
  });

  it('cost fact + 受影响行动 → 生成带原文解释的候选', () => {
    const candidate = costRevealCandidate({
      facts: [fact({ id: 'cost-1', exactQuote: '我把整个周末都投进了比赛。' })],
      affectedActionIds: ['action-补课'],
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.effect).toBe('remove');
    expect(candidate!.affectedActionIds).toEqual(['action-补课']);
    expect(candidate!.explanation).toContain('整个周末');
    expect(candidate!.sourceFactIds).toContain('cost-1');
  });
});

describe('applyCostReveal：真正改变行动空间', () => {
  it('remove 把行动移出可用', () => {
    const space = buildInitialActionSpace([action('action-补课'), action('action-比赛')]);
    const candidate = costRevealCandidate({ facts: [fact()], affectedActionIds: ['action-补课'] })!;
    const next = applyCostReveal(space, candidate);
    expect(next.available.map((item) => item.id)).toEqual(['action-比赛']);
    expect(next.removed[0]!.action.id).toBe('action-补课');
  });

  it('lock 把行动锁住并给出理由', () => {
    const space = buildInitialActionSpace([action('action-补课')]);
    const candidate = costRevealCandidate({
      facts: [fact()],
      affectedActionIds: ['action-补课'],
      effect: 'lock',
    })!;
    const next = applyCostReveal(space, candidate);
    expect(next.locked[0]!.reason).toBe('opportunity_cost');
    expect(next.locked[0]!.explanation.length).toBeGreaterThan(0);
  });

  it('closableUserActions 只挑无门槛的用户行动', () => {
    const space = buildInitialActionSpace([
      action('user-1'),
      action('exp-1', { source: 'experience' }),
      action('cond-1', { requirements: [{ key: 'team' }] }),
    ]);
    expect(closableUserActions(space).map((item) => item.id)).toEqual(['user-1']);
  });
});

describe('validateEncounterPlan：cost_reveal 纪律', () => {
  const plan = (sourceFactIds: string[], affectedActionIds: string[]): EncounterPlan => ({
    id: 'e1',
    type: 'cost_reveal',
    act: 2,
    sourceFactIds,
    sourceCaseIds: [],
    payload: { kind: 'cost_reveal', effect: 'remove', affectedActionIds, explanation: '时间已经花掉' },
  });

  it('cost fact + 受影响行动 → 无 issue', () => {
    const issues = validateEncounterPlan(plan(['cost-1'], ['a']), {
      facts: [fact({ id: 'cost-1' })],
      cases: [],
      differences: [],
      unknownIds: [],
    });
    expect(issues).toEqual([]);
  });

  it('没有 cost fact 支撑 → 报错', () => {
    const issues = validateEncounterPlan(plan(['act-1'], ['a']), {
      facts: [fact({ id: 'act-1', type: 'action' })],
      cases: [],
      differences: [],
      unknownIds: [],
    });
    expect(issues.join(' ')).toContain('cost');
  });

  it('不改变行动空间 → 报错', () => {
    const issues = validateEncounterPlan(plan(['cost-1'], []), {
      facts: [fact({ id: 'cost-1' })],
      cases: [],
      differences: [],
      unknownIds: [],
    });
    expect(issues.join(' ')).toContain('行动空间');
  });
});
