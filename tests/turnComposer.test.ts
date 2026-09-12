import { describe, expect, it } from 'vitest';

import { signalsFromStats, strongRelicCount, withDirectedPlot } from '@/agents/dmOrchestration';
import { magnitudeForAct, synthesizeOutcome } from '@/agents/outcomeSynthesizer';
import { composeTurn, plotAttribution, toScenarioChoices } from '@/agents/turnComposer';
import { createProviderRouter, type ProviderCredential } from '@/agents/providerRouter';

import type { DmTurnInput } from '@/core/dm/prompt';
import type { PlotBrief } from '@/agents/types';
import type { ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * W1b 接线层的验收：**AI 决定结构，引擎决定数值，没 key 时零回归**。
 *
 * 这三条任何一条破了，都会直接伤害产品：
 * ① AI 若能写数值 → 平衡性与"可复盘"同时崩；
 * ② 没配 key 时若换了结构 → 线上已有的剧本体验被偷偷改掉；
 * ③ 选项若没有结果契约 → 玩家点下去无事发生。
 */

const BRIEF: PlotBrief = {
  title: '时间不够用',
  scene: '自习室',
  dilemma: '你面前摊着两份东西，今天只够做一件。',
  choices: [
    { id: 'a', text: '先交作业', hint: '稳，但机会不等人', tags: { moral: 'neutral', efficiency: 'direct', social: 'neutral' } },
    { id: 'b', text: '赌一次', hint: '可能两头空', tags: { moral: 'neutral', efficiency: 'risky', social: 'neutral' }, check: { stat: 'skill', difficulty: 16, flavor: '赌输的代价立刻显形。' } },
    { id: 'c', text: '找人换班', hint: '要欠人情', tags: { moral: 'good', efficiency: 'indirect', social: 'ally' } },
  ],
  referencedKnowledgeIds: [],
  threadIds: [],
};

const BASE_TURN: ScenarioTurn = {
  turnIndex: 2,
  title: '文本层标题',
  storyText: '文本层正文。',
  zhihuBullet: { author: '答主', quote: '引文', sourceUrl: 'https://www.zhihu.com/question/1', status: 'scripted' },
  choices: [
    { id: 'a', text: '旧选项一', hint: 'h', ghostEchoStat: 'g', onSuccess: { feedback: 'f', statDeltas: { skill: 5 } } },
    { id: 'b', text: '旧选项二', hint: 'h', ghostEchoStat: 'g', onSuccess: { feedback: 'f', statDeltas: { skill: 5 } } },
  ],
};

function dmInput(overrides: Partial<DmTurnInput> = {}): DmTurnInput {
  return {
    goal: '双非本科怎么冲大厂实习',
    seed: 'SEED-W1B',
    turnIndex: 2,
    totalTurns: 4,
    stats: { san: 35, skill: 50, bond: 20 },
    inventory: [{ id: 'r1', name: '裂开的护身符', kind: 'active' }],
    zhihuSnippets: [{ author: '秋招上岸的学姐', quote: '简历是让面试官看到你能解决什么问题', sourceUrl: 'https://www.zhihu.com/question/1' }],
    history: [{ turnIndex: 1, choiceText: '先交作业', outcome: 'success' }],
    personaTags: ['稳妥派'],
    ...overrides,
  } as DmTurnInput;
}

function credential(): ProviderCredential {
  return {
    name: 'deepseek',
    apiKey: 'placeholder-key',
    baseUrl: 'https://example.com/v1',
    model: 'deepseek-chat',
    jsonMode: true,
    timeoutMs: 1000,
    temperature: 0.8,
    maxTokens: 800,
  };
}

describe('数值合成器（AI 提供意义，引擎提供数字）', () => {
  it('同幕同语义必得同一组数值（AI 无法靠措辞改平衡）', () => {
    const input = { tags: { efficiency: 'risky' as const }, hasCheck: true, act: 3, targetStat: 'skill' as const, hint: '赌一次' };
    expect(JSON.stringify(synthesizeOutcome(input))).toBe(JSON.stringify(synthesizeOutcome(input)));
  });

  it('失败比成功更疼（惩罚倍数生效）', () => {
    const { onSuccess, onFail } = synthesizeOutcome({ tags: {}, hasCheck: true, act: 2, targetStat: 'skill', hint: 'h' });
    expect(Math.abs(onFail.statDeltas.san ?? 0)).toBeGreaterThan(Math.abs(onSuccess.statDeltas.san ?? 0));
  });

  it('幕次越靠后量级越大', () => {
    expect(magnitudeForAct(4)).toBeGreaterThan(magnitudeForAct(1));
  });

  it('社交与道德语义反映到羁绊上', () => {
    const ally = synthesizeOutcome({ tags: { social: 'ally' }, hasCheck: false, act: 2, hint: 'h' });
    expect(ally.onSuccess.statDeltas.bond).toBeGreaterThan(0);

    const antagonize = synthesizeOutcome({ tags: { social: 'antagonize' }, hasCheck: false, act: 2, hint: 'h' });
    expect(antagonize.onFail.statDeltas.bond).toBeLessThan(0);
  });

  it('文案里的百分比被彻底去掉', () => {
    const { onSuccess } = synthesizeOutcome({ tags: {}, hasCheck: false, act: 2, hint: '有 87% 的人会放弃' });
    expect(onSuccess.feedback).not.toMatch(/\d+\s*[%％]/);
  });

  it('没有检定时也给出可用的结果契约', () => {
    const { onSuccess, onFail } = synthesizeOutcome({ tags: {}, hasCheck: false, act: 1, hint: '稳妥一步' });
    expect(Object.keys(onSuccess.statDeltas).length).toBeGreaterThan(0);
    expect(onFail.feedback.length).toBeGreaterThan(0);
  });
});

describe('Turn Composer（结构来自 AI，正文来自文本层）', () => {
  it('useBrief=false 时原样返回（无 key 零回归）', () => {
    const turn = composeTurn({ baseTurn: BASE_TURN, brief: BRIEF, act: 2, useBrief: false });
    expect(turn).toBe(BASE_TURN);
  });

  it('采用简报时：3 个选项、带语义标签、每个都有成败结果', () => {
    const turn = composeTurn({ baseTurn: BASE_TURN, brief: BRIEF, act: 2, useBrief: true });

    expect(turn.choices.length).toBe(3);
    expect(turn.choices.every((c) => c.tags)).toBe(true);
    expect(turn.choices.every((c) => c.onSuccess.statDeltas && c.onFail)).toBe(true);
    expect(turn.title).toBe(BRIEF.title);
    // 正文仍来自文本层
    expect(turn.storyText).toBe('文本层正文。');
    expect(turn.zhihuBullet.author).toBe('答主');
  });

  it('带检定的选项保留引擎钳制后的 DC', () => {
    const [choice] = toScenarioChoices(BRIEF, 2).filter((c) => c.check);
    expect(choice?.check?.difficulty).toBe(16);
  });

  it('选项不足两个时退回文本层选项（不能给玩家无法选择的回合）', () => {
    const thin: PlotBrief = { ...BRIEF, choices: [BRIEF.choices[0]] };
    const turn = composeTurn({ baseTurn: BASE_TURN, brief: thin, act: 2, useBrief: true });
    expect(turn).toBe(BASE_TURN);
  });

  it('同路人回声不含数字', () => {
    for (const choice of toScenarioChoices(BRIEF, 2)) {
      expect(/\d/.test(choice.ghostEchoStat)).toBe(false);
    }
  });

  it('来源标注如实反映是模型还是本地', () => {
    expect(plotAttribution('model', 'deepseek')).toContain('deepseek');
    expect(plotAttribution('fallback', null)).toContain('本地');
  });
});

describe('DM 接线（withDirectedPlot）', () => {
  it('没有 provider → plotSource=off，回合一字不改', async () => {
    const result = await withDirectedPlot({ turn: BASE_TURN, dmInput: dmInput(), router: null });
    expect(result.plotSource).toBe('off');
    expect(result.turn).toBe(BASE_TURN);
  });

  it('模型产出合法简报 → 采用 AI 结构（3 选项 + 标签）', async () => {
    const router = createProviderRouter({
      providers: [credential()],
      clientFactory: () => ({ id: 'fake', complete: async () => ({ ok: true, text: JSON.stringify(BRIEF) }) }),
    });

    const result = await withDirectedPlot({ turn: BASE_TURN, dmInput: dmInput(), router });
    expect(result.plotSource).toBe('model');
    expect(result.plotProvider).toBe('deepseek');
    expect(result.turn.choices.length).toBe(3);
    expect(result.turn.choices[0].tags).toBeDefined();
    expect(result.turn.storyText).toBe('文本层正文。');
  });

  it('模型失败 → plotSource=fallback，且**不**用本地短模板覆盖正文', async () => {
    const router = createProviderRouter({
      providers: [credential()],
      clientFactory: () => ({ id: 'boom', complete: async () => ({ ok: false, code: 'http-500', message: 'x' }) }),
    });

    const result = await withDirectedPlot({ turn: BASE_TURN, dmInput: dmInput(), router });
    expect(result.plotSource).toBe('fallback');
    expect(result.turn).toBe(BASE_TURN);
    expect(result.issue).toBe('http-500');
  });

  it('模型返回坏 JSON → 同样不覆盖正文', async () => {
    const router = createProviderRouter({
      providers: [credential()],
      clientFactory: () => ({ id: 'fake', complete: async () => ({ ok: true, text: 'not json' }) }),
    });

    const result = await withDirectedPlot({ turn: BASE_TURN, dmInput: dmInput(), router });
    expect(result.plotSource).toBe('fallback');
    expect(result.turn).toBe(BASE_TURN);
  });
});

describe('输入换算（服务端只有属性时的定性信号）', () => {
  it('临界状态与孤立处境会被表达出来', () => {
    expect(signalsFromStats({ san: 20, skill: 50, bond: 20 }).join()).toContain('临界');
    expect(signalsFromStats({ san: 80, skill: 70, bond: 60 }).join()).toContain('真本事');
  });

  it('强力遗物计数用于动态难度', () => {
    expect(strongRelicCount(dmInput())).toBe(1);
    expect(strongRelicCount(dmInput({ inventory: [] }))).toBe(0);
  });
});
