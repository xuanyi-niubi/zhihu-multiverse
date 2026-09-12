import { describe, expect, it } from 'vitest';

import { hasFabricatedStat, validateDmTurn, type DmValidateContext } from '@/core/dm/validate';
import { AI_DM_SCENARIO_ID, PREBUILT_SCENARIOS, getFallbackTurn } from '@/data/prebuiltScenarios';

/**
 * 「同路人氛围句」不得编造统计（P0）。
 *
 * 背景：这一格必须只给同路人回声，不能出现「62% 的同路人在这里妥协」这类数字 ——
 * 在真实聚合数据上线前，这些比例全是编的，属于对外宣称我们不拥有的能力。
 * 现在契约是：**任何数字或百分比都视为编造**，校验层会替换掉并留问题码，
 * 界面上这条也会带「剧本模拟」标记。
 */

const CTX: DmValidateContext = {
  turnIndex: 2,
  totalTurns: 4,
  goal: '双非本科怎么冲大厂实习',
  snippets: [],
};

/** 造一份最小可用的 DM 输出，两个选项的氛围句可分别指定（null = 缺字段）。 */
function payload(echoA: string | null, echoB: string | null): Record<string, unknown> {
  const choice = (id: string, echo: string | null, check?: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      id,
      text: id === 'a' ? '老老实实补一个完整项目' : '包装经历硬刚算法岗',
      hint: id === 'a' ? '稳妥：专业力稳步上升' : '高危：需要专业力检定',
      onSuccess: {
        feedback: '你把这段时间的取舍讲得很清楚，听的人能接住。',
        statDeltas: { skill: 10 },
      },
    };
    if (echo !== null) {
      base.ghostEchoStat = echo;
    }
    if (check) {
      base.check = check;
    }
    return base;
  };

  return {
    turnIndex: 2,
    title: '简历投出去的第 47 天',
    storyText: '邮箱里躺着几十封感谢投递，你盯着屏幕上那份单薄的简历，手指悬在编辑按钮上。',
    zhihuBullet: {
      author: '秋招上岸的学姐',
      quote: '简历不是把经历写得好看，是让面试官一眼看到你能解决什么问题。',
      sourceUrl: 'https://www.zhihu.com/question/293352359',
    },
    choices: [
      choice('a', echoA),
      choice('b', echoB, { targetStat: 'skill', difficulty: 14 }),
    ],
  };
}

const DIGITS = /[0-9０-９]|[%％]/;

describe('hasFabricatedStat', () => {
  it('识别阿拉伯数字与百分号', () => {
    expect(hasFabricatedStat('62% 的同路人在这里妥协')).toBe(true);
    expect(hasFabricatedStat('有 3 个人这么选')).toBe(true);
  });

  it('识别全角数字与全角百分号', () => {
    expect(hasFabricatedStat('６２％ 的人会犹豫')).toBe(true);
  });

  it('纯氛围文案不算编造', () => {
    expect(hasFabricatedStat('很多人在这一步都会犹豫')).toBe(false);
    expect(hasFabricatedStat('硬刚的人不多，但有人走通过')).toBe(false);
  });
});

describe('validateDmTurn 对编造统计的处理', () => {
  it('模型编了百分比：替换为无数字氛围句，并留下可统计的问题码', () => {
    const result = validateDmTurn(payload('62% 的同路人在这里妥协', '仅 18% 的人选择硬刚'), CTX);

    if (!result.ok) {
      throw new Error(`期望校验通过：${JSON.stringify(result.issues)}`);
    }

    for (const choice of result.turn.choices) {
      expect(DIGITS.test(choice.ghostEchoStat)).toBe(false);
    }
    expect(result.issues.some((issue) => issue.code === 'ghost-echo-fabricated-number')).toBe(true);
  });

  it('干净的氛围句原样保留，不产生编造问题码', () => {
    const echo = '很多人在这一步都会犹豫';
    const result = validateDmTurn(payload(echo, '硬刚的人不多'), CTX);

    if (!result.ok) {
      throw new Error(`期望校验通过：${JSON.stringify(result.issues)}`);
    }

    expect(result.turn.choices[0].ghostEchoStat).toBe(echo);
    expect(result.issues.some((issue) => issue.code === 'ghost-echo-fabricated-number')).toBe(false);
  });

  it('字段缺失时合成氛围句，同样不含数字', () => {
    const result = validateDmTurn(payload(null, null), CTX);

    if (!result.ok) {
      throw new Error(`期望校验通过：${JSON.stringify(result.issues)}`);
    }

    for (const choice of result.turn.choices) {
      expect(DIGITS.test(choice.ghostEchoStat)).toBe(false);
    }
    expect(result.issues.some((issue) => issue.code === 'ghost-echo-synthesized')).toBe(true);
  });

  it('任何被修过的氛围句都不带数字（一轮多形态输入）', () => {
    const inputs = ['99% 的人会这样', '１２％ 的人', '有 7 成人妥协', '两千人选了这条', ''];
    for (const echo of inputs) {
      const result = validateDmTurn(payload(echo, echo), CTX);
      if (!result.ok) {
        continue;
      }
      for (const choice of result.turn.choices) {
        expect(DIGITS.test(choice.ghostEchoStat)).toBe(false);
      }
    }
  });
});

describe('预置剧本数据不含编造统计（数据层回归）', () => {
  it('所有 prebuilt 选项的氛围句都没有数字或百分号', () => {
    const offenders: string[] = [];

    for (const scenario of PREBUILT_SCENARIOS) {
      for (const turn of scenario.turns) {
        for (const choice of turn.choices) {
          if (hasFabricatedStat(choice.ghostEchoStat)) {
            offenders.push(`${scenario.id} / ${choice.id}: ${choice.ghostEchoStat}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('兜底回合同样干净', () => {
    for (let index = 0; index < 6; index += 1) {
      expect(DIGITS.test(getFallbackTurn(index).choices[0].ghostEchoStat)).toBe(false);
    }
  });

  it('AI 剧本 id 常量未被改动（挑战链接依赖它）', () => {
    expect(AI_DM_SCENARIO_ID).toBe('ai-dm');
  });
});
