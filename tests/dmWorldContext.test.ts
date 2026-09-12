import { describe, expect, it } from 'vitest';

import { normalizeDmInput } from '@/core/dm/input';
import { formatDmUserMessage } from '@/core/dm/prompt';

import type { DmWorldContext } from '@/features/game-world/dmContext';

/**
 * DM 世界上下文接线（Phase 13 / P0-G）。
 *
 * 锁三条：normalize 安全钳制、prompt 有蓝图块且逐字规则生效、
 * 无 session 时 prompt 与旧版完全一致。
 */

const WORLD: DmWorldContext = {
  sessionId: 'sess-1',
  centralTension: '怕影响课程又想参赛',
  actObjective: 'experience-cost',
  actConflict: '走这条路的人提到过这些代价，现在轮到你了。',
  keyUnknown: '你未来两周能稳定拿出多少时间',
  sourceFacts: [
    {
      id: 'fact:1',
      quote: '我当时每周花 30 个小时在比赛上，课程确实受了影响。',
      sourceUrl: 'https://www.zhihu.com/q/1/a/1',
      author: '走过这条路的人',
    },
  ],
  differences: [
    { variable: '每周投入', relation: 'different', userValue: '8小时', experienceValue: '30小时' },
  ],
  forbiddenClaims: ['不得宣称成功概率', '不得把模拟结局写成现实预测'],
};

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goal: '大二想参加比赛',
    seed: 'SEED-2026-TEST',
    turnIndex: 2,
    totalTurns: 4,
    stats: { san: 80, skill: 20, bond: 15 },
    inventory: [],
    zhihuSnippets: [],
    history: [],
    personaTags: [],
    ...overrides,
  };
}

describe('normalize：worldContext / experienceUnlock 安全钳制', () => {
  it('合法 worldContext 被保留', () => {
    const input = normalizeDmInput(baseInput({ worldContext: WORLD }));
    expect(input.worldContext?.sessionId).toBe('sess-1');
    expect(input.worldContext?.actObjective).toBe('experience-cost');
    expect(input.worldContext?.sourceFacts).toHaveLength(1);
    expect(input.worldContext?.sourceFacts[0]!.quote).toContain('30 个小时');
  });

  it('超过 6 条事实 → 截断；烂 objective → 回落 final-reflection', () => {
    const input = normalizeDmInput(
      baseInput({
        worldContext: {
          ...WORLD,
          actObjective: '乱写的',
          sourceFacts: Array.from({ length: 9 }, (_, index) => ({
            id: `fact:${index}`,
            quote: `第 ${index} 条足够长的原文片段，长度超过最低门槛线。`,
            sourceUrl: 'https://www.zhihu.com/a',
            author: '某人',
          })),
        },
      }),
    );
    expect(input.worldContext?.actObjective).toBe('final-reflection');
    expect(input.worldContext?.sourceFacts).toHaveLength(6);
  });

  it('缺失 worldContext → undefined（legacy 路径零变化）', () => {
    expect(normalizeDmInput(baseInput()).worldContext).toBeUndefined();
  });
});

describe('prompt：世界蓝图块', () => {
  it('有蓝图时包含冲突、允许引用的真实经验与现实边界', () => {
    const text = formatDmUserMessage(
      normalizeDmInput(baseInput({ worldContext: WORLD })),
    );
    expect(text).toContain('【本局世界蓝图】');
    expect(text).toContain('走这条路的人提到过这些代价');
    expect(text).toContain('我当时每周花 30 个小时在比赛上');
    expect(text).toContain('不得宣称成功概率');
    expect(text).toContain('禁止改写');
    expect(text).toContain('与玩家的差异');
  });

  it('有蓝图时逐字引用规则覆盖 legacy 的「改写自」规则', () => {
    const text = formatDmUserMessage(normalizeDmInput(baseInput({ worldContext: WORLD })));
    expect(text).toContain('quote 必须逐字使用其中原文');
  });

  it('没有蓝图时与旧 prompt 形状一致（无世界块）', () => {
    const text = formatDmUserMessage(normalizeDmInput(baseInput()));
    expect(text).not.toContain('【本局世界蓝图】');
    expect(text).not.toContain('【经验解锁的新选择');
  });
});
