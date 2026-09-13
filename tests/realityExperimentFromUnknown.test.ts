import { describe, expect, it } from 'vitest';

import { designExperiment, createSession } from '@/features/decision-session/service';
import {
  experimentFromUnknown,
  inferUnknownKind,
} from '@/features/decision-session/experiment';

import type { RealityExperiment, UserContext } from '@/features/decision-session/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';
import type { ProblemFrame, UnknownVariable, UserDifference } from '@/features/experience/domain';

/**
 * 未知驱动的现实实验（P1-1）。
 *
 * 旧的「问题类型 → 模板」表答不了一个问题：两个都在纠结转专业的人，
 * 一个真正不知道的是「我能不能每周稳定拿出 10 小时」，另一个是
 * 「我到底喜欢它还是喜欢想象中的它」。同一张表给不出两个答案。
 */

const FIELDS = [
  'hypothesis',
  'action',
  'timebox',
  'artifact',
  'successSignal',
  'stopSignal',
  'reducesUnknown',
] as const;

function unknown(overrides: Partial<UnknownVariable> = {}): UnknownVariable {
  return {
    id: 'unknown-time',
    label: '你未来两周能稳定拿出多少时间',
    whyItMatters: '它决定实验做多大',
    origin: 'missing-user-context',
    priority: 1,
    ...overrides,
  };
}

function context(overrides: Partial<UserContext> = {}): UserContext {
  return {
    goal: '大二数据科学，想参加比赛但怕影响课程',
    nonNegotiables: ['影响课程'],
    existingResources: [],
    ...overrides,
  };
}

function frame(overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  return {
    rawQuestion: '大二数据科学，想参加比赛但怕影响课程',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '想积累作品 vs 每周只有几小时',
    unknowns: [],
    parseConfidence: 0.4,
    ...overrides,
  };
}

const DIFFERENCES: readonly UserDifference[] = [
  {
    variable: '每周投入',
    userValue: '还不知道',
    experienceValue: '每周 10 小时',
    relation: 'different',
    evidenceFactIds: ['fact:1'],
  },
];

function build(
  kind: UnknownVariable['kind'],
  opts: { readonly context?: UserContext; readonly differences?: readonly UserDifference[] } = {},
): RealityExperiment {
  return experimentFromUnknown({
    unknown: unknown({ kind, label: LABEL[kind!] ?? '一个未知' }),
    frame: frame(),
    differences: opts.differences ?? DIFFERENCES,
    context: opts.context ?? context(),
  });
}

const LABEL: Record<string, string> = {
  'time-capacity': '你未来两周能稳定拿出多少时间',
  'ally-availability': '你能不能找到稳定协作的人',
  'interest-fit': '你到底喜欢这个方向，还是只是喜欢想象中的它',
  'skill-capability': '你的基础够不够撑到出成果',
  'cost-tolerance': '这份代价你愿不愿意长期承担',
  reversibility: '走错了还能不能退回来',
  'information-gap': '这条路真实的一天是什么样的',
};

describe('六要素：任何类型都不能缺', () => {
  const kinds = Object.keys(LABEL) as NonNullable<UnknownVariable['kind']>[];

  for (const kind of kinds) {
    it(`${kind} → 七个字段全非空，且 reducesUnknown 就是这个未知`, () => {
      const experiment = build(kind);
      for (const field of FIELDS) {
        expect(String(experiment[field]).length).toBeGreaterThan(0);
      }
      expect(experiment.reducesUnknown).toBe(LABEL[kind]);
    });
  }
});

describe('未知类型决定实验形态', () => {
  it('时间容量 → 七天真实记录，而不是「你要更自律」', () => {
    const experiment = build('time-capacity');
    expect(experiment.action).toContain('7 天');
    expect(experiment.action).toContain('记录');
    // 记录本身不该要求每天投入几小时
    expect(experiment.timebox).toContain('2 分钟');
    expect(experiment.artifact).toContain('记录');
  });

  it('队友可得性 → 真去联系 3 个人，完成一次 30 分钟共同任务', () => {
    const experiment = build('ally-availability');
    expect(experiment.action).toContain('3 个');
    expect(experiment.action).toContain('30 分钟');
  });

  it('兴趣匹配 → 3 小时最小任务，记录还想不想继续', () => {
    const experiment = build('interest-fit');
    expect(experiment.action).toContain('3 小时');
    expect(experiment.action).toContain('想不想继续');
    expect(experiment.timebox).toContain('3 小时');
  });

  it('可逆性 → 先写清退出条件（时间点 + 信号）', () => {
    const experiment = build('reversibility');
    expect(experiment.action).toContain('退出');
    expect(experiment.successSignal).toContain('退出条件');
  });

  it('信息缺口 → 找 2 位走过这条路的人各问 20 分钟', () => {
    const experiment = build('information-gap');
    expect(experiment.action).toContain('2 位');
    expect(experiment.action).toContain('20 分钟');
  });
});

describe('两条既有纪律在未知驱动路径上同样成立', () => {
  it('时间盒跟着用户给的可用时间走', () => {
    const small = build('information-gap', { context: context({ availableTime: '未来两周约 3 小时' }) });
    const large = build('information-gap', { context: context({ availableTime: '未来两周约 15 小时' }) });
    expect(small.timebox).toContain('3 小时');
    expect(large.timebox).toContain('12 小时');
  });

  it('停止信号引用用户自己说的那种损失，并明确说「停下」', () => {
    const experiment = build('cost-tolerance');
    expect(experiment.stopSignal).toContain('课程');
    expect(experiment.stopSignal).toContain('停下');
  });

  it('没有说不接受的损失时，停止信号仍然写出来（用通用句，不省略）', () => {
    const experiment = build('time-capacity', { context: context({ nonNegotiables: [] }) });
    expect(experiment.stopSignal).toContain('停下');
  });
});

describe('与样本的差异被写进假设', () => {
  it('有不同项时，假设里点明「别人的结论不能直接搬到你身上」', () => {
    const experiment = build('skill-capability', { differences: DIFFERENCES });
    expect(experiment.hypothesis).toContain('每周 10 小时');
    expect(experiment.hypothesis).toContain('不能直接搬到你身上');
  });

  it('没有任何差异时不编一段差异出来', () => {
    const experiment = build('skill-capability', { differences: [] });
    expect(experiment.hypothesis).not.toContain('不能直接搬到你身上');
    expect(experiment.hypothesis.length).toBeGreaterThan(0);
  });
});

describe('kind 缺失时按 label 推断（确定性）', () => {
  const cases: readonly { readonly label: string; readonly kind: NonNullable<UnknownVariable['kind']> }[] = [
    { label: '你未来两周能稳定拿出多少时间', kind: 'time-capacity' },
    { label: '你能不能找到稳定协作的人', kind: 'ally-availability' },
    { label: '你到底喜不喜欢这个方向', kind: 'interest-fit' },
    { label: '你的基础够不够用', kind: 'skill-capability' },
    { label: '这份代价你愿不愿意长期承担', kind: 'cost-tolerance' },
    { label: '如果走错了还能不能退回来', kind: 'reversibility' },
    { label: '你手上已有的资源（时间、技能、人脉）', kind: 'information-gap' },
  ];

  for (const item of cases) {
    it(`「${item.label}」→ ${item.kind}`, () => {
      expect(inferUnknownKind(item.label)).toBe(item.kind);
    });
  }

  it('同时含「时间」「技能」「人脉」的资源类问题不被误判成时间容量', () => {
    expect(inferUnknownKind('你手上已有的资源（时间、技能、人脉）')).not.toBe('time-capacity');
  });

  it('什么都不命中 → information-gap（去找人问，而不是编一个动作）', () => {
    expect(inferUnknownKind('一个说不清的未知')).toBe('information-gap');
  });

  it('同输入两次推断一致（确定性）', () => {
    const label = '你能不能找到稳定协作的人';
    expect(inferUnknownKind(label)).toBe(inferUnknownKind(label));
  });
});

/**
 * 接线（P1-1）：会话有世界蓝图时，实验必须从 `keyUnknown` 推导；
 * 没有蓝图时旧模板行为零变化。
 */
describe('接线：有蓝图走未知驱动，无蓝图保留旧模板', () => {
  function blueprintWith(unknownVar: UnknownVariable): WorldBlueprint {
    return {
      version: 'world-blueprint-v1',
      sessionId: 'sess-1',
      problemFrame: frame(),
      centralTension: '想积累作品 vs 每周只有几小时',
      paths: [],
      keyUnknown: unknownVar,
      acts: [
        { act: 1, objective: 'enter-world', titleHint: '进入', conflict: 'c1', primaryPathIds: [], experienceFactIds: [], unlockIds: [] },
        { act: 2, objective: 'experience-cost', titleHint: '代价', conflict: 'c2', primaryPathIds: [], experienceFactIds: [], unlockIds: [] },
        { act: 3, objective: 'meet-counterexample', titleHint: '反例', conflict: 'c3', primaryPathIds: [], experienceFactIds: [], unlockIds: [] },
        { act: 4, objective: 'final-reflection', titleHint: '反思', conflict: 'c4', primaryPathIds: [], experienceFactIds: [], unlockIds: [] },
      ],
      experienceFacts: [],
      unlocks: [],
      forbiddenClaims: ['不得宣称成功概率'],
    };
  }

  const QUESTION = '大二数据科学，想参加比赛但怕影响课程';

  it('有蓝图 → 实验由 keyUnknown 决定（时间容量 → 七天记录）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const unknownVar = unknown({ kind: 'time-capacity' });

    const designed = designExperiment({ ...session, worldBlueprint: blueprintWith(unknownVar) });

    expect(designed.status).toBe('designing_experiment');
    expect(designed.experiment?.reducesUnknown).toBe(unknownVar.label);
    expect(designed.experiment?.action).toContain('7 天');
  });

  it('没有蓝图 → 沿用旧的问题类型模板（legacy 不回归）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const designed = designExperiment(session);

    expect(designed.experiment).not.toBeNull();
    expect(designed.experiment?.stopSignal).toContain('停下');
    // 旧模板不会出现「七天记录」这个只为时间容量设计的动作
    expect(designed.experiment?.action).not.toContain('连续 7 天记录真实投入');
  });
});

/**
 * P1-1 补充：时间容量实验的时间盒必须**看得见**用户自述的可用时间。
 *
 * 它和其他实验方向相反（不是花掉时间，而是量出真实容量），
 * 但如果不把自述时间写出来，用户会以为记录要占用他刚说的那 3 小时。
 */
describe('时间容量实验的时间盒', () => {
  it('用户说了可用时间 → 时间盒里写明它，并说清记录不占用', () => {
    const experiment = build('time-capacity', {
      context: context({ availableTime: '未来两周约 3 小时' }),
    });
    expect(experiment.timebox).toContain('3 小时');
    expect(experiment.timebox).toContain('不占用');
    // 仍然只要求每天两分钟的记录量
    expect(experiment.timebox).toContain('2 分钟');
  });

  it('用户没说可用时间 → 不编一个数字，只说明这是最小记录量', () => {
    const experiment = build('time-capacity', { context: context({ availableTime: undefined }) });
    expect(experiment.timebox).toContain('2 分钟');
    expect(experiment.timebox).not.toMatch(/约 \d+\s*小时/);
  });
});
