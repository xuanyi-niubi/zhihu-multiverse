import { describe, expect, it } from 'vitest';

import { normalizeDmInput } from '@/core/dm/input';
import { buildDmMessages, formatDmUserMessage } from '@/core/dm/prompt';

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

  it('超过 6 条事实 → 截断；烂 objective → 回落最后一幕（反例幕）', () => {
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
    expect(input.worldContext?.actObjective).toBe('meet-counterexample');
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

  /**
   * P0-7：第三幕是反例幕，模型必须被告知「遇见不同的经验逻辑」，
   * 且**没有真实反例时不得虚构** —— 否则它会自己编一个反例出来。
   */
  it('第三幕注入反例纪律（不得虚构反例）', () => {
    const text = formatDmUserMessage(
      normalizeDmInput(baseInput({ worldContext: { ...WORLD, actObjective: 'meet-counterexample' } })),
    );
    expect(text).toContain('本幕纪律');
    expect(text).toContain('与前两幕不同的经验逻辑');
    expect(text).toContain('不得虚构反例');
  });

  it('非反例幕不出现这条纪律（只有该幕需要）', () => {
    const text = formatDmUserMessage(normalizeDmInput(baseInput({ worldContext: WORLD })));
    expect(text).not.toContain('不得虚构反例');
  });

  it('第三幕同时承担反例与收束（终幕纪律不再单独一幕）', () => {
    const text = formatDmUserMessage(
      normalizeDmInput(baseInput({ worldContext: { ...WORLD, actObjective: 'meet-counterexample' } })),
    );
    expect(text).toContain('本幕是最后一幕');
    expect(text).toContain('不再引入新的现实主张');
  });

  /**
   * P0-10：系统提示词必须把两种模式讲清楚 ——
   * 蓝图模式逐字引用，legacy（只有检索片段）才允许改写。
   * 此前只有「改写自」一条，与蓝图块的「禁止改写」互相矛盾。
   */
  it('system prompt 同时给出逐字模式与 legacy 改写模式（P0-10）', () => {
    const messages = buildDmMessages(normalizeDmInput(baseInput({ worldContext: WORLD })));
    const system = messages[0]!.content;
    expect(system).toContain('逐字等于');
    expect(system).toContain('legacy 模式');
    expect(system).toContain('改写自');
  });
});

/**
 * §16：选项不再由「一稳一险」模板产生。
 *
 * 有蓝图时，选项必须来自玩家想法 / 真实行动 / 反例替代做法；
 * 旧模板只保留给 legacy 路径（没有蓝图时）。
 */
describe('选项来源（§16）', () => {
  it('蓝图模式：明确禁止稳妥-高风险模板，且不强制任何位置带 check', () => {
    const text = formatDmUserMessage(normalizeDmInput(baseInput({ worldContext: WORLD })));
    expect(text).toContain('不套稳妥-高风险模板');
    expect(text).toContain('真实行动');
    expect(text).not.toContain('choices[1] 必须带 check');
  });

  it('legacy（无蓝图）：保留原来的稳妥/高风险模板，行为零变化', () => {
    const text = formatDmUserMessage(normalizeDmInput(baseInput()));
    expect(text).toContain('choices[1] 必须带 check');
    expect(text).toContain('choices[0] 稳妥');
  });
});
