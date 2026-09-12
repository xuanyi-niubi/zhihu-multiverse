import { describe, expect, it } from 'vitest';

import {
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  SOURCE_LABELS,
  criticalNote,
  verdictLines,
} from '@/components/BossTerminal';
import { parseBossVerdict } from '@/core/bossClient';

import type { BossVerdictView } from '@/core/bossClient';

/**
 * 终局判卷的**可解释性**测试。
 *
 * 玩家会质疑「凭什么给我这个结局」，所以：
 * ① 分解必须把四维、属性、遗物、思路修正、骰面与 DC 全部摊开；
 * ② 必须标明这个分是谁给的（模型 / 本地规则 / 缓存）；
 * ③ 天然 1 与天然 20 要单独点出来（它们高于数值比较）；
 * ④ 不得泄露隐藏状态（那是后台数值，不该出现在终局文案里）。
 */

const VERDICT: BossVerdictView = {
  source: 'fallback',
  dimensions: { specificity: 2, evidenceUse: 0, feasibility: 2, selfAwareness: 2 },
  modifier: 3,
  feedback: '方案具体、有截止、也留了退路。',
  issues: ['没有用上本局给出的知乎片段'],
  dc: 14,
  dice: 16,
  total: 20,
  outcome: 'success',
  critical: 'none',
  baseModifier: 1,
  relicModifier: 2,
  bossModifier: 3,
  knowledgeModifier: 0,
  modelIssue: null,
};

describe('四维标签', () => {
  it('四维齐全且顺序固定', () => {
    expect(DIMENSION_ORDER).toEqual(['specificity', 'evidenceUse', 'feasibility', 'selfAwareness']);
    for (const key of DIMENSION_ORDER) {
      expect(DIMENSION_LABELS[key].length).toBeGreaterThan(1);
    }
  });

  it('判卷来源有中文标注（玩家有权知道分是谁给的）', () => {
    expect(SOURCE_LABELS.model).toContain('模型');
    expect(SOURCE_LABELS.fallback).toContain('本地');
    expect(SOURCE_LABELS.cached.length).toBeGreaterThan(1);
  });
});

describe('verdictLines（终局分解）', () => {
  it('四维逐项给出并带分母', () => {
    const lines = verdictLines(VERDICT).join('\n');

    expect(lines).toContain('具体性 2/2');
    expect(lines).toContain('证据利用 0/2');
    expect(lines).toContain('可执行性 2/2');
    expect(lines).toContain('自我认知 2/2');
  });

  it('结算公式完整：D20 + 属性 + 遗物 + 思路 = 总值 vs DC', () => {
    const lines = verdictLines(VERDICT).join('\n');

    expect(lines).toContain('D20 16');
    expect(lines).toContain('属性 +1');
    expect(lines).toContain('遗物 +2');
    expect(lines).toContain('思路 +3');
    expect(lines).toContain('= 20');
    expect(lines).toContain('DC 14');
  });

  it('标明判卷来源；模型异常时给出原因码', () => {
    expect(verdictLines(VERDICT).join('\n')).toContain('本地规则判卷');

    const withIssue = verdictLines({ ...VERDICT, source: 'model', modelIssue: 'invalid-json' }).join('\n');
    expect(withIssue).toContain('模型判卷');
    expect(withIssue).toContain('invalid-json');
  });

  it('没有遗物加成时说「无遗物加成」，不硬塞 0', () => {
    const lines = verdictLines({ ...VERDICT, relicModifier: 0 }).join('\n');
    expect(lines).toContain('无遗物加成');
  });

  it('**不泄露隐藏状态**（后台数值不进终局文案）', () => {
    const lines = verdictLines(VERDICT).join('\n');

    for (const secret of ['bodyAlarm', 'peerPressure', 'runway', 'mentorTrust', 'socialDebt']) {
      expect(lines).not.toContain(secret);
    }
  });
});

describe('criticalNote（天然 1 / 20 单独提示）', () => {
  it('天然 20 与天然 1 各有说明', () => {
    expect(criticalNote({ ...VERDICT, critical: 'critical-success' })).toContain('天然 20');
    expect(criticalNote({ ...VERDICT, critical: 'critical-failure' })).toContain('天然 1');
  });

  it('普通骰面不额外提示', () => {
    expect(criticalNote(VERDICT)).toBeNull();
  });
});

describe('parseBossVerdict（客户端形状校验）', () => {
  const valid = {
    ok: true,
    source: 'model',
    evaluation: {
      dimensions: { specificity: 2, evidenceUse: 1, feasibility: 2, selfAwareness: 0 },
      modifier: 4,
      feedback: '还行',
      issues: ['缺少退路'],
    },
    adjudication: {
      dc: 15,
      dice: 20,
      total: 25,
      outcome: 'success',
      critical: 'critical-success',
      baseModifier: 1,
      relicModifier: 0,
      bossModifier: 4,
    },
    modelIssue: null,
  };

  it('合法响应被完整映射', () => {
    const verdict = parseBossVerdict(valid);

    expect(verdict?.source).toBe('model');
    expect(verdict?.dimensions.evidenceUse).toBe(1);
    expect(verdict?.critical).toBe('critical-success');
    expect(verdict?.bossModifier).toBe(4);
  });

  it('未知的 source / critical 收敛到安全默认值', () => {
    const verdict = parseBossVerdict({
      ...valid,
      source: 'something-else',
      adjudication: { ...valid.adjudication, critical: 'weird' },
    });

    expect(verdict?.source).toBe('fallback');
    expect(verdict?.critical).toBe('none');
  });

  it('缺字段或非对象 → null（不猜）', () => {
    expect(parseBossVerdict(null)).toBeNull();
    expect(parseBossVerdict({ ok: true })).toBeNull();
    expect(parseBossVerdict({ ...valid, evaluation: undefined })).toBeNull();
    expect(parseBossVerdict({ ...valid, adjudication: undefined })).toBeNull();
  });

  it('数值缺失按 0 处理而不是 NaN', () => {
    const verdict = parseBossVerdict({
      ...valid,
      evaluation: { ...valid.evaluation, modifier: undefined },
      adjudication: { ...valid.adjudication, dc: undefined },
    });

    expect(verdict?.modifier).toBe(0);
    expect(verdict?.dc).toBe(0);
    expect(Number.isNaN(verdict?.modifier as number)).toBe(false);
  });
});
