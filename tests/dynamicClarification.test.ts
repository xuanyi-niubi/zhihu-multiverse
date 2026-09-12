import { describe, expect, it } from 'vitest';

import {
  clarificationNeedsFor,
  MAX_CLARIFICATION_NEEDS,
} from '@/features/experience/clarification';
import { buildProblemFrame } from '@/features/experience/frame';
import { extractProfile } from '@/core/dm/profile';

import type { ProblemFrame, UnknownVariable } from '@/features/experience/domain';

/**
 * 动态澄清（Phase 3 / P0-B）。
 *
 * 这组测试守的最重要一条：
 *
 * > **用户已经说过 → 绝对不能重复问。**
 *
 * 旧实现固定问三件事，用户写了「怕影响课程」还是会被问「哪种损失你不愿意接受」。
 */

function frame(overrides: Partial<ProblemFrame> = {}): ProblemFrame {
  return {
    rawQuestion: '大二想参加比赛',
    currentSituation: '大二',
    desiredChange: '参加比赛',
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '',
    unknowns: [],
    parseConfidence: 0.3,
    ...overrides,
  };
}

function unknown(id: string, priority: 1 | 2 | 3 = 1): UnknownVariable {
  return { id, label: id, whyItMatters: '因为会改变结论', origin: 'missing-user-context', priority };
}

describe('问题数量：0 / 1 / 2，且绝不超过 2', () => {
  it('什么都不缺 → 0 个问题（**不问已经知道的**）', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '大二想参加比赛，每周能拿出 8 小时，怕影响课程', unknowns: [] }),
    );
    expect(needs).toHaveLength(0);
  });

  it('缺时间 + 确实是吃时间的事 → 1 个问题', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '大二想参加比赛', unknowns: [unknown('unknown-time')] }),
    );
    expect(needs).toHaveLength(1);
    expect(needs[0]?.missingVariable).toBe('availableTime');
  });

  it('缺时间 + 缺同伴 + 目标涉及组队 → 2 个问题', () => {
    const needs = clarificationNeedsFor(
      frame({
        rawQuestion: '想组队参加一个比赛',
        unknowns: [unknown('unknown-time', 1), unknown('unknown-resources', 2)],
      }),
    );
    expect(needs).toHaveLength(2);
  });

  it('**候选超过 2 个时只取优先级最高的两个**', () => {
    const needs = clarificationNeedsFor(
      frame({
        rawQuestion: '想裸辞创业，组队做一个项目',
        unknowns: [
          unknown('unknown-stop', 3),
          unknown('unknown-resources', 2),
          unknown('unknown-time', 1),
        ],
      }),
    );
    expect(needs).toHaveLength(MAX_CLARIFICATION_NEEDS);
    // 时间（priority 1）与同伴（priority 2）胜出，停止信号（3）被挤掉
    expect(needs.map((item) => item.missingVariable)).toEqual(['availableTime', 'existingResources']);
  });

  it('上限常量就是 2（界面与文档都引用它）', () => {
    expect(MAX_CLARIFICATION_NEEDS).toBe(2);
  });
});

describe('不重复问：用户说过的绝不问', () => {
  it('已经写了时间 → 不问时间（即使 unknowns 里残留）', () => {
    // frame 的 unknowns 由 frame.ts 生成；这里模拟「已经说过」= 没有该 unknown
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '大二想参加比赛，每周大概能拿出 8 小时', unknowns: [] }),
    );
    expect(needs.find((item) => item.missingVariable === 'availableTime')).toBeUndefined();
  });

  it('已经说了顾虑 → 不问停止信号', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '想裸辞创业，怕断了收入', unknowns: [] }),
    );
    expect(needs.find((item) => item.missingVariable === 'nonNegotiables')).toBeUndefined();
  });

  it('端到端：extractProfile 有资源信息时就不问同伴', () => {
    const question = '想组队参加比赛';
    const profile = extractProfile(question);
    const built = buildProblemFrame({ question, profile, analysis: null });
    const needs = clarificationNeedsFor(built);

    // 只要 frame 认为资源不缺（unknown-resources 不存在），就不该问同伴
    const hasResourceUnknown = built.unknowns.some((item) => item.id === 'unknown-resources');
    if (!hasResourceUnknown) {
      expect(needs.find((item) => item.missingVariable === 'existingResources')).toBeUndefined();
    }
  });
});

describe('该问才问：与结论无关的不问', () => {
  it('目标不吃时间（例如纯人际困扰）→ 不问时间', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '和室友关系不好', desiredChange: '想改善关系', unknowns: [unknown('unknown-time')] }),
    );
    expect(needs).toHaveLength(0);
  });

  it('目标不涉及合作 → 不问同伴', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '想考研', desiredChange: '考研上岸', unknowns: [unknown('unknown-resources')] }),
    );
    expect(needs).toHaveLength(0);
  });

  it('成本不高的尝试 → 不问停止信号', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '想参加一个校内的比赛', unknowns: [unknown('unknown-stop', 1)] }),
    );
    expect(needs).toHaveLength(0);
  });
});

describe('每个问题都必须能说清「它改变什么」', () => {
  it('全量检查：reason / missingVariable / answerType 都在合法集合里', () => {
    const needs = clarificationNeedsFor(
      frame({
        rawQuestion: '想裸辞创业，组队做一个项目',
        unknowns: [unknown('unknown-time', 1), unknown('unknown-resources', 2), unknown('unknown-stop', 3)],
      }),
    );

    const reasons = ['changes-retrieval', 'changes-world', 'changes-experiment'];
    const types = ['choice', 'number', 'short-text'];
    for (const need of needs) {
      expect(reasons).toContain(need.reason);
      expect(types).toContain(need.answerType);
      expect(need.missingVariable.length).toBeGreaterThan(0);
      expect(need.question.trim().length).toBeGreaterThan(0);
      expect(need.priority).toBeGreaterThan(0);
    }
  });

  it('选项题的每个选项都有 id / label / value', () => {
    const needs = clarificationNeedsFor(
      frame({ rawQuestion: '想参加比赛', unknowns: [unknown('unknown-time')] }),
    );
    for (const need of needs) {
      if (need.answerType !== 'choice') continue;
      expect(need.options && need.options.length > 0).toBe(true);
      for (const option of need.options ?? []) {
        expect(option.id.length).toBeGreaterThan(0);
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.value.length).toBeGreaterThan(0);
      }
    }
  });

  it('问题 id 唯一（答复才能按 id 落地）', () => {
    const needs = clarificationNeedsFor(
      frame({
        rawQuestion: '想裸辞创业，组队做一个项目',
        unknowns: [unknown('unknown-time', 1), unknown('unknown-resources', 2), unknown('unknown-stop', 3)],
      }),
    );
    const ids = needs.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('确定性：同一 frame 两次生成一致', () => {
    const built = frame({
      rawQuestion: '想裸辞创业，组队做一个项目',
      unknowns: [unknown('unknown-time', 1), unknown('unknown-resources', 2)],
    });
    expect(JSON.stringify(clarificationNeedsFor(built))).toBe(JSON.stringify(clarificationNeedsFor(built)));
  });
});
