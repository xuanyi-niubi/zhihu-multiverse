import { describe, expect, it } from 'vitest';

import { findExperienceConflict } from '@/features/game-mechanics/experienceConflict';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { ExperienceCase, ExperienceFact, UserDifference } from '@/features/experience/domain';

/**
 * EXPERIENCE CONFLICT（§8 / §56 / §79）。
 *
 * 关键纪律：没有两个真实 case 就不生成 conflict，
 * 玩家选择只记录 focusVariable，不写因果结论。
 */

let seq = 0;
function fact(type: ExperienceFact['type'], exactQuote: string): ExperienceFact {
  seq += 1;
  return {
    id: `fact:${seq}`,
    sourceId: 'src',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote,
    type,
    relevance: 0.5,
    purposes: [],
  };
}

function experienceCase(
  id: string,
  sourceId: string,
  input: { outcome?: string; action?: string; reflection?: string } = {},
): ExperienceCase {
  return {
    id,
    sourceId,
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    conditions: [],
    actions: input.action ? [fact('action', input.action)] : [],
    costs: [],
    outcomes: input.outcome ? [fact('outcome', input.outcome)] : [],
    reflections: input.reflection ? [fact('reflection', input.reflection)] : [],
  };
}

describe('findExperienceConflict', () => {
  it('少于两个 case → 不生成', () => {
    expect(findExperienceConflict([])).toBeNull();
    expect(findExperienceConflict([experienceCase('case:a', 'a')])).toBeNull();
  });

  it('没有真实分歧（无结果）→ 不生成', () => {
    const cases = [
      experienceCase('case:a', 'a', { action: '直接报名' }),
      experienceCase('case:b', 'b', { action: '直接报名' }),
    ];
    expect(findExperienceConflict(cases)).toBeNull();
  });

  it('结果相反的两个真实 case → 生成冲突', () => {
    const cases = [
      experienceCase('case:a', 'a', { outcome: '最后拿了省二', action: '直接报名' }),
      experienceCase('case:b', 'b', { outcome: '中途退出，只拖累了队友', action: '直接报名' }),
    ];
    const conflict = findExperienceConflict(cases);
    expect(conflict).not.toBeNull();
    expect(conflict!.caseIds).toEqual(['case:a', 'case:b']);
    expect(conflict!.supportingFactIds.length).toBeGreaterThan(0);
  });

  it('focus variables 只来自已知差异 / 未知，不发明因果', () => {
    const differences: UserDifference[] = [
      {
        variable: '队友',
        relation: 'different',
        userValue: '没有',
        experienceValue: '有',
        evidenceFactIds: [],
      },
      { variable: '时间', relation: 'same', evidenceFactIds: [] },
    ];
    const cases = [
      experienceCase('case:a', 'a', { outcome: '成功' }),
      experienceCase('case:b', 'b', { outcome: '失败' }),
    ];
    const conflict = findExperienceConflict(cases, { differences });
    expect(conflict!.candidateFocusVariables).toContain('队友');
    expect(conflict!.candidateFocusVariables).not.toContain('时间');
  });

  it('确定性：同输入两次结果一致', () => {
    const cases = [
      experienceCase('case:a', 'a', { outcome: '成功' }),
      experienceCase('case:b', 'b', { outcome: '失败' }),
    ];
    const reversed = [...cases].reverse();
    expect(JSON.stringify(findExperienceConflict(cases))).toBe(
      JSON.stringify(findExperienceConflict(reversed)),
    );
  });
});

describe('validateEncounterPlan：experience_conflict 必须引用真实 case', () => {
  const payload = {
    kind: 'experience_conflict' as const,
    caseIds: ['case:a', 'case:b'],
    supportingFactIds: [],
    candidateFocusVariables: [],
  };

  it('真实 case → 无 issue', () => {
    const issues = validateEncounterPlan(
      { id: 'e1', type: 'experience_conflict', act: 3, sourceFactIds: [], sourceCaseIds: ['case:a', 'case:b'], payload },
      { facts: [], cases: [experienceCase('case:a', 'a'), experienceCase('case:b', 'b')], differences: [], unknownIds: [] },
    );
    expect(issues).toEqual([]);
  });

  it('凭空构造的 case → 报错', () => {
    const issues = validateEncounterPlan(
      { id: 'e1', type: 'experience_conflict', act: 3, sourceFactIds: [], sourceCaseIds: ['case:fake-1', 'case:fake-2'], payload },
      { facts: [], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues.join(' ')).toContain('不存在的 case');
  });
});
