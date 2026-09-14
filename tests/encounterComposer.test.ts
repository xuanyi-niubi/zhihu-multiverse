import { describe, expect, it } from 'vitest';

import {
  ENCOUNTER_TYPE_ORDER,
  composeEncounters,
  effectiveDifferences,
  pathRevealActionFrom,
} from '@/features/game-mechanics/encounterComposer';
import type {
  EncounterComposerInput,
  EncounterPlan,
  EncounterType,
  ExperienceUnlockInput,
} from '@/features/game-mechanics/domain';
import type {
  ExperienceCase,
  ExperienceFact,
  ExperienceFactType,
  UnknownVariable,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Encounter Composer（§十九-§二十 / §二十五）。
 *
 * ```text
 * 有有效 unlock            → act 2 path-reveal
 * 有 counterexample
 *   + primary case
 *   + difference           → act 3 experience-collision
 * 有 keyUnknown            → act 3 unknown-lock
 * encounter <= 3，不随机，不硬补
 * ```
 */

let seq = 0;
function fact(type: ExperienceFactType, overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact-${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: '我先做了一个 48 小时的最小 Demo 再决定。',
    type,
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

function experienceCase(id: string, overrides: Partial<ExperienceCase> = {}): ExperienceCase {
  return {
    id,
    sourceId: id.replace('case:', ''),
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    conditions: [],
    actions: [],
    costs: [],
    outcomes: [],
    reflections: [],
    ...overrides,
  };
}

function unlock(
  sourceFactIds: readonly string[],
  overrides: Partial<ExperienceUnlockInput> = {},
): ExperienceUnlockInput {
  return {
    id: 'unlock-1',
    label: '先做最小 Demo',
    sourceFactIds,
    choice: { text: '按「先做最小 Demo」的路子先试一小步', hint: '来自一条真实经验。' },
    availableFromAct: 2,
    ...overrides,
  };
}

function difference(variable: string): UserDifference {
  return { variable, relation: 'different', userValue: '没有', experienceValue: '有', evidenceFactIds: [] };
}

const keyUnknown: UnknownVariable = {
  id: 'unknown-hours',
  label: '每周能否稳定投入 8 小时',
  whyItMatters: '它决定高强度比赛是否成立。',
  kind: 'time-capacity',
  origin: 'missing-user-context',
  priority: 1,
};

function divergingCases(): readonly ExperienceCase[] {
  return [
    experienceCase('case:a', {
      actions: [fact('action', { sourceId: 'src-a', exactQuote: '边做边学，直接报名' })],
      outcomes: [fact('outcome', { sourceId: 'src-a', exactQuote: '最后拿了省二' })],
    }),
    experienceCase('case:b', {
      actions: [fact('action', { sourceId: 'src-b', exactQuote: '没准备好就报了名' })],
      outcomes: [fact('outcome', { sourceId: 'src-b', exactQuote: '中途退出，拖累了队友' })],
    }),
  ];
}

function input(overrides: Partial<EncounterComposerInput> = {}): EncounterComposerInput {
  return {
    facts: [],
    cases: [],
    differences: [],
    unlocks: [],
    keyUnknown: null,
    ...overrides,
  };
}

function typesOf(plans: readonly EncounterPlan[]): ReadonlySet<EncounterType> {
  return new Set(plans.map((plan) => plan.type));
}

describe('composeEncounters：三种 Encounter 的准入', () => {
  it('有有效 unlock → act 2 path-reveal', () => {
    const action = fact('action', { id: 'act-1' });
    const plans = composeEncounters(input({ facts: [action], unlocks: [unlock(['act-1'])] }));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.type).toBe('path-reveal');
    expect(plans[0]!.act).toBe(2);
    expect(plans[0]!.unlockId).toBe('unlock-1');
    expect(plans[0]!.sourceFactIds).toEqual(['act-1']);
  });

  it('cost fact → 不能 reveal（也不生成任何 plan）', () => {
    const cost = fact('cost', { id: 'cost-1', exactQuote: '每周要投入 12 小时' });
    const plans = composeEncounters(input({ facts: [cost], unlocks: [unlock(['cost-1'])] }));
    expect(plans).toEqual([]);
  });

  it('reflection → 不能 reveal', () => {
    const reflection = fact('reflection', { id: 'ref-1' });
    const plans = composeEncounters(input({ facts: [reflection], unlocks: [unlock(['ref-1'])] }));
    expect(plans).toEqual([]);
  });

  it('duplicate unlock → 幂等（只出一个 path-reveal）', () => {
    const action = fact('action', { id: 'act-1' });
    const unlocks = [unlock(['act-1']), unlock(['act-1'], { id: 'unlock-2' })];
    const plans = composeEncounters(input({ facts: [action], unlocks }));
    expect(plans.filter((plan) => plan.type === 'path-reveal')).toHaveLength(1);
  });

  it('有 counterexample + primary case + difference → act 3 experience-collision', () => {
    const plans = composeEncounters(
      input({ cases: divergingCases(), differences: [difference('时间投入')] }),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.type).toBe('experience-collision');
    expect(plans[0]!.act).toBe(3);
    expect(plans[0]!.sourceCaseIds).toEqual(['case:a', 'case:b']);
    expect(plans[0]!.focusCandidates!.map((focus) => focus.label)).toEqual(['时间投入']);
  });

  it('无 difference → 不生成 collision', () => {
    const plans = composeEncounters(input({ cases: divergingCases() }));
    expect(typesOf(plans).has('experience-collision')).toBe(false);
  });

  it('只有一个 case → 不生成 collision', () => {
    const plans = composeEncounters(
      input({ cases: [divergingCases()[0]!], differences: [difference('时间投入')] }),
    );
    expect(typesOf(plans).has('experience-collision')).toBe(false);
  });

  it('有 keyUnknown → act 3 unknown-lock', () => {
    const plans = composeEncounters(input({ keyUnknown }));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.type).toBe('unknown-lock');
    expect(plans[0]!.act).toBe(3);
    expect(plans[0]!.unknownId).toBe('unknown-lock-unknown-hours');
  });

  it('无 unknown → no unknown lock', () => {
    expect(composeEncounters(input())).toEqual([]);
  });
});

describe('composeEncounters：上限与确定性', () => {
  it('三种同时成立时最多 3 条，顺序为 act 升序', () => {
    const action = fact('action', { id: 'act-1' });
    const plans = composeEncounters(
      input({
        facts: [action],
        cases: divergingCases(),
        differences: [difference('时间投入')],
        unlocks: [unlock(['act-1'])],
        keyUnknown,
      }),
    );
    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.type)).toEqual([...ENCOUNTER_TYPE_ORDER]);
    expect(plans.map((plan) => plan.act)).toEqual([2, 3, 3]);
  });

  it('不为了 3 个硬补：证据只支持一种时就只出一条', () => {
    expect(composeEncounters(input({ keyUnknown }))).toHaveLength(1);
  });

  it('确定性：同输入两次组成逐字节一致', () => {
    const fixed = input({
      cases: divergingCases(),
      differences: [difference('时间投入')],
      keyUnknown,
    });
    const build = () => composeEncounters(fixed);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('同类型不重复（每局每种最多一条）', () => {
    const action = fact('action', { id: 'act-1' });
    const unlocks = [unlock(['act-1']), unlock(['act-1'], { id: 'unlock-2' })];
    const plans = composeEncounters(input({ facts: [action], unlocks, keyUnknown }));
    expect(plans.filter((plan) => plan.type === 'path-reveal')).toHaveLength(1);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length);
  });

  it('每条 plan 的类型都在冻结的三种之内', () => {
    const plans = composeEncounters(
      input({ facts: [fact('action', { id: 'act-1' })], unlocks: [unlock(['act-1'])], keyUnknown }),
    );
    for (const plan of plans) {
      expect(ENCOUNTER_TYPE_ORDER).toContain(plan.type);
    }
  });
});

describe('composeEncounters 的纯函数性质', () => {
  it('同步返回纯数据（不调用 LLM / 不调用 API，没有 Promise）', () => {
    const result = composeEncounters(input({ keyUnknown })) as unknown;
    expect(result instanceof Promise).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('immutable：不改入参', () => {
    const cases = divergingCases();
    const snapshot = JSON.stringify(cases);
    composeEncounters(input({ cases, differences: [difference('时间投入')] }));
    expect(JSON.stringify(cases)).toBe(snapshot);
  });
});

describe('辅助函数', () => {
  it('effectiveDifferences：入参为空时从 paths 补齐，并按变量去重', () => {
    const paths = [
      {
        id: 'path-1',
        label: '路',
        summary: '摘要',
        supportingCaseIds: [],
        opposingCaseIds: [],
        supportingFactIds: [],
        opposingFactIds: [],
        observedConditions: [],
        observedActions: [],
        observedCosts: [],
        observedOutcomes: [],
        differencesFromUser: [difference('固定队友'), difference('时间投入')],
        unknowns: [],
        origin: 'model-clustered' as const,
      },
    ];
    const merged = effectiveDifferences(input({ differences: [difference('时间投入')], paths }));
    expect(merged.map((item) => item.variable)).toEqual(['时间投入', '固定队友']);
  });

  it('pathRevealActionFrom 复用 ExperienceChoiceUnlock，不另造行动', () => {
    const action = fact('action', { id: 'act-1', exactQuote: '先把课程表排出来' });
    const revealed = pathRevealActionFrom(input({ facts: [action], unlocks: [unlock(['act-1'])] }));
    expect(revealed).not.toBeNull();
    expect(revealed!.unlockId).toBe('unlock-1');
    expect(revealed!.action.sourceFactIds).toEqual(['act-1']);
    expect(revealed!.action.state).toBe('unlocked');
  });
});
