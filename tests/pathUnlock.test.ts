import { describe, expect, it } from 'vitest';

import {
  actionFacts,
  actionOptionFromFact,
  isActionFact,
  pathUnlockActionsFromFacts,
  pathUnlockPayloadFromFact,
} from '@/features/game-mechanics/pathUnlock';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * PATH UNLOCK 的事实类型约束（§54 / §76）。
 *
 * > 只有 action fact 能解锁行动。
 * > cost / reflection / condition 一律不可以。
 */

let seq = 0;
function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact:${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: '我先做了一个最小样再决定是否全力投入。',
    type: 'action',
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

describe('唯一准入：action fact', () => {
  it('isActionFact 只认 action', () => {
    expect(isActionFact(fact({ type: 'action' }))).toBe(true);
    for (const type of ['condition', 'cost', 'outcome', 'reflection'] as const) {
      expect(isActionFact(fact({ type }))).toBe(false);
    }
  });

  it('cost fact 不能生成行动选项', () => {
    expect(actionOptionFromFact(fact({ type: 'cost' }))).toBeNull();
  });

  it('reflection fact 不能生成行动选项', () => {
    expect(actionOptionFromFact(fact({ type: 'reflection' }))).toBeNull();
  });

  it('action fact 生成带原文回溯的行动选项', () => {
    const option = actionOptionFromFact(fact({ id: 'f1', type: 'action' }));
    expect(option).not.toBeNull();
    expect(option!.source).toBe('experience');
    expect(option!.sourceFactIds).toEqual(['f1']);
    expect(option!.description).toContain('最小样');
  });

  it('actionFacts / pathUnlockActionsFromFacts 只挑 action 且有序', () => {
    const facts = [
      fact({ id: 'c', type: 'condition', exactQuote: '我当时基础一般' }),
      fact({ id: 'a', type: 'action', exactQuote: '我先做小样', relevance: 0.9 }),
      fact({ id: 'b', type: 'action', exactQuote: '我直接报名', relevance: 0.4 }),
    ];
    expect(actionFacts(facts).map((item) => item.id)).toEqual(['a', 'b']);
    expect(pathUnlockActionsFromFacts(facts).map((item) => item.id)).toEqual([
      'action-a',
      'action-b',
    ]);
  });
});

describe('validateEncounterPlan：path_unlock 必须由 action 支撑', () => {
  const nonAction = fact({ id: 'cost-1', type: 'cost', exactQuote: '我搭进去一个学期的时间。' });
  const action = fact({ id: 'act-1', type: 'action' });
  const payload = {
    kind: 'path_unlock' as const,
    unlockId: 'u1',
    label: '先做小样',
    choiceText: '按「先做小样」先试一小步',
    hint: '来自真实经验',
  };

  it('action fact → 无 issue', () => {
    const issues = validateEncounterPlan(
      {
        id: 'e1',
        type: 'path_unlock',
        act: 2,
        sourceFactIds: ['act-1'],
        sourceCaseIds: [],
        payload,
      },
      { facts: [action, nonAction], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues).toEqual([]);
  });

  it('cost fact → 报错（禁止伪装成方法）', () => {
    const issues = validateEncounterPlan(
      {
        id: 'e1',
        type: 'path_unlock',
        act: 2,
        sourceFactIds: ['cost-1'],
        sourceCaseIds: [],
        payload,
      },
      { facts: [action, nonAction], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues.join(' ')).toContain('action');
  });

  it('引用不存在的事实 → 报错', () => {
    const issues = validateEncounterPlan(
      { id: 'e1', type: 'path_unlock', act: 2, sourceFactIds: ['ghost'], sourceCaseIds: [], payload },
      { facts: [action], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('pathUnlockPayloadFromFact', () => {
  it('非 action 返回 null', () => {
    expect(pathUnlockPayloadFromFact(fact({ type: 'outcome' }))).toBeNull();
  });

  it('action 生成可点击回原文的 payload', () => {
    const payload = pathUnlockPayloadFromFact(fact({ id: 'act-1', type: 'action' }));
    expect(payload!.unlockId).toBe('unlock-act-1');
    expect(payload!.choiceText).toContain('先试一小步');
  });
});
