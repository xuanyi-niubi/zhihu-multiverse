import { describe, expect, it } from 'vitest';

import {
  BOSS_MODIFIER_MAX,
  BOSS_MODIFIER_MIN,
  bossDimensionTotal,
  clampBossModifier,
  clampDimensionScore,
  parseBossEvaluation,
  parseRunManifest,
  toHiddenSignal,
} from '@/features/run/contracts';

/**
 * V3 契约层测试（P0）。
 *
 * 这一层不是玩法，是**边界**。要锁死的是三条：
 * ① 挑战 Manifest 被篡改时必须拒绝，而不是静默降级；
 * ② AI 给的分永远出不了 -3..+5，也永远不能引用不存在的来源；
 * ③ 隐藏状态只通过定性信号对外暴露。
 */

const VALID = {
  version: 3,
  runId: 'run-1',
  seed: 'SEED-2026-ABC',
  scenarioId: 'ai-dm',
  scenarioRevision: '1',
  eventPlanHash: 'a'.repeat(16),
  sourceSetHash: 'b'.repeat(40),
};

describe('parseRunManifest', () => {
  it('接受合法 Manifest', () => {
    const result = parseRunManifest(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.scenarioId).toBe('ai-dm');
      expect(result.manifest.challengeId).toBeUndefined();
    }
  });

  it('version 不是 3 就拒绝（避免老挑战被当成新协议解释）', () => {
    expect(parseRunManifest({ ...VALID, version: 2 })).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('哈希必须是十六进制且长度合法', () => {
    expect(parseRunManifest({ ...VALID, eventPlanHash: 'not-a-hash' }).ok).toBe(false);
    expect(parseRunManifest({ ...VALID, sourceSetHash: 'zz'.repeat(8) }).ok).toBe(false);
  });

  it('缺字段逐个报出可诊断的 reason', () => {
    for (const key of ['runId', 'seed', 'scenarioId', 'scenarioRevision'] as const) {
      const broken: Record<string, unknown> = { ...VALID };
      delete broken[key];

      const result = parseRunManifest(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(`invalid-${key}`);
      }
    }
  });

  it('非对象输入不抛异常', () => {
    expect(parseRunManifest(null).ok).toBe(false);
    expect(parseRunManifest('x').ok).toBe(false);
    expect(parseRunManifest([]).ok).toBe(false);
  });

  it('challengeId 可选，但给了就必须合法', () => {
    expect(parseRunManifest({ ...VALID, challengeId: 'c-1' }).ok).toBe(true);
    expect(parseRunManifest({ ...VALID, challengeId: '   ' }).ok).toBe(false);
  });
});

describe('AI 不得决定胜负', () => {
  it('思路修正永远落在 -3..+5', () => {
    expect(clampBossModifier(-999)).toBe(BOSS_MODIFIER_MIN);
    expect(clampBossModifier(999)).toBe(BOSS_MODIFIER_MAX);
    expect(clampBossModifier(0)).toBe(0);
    expect(clampBossModifier(Number.NaN)).toBe(0);
    expect(clampBossModifier('3')).toBe(0);
    expect(clampBossModifier(2.6)).toBe(3);
  });

  it('四维分数只允许 0/1/2', () => {
    expect(clampDimensionScore(-5)).toBe(0);
    expect(clampDimensionScore(9)).toBe(2);
    expect(clampDimensionScore(1.4)).toBe(1);
    expect(clampDimensionScore(undefined)).toBe(0);
  });

  it('parseBossEvaluation 接受缺失的 issues，并清洗越界值', () => {
    const result = parseBossEvaluation(
      { dimensions: { specificity: 5, evidenceUse: -1, feasibility: 2, selfAwareness: 1 }, modifier: 99, feedback: '还行' },
      ['s1'],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evaluation.modifier).toBe(BOSS_MODIFIER_MAX);
      expect(result.evaluation.dimensions.specificity).toBe(2);
      expect(result.evaluation.dimensions.evidenceUse).toBe(0);
      expect(result.evaluation.issues).toEqual([]);
      expect(bossDimensionTotal(result.evaluation)).toBe(5);
    }
  });

  it('引用白名单之外的来源会被丢弃（模型不能凭空造链接）', () => {
    const result = parseBossEvaluation(
      {
        dimensions: { specificity: 2, evidenceUse: 2, feasibility: 2, selfAwareness: 2 },
        modifier: 3,
        feedback: '引用得不错',
        citedSourceIds: ['s1', 's2', 'invented-source', 's1'],
      },
      ['s1', 's2'],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evaluation.citedSourceIds).toEqual(['s1', 's2', 's1']);
    }
  });

  it('反馈超长会截断到 80 字，且不会把非字符串塞进来', () => {
    const result = parseBossEvaluation(
      {
        dimensions: { specificity: 1, evidenceUse: 1, feasibility: 1, selfAwareness: 1 },
        modifier: 1,
        feedback: '很'.repeat(200),
        citedSourceIds: [1, null, 's1'],
      },
      ['s1'],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evaluation.feedback.length).toBe(80);
      expect(result.evaluation.citedSourceIds).toEqual(['s1']);
    }
  });

  it('缺 dimensions 视为不可用（交给本地降级判卷）', () => {
    expect(parseBossEvaluation({ modifier: 1 }, []).ok).toBe(false);
  });
});

describe('隐藏状态只通过信号暴露', () => {
  it('阈值边界稳定', () => {
    expect(toHiddenSignal(0)).toBe('calm');
    expect(toHiddenSignal(24)).toBe('calm');
    expect(toHiddenSignal(25)).toBe('watch');
    expect(toHiddenSignal(49)).toBe('watch');
    expect(toHiddenSignal(50)).toBe('alert');
    expect(toHiddenSignal(74)).toBe('alert');
    expect(toHiddenSignal(75)).toBe('critical');
    expect(toHiddenSignal(200)).toBe('critical');
  });
});
