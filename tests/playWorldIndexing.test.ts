import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { worldContextForTurn, unlockForTurn } from '@/features/game-world/dmContext';

import type { WorldBlueprint } from '@/features/game-world/domain';

/**
 * Play 幕次索引与蓝图幕次对齐（P0-1）。
 *
 * ## 这个 bug 的真实表现
 *
 * Play 的 `state.turnIndex` 是 **1 基**（1 = 第一幕），
 * 而 `worldContextForTurn` / `unlockForTurn` 的契约是 **0 基**。
 * 直接传 1 基值会让**每一幕都错开一位**：
 *
 * ```text
 * 游戏第一幕 → 蓝图「体会代价」幕     （本该是「进入世界」）
 * 游戏第二幕 → 蓝图「遇到反例」幕
 * 游戏第三幕 → 蓝图「终局反思」幕
 * 游戏第四幕 → 读不到任何东西
 * ```
 *
 * 这组测试把四个映射逐个钉死。
 */

/** 一个四幕蓝图（与 compileWorld 的固定结构一致）。 */
function blueprint(): WorldBlueprint {
  return {
    version: 'world-blueprint-v1',
    sessionId: 's-test',
    problemFrame: {
      rawQuestion: '大二想参加比赛',
      currentSituation: '大二',
      desiredChange: '参加比赛',
      constraints: [],
      resources: [],
      concerns: [],
      centralTension: '想积累 vs 时间少',
      unknowns: [],
      parseConfidence: 0.4,
    },
    centralTension: '想积累 vs 时间少',
    paths: [],
    keyUnknown: null,
    acts: [
      { act: 1, objective: 'enter-world', titleHint: '进入', conflict: 'c1', primaryPathIds: [], experienceFactIds: ['f1'], unlockIds: [] },
      { act: 2, objective: 'experience-cost', titleHint: '代价', conflict: 'c2', primaryPathIds: [], experienceFactIds: ['f2'], unlockIds: [] },
      { act: 3, objective: 'meet-counterexample', titleHint: '反例', conflict: 'c3', primaryPathIds: [], experienceFactIds: ['f3'], unlockIds: [] },
      { act: 4, objective: 'final-reflection', titleHint: '反思', conflict: 'c4', primaryPathIds: [], experienceFactIds: ['f4'], unlockIds: [] },
    ],
    experienceFacts: [],
    unlocks: [],
    forbiddenClaims: ['不得声称成功率高'],
  };
}

/** 复现 Play 层做的 1 基 → 0 基换算。 */
function blueprintIndexForPlayTurn(turnIndex: number): number {
  return Math.max(0, turnIndex - 1);
}

describe('Play 1 基 → 蓝图 0 基 的四个映射', () => {
  const cases: readonly { readonly turnIndex: number; readonly objective: string }[] = [
    { turnIndex: 1, objective: 'enter-world' },
    { turnIndex: 2, objective: 'experience-cost' },
    { turnIndex: 3, objective: 'meet-counterexample' },
    { turnIndex: 4, objective: 'final-reflection' },
  ];

  for (const item of cases) {
    it(`Play turnIndex=${item.turnIndex} → ${item.objective}`, () => {
      const context = worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(item.turnIndex));
      expect(context?.actObjective).toBe(item.objective);
    });
  }

  it('**不换算会错位一位**（反例：证明这层转换是必要的）', () => {
    // 直接把 1 基值当 0 基传 → 第一幕读到第二幕
    const wrong = worldContextForTurn(blueprint(), 1);
    expect(wrong?.actObjective).toBe('experience-cost');
    expect(wrong?.actObjective).not.toBe('enter-world');
  });

  it('turnIndex 越界时不崩（钳到第 0 幕）', () => {
    expect(() => worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(0))).not.toThrow();
    expect(worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(0))?.actObjective).toBe('enter-world');
  });

  it('换算后 unlockForTurn 与同一幕对齐', () => {
    const base = blueprint();
    // 给第三幕（index 2）挂一个解锁（不可变方式）
    const b: WorldBlueprint = {
      ...base,
      unlocks: [
        {
          id: 'u1',
          label: '先做小样',
          description: '有人用一个小交付替代了空想。',
          sourceFactIds: ['f3'],
          choice: { text: '先做 48 小时小样', hint: '把决定推迟到有东西可看之后' },
          availableFromAct: 3,
        },
      ],
      acts: base.acts.map((act, index) =>
        index === 2 ? { ...act, unlockIds: ['u1'] } : act,
      ),
    };

    // Play 第三幕（turnIndex=3）→ 蓝图 index 2 → 应拿到 u1
    const unlock = unlockForTurn(b, blueprintIndexForPlayTurn(3), []);
    expect(unlock?.unlockId).toBe('u1');

    // Play 第二幕不该拿到它（availableFromAct=3）
    expect(unlockForTurn(b, blueprintIndexForPlayTurn(2), [])).toBeNull();
  });
});

describe('源码层的契约（防止有人把换算删掉）', () => {
  it('play/page.tsx 里对两个蓝图函数都传了换算后的索引', () => {
    const source = readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');

    // 换算必须存在
    expect(source).toContain('turnIndex - 1');
    // 且不能出现「把 1 基 turnIndex 直接传给蓝图函数」的写法
    expect(source).not.toMatch(/worldContextForTurn\(\s*blueprint\s*,\s*turnIndex\s*\)/);
    expect(source).not.toMatch(/unlockForTurn\(\s*blueprint\s*,\s*turnIndex\s*,/);
  });

  it('/api/dm 的 act 是 1 基，不能重复 +1', () => {
    const source = readFileSync(new URL('../src/app/api/dm/route.ts', import.meta.url), 'utf8');
    // 旧的错误写法：act: input.turnIndex + 1
    expect(source).not.toMatch(/act:\s*input\.turnIndex\s*\+\s*1/);
    expect(source).toMatch(/act:\s*input\.turnIndex\b/);
  });
});
