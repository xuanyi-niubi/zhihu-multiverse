import { describe, expect, it } from 'vitest';

import { generateTurn } from '@/core/dm/generate';
import { getFallbackTurn } from '@/data/prebuiltScenarios';

import type { DmTurnInput } from '@/core/dm/prompt';
import type { DmModelClient, DmModelResult } from '@/core/dm/provider';

/**
 * 编排层测试：用假模型模拟模型的各种翻车方式，验证降级路径。
 *
 * 这是「100% 不崩」这条承诺的端到端证明——无论模型返回什么，
 * `generateTurn` 都必须给出一个合法关卡，而不是抛异常或返回 undefined。
 */

const INPUT: DmTurnInput = {
  goal: '农业工程跨界人形机器人',
  seed: 'SEED-2026-TEST',
  turnIndex: 2,
  totalTurns: 4,
  stats: { san: 72, skill: 40, bond: 22 },
  inventory: [],
  zhihuSnippets: [],
  history: [{ turnIndex: 1, choiceText: '按部就班刷题', outcome: 'san -8 / skill +8' }],
  personaTags: ['死磕型'],
};

const VALID_TURN = {
  turnIndex: 2,
  title: '农机实验室的深夜',
  storyText: '实验室的离心机还在响，你盯着屏幕上那台样机的关节参数，导师的消息停在对话框里没有回复。',
  zhihuBullet: {
    author: '匿名用户',
    quote: '跨界的价值不在于你会两件事，而在于你能把两件事接上。',
    sourceUrl: 'https://www.zhihu.com/question/293352359',
  },
  choices: [
    {
      id: 'a',
      text: '先把手头的样机调试完',
      hint: '稳妥：进度慢但不会翻车',
      ghostEchoStat: '先把手上的事做完，是常见选择',
      onSuccess: {
        feedback: '你把关节参数调回正常区间，样机第一次连续跑满了十分钟。',
        statDeltas: { san: -6, skill: 10 },
      },
    },
    {
      id: 'b',
      text: '连夜改方案，赌一次答辩',
      hint: '高危：需要专业力检定',
      ghostEchoStat: '连夜改方案的人不多',
      check: { targetStat: 'skill', difficulty: 14 },
      onSuccess: {
        feedback: '你把控制策略整个换掉，答辩时导师沉默了几秒，然后说这个思路可以。',
        statDeltas: { san: 8, skill: 18 },
      },
      onFail: {
        feedback: '新方案在答辩前两小时崩了，你只能拿着旧版本硬着头皮讲完。',
        statDeltas: { san: -20, skill: 3 },
      },
    },
  ],
};

/** 按调用顺序依次返回预设结果；超出后重复最后一个。 */
function mockClient(results: readonly DmModelResult[]): DmModelClient {
  let index = 0;
  return {
    id: 'mock',
    async complete() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result;
    },
  };
}

describe('generateTurn 降级链路', () => {
  it('标准 JSON 输出 → model', async () => {
    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: true, text: JSON.stringify(VALID_TURN) }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('model');
    expect(result.turn.title).toBe(VALID_TURN.title);
  });

  it('markdown 围栏输出 → model（解析层剥离）', async () => {
    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: true, text: `\`\`\`json\n${JSON.stringify(VALID_TURN)}\n\`\`\`` }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('model');
    expect(result.turn.choices).toHaveLength(2);
  });

  it('损坏 JSON（尾随逗号 + 全角标点）→ model（修复层救回）', async () => {
    const damaged = JSON.stringify(VALID_TURN).replace('"title":', '\uFF02title\uFF02\uFF1A').replace('}]}}', '},]}}');

    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: true, text: damaged }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('model');
  });

  it('首轮垃圾、修复轮合法 → model-repaired', async () => {
    const result = await generateTurn(INPUT, {
      client: mockClient([
        { ok: true, text: '抱歉，我无法完成这个请求。' },
        { ok: true, text: JSON.stringify(VALID_TURN) },
      ]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('model-repaired');
    expect(result.turn.title).toBe(VALID_TURN.title);
    expect(result.diagnostics.some((item) => item.stage === 'parse')).toBe(true);
  });

  it('两轮都是垃圾 → fallback，且返回离线剧本', async () => {
    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: true, text: '完全不是 JSON' }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('fallback');
    expect(result.turn).toEqual(getFallbackTurn(2));
    expect(result.diagnostics.some((item) => item.code === 'fallback-used')).toBe(true);
  });

  it('两轮校验都不通过 → fallback', async () => {
    const broken = JSON.stringify({ ...VALID_TURN, choices: [] });

    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: true, text: broken }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('fallback');
    expect(result.turn.choices.length).toBeGreaterThanOrEqual(2);
  });

  it('未配置模型 → fallback', async () => {
    const result = await generateTurn(INPUT, {
      client: null,
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('fallback');
    expect(result.diagnostics.some((item) => item.code === 'no-provider')).toBe(true);
  });

  it('provider 返回失败 → fallback', async () => {
    const result = await generateTurn(INPUT, {
      client: mockClient([{ ok: false, code: 'timeout-or-abort', message: '请求超时' }]),
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('fallback');
    expect(result.diagnostics.some((item) => item.code === 'timeout-or-abort')).toBe(true);
  });

  it('provider 直接抛异常也不会让 generateTurn 抛出', async () => {
    const throwingClient: DmModelClient = {
      id: 'throwing',
      async complete() {
        throw new Error('boom');
      },
    };

    const result = await generateTurn(INPUT, {
      client: throwingClient,
      fallback: (input) => getFallbackTurn(input.turnIndex),
    });

    expect(result.source).toBe('fallback');
    expect(result.diagnostics.some((item) => item.code === 'unexpected')).toBe(true);
  });

  it('兜底函数本身抛异常时仍有最小关卡', async () => {
    const result = await generateTurn(INPUT, {
      client: null,
      fallback: () => {
        throw new Error('fallback broken');
      },
    });

    expect(result.turn.choices).toHaveLength(2);
    expect(result.turn.choices[0].check).toBeUndefined();
    expect(result.turn.choices[1].check).toBeDefined();
  });
});
