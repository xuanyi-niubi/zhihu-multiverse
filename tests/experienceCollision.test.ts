import { describe, expect, it } from 'vitest';

import {
  caseFactIds,
  collisionFocusOf,
  findExperienceCollision,
  focusCandidatesFromDifferences,
} from '@/features/game-mechanics/experienceCollision';
import { collisionViewOf } from '@/features/game-mechanics/view';
import type {
  ExperienceCase,
  ExperienceFact,
  ExperienceFactType,
  UserDifference,
} from '@/features/experience/domain';

/**
 * EXPERIENCE COLLISION（§十二-§十四 / §二十五）。
 *
 * ```text
 * 无 counterexample → no collision
 * 无 difference      → no collision
 * collision 不输出因果结论
 * ```
 */

let seq = 0;
function fact(type: ExperienceFactType, exactQuote: string): ExperienceFact {
  seq += 1;
  return {
    id: `fact-${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote,
    type,
    relevance: 0.5,
    purposes: [],
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

function difference(variable: string, relation: UserDifference['relation'] = 'different'): UserDifference {
  return {
    variable,
    relation,
    ...(relation === 'different' ? { userValue: '没有', experienceValue: '有' } : {}),
    evidenceFactIds: [],
  };
}

function divergingCases(): readonly ExperienceCase[] {
  return [
    experienceCase('case:a', {
      actions: [fact('action', '先做最小 Demo 再决定')],
      outcomes: [fact('outcome', '最后拿了省二')],
    }),
    experienceCase('case:b', {
      actions: [fact('action', '没准备好就报了名')],
      outcomes: [fact('outcome', '中途退出，拖累了队友')],
    }),
  ];
}

describe('findExperienceCollision', () => {
  it('primary + counterexample + difference → 生成 collision', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('时间投入')]);
    expect(collision).not.toBeNull();
    expect(collision!.primaryCaseId).toBe('case:a');
    expect(collision!.counterCaseId).toBe('case:b');
    expect(collision!.primaryFactIds.length).toBeGreaterThan(0);
    expect(collision!.counterFactIds.length).toBeGreaterThan(0);
    expect(collision!.focusCandidates.map((focus) => focus.label)).toEqual(['时间投入']);
  });

  it('无 counterexample（只有一个 case）→ no collision', () => {
    const only = [divergingCases()[0]!];
    expect(findExperienceCollision(only, [difference('时间投入')])).toBeNull();
  });

  it('两个 case 没有任何可观察分歧 → no collision', () => {
    const same = [
      experienceCase('case:a', { actions: [fact('action', '一样的做法')], outcomes: [fact('outcome', '一样的结果')] }),
      experienceCase('case:b', { actions: [fact('action', '一样的做法')], outcomes: [fact('outcome', '一样的结果')] }),
    ];
    expect(findExperienceCollision(same, [difference('时间投入')])).toBeNull();
  });

  it('无 difference → no collision（不硬造冲突）', () => {
    expect(findExperienceCollision(divergingCases(), [])).toBeNull();
  });

  it('所有差异都是 same → no collision', () => {
    expect(findExperienceCollision(divergingCases(), [difference('时间投入', 'same')])).toBeNull();
  });

  it('unknown 关系的差异也算真实差异（一等公民）', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('家里支持度', 'unknown')]);
    expect(collision).not.toBeNull();
  });

  it('反例按分歧打分确定性挑选（outcome 不同分更高）', () => {
    const cases = [
      ...divergingCases(),
      experienceCase('case:c', { actions: [fact('action', '第三条路')] }),
    ];
    const collision = findExperienceCollision(cases, [difference('时间投入')]);
    expect(collision!.counterCaseId).toBe('case:b');
  });

  it('确定性：同输入两次结果逐字节一致', () => {
    const cases = divergingCases();
    const differences = [difference('时间投入')];
    const build = () => findExperienceCollision(cases, differences);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('collision 只给观察变量，不给因果结论', () => {
  it('collisionFocusOf 只返回变量名', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('时间投入'), difference('家里支持度')])!;
    const focus = collision.focusCandidates[0]!;
    expect(collisionFocusOf(collision, focus.id)).toBe(focus.label);
    expect(collisionFocusOf(collision, focus.id)).toBe('家里支持度');
  });

  it('不属于这次 collision 的 focus → null', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('时间投入')])!;
    expect(collisionFocusOf(collision, 'focus-不存在的变量')).toBeNull();
  });

  it('focus 的 supportingDifferenceIds 指向真实差异变量', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('时间投入')])!;
    expect(collision.focusCandidates[0]!.supportingDifferenceIds).toEqual(['时间投入']);
    expect(collision.supportingDifferenceIds).toEqual(['时间投入']);
  });

  it('view 里只有 id 与 label，没有任何因果文案字段', () => {
    const collision = findExperienceCollision(divergingCases(), [difference('时间投入')])!;
    const view = collisionViewOf(collision);
    expect(Object.keys(view).sort()).toEqual(['counterCaseId', 'focusCandidates', 'primaryCaseId']);
    expect(Object.keys(view.focusCandidates[0]!).sort()).toEqual(['id', 'label']);
    expect(JSON.stringify(view)).not.toMatch(/导致|原因|因为|所以/);
  });
});

describe('focusCandidatesFromDifferences', () => {
  it('按变量去重、稳定排序，忽略 same', () => {
    const candidates = focusCandidatesFromDifferences([
      difference('b变量'),
      difference('a变量'),
      difference('a变量', 'same'),
      difference('c变量', 'unknown'),
    ]);
    expect(candidates.map((focus) => focus.id)).toEqual(['focus-a变量', 'focus-b变量', 'focus-c变量']);
  });

  it('没有真实差异时为空数组', () => {
    expect(focusCandidatesFromDifferences([difference('a', 'same')])).toEqual([]);
  });
});

describe('caseFactIds', () => {
  it('汇总一个 case 引用的全部事实并稳定去重', () => {
    const item = experienceCase('case:a', {
      conditions: [fact('condition', '大二在读')],
      actions: [fact('action', '先做 Demo')],
      outcomes: [fact('outcome', '拿了省二')],
    });
    expect(caseFactIds(item)).toHaveLength(3);
    expect(caseFactIds(item)).toEqual([...caseFactIds(item)].sort());
  });
});
