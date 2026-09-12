import { describe, expect, it, vi } from 'vitest';

import { adaptDifficulty, deterministicJitter, resolveCheckDifficulty } from '@/agents/difficultyAdapter';
import { curateTurn, pruneMemories, recallMemories, toMemoryPromptLines } from '@/agents/memoryCurator';
import { buildNarrativeContext, classifyIntent, orchestrateTurn } from '@/agents/orchestrator';
import { normalizePlotBrief, fallbackPlotBrief, stripFabricatedStats, directPlot } from '@/agents/plotDirector';
import { candidatesFor, createProviderRouter, type ProviderCredential } from '@/agents/providerRouter';
import { directStyle } from '@/agents/styleStylist';
import { clampCheckDifficulty, type NarrativeContext } from '@/agents/types';
import { advanceWorldWithChoiceTags, hiddenDeltaFor, hiddenDeltaForTags } from '@/core/run/scenarioAdapter';
import { createInitialWorld } from '@/core/run/worldState';

import type { DmModelClient } from '@/core/dm/provider';
import type { PerformanceProfile } from '@/agents/difficultyAdapter';

/**
 * AI 叙事引擎（W1）的验收：把 AI 从「文本生成器」变成「叙事引擎」，
 * 同时**保住确定性内核**——AI 决定故事是什么，数值永远由引擎裁决。
 *
 * 这些测试守的是四件事：
 * ① 难度只由对局历史算出（可解释、有界、确定）；
 * ② 模型无法通过任何字段改数值（白名单式规范化）；
 * ③ 主备失败一律降级，游戏永不卡住；
 * ④ 记忆真的会被叙事消费（MAG），且不含后台数字。
 */

const WORLD = {
  act: 2,
  totalActs: 4,
  sceneName: '图书馆',
  timeLabel: '23:40',
  stats: { san: 60, skill: 50, bond: 40 },
  signals: ['时间很紧'],
  relics: [{ name: '裂开的护身符', hook: '它在吸收周围的绝望' }],
};

const PLAYER = {
  originName: '文科刺客',
  goal: '双非本科怎么冲大厂实习',
  archetypes: ['孤注一掷型'],
  legacyWords: '别把心气耗光',
  totalRuns: 2,
};

function profile(overrides: Partial<PerformanceProfile> = {}): PerformanceProfile {
  return {
    act: 2,
    totalActs: 4,
    outcomes: [],
    equippedRelicCount: 0,
    strongRelicCount: 0,
    san: 60,
    realityAnchor: 1,
    seed: 'SEED-W1',
    ...overrides,
  };
}

function credential(name: string, model = `${name}-model`): ProviderCredential {
  return {
    name,
    apiKey: `placeholder-${name}-key`,
    baseUrl: 'https://example.com/v1',
    model,
    jsonMode: true,
    timeoutMs: 1000,
    temperature: 0.8,
    maxTokens: 800,
  };
}

function fakeClient(text: string, ok = true): DmModelClient {
  return { id: 'fake', complete: async () => (ok ? { ok: true, text } : { ok: false, code: 'http-500', message: 'boom' }) };
}

const VALID_BRIEF = {
  title: '时间不够用',
  scene: '自习室',
  dilemma: '你面前摊着两份东西，今天只够做一件。',
  choices: [
    { id: 'a', text: '先交作业', hint: '稳，但机会不等人', tags: { moral: 'neutral', efficiency: 'direct', social: 'neutral' } },
    { id: 'b', text: '赌一次机会', hint: '可能两头空', tags: { moral: 'neutral', efficiency: 'risky', social: 'neutral' }, check: { stat: 'skill', difficulty: 15 } },
    { id: 'c', text: '找人换班', hint: '要欠人情', tags: { moral: 'good', efficiency: 'indirect', social: 'ally' } },
  ],
  referencedKnowledgeIds: ['k1'],
  threadIds: [],
};

const NORMALIZE_CTX = {
  allowedKnowledgeIds: ['k1'],
  allowedThreadIds: [],
  adjustment: { offset: 0, reasons: [], variance: 0 },
};

describe('动态难度（规则可解释、结果有界）', () => {
  it('连续三次成功 +2；连续两次失败 −1', () => {
    const hot = adaptDifficulty(profile({ outcomes: ['success', 'success', 'success'] }));
    expect(hot.offset).toBe(2);
    expect(hot.reasons.some((r) => r.includes('连续 3 次成功'))).toBe(true);

    const cold = adaptDifficulty(profile({ outcomes: ['failure', 'failure'] }));
    expect(cold.offset).toBe(-1);
  });

  it('强力遗物最多 +2；终幕高潮 +3', () => {
    expect(adaptDifficulty(profile({ strongRelicCount: 5 })).offset).toBe(2);
    expect(adaptDifficulty(profile({ act: 4, totalActs: 4 })).offset).toBe(3);
    expect(adaptDifficulty(profile({ san: 20 })).reasons.join()).toContain('SAN 临界');
  });

  it('偏移被钳制在 −2..+5（不能把玩家逼到必败或送分）', () => {
    const extreme = adaptDifficulty(profile({ outcomes: ['success', 'success', 'success'], strongRelicCount: 3, act: 4, totalActs: 4 }));
    expect(extreme.offset).toBeLessThanOrEqual(5);
    expect(adaptDifficulty(profile({ outcomes: ['failure', 'failure'], san: 10 })).offset).toBeGreaterThanOrEqual(-2);
  });

  it('锚点低时波动增大，但抖动是确定性的', () => {
    const low = adaptDifficulty(profile({ realityAnchor: 0.1 }));
    expect(low.variance).toBe(1);
    expect(deterministicJitter('SEED-W1', 2)).toBe(deterministicJitter('SEED-W1', 2));
  });

  it('同一画像必得同一偏移', () => {
    const input = profile({ outcomes: ['success', 'failure', 'success'] });
    expect(adaptDifficulty(input).offset).toBe(adaptDifficulty(input).offset);
  });

  it('AI 的直觉难度会被钳制到 8..22', () => {
    expect(clampCheckDifficulty(99)).toBe(22);
    expect(clampCheckDifficulty(-5)).toBe(8);
    expect(resolveCheckDifficulty(15, { offset: 3, reasons: [], variance: 0 })).toBe(18);
  });
});

describe('Provider 智能路由（主备 + 退避 + 全失败可见）', () => {
  it('按角色顺序选主备，并自动跳过没配的 provider', () => {
    const available = [credential('openai'), credential('deepseek')];
    const picked = candidatesFor('plot-director', available);
    expect(picked.map((c) => c.name)).toEqual(['deepseek', 'openai']);
  });

  it('主 provider 失败时自动切备用，并记录两次尝试', async () => {
    const router = createProviderRouter({
      providers: [credential('deepseek'), credential('openai')],
      clientFactory: (c) => (c.name === 'deepseek' ? fakeClient('', false) : fakeClient(JSON.stringify(VALID_BRIEF))),
    });

    const result = await router.complete('plot-director', [{ role: 'user', content: 'x' }]);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it('全部失败时返回 ok:false 与全部尝试（上层据此降级）', async () => {
    const router = createProviderRouter({
      providers: [credential('deepseek'), credential('openai')],
      clientFactory: () => fakeClient('', false),
    });

    const result = await router.complete('plot-director', [{ role: 'user', content: 'x' }]);
    expect(result.ok).toBe(false);
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
    expect(result.attempts.every((a) => !a.ok)).toBe(true);
  });

  it('抛异常的 provider 也会被记为失败而不是冒泡', async () => {
    const router = createProviderRouter({
      providers: [credential('deepseek')],
      clientFactory: () => ({
        id: 'boom',
        complete: async () => {
          throw new Error('socket hang up');
        },
      }),
    });

    const result = await router.complete('plot-director', [{ role: 'user', content: 'x' }]);
    expect(result.ok).toBe(false);
    expect(result.attempts[0].code).toBe('exception');
  });
});

describe('记忆策展与 MAG 检索', () => {
  const curated = curateTurn({
    act: 2,
    totalActs: 4,
    choiceText: '通宵手撕项目',
    outcome: 'failure',
    sanDelta: -16,
    bondDelta: -4,
    droppedRelicName: null,
    title: '面试会议室',
  });

  it('按类型产出记忆（经历 / 经验 / 关系 / 体感）', () => {
    const kinds = new Set(curated.map((m) => m.kind));
    expect(kinds.has('episodic')).toBe(true);
    expect(kinds.has('procedural')).toBe(true);
    expect(kinds.has('relationship')).toBe(true);
    expect(kinds.has('semantic')).toBe(true);
  });

  it('同一回合重复策展得到同一批记忆（幂等，保证跨局连续不是幻觉）', () => {
    const again = curateTurn({
      act: 2, totalActs: 4, choiceText: '通宵手撕项目', outcome: 'failure', sanDelta: -16, bondDelta: -4, droppedRelicName: null, title: '面试会议室',
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(curated));
  });

  it('检索按目标相关度排序并限量', () => {
    const recalled = recallMemories(curated, { act: 2, goalText: '我想把项目做完去投递实习', limit: 2 });
    expect(recalled.length).toBe(2);
    expect(recalled[0].weight).toBeGreaterThanOrEqual(recalled[1].weight - 0.4);
  });

  it('注入 prompt 的行不含后台数字', () => {
    for (const line of toMemoryPromptLines(curated)) {
      expect(/%/.test(line)).toBe(false);
    }
  });

  it('记忆有上限（遗忘是有意的）', () => {
    const many = Array.from({ length: 260 }, (_, index) =>
      curateTurn({ act: (index % 4) + 1, totalActs: 4, choiceText: `选择${index}`, outcome: 'success', sanDelta: 0, bondDelta: 0, droppedRelicName: null, title: 't' })[0],
    );
    expect(pruneMemories(many, 50).length).toBe(50);
  });
});

describe('情节规范化的白名单（AI 改不了数值）', () => {
  it('缺核心字段 / 选项不足两个 → 拒绝', () => {
    expect(normalizePlotBrief({ title: 'x' }, NORMALIZE_CTX).ok).toBe(false);
    expect(normalizePlotBrief({ ...VALID_BRIEF, choices: [VALID_BRIEF.choices[0]] }, NORMALIZE_CTX).ok).toBe(false);
    expect(normalizePlotBrief(null, NORMALIZE_CTX).ok).toBe(false);
  });

  it('**模型写骰面/DC/胜负也会被丢弃**（结构性保证，不靠提示词）', () => {
    const sneaky = {
      ...VALID_BRIEF,
      dice: 20,
      outcome: 'success',
      statDeltas: { san: 100 },
      choices: VALID_BRIEF.choices.map((c) => ({ ...c, dice: 20, outcome: 'success' })),
    };

    const result = normalizePlotBrief(sneaky, NORMALIZE_CTX);
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.brief);
    expect(serialized).not.toContain('"dice"');
    expect(serialized).not.toContain('"outcome"');
    expect(serialized).not.toContain('statDeltas');
  });

  it('越界的知乎素材 id 被丢掉（不能凭空造来源）', () => {
    const result = normalizePlotBrief({ ...VALID_BRIEF, referencedKnowledgeIds: ['k1', 'invented'] }, NORMALIZE_CTX);
    expect(result.brief?.referencedKnowledgeIds).toEqual(['k1']);
    expect(result.issues).toContain('unknown-knowledge-id-dropped');
  });

  it('检定难度经过动态偏移后再钳制', () => {
    const result = normalizePlotBrief(VALID_BRIEF, {
      ...NORMALIZE_CTX,
      adjustment: { offset: 5, reasons: [], variance: 0 },
    });
    const check = result.brief?.choices.find((c) => c.check)?.check;
    expect(check?.difficulty).toBe(20);
  });

  it('未知 stat 的检定被丢弃，而选项保留', () => {
    const result = normalizePlotBrief(
      {
        ...VALID_BRIEF,
        choices: [{ ...VALID_BRIEF.choices[0] }, { ...VALID_BRIEF.choices[1], check: { stat: 'luck', difficulty: 12 } }, { ...VALID_BRIEF.choices[2] }],
      },
      NORMALIZE_CTX,
    );
    expect(result.brief?.choices.some((c) => c.check)).toBe(false);
    expect(result.issues).toContain('check-stat-unknown');
  });

  it('编造的百分比被改写并打标（项目纪律：允许改写，不许发布）', () => {
    const result = normalizePlotBrief(
      { ...VALID_BRIEF, dilemma: '有 87% 的人在这里放弃。' },
      NORMALIZE_CTX,
    );
    expect(result.brief?.dilemma).not.toMatch(/\d+\s*[%％]/);
    expect(result.issues.some((issue) => issue.startsWith('fabricated-stat-stripped'))).toBe(true);
  });

  it('stripFabricatedStats 只动数字说法', () => {
    expect(stripFabricatedStats('有 62% 的人会犹豫')).not.toContain('62%');
    expect(stripFabricatedStats('八成人都会')).toBe('八成人都会');
  });

  it('选项上限 4 个，超出截断并打标', () => {
    const many = {
      ...VALID_BRIEF,
      choices: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, text: `选项${id}`, hint: '代价', tags: {} })),
    };
    const result = normalizePlotBrief(many, NORMALIZE_CTX);
    expect(result.brief?.choices.length).toBe(4);
    expect(result.issues).toContain('choices-truncated');
  });

  it('tags 非法时退回中性，不抛异常', () => {
    const result = normalizePlotBrief(
      { ...VALID_BRIEF, choices: VALID_BRIEF.choices.map((c) => ({ ...c, tags: { moral: 'evil', efficiency: 42, social: null } })) },
      NORMALIZE_CTX,
    );
    expect(result.brief?.choices[0].tags).toEqual({ moral: 'neutral', efficiency: 'indirect', social: 'neutral' });
  });
});

describe('Plot Director 编排（含降级）', () => {
  const context: NarrativeContext = {
    intent: { kind: 'action' },
    world: WORLD,
    player: PLAYER,
    memories: [],
    knowledge: [{ id: 'k1', title: '转码要趁早', quote: '耗光心气比学不会更致命' }],
    difficultyOffset: 0,
    style: directStyle(WORLD, 2),
  };

  it('没有可用 provider → 用本地情节模板（source=fallback）', async () => {
    const output = await directPlot({ context, adjustment: { offset: 0, reasons: [], variance: 0 }, router: null });
    expect(output.source).toBe('fallback');
    expect(output.issue).toBe('no-provider');
    expect(output.brief.choices.length).toBeGreaterThanOrEqual(2);
  });

  it('模型正常 → source=model，并记录 provider / model / 耗时', async () => {
    const router = createProviderRouter({
      providers: [credential('deepseek')],
      clientFactory: () => fakeClient(JSON.stringify(VALID_BRIEF)),
    });
    const output = await directPlot({ context, adjustment: { offset: 0, reasons: [], variance: 0 }, router });

    expect(output.source).toBe('model');
    expect(output.provider).toBe('deepseek');
    expect(output.model).toBe('deepseek-model');
    expect(output.timings.some((t) => t.stage === 'plot-director')).toBe(true);
  });

  it('模型输出坏 JSON → 降级且带原因码', async () => {
    const router = createProviderRouter({
      providers: [credential('deepseek')],
      clientFactory: () => fakeClient('{ "title": '),
    });
    const output = await directPlot({ context, adjustment: { offset: 0, reasons: [], variance: 0 }, router });
    expect(output.source).toBe('fallback');
    expect(output.issue).toBe('not-an-object');
  });

  it('本地模板按幕次变化，且经过难度偏移', () => {
    const act3 = fallbackPlotBrief({ ...context, world: { ...WORLD, act: 3 }, difficultyOffset: 2 });
    const act1 = fallbackPlotBrief({ ...context, world: { ...WORLD, act: 1 }, difficultyOffset: 0 });
    expect(act3.title).not.toBe(act1.title);
    const checked = act3.choices.find((c) => c.check);
    expect(checked?.check?.difficulty).toBeGreaterThanOrEqual(8);
  });
});

describe('Orchestrator 组装', () => {
  const base = {
    intent: { kind: 'action' as const },
    world: WORLD,
    player: PLAYER,
    memories: curateTurn({ act: 1, totalActs: 4, choiceText: '先交作业', outcome: 'success', sanDelta: -4, bondDelta: 0, droppedRelicName: null, title: '第一幕' }),
    knowledge: [{ id: 'k1', title: 't', quote: 'q' }],
    profile: profile(),
    router: null,
  };

  it('上下文包含难度、风格与按相关度取到的记忆', () => {
    const context = buildNarrativeContext(base);
    expect(context.difficultyOffset).toBe(0);
    expect(context.style.tone).toBeDefined();
    expect(context.memories.length).toBeGreaterThan(0);
  });

  it('同一输入组装出同一上下文（可复盘）', () => {
    expect(JSON.stringify(buildNarrativeContext(base))).toBe(JSON.stringify(buildNarrativeContext(base)));
  });

  it('可用 provider 缺失时整条链路仍返回可用情节', async () => {
    const result = await orchestrateTurn(base);
    expect(result.source).toBe('fallback');
    expect(result.brief.choices.length).toBeGreaterThanOrEqual(2);
    expect(result.adjustment.offset).toBe(0);
  });

  it('意图分类：对话 / 探索 / 行动', () => {
    expect(classifyIntent('说吧').kind).toBe('dialogue');
    expect(classifyIntent('看看抽屉').kind).toBe('explore');
    expect(classifyIntent(null).kind).toBe('action');
    expect(classifyIntent('我推开门').kind).toBe('action');
  });
});

describe('选项语义驱动隐藏状态（AI 的决定真的改变机制）', () => {
  it('dark / direct / antagonize 各有代价', () => {
    expect(hiddenDeltaForTags({ moral: 'dark' }).socialDebt).toBe(8);
    expect(hiddenDeltaForTags({ efficiency: 'direct' }).bodyAlarm).toBe(6);
    expect(hiddenDeltaForTags({ social: 'antagonize' }).peerPressure).toBe(10);
  });

  it('未标 tags 时零增量（向后兼容，不送分）', () => {
    expect(hiddenDeltaForTags(undefined)).toEqual({});
  });

  it('与「风险/稳妥」规则叠加而非覆盖', () => {
    const world = createInitialWorld('SEED-W1', { san: 60, skill: 50, bond: 40 });
    const choice = { id: 'b', text: '赌一次', check: { targetStat: 'skill' as const, difficulty: 15 } };
    const outcome = { statDeltas: { san: -12 } };

    const withTags = advanceWorldWithChoiceTags(world, choice, 'failure', outcome, { efficiency: 'risky' });

    // 期望值从引擎自身推导，避免把"我以为的初始值"写进断言
    const base = hiddenDeltaFor(choice, 'failure', outcome);
    const tags = hiddenDeltaForTags({ efficiency: 'risky' });

    expect(withTags.hidden.bodyAlarm).toBe(
      Math.min(100, world.hidden.bodyAlarm + (base.bodyAlarm ?? 0) + (tags.bodyAlarm ?? 0)),
    );
    expect(withTags.hidden.peerPressure).toBe(
      Math.min(100, world.hidden.peerPressure + (base.peerPressure ?? 0) + (tags.peerPressure ?? 0)),
    );
    // 叠加的证据：tags 确实贡献了额外代价
    expect(tags.bodyAlarm).toBeGreaterThan(0);
    expect(withTags.hidden.bodyAlarm).toBeGreaterThan(
      Math.min(100, world.hidden.bodyAlarm + (base.bodyAlarm ?? 0)),
    );
  });

  it('确定性：同输入同结果', () => {
    const world = createInitialWorld('SEED-W1', { san: 60, skill: 50, bond: 40 });
    const run = () =>
      advanceWorldWithChoiceTags(world, { id: 'a', text: 'x' }, 'success', undefined, { moral: 'dark', social: 'ally' });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
