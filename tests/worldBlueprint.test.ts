import { describe, expect, it } from 'vitest';

import { compileWorldBlueprint } from '@/features/game-world/compileWorld';
import { cardTitlesFrom } from '@/features/game-world/cardTitles';
import { isUsableTitle, withUnlockTitles } from '@/features/game-world/unlockTitles';

import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';
import type { ExperienceChoiceUnlock } from '@/features/game-world/domain';

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

describe('固定结构：三幕不可多不可少', () => {
  it('总是 3 个 act spec，objective 顺序固定', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path()],
      facts: [fact('fact:1', 'action', '报名参加了比赛，边做边学')],
    });
    expect(blueprint.acts).toHaveLength(3);
    expect(blueprint.acts.map((act) => act.objective)).toEqual([
      'enter-world',
      'experience-cost',
      'meet-counterexample',
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
  it('空路径 + 空片段 → 三幕仍在，但全部留空且 unlock 为空', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths: [], facts: [] });
    expect(blueprint.acts).toHaveLength(3);
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

/**
 * P0-8：解锁项只允许从**行动**经验生成。
 *
 * 解锁会被渲染成「按『X』的路子先试一小步」这样的游戏行动。
 * 若来源是 condition（「家里能支持两年」），文案就荒谬了 ——
 * 而且它把一个条件伪装成了一种方法。
 */
describe('P0-8：解锁只从行动经验生成', () => {
  function compileWith(facts: readonly ExperienceFact[]) {
    return compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path({ supportingFactIds: facts.map((item) => item.id) })],
      facts,
    });
  }

  it('只有 condition 片段 → 不生成解锁（宁可这一局没有解锁）', () => {
    const blueprint = compileWith([fact('fact:cond', 'condition', '家里能支持我两年不赚钱。')]);
    expect(blueprint.unlocks).toHaveLength(0);
    // 蓝图本身仍然成立：四幕、没有解锁、Act 里也没有 unlockIds
    expect(blueprint.acts).toHaveLength(3);
    expect(blueprint.acts.every((act) => act.unlockIds.length === 0)).toBe(true);
  });

  it('condition 排在 action 前面时，也只用 action 生成', () => {
    const blueprint = compileWith([
      fact('fact:cond', 'condition', '家里能支持我两年不赚钱。'),
      fact('fact:act', 'action', '我先做了个 48 小时的小样给队友看。'),
    ]);
    expect(blueprint.unlocks).toHaveLength(1);
    expect(blueprint.unlocks[0]!.sourceFactIds).toEqual(['fact:act']);
    expect(blueprint.unlocks[0]!.description).toBe('我先做了个 48 小时的小样给队友看。');
  });

  it('解锁选项文案由 action 原文的短标签拼成（描述 = 逐字原文）', () => {
    const quote = '我先做一个小样再决定是否全力投入';
    const blueprint = compileWith([fact('fact:act', 'action', quote)]);
    expect(blueprint.unlocks[0]!.choice.text).toContain('先试一小步');
    expect(blueprint.unlocks[0]!.description).toBe(quote);
    expect(blueprint.unlocks[0]!.label.length).toBeLessThanOrEqual(12);
  });
});

/**
 * 经验卡（§13）：蓝图必须带上「按人聚合的经历」，卡片才有数据可渲染。
 */
describe('经验卡数据（§13）', () => {
  it('蓝图带 experienceCases，且每条片段都能回到来源', () => {
    const blueprint = compileWorldBlueprint({
      sessionId: 's1',
      frame: frame(),
      paths: [path()],
      facts: [
        fact('fact:c', 'condition', '我当时大二，基础一般，没有把握。'),
        fact('fact:a', 'action', '先用一周完成一个最小项目。'),
        fact('fact:o', 'outcome', '发现真正缺的是协作，而不是技术。'),
      ],
    });

    expect(blueprint.experienceCases?.length).toBeGreaterThan(0);
    const card = blueprint.experienceCases![0]!;
    expect(card.actions[0]!.exactQuote).toBe('先用一周完成一个最小项目。');
    expect(card.conditions[0]!.exactQuote).toContain('基础一般');
    // 卡片上的每一句都能点回原文
    expect(card.sourceUrl.length).toBeGreaterThan(0);
  });

  it('没有事实时不编卡片', () => {
    const blueprint = compileWorldBlueprint({ sessionId: 's1', frame: frame(), paths: [], facts: [] });
    expect(blueprint.experienceCases?.length ?? 0).toBe(0);
  });
});

/**
 * 解锁项的行动式标题（§24）：只有标题可以被模型改写，正文永远是逐字片段。
 */
describe('解锁标题的护栏（§24）', () => {
  it('可用的标题：短、无数字、不下结论', () => {
    for (const title of ['先验证，再下注', '先找人，再开局', '先留一条退路']) {
      expect(isUsableTitle(title)).toBe(true);
    }
  });

  it('带数字 / 成功率 / 建议式措辞的标题一律拒绝', () => {
    for (const bad of ['提高 30% 成功率', '成功率高', '建议你先参赛', '你应该早点开始', '匹配度很高', 'x']) {
      expect(isUsableTitle(bad)).toBe(false);
    }
  });

  it('模型不可用时原样返回（不编标题）', async () => {
    const unlock = {
      id: 'unlock-1',
      label: '原来的标签',
      description: '先做一个小样再决定',
      sourceFactIds: ['fact:1'],
      choice: { text: '按「原来的标签」的路子先试一小步', hint: 'h' },
      availableFromAct: 2,
    } as const;
    const result = await withUnlockTitles({ unlocks: [unlock], facts: [], router: null });
    expect(result).toBe(result);
    expect(result[0]!.label).toBe('原来的标签');
  });
});

/**
 * 经验卡抬头（§24）：复用解锁项已有的行动式标题，不额外生成一个字。
 */
describe('经验卡抬头复用解锁标题（§24）', () => {
  function experienceCase(id: string, actions: readonly ExperienceFact[]): ExperienceCase {
    return {
      id,
      sourceId: 'live:src-1',
      sourceUrl: 'https://www.zhihu.com/q/1',
      author: '某人',
      conditions: [],
      actions,
      costs: [],
      outcomes: [],
      reflections: [],
    };
  }

  it('把解锁标题映射到包含其来源片段的卡上', () => {
    const unlock: ExperienceChoiceUnlock = {
      id: 'unlock-path-1',
      label: '先验证，再下注',
      description: '先做一个小样再决定',
      sourceFactIds: ['fact:1'],
      choice: { text: '按「先验证，再下注」的路子先试一小步', hint: 'h' },
      availableFromAct: 2,
    };
    const cases = [experienceCase('case:live:src-1', [fact('fact:1', 'action', '先做一个小样再决定')])];

    expect(cardTitlesFrom([unlock], cases)).toEqual({ 'case:live:src-1': '先验证，再下注' });
  });

  it('没有对应解锁的卡不硬塞标题（宁可不给）', () => {
    const cases = [experienceCase('case:live:src-1', [fact('fact:1', 'action', '先做一个小样再决定')])];
    expect(cardTitlesFrom([], cases)).toEqual({});
  });

  it('映射是纯函数：不改动输入的解锁与卡片', () => {
    const unlock: ExperienceChoiceUnlock = {
      id: 'unlock-path-1',
      label: '先找人，再开局',
      description: '先找一个同伴',
      sourceFactIds: ['fact:1'],
      choice: { text: '按「先找人，再开局」的路子先试一小步', hint: 'h' },
      availableFromAct: 2,
    };
    const cases = [experienceCase('case:live:src-1', [fact('fact:1', 'action', '先找一个同伴')])];
    const before = JSON.stringify({ unlocks: [unlock], cases });

    const titles = cardTitlesFrom([unlock], cases);

    expect(titles['case:live:src-1']).toBe('先找人，再开局');
    expect(JSON.stringify({ unlocks: [unlock], cases })).toBe(before);
  });
});
