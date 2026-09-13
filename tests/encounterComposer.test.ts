import { describe, expect, it } from 'vitest';

import { composeEncounters } from '@/features/game-mechanics/encounterComposer';
import type { UnlockSource } from '@/features/game-mechanics/pathUnlock';
import type { ActionOption, EncounterType } from '@/features/game-mechanics/domain';
import { buildExperienceCases } from '@/features/experience/cases';
import type {
  ExperienceFact,
  ProblemFrame,
  UnknownVariable,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Encounter Composer（§13-§16 / §44-§45 / §59 / §81）。
 *
 * > 每局不使用全部 Encounter；证据不足允许 0 个，不强行填满。
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

function frame(overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛，但怕影响课程',
    currentSituation: '大二在读',
    desiredChange: '参加一次比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '想积累作品 vs 每周只有 8 小时',
    unknowns: [],
    parseConfidence: 0.6,
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

function typeSet(plans: readonly { readonly type: EncounterType }[]): Set<EncounterType> {
  return new Set(plans.map((plan) => plan.type));
}

describe('不强行填满（§59）', () => {
  it('完全无证据 → 0 个 Encounter', () => {
    expect(
      composeEncounters({
        frame: frame(),
        cases: [],
        facts: [],
        differences: [],
        keyUnknown: null,
      }),
    ).toEqual([]);
  });

  it('只有未知 → 只生成 1 个 UNKNOWN LOCK', () => {
    const plans = composeEncounters({
      frame: frame({ unknowns: [unknown] }),
      cases: [],
      facts: [],
      differences: [],
      keyUnknown: unknown,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.type).toBe('unknown_lock');
    expect(plans[0]!.act).toBe(3);
  });

  it('最多 3 个（§59），且类型不重复', () => {
    const facts = [
      fact({ id: 'act-1', type: 'action' }),
      fact({ id: 'cost-1', type: 'cost', exactQuote: '我为此牺牲了整个周末。' }),
      fact({ id: 'o-1', type: 'outcome', sourceId: 'src-a', exactQuote: '最后拿了省二' }),
      fact({ id: 'o-2', type: 'outcome', sourceId: 'src-b', exactQuote: '中途退出，拖累了队友' }),
    ];
    const plans = composeEncounters({
      frame: frame({ unknowns: [unknown] }),
      cases: buildExperienceCases(facts),
      facts,
      differences: [
        {
          variable: '队友',
          relation: 'different',
          userValue: '没有',
          experienceValue: '有固定队友',
          evidenceFactIds: [],
        },
      ],
      unlocks: [
        {
          id: 'unlock-1',
          label: '先做 Demo',
          sourceFactIds: ['act-1'],
          choice: { text: '按「先做 Demo」先试一小步', hint: '来自真实经验' },
          availableFromAct: 2,
        },
      ],
      keyUnknown: unknown,
    });
    expect(plans.length).toBeLessThanOrEqual(3);
    expect(typeSet(plans).size).toBe(plans.length);
  });
});

describe('比赛问题：PATH UNLOCK + EXPERIENCE CONFLICT + UNKNOWN LOCK（§15）', () => {
  const facts = [
    fact({ id: 'act-1', type: 'action' }),
    // 两个真实 case 各自都要「有行动」才升级成 ExperienceCase，
    // 否则 buildExperienceCases 不会聚合它们。
    fact({ id: 'a-1', type: 'action', sourceId: 'src-a', exactQuote: '边做边学，直接报名' }),
    fact({ id: 'a-2', type: 'action', sourceId: 'src-b', exactQuote: '没准备好就报了名' }),
    fact({ id: 'o-1', type: 'outcome', sourceId: 'src-a', exactQuote: '最后拿了省二' }),
    fact({ id: 'o-2', type: 'outcome', sourceId: 'src-b', exactQuote: '没准备好就参赛，拖累了队友' }),
  ];
  const unlocks: UnlockSource[] = [
    {
      id: 'unlock-1',
      label: '先做 Demo',
      sourceFactIds: ['act-1'],
      choice: { text: '按「先做 Demo」先试一小步', hint: '来自真实经验' },
      availableFromAct: 2,
    },
  ];

  it('组合由数据决定', () => {
    const plans = composeEncounters({
      frame: frame({ unknowns: [unknown] }),
      cases: buildExperienceCases(facts),
      facts,
      differences: [],
      unlocks,
      keyUnknown: unknown,
    });
    const types = typeSet(plans);
    expect(types.has('path_unlock')).toBe(true);
    expect(types.has('experience_conflict')).toBe(true);
    expect(types.has('unknown_lock')).toBe(true);
    expect(types.has('condition_shift')).toBe(false);
    expect(types.has('cost_reveal')).toBe(false);
  });
});

describe('转行问题：CONDITION SHIFT + COST REVEAL + UNKNOWN LOCK（§15）', () => {
  const facts = [fact({ id: 'cost-1', type: 'cost', exactQuote: '我为此牺牲了整个周末。' })];
  const differences: UserDifference[] = [
    {
      variable: '可支配时间',
      relation: 'different',
      userValue: '每周 6 小时',
      experienceValue: '每周 12 小时',
      evidenceFactIds: [],
    },
  ];
  const userAction: ActionOption = {
    id: 'action-补课',
    label: '补课程',
    source: 'user',
    sourceFactIds: [],
    requirements: [],
  };

  it('组合由数据决定', () => {
    const plans = composeEncounters({
      frame: frame({ unknowns: [unknown] }),
      cases: [],
      facts,
      differences,
      actions: [userAction],
      keyUnknown: unknown,
    });
    const types = typeSet(plans);
    expect(types.has('condition_shift')).toBe(true);
    expect(types.has('cost_reveal')).toBe(true);
    expect(types.has('unknown_lock')).toBe(true);
    expect(types.has('path_unlock')).toBe(false);
  });
});

describe('确定性（§16 / §45）', () => {
  it('同输入两次组合逐字节一致', () => {
    const input = {
      frame: frame({ unknowns: [unknown] }),
      cases: buildExperienceCases([
        fact({ id: 'o-1', type: 'outcome', sourceId: 'src-a', exactQuote: '成功' }),
        fact({ id: 'o-2', type: 'outcome', sourceId: 'src-b', exactQuote: '失败' }),
      ]),
      facts: [fact({ id: 'act-1', type: 'action' })],
      differences: [],
      keyUnknown: unknown,
    };
    expect(JSON.stringify(composeEncounters(input))).toBe(JSON.stringify(composeEncounters(input)));
  });

  it('maxEncounters 生效', () => {
    const plans = composeEncounters({
      frame: frame({ unknowns: [unknown] }),
      cases: [],
      facts: [],
      differences: [],
      keyUnknown: unknown,
      maxEncounters: 0,
    });
    expect(plans).toEqual([]);
  });
});
