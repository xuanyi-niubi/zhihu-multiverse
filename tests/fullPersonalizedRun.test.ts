import { describe, expect, it } from 'vitest';

import { extractProfile } from '@/core/dm/profile';
import { buildProblemFrame } from '@/features/experience/frame';
import { clarificationNeedsFor } from '@/features/experience/clarification';
import { buildSearchPlan } from '@/features/experience/queryPlan';
import { retrieveExperienceSources, type ExperienceSearch } from '@/features/experience/retrieve';
import { extractExperienceFacts } from '@/features/experience/extract';
import { buildExperienceCases } from '@/features/experience/cases';
import { synthesizeExperiencePaths } from '@/features/experience/pathSynthesis';
import { legacyExperiencePaths } from '@/features/experience/legacyAdapter';
import { compareUserToCase } from '@/features/experience/compare';
import { compileWorldBlueprint } from '@/features/game-world/compileWorld';
import { worldContextForTurn, unlockForTurn, type PlaySessionView } from '@/features/game-world/dmContext';
import { injectExperienceUnlock } from '@/features/game-world/experienceUnlock';
import { normalizeDmInput } from '@/core/dm/input';
import { formatDmUserMessage } from '@/core/dm/prompt';

import type { ExperienceFact, ProblemFrame } from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';
import type { ScenarioChoice } from '@/data/prebuiltScenarios';

/**
 * 全链路个性化推演（任务书 §29）—— **本产品的技术身份证**。
 *
 * 不碰真网络：搜索与模型全部注入 fake。它锁住的是新主链的完整形状：
 *
 * ```text
 * 陌生问题 → ProblemFrame → 0~2 澄清 → 三视角检索 → 逐字片段
 *   → 经历 → 动态路径 → 用户差异 → 世界蓝图 → 经验解锁
 *   → DM 上下文逐字引用 → 可注入解锁选项
 * ```
 *
 * 演示用的那句话就是这条链的验收输入（任务书 §36 / §51）。
 */

const QUESTION = '大二数据科学，基础一般，想参加比赛但怕影响课程';

/** 三组 fake verified 来源：相似 / 替代 / 反例，措辞对齐 legacy 路由词表。 */
const FAKE_SOURCES: Record<string, readonly KnowledgeSource[]> = {
  similar: [
    {
      id: 'live:sim-1',
      author: '拿过省二的人',
      quote: '我当时大二，基础一般，报名参加了比赛，边做边学，每周大概花十个小时，最后拿了省二。',
      upvotes: 421,
      url: 'https://www.zhihu.com/question/1/answer/11',
      retrievedAt: '2026-09-01T00:00:00.000Z',
      status: 'verified',
      editTime: 1756684800,
      authority: 3,
    },
  ],
  alternative: [
    {
      id: 'live:alt-1',
      author: '先做项目的人',
      quote: '我建议先做一个能交付的项目再决定报不报名，用工程实践打基础，而不是竞赛。',
      upvotes: 233,
      url: 'https://www.zhihu.com/question/1/answer/12',
      retrievedAt: '2026-09-01T00:00:00.000Z',
      status: 'verified',
      editTime: 1756684800,
      authority: 2,
    },
  ],
  counterexample: [
    {
      id: 'live:cx-1',
      author: '中途退出的人',
      quote: '我报名了但没时间，还挂科了，精力有限只能中途退出，现在挺后悔的。',
      upvotes: 98,
      url: 'https://www.zhihu.com/question/1/answer/13',
      retrievedAt: '2026-09-01T00:00:00.000Z',
      status: 'verified',
      editTime: 1756684800,
      authority: 2,
    },
  ],
};

const fakeSearch: ExperienceSearch = async (query) => {
  if (query.includes('经历')) return FAKE_SOURCES.similar!;
  if (query.includes('另一种选择')) return FAKE_SOURCES.alternative!;
  if (query.includes('失败') || query.includes('后悔')) return FAKE_SOURCES.counterexample!;
  return [];
};

/** 确定性整链，供多个用例复用。 */
async function runFullChain() {
  const profile = extractProfile(QUESTION);
  const frame: ProblemFrame = buildProblemFrame({ question: QUESTION, profile, analysis: null });

  const needs = clarificationNeedsFor(frame);
  const plan = buildSearchPlan({ frame });
  const retrieved = await retrieveExperienceSources({ plan, search: fakeSearch });
  const extracted = await extractExperienceFacts({
    sources: retrieved.sources.map((item) => item.source),
    question: QUESTION,
    router: null, // 零模型：fallback 提取，链路仍须完整
  });
  const facts: readonly ExperienceFact[] = extracted.facts;
  const cases = buildExperienceCases(facts);

  /**
   * 模拟澄清回答落地（与 applyDynamicClarification 同效）：
   * 用户补进的时间是硬条件 —— 它让 UserDifference 里出现 unknown。
   */
  const frameAfterClarify: ProblemFrame = {
    ...frame,
    constraints: [
      ...frame.constraints,
      { id: 'answered-availableTime', text: '每周 8 小时', origin: 'user-explicit' as const, hard: true },
    ],
  };

  const caseIdByFactId = new Map<string, string>();
  for (const experienceCase of cases) {
    for (const fact of [
      ...experienceCase.conditions,
      ...experienceCase.actions,
      ...experienceCase.costs,
      ...experienceCase.outcomes,
      ...experienceCase.reflections,
    ]) {
      caseIdByFactId.set(fact.id, experienceCase.id);
    }
  }

  const synthesized = await synthesizeExperiencePaths({
    frame: frameAfterClarify,
    cases,
    facts,
    router: null,
    legacyCluster: ({ question }) => legacyExperiencePaths({ question, facts, caseIdByFactId }),
  });

  const blueprint = compileWorldBlueprint({
    sessionId: 'sess-e2e-1',
    frame: frameAfterClarify,
    paths: synthesized.paths,
    facts,
  });

  return { frame, needs, plan, retrieved, facts, cases, synthesized, blueprint, profile };
}

describe('① 问题框定与澄清', () => {
  it('陌生问题得到 frame，澄清不超过 2 条', async () => {
    const { frame, needs } = await runFullChain();
    expect(frame.rawQuestion).toBe(QUESTION);
    expect(needs.length).toBeLessThanOrEqual(2);
    // 「怕影响课程」是用户原话 → 不得问停止信号
    expect(needs.find((need) => need.missingVariable === 'nonNegotiables')).toBeUndefined();
  });
});

describe('② 检索：三种强制视角都命中', () => {
  it('SearchPlan 有 similar / alternative / counterexample，且三路都有收获', async () => {
    const { plan, retrieved } = await runFullChain();
    const purposes = plan.queries.map((query) => query.purpose);
    expect(purposes).toContain('similar-person');
    expect(purposes).toContain('alternative');
    expect(purposes).toContain('counterexample');
    expect(retrieved.sources.length).toBeGreaterThanOrEqual(3);
  });
});

describe('③ 片段：全部逐字可回溯', () => {
  it('每条 ExperienceFact 的 exactQuote 都是来源原文的子串', async () => {
    const { facts } = await runFullChain();
    expect(facts.length).toBeGreaterThan(0);
    const sourceQuotes = new Map(
      Object.values(FAKE_SOURCES)
        .flat()
        .map((source) => [source.id, source.quote]),
    );
    for (const fact of facts) {
      expect(sourceQuotes.get(fact.sourceId)!.includes(fact.exactQuote)).toBe(true);
    }
  });
});

describe('④ 路径与差异', () => {
  it('至少 2 条路径；差异里包含 unknown（不能明确比较就明说）', async () => {
    const { cases, facts, synthesized, blueprint } = await runFullChain();
    // 零模型 fallback 下每条来源只有一条片段，能升级成「经历」的至少有一条
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(synthesized.paths.length).toBeGreaterThanOrEqual(2);

    // 差异对照（与 synthesize 内部 attachDifferencesToPaths 同一规则链）
    const primary = synthesized.paths[0]!;
    const caseById = new Map(cases.map((item) => [item.id, item]));
    const differences = primary.supportingCaseIds.flatMap((caseId) =>
      compareUserToCase({ frame: { ...blueprint.problemFrame }, experienceCase: caseById.get(caseId)! }),
    );
    expect(differences.some((difference) => difference.relation === 'unknown')).toBe(true);
    expect(JSON.stringify(differences)).not.toMatch(/%|成功率|匹配度|推荐/);
  });
});

describe('⑤ 世界蓝图：结构固定、解锁就绪', () => {
  it('四幕结构 + 反例幕 + keyUnknown + 至少一个经验解锁', async () => {
    const { blueprint } = await runFullChain();
    expect(blueprint.version).toBe('world-blueprint-v1');
    expect(blueprint.acts.map((act) => act.objective)).toEqual([
      'enter-world',
      'experience-cost',
      'meet-counterexample',
      'final-reflection',
    ]);
    expect(blueprint.acts[2]!.experienceFactIds.length).toBeGreaterThan(0);
    expect(blueprint.unlocks.length).toBeGreaterThan(0);
    expect(blueprint.experienceFacts.every((fact) => fact.exactQuote.length >= 12)).toBe(true);
  });
});

describe('⑥ DM 上下文与解锁选项', () => {
  it('第二幕的 worldContext 携带逐字原文，解锁可以插入一个新选项', async () => {
    const { blueprint, profile } = await runFullChain();

    // turnIndex=1（第二幕：体验代价）
    const context = worldContextForTurn(blueprint, 1);
    expect(context.actObjective).toBe('experience-cost');
    expect(context.sourceFacts.length).toBeGreaterThan(0);
    const allSourceQuotes = Object.values(FAKE_SOURCES).flat().map((source) => source.quote);
    for (const fact of context.sourceFacts) {
      expect(allSourceQuotes.some((quote) => quote.includes(fact.quote))).toBe(true);
    }

    // 注入后的 DM 输入里 prompt 携带逐字引用与解锁选项
    const unlock = unlockForTurn(blueprint, 1, []);
    const input = normalizeDmInput({
      goal: QUESTION,
      seed: 'SEED-2026-E2E',
      turnIndex: 2,
      totalTurns: 4,
      stats: { san: 80, skill: 20, bond: 15 },
      inventory: [],
      zhihuSnippets: [],
      history: [],
      personaTags: [],
      worldContext: context,
      ...(unlock ? { experienceUnlock: unlock } : {}),
    });
    const promptText = formatDmUserMessage(input);
    expect(promptText).toContain('【本局世界蓝图】');
    expect(promptText).toContain('【经验解锁的新选择');
    expect(promptText).toContain(unlock!.choiceText);

    // turnComposer 层：解锁选项能插入既有选项列表（P0-H 的机制承诺）
    const existing: ScenarioChoice[] = [
      {
        id: 'c0',
        text: '稳住课内，周末再推进比赛准备',
        hint: '稳妥',
        ghostEchoStat: '这一步是最常见的走法',
        onSuccess: { feedback: '节奏稳住了', statDeltas: { san: -2 } },
      },
      {
        id: 'c1',
        text: '全力投入比赛',
        hint: '有风险',
        ghostEchoStat: '这么走的人，多半吃过亏',
        check: { targetStat: 'skill', difficulty: 13 },
        onSuccess: { feedback: '拿名次了', statDeltas: { skill: 10 } },
        onFail: { feedback: '两头都没顾上', statDeltas: { san: -14 } },
      },
    ];
    const injected = injectExperienceUnlock({ choices: existing, unlock, act: 2 });
    expect(injected).toHaveLength(3);
    expect(injected[2]!.experienceUnlockId).toBeTruthy();
    expect(injected[2]!.check).toBeUndefined();

    // PlaySessionView：游戏端消费的最小视图形状成立
    const view: PlaySessionView = {
      id: 'sess-e2e-1',
      question: QUESTION,
      profile,
      profileAnalysis: null,
      worldBlueprint: blueprint,
    };
    expect(view.worldBlueprint.sessionId).toBe('sess-e2e-1');
  });
});

