import { describe, expect, it } from 'vitest';

import { compileWorldBlueprint, counterexampleFacts } from '@/features/game-world/compileWorld';

import type { ExperienceFact, ExperiencePath, ProblemFrame } from '@/features/experience/domain';

/**
 * 第三幕必须真的由**反例**驱动（P0-7）。
 *
 * ## 这条测试防的是什么
 *
 * 世界蓝图里第三幕叫 `meet-counterexample`，但如果编译时拿「任意一条
 * reflection」兜底，第三幕就会悄悄退化成「换个说法的支持」——
 * 玩家以为自己撞见了不同的声音，其实全程都被顺着说。
 *
 * 这个产品的护城河是「我们主动去找反例」。所以这里锁两件事：
 *
 * 1. 有反例时，第三幕**优先**用它（四轮优先级逐轮验证）；
 * 2. 没有反例时，第三幕**留空**并如实写在冲突文案里 —— 绝不伪造。
 */

function fact(
  id: string,
  type: ExperienceFact['type'],
  quote: string,
  overrides: Partial<ExperienceFact> = {},
): ExperienceFact {
  return {
    id,
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: quote,
    type,
    relevance: 0.6,
    purposes: [],
    ...overrides,
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

function frame(): ProblemFrame {
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
  };
}

function compile(paths: readonly ExperiencePath[], facts: readonly ExperienceFact[]) {
  return compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths, facts });
}

describe('有反例：第三幕优先用它', () => {
  it('优先级 1：路径标注的对立片段排在最前', () => {
    const blueprint = compile(
      [path(), path({ id: 'path-2', opposingFactIds: ['fact:opposing'] })],
      [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:support-reflection', 'reflection', '我觉得这条路值得走，早点开始更好。'),
        fact('fact:opposing', 'outcome', '因为时间冲突中途退出了，挺后悔的。'),
      ],
    );

    const act3 = blueprint.acts[2]!;
    expect(act3.experienceFactIds[0]).toBe('fact:opposing');
    expect(act3.evidenceRole).toBe('counterexample');
  });

  it('优先级 2：没有对立片段时，取检索阶段作为反例找来的片段', () => {
    const blueprint = compile(
      [path()],
      [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:counter', 'outcome', '我们队三个人最后都退赛了，课业压力太大。', {
          purposes: ['counterexample'],
        }),
      ],
    );

    expect(blueprint.acts[2]!.experienceFactIds).toEqual(['fact:counter']);
  });

  it('优先级 3：没有反例意图时，取失败经历（failure）', () => {
    const blueprint = compile(
      [path()],
      [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:failed', 'outcome', '最后没能坚持下来，项目烂尾了。', { purposes: ['failure'] }),
      ],
    );

    expect(blueprint.acts[2]!.experienceFactIds).toEqual(['fact:failed']);
  });

  it('优先级 4：没有意图标注时，取路径标注的对立 case 所属来源', () => {
    const blueprint = compile(
      [path({ opposingCaseIds: ['case:live:opponent'] })],
      [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:opponent', 'reflection', '我走的是先补基础再参赛，结果确实不一样。', {
          sourceId: 'live:opponent',
        }),
      ],
    );

    expect(blueprint.acts[2]!.experienceFactIds).toEqual(['fact:opponent']);
  });
});

describe('没有反例：第三幕留空，不伪造', () => {
  const supportOnly = [
    fact('fact:1', 'action', '报名参加了比赛，边做边学'),
    fact('fact:reflect', 'reflection', '我觉得这条路值得走，早点开始更好。'),
  ];

  it('只有支持性反思时，第三幕**不拿它充反例**', () => {
    const blueprint = compile([path()], supportOnly);
    const act3 = blueprint.acts[2]!;

    // 旧实现会把这条 reflection 塞进第三幕（「拿支持硬充反例」）
    expect(act3.experienceFactIds).toHaveLength(0);
  });

  it('留空时冲突文案如实说明「没有找到反例」', () => {
    const blueprint = compile([path()], supportOnly);
    expect(blueprint.acts[2]!.conflict).toContain('没有找到真正的反例');
  });

  it('留空时不标 evidenceRole —— 留空本身就是「本幕没有反例证据」的信号', () => {
    const blueprint = compile([path()], supportOnly);
    expect(blueprint.acts[2]!.evidenceRole).toBeUndefined();
  });

  it('support 类片段不会因为类型是 reflection 就进入第三幕', () => {
    // 直接锁函数契约：无对立、无意图、无对立 case → 空
    expect(counterexampleFacts([path()], supportOnly)).toHaveLength(0);
  });
});

describe('evidenceRole：四幕各自的证据角色可断言', () => {
  it('Act1=support / Act2=cost / Act3=counterexample（有反例时）/ Act4=reflection', () => {
    const blueprint = compile(
      [path({ opposingFactIds: ['fact:counter'] })],
      [
        fact('fact:1', 'action', '报名参加了比赛，边做边学'),
        fact('fact:cost', 'cost', '每周大概花十个小时，课程确实受了影响。'),
        fact('fact:counter', 'outcome', '因为时间冲突中途退出了，挺后悔的。'),
      ],
    );
    expect(blueprint.acts.map((act) => act.evidenceRole)).toEqual([
      'support',
      'cost',
      'counterexample',
      'reflection',
    ]);
  });
});
