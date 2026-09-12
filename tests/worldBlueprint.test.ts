import { describe, expect, it } from 'vitest';

import { compileWorldBlueprint } from '@/features/game-world/compileWorld';

import type {
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * 世界蓝图编译（Phase 10 / P0-F）。
 *
 * 锁四条：固定四幕、Act3 优先反例、终局有 keyUnknown、
 * 没有事实不伪造。外加：纯函数确定性。
 */

function fact(id: string, type: ExperienceFact['type'], quote: string): ExperienceFact {
  return {
    id,
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: quote,
    type,
    relevance: 0.6,
    purposes: [],
  };
}

function path(overrides: Partial<ExperiencePath> = {}): ExperiencePath {
  return {
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
    ...overrides,
  };
}

function frame(overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '怕影响课程又想参赛',
    unknowns: [],
    parseConfidence: 0.5,
    ...overrides,
  };
}

describe('固定结构：四幕不可多不可少', () => {
  it('总是 4 个 act spec，objective 顺序固定', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path()],
      facts: [fact('fact:1', 'action', '报名参加了比赛，边做边学')],
    });
    expect(blueprint.acts).toHaveLength(4);
    expect(blueprint.acts.map((act) => act.objective)).toEqual([
      'enter-world',
      'experience-cost',
      'meet-counterexample',
      'final-reflection',
    ]);
    expect(blueprint.version).toBe('world-blueprint-v1');
    expect(blueprint.sessionId).toBe('s1');
  });

  it('Act1 引用主路径的支持片段，让玩家马上认出「这是我的问题」', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path()],
      facts: [fact('fact:1', 'action', '报名参加了比赛，边做边学')],
    });
    expect(blueprint.acts[0]!.primaryPathIds).toEqual(['path-1']);
    expect(blueprint.acts[0]!.experienceFactIds).toContain('fact:1');
  });

  it('Act2 优先代价片段（cost）', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path({ supportingFactIds: ['fact:cost'] })],
      facts: [
        fact('fact:cost', 'cost', '每周大概花十个小时，课程确实受了影响。'),
        fact('fact:action', 'action', '报名参加了比赛'),
      ],
    });
    expect(blueprint.acts[1]!.experienceFactIds).toContain('fact:cost');
  });
});

describe('Act3：优先反例', () => {
  it('对立片段进入 Act3，而不是被丢掉', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [
        path(),
        path({
          id: 'path-2',
          opposingFactIds: ['fact:counter'],
        }),
      ],
      facts: [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:counter', 'outcome', '因为时间冲突中途退出了，挺后悔的。'),
      ],
    });
    expect(blueprint.acts[2]!.experienceFactIds).toContain('fact:counter');
  });
});

describe('终局反思', () => {
  it('keyUnknown 取 frame 里优先级最高的未知', () => {
    const unknown: UnknownVariable = {
      id: 'unknown-time',
      label: '你未来两周能稳定拿出多少时间',
      whyItMatters: '它决定实验做多大',
      origin: 'missing-user-context',
      priority: 1,
    };
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame({ unknowns: [unknown] }),
      paths: [path()],
      facts: [],
    });
    expect(blueprint.keyUnknown?.id).toBe('unknown-time');
  });

  it('frame 没有未知时回落路径上的未知', () => {
    const pathUnknown: UnknownVariable = {
      id: 'path-1-unknown-1',
      label: '你能不能坚持完整交付一个项目',
      whyItMatters: '它决定这条路走不走得到报名那天',
      origin: 'experience-disagreement',
      priority: 2,
    };
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame({ unknowns: [] }),
      paths: [path({ unknowns: [pathUnknown] })],
      facts: [],
    });
    expect(blueprint.keyUnknown?.id).toBe('path-1-unknown-1');
  });
});

describe('诚信：没有事实不伪造', () => {
  it('空路径 + 空片段 → 四幕仍在，但全部留空且 unlock 为空', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths: [], facts: [] });
    expect(blueprint.acts).toHaveLength(4);
    for (const act of blueprint.acts) {
      expect(act.experienceFactIds).toHaveLength(0);
      expect(act.unlockIds).toHaveLength(0);
    }
    expect(blueprint.unlocks).toHaveLength(0);
    // 冲突文案如实说「没有」，不编
    expect(blueprint.acts[1]!.conflict).toContain('没有找到');
  });

  it('unlock 的 description 是片段原文（逐字，可回溯）', () => {
    const quote = '报名参加了比赛，边做边学，最后拿了省二';
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path({ supportingFactIds: ['fact:1'] })],
      facts: [fact('fact:1', 'action', quote)],
    });
    expect(blueprint.unlocks).toHaveLength(1);
    expect(blueprint.unlocks[0]!.description).toBe(quote);
    expect(blueprint.unlocks[0]!.sourceFactIds).toEqual(['fact:1']);
    expect(blueprint.unlocks[0]!.availableFromAct).toBeGreaterThanOrEqual(2);
  });

  it('forbiddenClaims 是固定五条（产品的宪法条款）', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths: [], facts: [] });
    expect(blueprint.forbiddenClaims).toContain('不得把模拟结局写成现实预测');
    expect(blueprint.forbiddenClaims).toContain('不得宣称成功概率');
    expect(blueprint.forbiddenClaims).toContain('不得编造知乎来源');
  });
});

describe('确定性', () => {
  it('同输入两次编译逐字节一致', () => {
    const input = {
      sessionId: 's1',
      frame: frame({ unknowns: [] }),
      paths: [path(), path({ id: 'path-2', opposingFactIds: ['fact:2'] })],
      facts: [fact('fact:1', 'action', '报名参加了比赛'), fact('fact:2', 'outcome', '中途退出了')],
    };
    expect(JSON.stringify(compileWorldBlueprint(input))).toBe(JSON.stringify(compileWorldBlueprint(input)));
  });
});
