import { describe, expect, it } from 'vitest';

import { extractProfile, type PlayerProfile } from '@/core/dm/profile';
import { appearsExplicitly, buildProblemFrame } from '@/features/experience/frame';

/**
 * 问题框定（Phase 2 / P0-A）。
 *
 * 这组测试守的是整个 Experience Engine 的**第一道诚实性关卡**：
 *
 * > `PlayerProfile` 里混着「用户原话」与「解析推断」，
 * > 旧实现把两者一视同仁地喂给下游，于是系统的一点猜测
 * > 会变成后续所有推理的前提。
 *
 * 现在只有**在用户原话里逐字找得到**的陈述才是硬条件。
 */

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    background: '数据科学 大二学生',
    target: '参加一次比赛',
    constraints: [],
    fears: [],
    resources: [],
    keyTension: '想积累作品 vs 每周只有 8 小时',
    riskAppetite: 'medium',
    arc: [],
    ...overrides,
  };
}

const QUESTION = '大二数据科学，基础一般，想参加比赛但怕影响课程，每周大概能拿出 8 小时';

describe('逐字判定：只有原话里找得到的才是事实', () => {
  it('原话直接包含整句 → 命中', () => {
    expect(appearsExplicitly(QUESTION, '每周大概能拿出 8 小时')).toBe(true);
  });

  it('实词覆盖率足够 → 命中（用户用近义说法时）', () => {
    expect(appearsExplicitly(QUESTION, '想参加比赛')).toBe(true);
  });

  it('**原话没提过的说法 → 不命中**', () => {
    expect(appearsExplicitly(QUESTION, '家里希望我考公')).toBe(false);
    expect(appearsExplicitly(QUESTION, '风险偏好低')).toBe(false);
  });

  it('空输入不命中（保守）', () => {
    expect(appearsExplicitly('', '任何内容')).toBe(false);
    expect(appearsExplicitly(QUESTION, '')).toBe(false);
    expect(appearsExplicitly(QUESTION, '   ')).toBe(false);
  });

  it('纯虚词不命中（「的」「了」不该算信息）', () => {
    expect(appearsExplicitly(QUESTION, '的了是')).toBe(false);
  });
});

describe('必测 1｜用户明确写「每周 8 小时」→ 硬条件', () => {
  it('原话里写过的时间约束被标为 user-explicit + hard', () => {
    const frame = buildProblemFrame({
      question: QUESTION,
      profile: profile({ constraints: ['每周大概能拿出 8 小时'] }),
      analysis: null,
    });

    const hard = frame.constraints.filter((item) => item.hard);
    expect(hard.length).toBeGreaterThan(0);
    expect(hard[0]?.origin).toBe('user-explicit');
    expect(hard[0]?.text).toContain('8 小时');
  });
});

describe('必测 2｜解析推断「风险偏好低」→ 不得变成现实硬条件', () => {
  it('档案里的推断被标为 parser-synthesis + 非 hard', () => {
    const frame = buildProblemFrame({
      question: QUESTION,
      profile: profile({ constraints: ['风险偏好低，不适合豪赌'] }),
      analysis: null,
    });

    const inferred = frame.constraints.find((item) => item.text.includes('风险偏好'));
    expect(inferred).toBeDefined();
    expect(inferred?.hard).toBe(false);
    expect(inferred?.origin).toBe('parser-synthesis');
  });

  it('**恐惧一律不是硬条件**（连「我害怕」也不是可核对的现实条件）', () => {
    const frame = buildProblemFrame({
      question: QUESTION,
      profile: profile({ fears: ['怕影响课程', '怕白忙一场'] }),
      analysis: null,
    });

    for (const concern of frame.concerns) {
      expect(concern.hard).toBe(false);
    }
  });
});

describe('必测 3｜用户没说家庭压力 → 不得标成 hard', () => {
  it('原话与档案都没提家庭时，frame 里不存在硬性的家庭约束', () => {
    const frame = buildProblemFrame({
      question: QUESTION,
      profile: profile({ constraints: ['家里希望我考公'] }),
      analysis: null,
    });

    const family = frame.constraints.find((item) => item.text.includes('家里'));
    expect(family).toBeDefined();
    // 用户没说过 → 只能是解析推断，不能当事实
    expect(family?.hard).toBe(false);
    expect(frame.constraints.filter((item) => item.text.includes('家里') && item.hard)).toHaveLength(0);
  });
});

describe('必测 4｜同一句 goal + 不同 profile → frame 可以不同', () => {
  it('档案不同则框定不同（框定确实消费了档案）', () => {
    const a = buildProblemFrame({
      question: QUESTION,
      profile: profile({ keyTension: '想积累作品 vs 每周只有 8 小时' }),
      analysis: null,
    });
    const b = buildProblemFrame({
      question: QUESTION,
      profile: profile({ keyTension: '想赢一次 vs 基础太差', resources: ['有一个现成队友'] }),
      analysis: null,
    });

    expect(a.centralTension).not.toBe(b.centralTension);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('同一份输入必得同一份 frame（纯函数，可复现）', () => {
    const input = { question: QUESTION, profile: profile(), analysis: '分析' };
    expect(JSON.stringify(buildProblemFrame(input))).toBe(JSON.stringify(buildProblemFrame(input)));
  });
});

describe('必测 5｜parseConfidence 只能落在 0..1', () => {
  it('各种输入都钳在区间内', () => {
    const cases: PlayerProfile[] = [
      profile(),
      profile({ constraints: ['a', 'b', 'c', 'd'], resources: ['x', 'y', 'z'], fears: ['f'] }),
      profile({ keyTension: '', target: '', background: '' }),
    ];
    for (const item of cases) {
      const frame = buildProblemFrame({ question: QUESTION, profile: item, analysis: null });
      expect(frame.parseConfidence).toBeGreaterThanOrEqual(0);
      expect(frame.parseConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('空问题也不会越界（保守取低分）', () => {
    const frame = buildProblemFrame({ question: '', profile: profile(), analysis: null });
    expect(frame.parseConfidence).toBeGreaterThanOrEqual(0);
    expect(frame.parseConfidence).toBeLessThanOrEqual(1);
  });

  it('**它只表示解析完整度，字段名里不能出现概率/匹配语义**', () => {
    const frame = buildProblemFrame({ question: QUESTION, profile: profile(), analysis: null });
    // 类型层面已限定，这里再确认它不是「成功概率」的替身：
    // 信息更完整时分数上升，与「这条路行不行」无关
    const sparse = buildProblemFrame({ question: QUESTION, profile: profile({ keyTension: '', target: '' }), analysis: null });
    const rich = buildProblemFrame({
      question: QUESTION,
      profile: profile({ constraints: ['每周大概能拿出 8 小时', '基础一般'], resources: ['自学过 Python'] }),
      analysis: '他在权衡时间与产出。',
    });
    expect(rich.parseConfidence).toBeGreaterThanOrEqual(sparse.parseConfidence);
  });
});

describe('未知变量：缺什么就说什么', () => {
  it('原话没提时间 → 生成「能拿出多少时间」的未知，且优先级最高', () => {
    const frame = buildProblemFrame({
      question: '大二想参加比赛',
      profile: profile(),
      analysis: null,
    });
    const time = frame.unknowns.find((item) => item.id === 'unknown-time');
    expect(time).toBeDefined();
    expect(time?.priority).toBe(1);
    expect(time?.origin).toBe('missing-user-context');
  });

  it('原话提了时间 → 不生成该未知（不重复问已经知道的）', () => {
    const frame = buildProblemFrame({ question: QUESTION, profile: profile(), analysis: null });
    expect(frame.unknowns.find((item) => item.id === 'unknown-time')).toBeUndefined();
  });

  it('档案没有资源信息 → 记为 evidence-gap（缺的是证据，不是用户表述）', () => {
    const frame = buildProblemFrame({
      question: QUESTION,
      profile: profile({ resources: [] }),
      analysis: null,
    });
    const resources = frame.unknowns.find((item) => item.id === 'unknown-resources');
    expect(resources?.origin).toBe('evidence-gap');
  });
});

describe('与现有档案管线对接（复用而不另造）', () => {
  it('deterministic extractProfile 的结果能直接喂给 buildProblemFrame', () => {
    const extracted = extractProfile(QUESTION);
    const frame = buildProblemFrame({ question: QUESTION, profile: extracted, analysis: null });

    expect(frame.rawQuestion).toBe(QUESTION);
    expect(frame.currentSituation.length).toBeGreaterThan(0);
    expect(frame.desiredChange.length).toBeGreaterThan(0);
    // 硬条件必须能在原话里找到 —— 这是本阶段的核心不变量
    for (const item of frame.constraints.filter((entry) => entry.hard)) {
      expect(appearsExplicitly(QUESTION, item.text)).toBe(true);
    }
  });
});
