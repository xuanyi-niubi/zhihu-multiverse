import { describe, expect, it } from 'vitest';

import { validateDmTurn, type DmValidateContext, type DmValidationResult } from '@/core/dm/validate';

import { RELIC_LIBRARY } from '@/data/prebuiltScenarios';

/**
 * 校验与修复层测试。
 *
 * 关注点是「越界/畸形输入被修成什么」，而不是「是否被拒绝」——
 * 这套校验器的设计目标就是尽量不拒绝，只在无法安全修复时才失败。
 */

const CTX: DmValidateContext = {
  turnIndex: 2,
  totalTurns: 4,
  goal: '双非本科怎么冲大厂实习',
  snippets: [],
};

function expectOk(result: DmValidationResult) {
  if (!result.ok) {
    throw new Error(`期望校验通过，实际失败：${JSON.stringify(result.issues, null, 2)}`);
  }
  return result;
}

function basePayload(): Record<string, unknown> {
  return {
    turnIndex: 2,
    title: '简历投出去的第 47 天',
    storyText: '邮箱里躺着 46 封感谢您的投递，你盯着屏幕上那份单薄的简历，手指悬在编辑按钮上。',
    zhihuBullet: {
      author: '秋招上岸的学姐',
      quote: '简历不是把经历写得好看，是让面试官一眼看到你能解决什么问题。',
      sourceUrl: 'https://www.zhihu.com/question/293352359',
    },
    choices: [
      {
        id: 'a',
        text: '老老实实补一个完整项目',
        hint: '稳妥：专业力稳步上升',
        ghostEchoStat: '先把项目补齐，再谈选择',
        onSuccess: {
          feedback: '你用两周写了一个带鉴权的短链服务，每一行你都能讲清楚。',
          statDeltas: { san: -6, skill: 12 },
        },
      },
      {
        id: 'b',
        text: '包装经历，硬刚大厂算法岗',
        hint: '高危：需要专业力检定',
        ghostEchoStat: '直接硬刚是少数派',
        check: { targetStat: 'skill', difficulty: 14 },
        onSuccess: {
          feedback: '你把文本检索讲成了信息检索问题，面试官眼睛亮了。',
          statDeltas: { san: 8, skill: 18 },
        },
        onFail: {
          feedback: '面试官追问了三个底层问题，你答得越来越小声。',
          statDeltas: { san: -22 },
        },
      },
    ],
  };
}

describe('validateDmTurn', () => {
  it('合法输出直接通过，且没有未修复的问题', () => {
    const result = expectOk(validateDmTurn(basePayload(), CTX));

    expect(result.turn.turnIndex).toBe(2);
    expect(result.turn.choices).toHaveLength(2);
    expect(result.turn.choices[0].check).toBeUndefined();
    expect(result.turn.choices[1].check).toBeDefined();
    expect(result.issues.filter((issue) => !issue.repaired)).toHaveLength(0);
  });

  it('DC 超出回合区间时收敛到区间内', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[1].check = {
      targetStat: 'skill',
      difficulty: 30,
    };

    const result = expectOk(validateDmTurn(payload, CTX));
    const difficulty = result.turn.choices[1].check?.difficulty ?? 0;

    expect(difficulty).toBeGreaterThanOrEqual(13);
    expect(difficulty).toBeLessThanOrEqual(15);
    expect(result.issues.some((issue) => issue.code === 'dc-out-of-band')).toBe(true);
  });

  it('属性增减被钳制到 ±40 并丢弃非法键', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[0].onSuccess = {
      feedback: '测试分支的反馈文案。',
      statDeltas: { san: -999, skill: 500, luck: 3 },
    };

    const result = expectOk(validateDmTurn(payload, CTX));
    const deltas = result.turn.choices[0].onSuccess.statDeltas;

    expect(deltas.san).toBe(-40);
    expect(deltas.skill).toBe(40);
    expect(Object.keys(deltas)).not.toContain('luck');
  });

  it('稳妥选项带 check 时移除', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[0].check = {
      targetStat: 'skill',
      difficulty: 12,
    };

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[0].check).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === 'safe-has-check')).toBe(true);
  });

  it('高风险选项缺 check 时按回合补齐', () => {
    const payload = basePayload();
    delete (payload.choices as Record<string, unknown>[])[1].check;

    const result = expectOk(validateDmTurn(payload, CTX));
    const check = result.turn.choices[1].check;

    expect(check).toBeDefined();
    expect(check?.difficulty).toBeGreaterThanOrEqual(13);
    expect(check?.difficulty).toBeLessThanOrEqual(15);
    expect(result.issues.some((issue) => issue.code === 'risk-missing-check')).toBe(true);
  });

  it('高风险选项缺 onFail 时合成失败分支', () => {
    const payload = basePayload();
    delete (payload.choices as Record<string, unknown>[])[1].onFail;

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[1].onFail).toBeDefined();
    expect(result.turn.choices[1].onFail?.statDeltas.san).toBeLessThan(0);
    expect(result.issues.some((issue) => issue.code === 'risk-missing-fail')).toBe(true);
  });

  it('未知 relicId 被丢弃', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[1].onSuccess = {
      feedback: '测试分支的反馈文案。',
      statDeltas: { san: 5 },
      relicId: 'relic-does-not-exist',
    };

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[1].onSuccess.relicId).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === 'unknown-relic')).toBe(true);
  });

  it('合法 relicId 被保留', () => {
    const validId = Object.keys(RELIC_LIBRARY)[0];
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[1].onSuccess = {
      feedback: '测试分支的反馈文案。',
      statDeltas: { san: 5 },
      relicId: validId,
    };

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[1].onSuccess.relicId).toBe(validId);
  });

  it('http 链接被替换为 https', () => {
    const payload = basePayload();
    (payload.zhihuBullet as Record<string, unknown>).sourceUrl = 'http://www.zhihu.com/question/1';

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.zhihuBullet.sourceUrl.startsWith('https://')).toBe(true);
    expect(result.issues.some((issue) => issue.code.startsWith('source-url-'))).toBe(true);
  });

  it('sourceUrl 非法时回退到检索片段链接', () => {
    const result = expectOk(
      validateDmTurn(basePayload(), {
        ...CTX,
        snippets: [
          {
            author: '答主',
            quote: '片段内容',
            sourceUrl: 'https://www.zhihu.com/question/999',
          },
        ],
      }),
    );

    const payload = basePayload();
    (payload.zhihuBullet as Record<string, unknown>).sourceUrl = 'not-a-url';
    const withBadUrl = expectOk(validateDmTurn(payload, {
      ...CTX,
      snippets: [{ author: '答主', quote: '片段内容', sourceUrl: 'https://www.zhihu.com/question/999' }],
    }));

    expect(result.turn.zhihuBullet.sourceUrl).toBe('https://www.zhihu.com/question/293352359');
    expect(withBadUrl.turn.zhihuBullet.sourceUrl).toBe('https://www.zhihu.com/question/999');
  });

  it('三个选项被保留（特殊事件允许多线）', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[]).push({
      id: 'c',
      text: '第三个选项',
      hint: '多线里的另一条路',
      ghostEchoStat: '几乎没人会这么选',
      onSuccess: { feedback: '第三条分支的反馈。', statDeltas: {} },
      check: { targetStat: 'bond', difficulty: 13 },
      onFail: { feedback: '第三条分支失败的反馈。', statDeltas: { san: -6 } },
    });

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices).toHaveLength(3);
    expect(result.turn.choices.map((choice) => choice.id)).toEqual(['a', 'b', 'c']);
    expect(result.issues.some((issue) => issue.code === 'too-many-choices')).toBe(false);
  });

  it('超过三个才截断，并记录修复', () => {
    const payload = basePayload();
    for (const id of ['c', 'd']) {
      (payload.choices as Record<string, unknown>[]).push({
        id,
        text: `选项${id}`,
        hint: '多余的',
        ghostEchoStat: '几乎没人会这么选',
        onSuccess: { feedback: '多余分支的反馈。', statDeltas: {} },
      });
    }

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices).toHaveLength(3);
    expect(result.issues.some((issue) => issue.code === 'too-many-choices')).toBe(true);
  });

  it('日常事件可以只有一个「推进」选项', () => {
    const payload = basePayload();
    payload.choices = [(payload.choices as Record<string, unknown>[])[0]];

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices).toHaveLength(1);
    expect(result.turn.choices[0].check).toBeUndefined();
  });

  it('turnIndex 以上下文为准', () => {
    const payload = basePayload();
    payload.turnIndex = 99;

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.turnIndex).toBe(2);
    expect(result.issues.some((issue) => issue.code === 'turn-index-mismatch')).toBe(true);
  });

  it('choices 为空时失败', () => {
    const payload = basePayload();
    payload.choices = [];

    const result = validateDmTurn(payload, CTX);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'empty-choices')).toBe(true);
  });

  it('两个选项都缺 onSuccess 时失败', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[]).forEach((choice) => {
      delete choice.onSuccess;
    });

    const result = validateDmTurn(payload, CTX);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'insufficient-valid-choices')).toBe(true);
  });

  it('非对象输入不抛异常并返回失败', () => {
    for (const value of [null, undefined, 42, 'x', []]) {
      expect(() => validateDmTurn(value, CTX)).not.toThrow();
      expect(validateDmTurn(value, CTX).ok).toBe(false);
    }
  });

  it('缺少 title/storyText 时补默认值而非失败', () => {
    const payload = basePayload();
    delete payload.title;
    delete payload.storyText;

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.title.length).toBeGreaterThan(0);
    expect(result.turn.storyText.length).toBeGreaterThan(0);
  });
});
