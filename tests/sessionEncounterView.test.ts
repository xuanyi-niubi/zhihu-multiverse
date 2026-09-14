import { describe, expect, it } from 'vitest';

import type { ActionSpace, EncounterPlan } from '@/features/game-mechanics/domain';
import type { ExperienceCase, ExperienceFact } from '@/features/experience/domain';
import {
  UNKNOWN_CONTINUE_LABEL,
  UNKNOWN_STAGE_COPY,
  sessionEncounterViewOf,
} from '@/components/game/session/viewModel';

/**
 * Encounter 视图的契约（Agent 03 §十七 / §十八 / §二十八）。
 *
 * ```text
 * collision 不显示 score        —— 只指出分歧，不裁决谁对
 * unknown 不显示 guessed answer —— 没有现实信息就说没有
 * ```
 */

function fact(id: string, quote: string, type: ExperienceFact['type']): ExperienceFact {
  return {
    id,
    sourceId: `s-${id}`,
    sourceUrl: `https://www.zhihu.com/answer/${id}`,
    author: `答主-${id}`,
    exactQuote: quote,
    type,
    relevance: 1,
    purposes: [],
  };
}

function experienceCase(id: string, author: string, actionQuote: string, outcomeQuote: string): ExperienceCase {
  return {
    id,
    sourceId: `s-${id}`,
    sourceUrl: `https://www.zhihu.com/answer/${id}`,
    author,
    conditions: [fact(`${id}-c`, '我大二，基础一般。', 'condition')],
    actions: [fact(`${id}-a`, actionQuote, 'action')],
    costs: [],
    outcomes: [fact(`${id}-o`, outcomeQuote, 'outcome')],
    reflections: [],
  };
}

const PRIMARY = experienceCase('case-a', '甲', '我先做了一个最小项目。', '后来我拿到了实习。');
const COUNTER = experienceCase('case-b', '乙', '我把时间全投在课程上。', '最后我没有去实习。');

function blueprintWith(encounters: readonly EncounterPlan[], cases: readonly ExperienceCase[] = [PRIMARY, COUNTER]) {
  return {
    acts: [],
    experienceCases: cases,
    encounters,
  };
}

const COLLISION_PLAN: EncounterPlan = {
  id: 'encounter-experience-collision-case-a-case-b',
  type: 'experience-collision',
  act: 3,
  sourceFactIds: ['case-a-a', 'case-b-a'],
  sourceCaseIds: ['case-a', 'case-b'],
  primaryCaseId: 'case-a',
  counterCaseId: 'case-b',
  focusCandidates: [
    { id: 'focus-时间投入', label: '时间投入', supportingDifferenceIds: ['时间投入'] },
    { id: 'focus-是否有同伴', label: '是否有同伴', supportingDifferenceIds: ['是否有同伴'] },
  ],
};

const UNKNOWN_PLAN: EncounterPlan = {
  id: 'unknown-lock-u1',
  type: 'unknown-lock',
  act: 3,
  sourceFactIds: [],
  sourceCaseIds: [],
  unknownId: 'unknown-lock-u1',
  unknownLabel: '我能不能连续两周每天稳定投入两小时',
};

const PATH_PLAN: EncounterPlan = {
  id: 'encounter-path-reveal-unlock-1',
  type: 'path-reveal',
  act: 2,
  sourceFactIds: ['case-a-a'],
  sourceCaseIds: ['case-a'],
  unlockId: 'unlock-1',
};

describe('没有 Encounter：返回 null，不硬造一个 Stage（§五十九）', () => {
  it('本幕没有计划时为 null', () => {
    expect(sessionEncounterViewOf({ blueprint: blueprintWith([]), act: 2, focusVariables: [] })).toBeNull();
  });

  it('计划在别的幕时为 null', () => {
    expect(
      sessionEncounterViewOf({ blueprint: blueprintWith([COLLISION_PLAN]), act: 2, focusVariables: [] }),
    ).toBeNull();
  });

  it('path-reveal 由选项承载，不占 Stage', () => {
    expect(
      sessionEncounterViewOf({ blueprint: blueprintWith([PATH_PLAN]), act: 2, focusVariables: [] }),
    ).toBeNull();
  });
});

describe('Collision：只指出分歧（§十七）', () => {
  const view = sessionEncounterViewOf({
    blueprint: blueprintWith([COLLISION_PLAN]),
    act: 3,
    focusVariables: ['focus-时间投入'],
  });

  it('给出两个真实 case 与它们的原话', () => {
    expect(view?.type).toBe('experience-collision');
    if (view?.type !== 'experience-collision') {
      throw new Error('应当是 collision');
    }
    expect(view.collision.primary.label).toBe('甲');
    expect(view.collision.counter.label).toBe('乙');
    expect(view.collision.primary.quotes.join('')).toContain('我先做了一个最小项目。');
    expect(view.collision.counter.quotes.join('')).toContain('最后我没有去实习。');
  });

  it('focus 候选原样给出，并标记玩家选过的那个', () => {
    if (view?.type !== 'experience-collision') {
      throw new Error('应当是 collision');
    }
    expect(view.collision.focuses.map((focus) => focus.label)).toEqual(['时间投入', '是否有同伴']);
    expect(view.collision.activeFocusId).toBe('focus-时间投入');
  });

  it('不显示任何分数 / 匹配度 / 百分比（§二十八）', () => {
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/score|match|percent|winRate|rating/i);
    expect(serialized).not.toMatch(/\d+\s*%/);
  });

  it('没有选过 focus 时 activeFocusId 为 null，不假装选过', () => {
    const fresh = sessionEncounterViewOf({
      blueprint: blueprintWith([COLLISION_PLAN]),
      act: 3,
      focusVariables: [],
    });
    if (fresh?.type !== 'experience-collision') {
      throw new Error('应当是 collision');
    }
    expect(fresh.collision.activeFocusId).toBeNull();
  });

  it('缺 experienceCases 时退回 case id，不编一个作者名', () => {
    const bare = sessionEncounterViewOf({
      blueprint: blueprintWith([COLLISION_PLAN], []),
      act: 3,
      focusVariables: [],
    });
    if (bare?.type !== 'experience-collision') {
      throw new Error('应当是 collision');
    }
    expect(bare.collision.primary.label).toBe('case-a');
    expect(bare.collision.primary.quotes).toEqual([]);
  });
});

describe('Unknown：不猜答案（§十八）', () => {
  const lockedSpace: ActionSpace = {
    actions: [
      {
        id: 'action-c1',
        label: '先投一周试试',
        state: 'locked',
        origin: 'scenario',
        sourceFactIds: [],
        reason: '这条世界线还不能确认。',
      },
      { id: 'action-c2', label: '直接去投简历', state: 'available', origin: 'scenario', sourceFactIds: [] },
    ],
  };

  const view = sessionEncounterViewOf({
    blueprint: blueprintWith([UNKNOWN_PLAN]),
    act: 3,
    actionSpace: lockedSpace,
    focusVariables: [],
  });

  it('给固定文案，不给一个猜出来的答案', () => {
    if (view?.type !== 'unknown-lock') {
      throw new Error('应当是 unknown-lock');
    }
    expect(view.unknown.explanation).toBe(UNKNOWN_STAGE_COPY);
    expect(view.unknown.explanation).toContain('没有足够的现实信息');
    expect(view.unknown.unknownLabel).toBe('我能不能连续两周每天稳定投入两小时');
  });

  it('只列被锁住的行动，不把可做的行动也算成「做不了」', () => {
    if (view?.type !== 'unknown-lock') {
      throw new Error('应当是 unknown-lock');
    }
    expect(view.unknown.blockedActions).toEqual(['先投一周试试']);
  });

  it('唯一的出口是「继续到终局」，不提供重投 / 付费解锁', () => {
    expect(UNKNOWN_CONTINUE_LABEL).toBe('继续到终局');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/retry|reroll|dice|cost|price|解锁费用/i);
  });
});
