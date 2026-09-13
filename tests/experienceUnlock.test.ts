import { describe, expect, it } from 'vitest';

import { injectExperienceUnlock } from '@/features/game-world/experienceUnlock';
import { unlockForTurn, worldContextForTurn } from '@/features/game-world/dmContext';
import { compileWorldBlueprint } from '@/features/game-world/compileWorld';

import type { ScenarioChoice } from '@/data/prebuiltScenarios';
import type { ExperienceFact, ExperiencePath, ProblemFrame } from '@/features/experience/domain';

/**
 * 经验解锁（Phase 14 / P0-H）。
 *
 * 这是比赛的 WOW Point 的机制层：
 *
 * > 先获得经验 → 之后的某一幕多出一个此前不存在的选择。
 */

function choice(id: string, overrides: Partial<ScenarioChoice> = {}): ScenarioChoice {
  return {
    id,
    text: `选项 ${id}`,
    hint: '一个普通的选择',
    ghostEchoStat: '这一步是最常见的走法',
    onSuccess: { feedback: '你按部就班地做了', statDeltas: { san: 0, skill: 2, bond: 0 } },
    ...overrides,
  };
}

function unlock(overrides: Partial<Parameters<typeof injectExperienceUnlock>[0]['unlock']> = {}) {
  return {
    unlockId: 'unlock-path-1',
    label: '先做小样',
    choiceText: '按「先做一个最小样」的路子先试一小步',
    hint: '这个选项来自一条真实经验 —— 你可以选择不参考它。',
    sourceFactIds: ['fact:1'],
    ...overrides,
  };
}

describe('注入规则（P0：只在选项不足 3 个时插入）', () => {
  it('0 个选项 → 追加', () => {
    const result = injectExperienceUnlock({ choices: [], unlock: unlock(), act: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]!.experienceUnlockId).toBe('unlock-path-1');
  });

  it('2 个选项 → 追加为第三个', () => {
    const result = injectExperienceUnlock({ choices: [choice('a'), choice('b')], unlock: unlock(), act: 2 });
    expect(result).toHaveLength(3);
    expect(result[2]!.text).toContain('先做一个小样'.replace('小', '最小'));
  });

  /**
   * §21 / §50：解锁是**全产品的 WOW Point**，必须让玩家看得见。
   *
   * 旧契约是「满 3 个就等下一幕」—— 实测这会让它在一整局里都不出现，
   * 而一个不出现的核心机制等于没有。现在：3 个以内追加；已经 4 个时
   * 替换最后一条（宁可挤掉一条模型生成的选项）。
   */
  it('3 个选项 → 追加为第四条（机制必须可见）', () => {
    const choices = [choice('a'), choice('b'), choice('c')];
    const result = injectExperienceUnlock({ choices, unlock: unlock(), act: 2 });
    expect(result).toHaveLength(4);
    expect(result[3]!.experienceUnlockId).toBe('unlock-path-1');
    // 原来的三条一个不动
    expect(result.slice(0, 3)).toEqual(choices);
  });

  it('4 个选项 → 替换最后一条，保证解锁一定在场', () => {
    const choices = [choice('a'), choice('b'), choice('c'), choice('d')];
    const result = injectExperienceUnlock({ choices, unlock: unlock(), act: 2 });
    expect(result).toHaveLength(4);
    expect(result[3]!.experienceUnlockId).toBe('unlock-path-1');
    expect(result.slice(0, 3)).toEqual(choices.slice(0, 3));
  });

  it('同一解锁已在场 → 不重复', () => {
    const marked = choice('a', { experienceUnlockId: 'unlock-path-1' });
    const result = injectExperienceUnlock({ choices: [marked, choice('b')], unlock: unlock(), act: 2 });
    expect(result).toHaveLength(2);
  });

  it('unlock 为 null → 原样返回（无 session 的旧路径零变化）', () => {
    const choices = [choice('a'), choice('b')];
    expect(injectExperienceUnlock({ choices, unlock: null, act: 2 })).toBe(choices);
  });

  it('注入的选项无检定、带来源回溯字段', () => {
    const result = injectExperienceUnlock({ choices: [choice('a')], unlock: unlock(), act: 2 });
    expect(result[1]!.check).toBeUndefined();
    expect(result[1]!.sourceFactIds).toEqual(['fact:1']);
    expect(result[1]!.experienceUnlockId).toBe('unlock-path-1');
  });
});

describe('解锁的出场时机', () => {
  const frame: ProblemFrame = {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '怕影响课程又想参赛',
    unknowns: [],
    parseConfidence: 0.5,
  };

  const facts: readonly ExperienceFact[] = [
    {
      id: 'fact:1',
      sourceId: 'live:src-1',
      sourceUrl: 'https://www.zhihu.com/q/1',
      author: '某人',
      exactQuote: '报名参加了比赛，边做边学，最后拿了省二',
      type: 'action',
      relevance: 0.6,
      purposes: [],
    },
  ];

  const paths: readonly ExperiencePath[] = [
    {
      id: 'path-1',
      label: '直接报名，边做边学',
      summary: '先进队再补技术。',
      supportingCaseIds: ['case:live:src-1'],
      opposingCaseIds: [],
      supportingFactIds: ['fact:1'],
      opposingFactIds: [],
      observedConditions: [],
      observedActions: [],
      observedCosts: [],
      observedOutcomes: [],
      differencesFromUser: [],
      unknowns: [],
      origin: 'model-clustered',
    },
  ];

  it('第一幕没有解锁，到了出场幕才有', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame, paths, facts });
    // compileWorldBlueprint 把 path-1 的解锁排到第 2 幕（availableFromAct=2）
    expect(unlockForTurn(blueprint, 0, [])).toBeNull();
    const act2 = unlockForTurn(blueprint, 1, []);
    expect(act2).not.toBeNull();
    expect(act2!.unlockId).toBe('unlock-path-1');
  });

  it('用过的解锁不再出现', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame, paths, facts });
    expect(unlockForTurn(blueprint, 1, ['unlock-path-1'])).toBeNull();
  });
});

describe('世界上下文切片', () => {
  const frame: ProblemFrame = {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '怕影响课程又想参赛',
    unknowns: [],
    parseConfidence: 0.5,
  };

  const facts: readonly ExperienceFact[] = [
    {
      id: 'fact:1',
      sourceId: 'live:src-1',
      sourceUrl: 'https://www.zhihu.com/q/1',
      author: '某人',
      exactQuote: '报名参加了比赛，边做边学，最后拿了省二',
      type: 'action',
      relevance: 0.6,
      purposes: [],
    },
  ];

  const paths: readonly ExperiencePath[] = [
    {
      id: 'path-1',
      label: '直接报名，边做边学',
      summary: '先进队再补技术。',
      supportingCaseIds: ['case:live:src-1'],
      opposingCaseIds: [],
      supportingFactIds: ['fact:1'],
      opposingFactIds: [],
      observedConditions: [],
      observedActions: [],
      observedCosts: [],
      observedOutcomes: [],
      differencesFromUser: [],
      unknowns: [],
      origin: 'model-clustered',
    },
  ];

  it('每幕只带该幕的事实，且封顶 6 条', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame,
      paths,
      facts: Array.from({ length: 8 }, (_, index) => ({
        ...facts[0]!,
        id: `fact:${index}`,
      })),
    });
    const context = worldContextForTurn(blueprint, 0);
    expect(context.sourceFacts.length).toBeLessThanOrEqual(6);
    expect(context.actObjective).toBe('enter-world');
    expect(context.forbiddenClaims.length).toBeGreaterThan(0);
  });

  it('超出三幕的动态幕钳到最后一幕（反例幕）', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame, paths, facts });
    expect(worldContextForTurn(blueprint, 7).actObjective).toBe('meet-counterexample');
  });
});
