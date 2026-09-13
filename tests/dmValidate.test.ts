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

  /**
   * §16 之后不再有「第 1 个必须无检定」这条位置规则：
   * 选项来自真实行动，能不能被分判成「稳/险」不由位置决定。
   */
  it('任意位置的选项都可以带 check（不再被位置剥离）', () => {
    const payload = basePayload();
    (payload.choices as Record<string, unknown>[])[0].check = {
      targetStat: 'skill',
      difficulty: 12,
    };

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[0].check).toBeDefined();
    expect(result.issues.some((issue) => issue.code === 'safe-has-check')).toBe(false);
  });

  it('没有 check 的选项就保持没有 check（不再自动补一个检定）', () => {
    const payload = basePayload();
    delete (payload.choices as Record<string, unknown>[])[1].check;

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[1].check).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === 'risk-missing-check')).toBe(false);
  });

  it('带 check 却没有失败分支 → 合成失败分支（机械保证，规则引擎不卡住）', () => {
    const payload = basePayload();
    delete (payload.choices as Record<string, unknown>[])[1].onFail;

    const result = expectOk(validateDmTurn(payload, CTX));

    expect(result.turn.choices[1].onFail).toBeDefined();
    expect(result.turn.choices[1].onFail?.statDeltas.san).toBeLessThan(0);
    expect(result.issues.some((issue) => issue.code === 'check-missing-fail')).toBe(true);
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

/**
 * P0-10：蓝图模式的引用必须**逐字**。
 *
 * legacy 模式允许模型从检索片段归纳改写；但本局世界蓝图里给出的
 * 真实经验是「证物」，引用时必须一字不差，且署名与链接必须同源。
 */
describe('P0-10：蓝图模式逐字引用强制', () => {
  const WORLD_CTX: DmValidateContext = {
    ...CTX,
    exactQuotes: [
      {
        quote: '我先做了一个 48 小时的小样，拿给队友看之后才决定要不要认真做。',
        author: '走过这条路的人',
        sourceUrl: 'https://www.zhihu.com/question/1/answer/1',
      },
      {
        quote: '我们组三个人最后都退赛了，课业压力比想象中大得多。',
        author: '中途退赛的学长',
        sourceUrl: 'https://www.zhihu.com/question/1/answer/2',
      },
    ],
  };

  function payloadWithQuote(quote: string, author = '某个人', sourceUrl = 'https://www.zhihu.com') {
    const payload = basePayload();
    payload.zhihuBullet = { author, quote, sourceUrl };
    return payload;
  }

  it('逐字命中 → 原样保留', () => {
    const verbatim = '我们组三个人最后都退赛了，课业压力比想象中大得多。';
    const result = expectOk(
      validateDmTurn(payloadWithQuote(verbatim, '中途退赛的学长', 'https://www.zhihu.com/question/1/answer/2'), WORLD_CTX),
    );
    expect(result.turn.zhihuBullet.quote).toBe(verbatim);
    expect(result.turn.zhihuBullet.author).toBe('中途退赛的学长');
    expect(result.issues.some((issue) => issue.code === 'quote-not-verbatim')).toBe(false);
  });

  it('改写过（意思相近但不等）→ 替换为最相关的真实片段，并记修复', () => {
    const result = expectOk(
      validateDmTurn(payloadWithQuote('我们组最后都退赛了，课业压力太大了。'), WORLD_CTX),
    );
    expect(result.turn.zhihuBullet.quote).toBe('我们组三个人最后都退赛了，课业压力比想象中大得多。');
    expect(result.turn.zhihuBullet.author).toBe('中途退赛的学长');
    expect(result.turn.zhihuBullet.sourceUrl).toBe('https://www.zhihu.com/question/1/answer/2');
    expect(result.issues.some((issue) => issue.code === 'quote-not-verbatim')).toBe(true);
  });

  it('**只修 quote 不修署名是不允许的**：逐字命中但署名不符 → 署名对齐', () => {
    const verbatim = '我先做了一个 48 小时的小样，拿给队友看之后才决定要不要认真做。';
    const result = expectOk(
      validateDmTurn(payloadWithQuote(verbatim, '随便编的答主', 'https://www.zhihu.com/question/9/answer/9'), WORLD_CTX),
    );
    expect(result.turn.zhihuBullet.author).toBe('走过这条路的人');
    expect(result.turn.zhihuBullet.sourceUrl).toBe('https://www.zhihu.com/question/1/answer/1');
    expect(result.issues.some((issue) => issue.code === 'author-mismatch-verbatim')).toBe(true);
  });

  it('超过 120 字的逐字原文不会被截断（截断即破坏逐字性）', () => {
    const longQuote =
      '我当时大二，基础一般，边上课边准备比赛，每周大概花十个小时，最后拿了省二；现在回头看，真正难的不是技术本身，而是在没有人给你反馈的那两个月里，你还能不能继续把手上这件小事做完；如果你也打算走这条路，先想清楚这一点，再决定要不要开始，别等到期中了才发现自己两头都没有抓住。';
    expect(longQuote.length).toBeGreaterThan(120);
    const ctx: DmValidateContext = {
      ...CTX,
      exactQuotes: [{ quote: longQuote, author: '长句答主', sourceUrl: 'https://www.zhihu.com/question/2/answer/2' }],
    };
    const result = expectOk(validateDmTurn(payloadWithQuote('随手写的一句话，明显不是原文引用。'), ctx));
    expect(result.turn.zhihuBullet.quote).toBe(longQuote);
  });

  it('legacy 模式（无 exactQuotes）行为不变：允许改写且照旧截断到 120', () => {
    const result = expectOk(validateDmTurn(payloadWithQuote('这是一句模型自己归纳的话，本来就没有原文。'), CTX));
    expect(result.turn.zhihuBullet.quote).toBe('这是一句模型自己归纳的话，本来就没有原文。');
    expect(result.issues.some((issue) => issue.code === 'quote-not-verbatim')).toBe(false);
  });
});
