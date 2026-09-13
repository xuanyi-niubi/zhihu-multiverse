import { describe, expect, it } from 'vitest';

import type {
  ExperienceChoiceUnlock,
  WorldActSpec,
  WorldBlueprint,
} from '@/features/game-world/domain';
import type { ProblemFrame } from '@/features/experience/domain';

/**
 * WorldBlueprint 领域契约（Phase 1）。
 *
 * 关键约束在这里被写成可测的形状：**蓝图是把经历编译成游戏，
 * 不是生成一份报告**。因此它的每一幕都必须挂着真实事实 ID，
 * 并且必须带一组给 DM 的负向约束（`forbiddenClaims`）。
 */

const frame: ProblemFrame = {
  rawQuestion: '大二数据科学，基础一般，想参加比赛但怕影响课程',
  currentSituation: '大二在读，基础一般',
  desiredChange: '想参加一次比赛',
  constraints: [],
  resources: [],
  concerns: [],
  centralTension: '想积累作品 vs 每周只有 8 小时',
  unknowns: [],
  parseConfidence: 0.7,
};

function unlock(overrides: Partial<ExperienceChoiceUnlock> = {}): ExperienceChoiceUnlock {
  return {
    id: 'u1',
    label: '先做 48 小时小样',
    description: '有人用一个小交付替代了「要不要报名」的空想。',
    sourceFactIds: ['f1'],
    choice: { text: '先花 48 小时做一个最小样', hint: '把决定推迟到有东西可看之后' },
    availableFromAct: 2,
    ...overrides,
  };
}

function act(overrides: Partial<WorldActSpec> = {}): WorldActSpec {
  return {
    act: 1,
    objective: 'enter-world',
    titleHint: '进入这条世界线',
    conflict: '你只有零散时间，却想做出一个完整东西。',
    primaryPathIds: ['p1'],
    experienceFactIds: ['f1'],
    unlockIds: [],
    ...overrides,
  };
}

function blueprint(overrides: Partial<WorldBlueprint> = {}): WorldBlueprint {
  return {
    version: 'world-blueprint-v1',
    sessionId: 's-1',
    problemFrame: frame,
    centralTension: frame.centralTension,
    paths: [],
    keyUnknown: null,
    acts: [act()],
    experienceFacts: [],
    unlocks: [],
    forbiddenClaims: ['不得声称某条路成功率高'],
    ...overrides,
  };
}

describe('WorldBlueprint 形状与纪律', () => {
  it('带版本号（要存进会话并复用，没版本无法演进）', () => {
    expect(blueprint().version).toBe('world-blueprint-v1');
  });

  it('每一幕都必须挂真实事实 ID 或路径 ID（不能是空口一幕）', () => {
    for (const item of blueprint().acts) {
      const anchored = item.experienceFactIds.length > 0 || item.primaryPathIds.length > 0;
      expect(anchored).toBe(true);
    }
  });

  it('**必须带 forbiddenClaims**（DM 的负向约束不可为空）', () => {
    // 空数组意味着模型可以随便说 —— 那是这类产品最危险的状态
    expect(blueprint().forbiddenClaims.length).toBeGreaterThan(0);
  });

  it('keyUnknown 允许为 null（没有就写没有，不编一个）', () => {
    expect(blueprint().keyUnknown).toBeNull();
  });

  it('三类幕目标都合法', () => {
    const objectives = ['enter-world', 'experience-cost', 'meet-counterexample'] as const;
    for (const objective of objectives) {
      expect(act({ objective }).objective).toBe(objective);
    }
  });
});

describe('ExperienceChoiceUnlock：游戏行动而非现实建议', () => {
  it('必须能指回原始片段（玩家要看得出这个选项从哪来）', () => {
    expect(unlock().sourceFactIds.length).toBeGreaterThan(0);
  });

  it('必须声明从第几幕可用', () => {
    expect(unlock().availableFromAct).toBeGreaterThanOrEqual(1);
  });

  it('选项文案与提示都不为空', () => {
    const item = unlock();
    expect(item.choice.text.trim().length).toBeGreaterThan(0);
    expect(item.choice.hint.trim().length).toBeGreaterThan(0);
  });

  it('tags 沿用现有选项语义（可与现有数值层对接）', () => {
    const item = unlock({
      choice: {
        text: '找一个人一起做',
        hint: '有人并肩时，退出率更低',
        tags: { social: 'ally', efficiency: 'indirect' },
      },
    });
    expect(item.choice.tags?.social).toBe('ally');
    expect(item.choice.tags?.efficiency).toBe('indirect');
  });
});
