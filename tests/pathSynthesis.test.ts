import { describe, expect, it } from 'vitest';

import { legacyExperiencePaths } from '@/features/experience/legacyAdapter';
import { buildExperienceCases } from '@/features/experience/cases';
import { synthesizeExperiencePaths } from '@/features/experience/pathSynthesis';

import type { ProviderRouter, RoutedResult } from '@/agents/providerRouter';
import type { ExperienceFact, ProblemFrame } from '@/features/experience/domain';

/**
 * 动态路径合成（Phase 8 / P0-E）。
 *
 * 核心承诺：**路径只能从真实片段里长出来**；
 * 模型只分组、不创作；验证不过宁可 fallback，不可编造。
 */

function fact(overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  return {
    id: 'fact:live:src-1:0',
    sourceId: 'live:src-1',
    sourceUrl: 'https://www.zhihu.com/question/9/answer/1',
    author: '某位走过这条路的人',
    exactQuote: '我当时大二，基础一般，报名参加了比赛，边做边学，最后拿了省二。',
    type: 'action',
    relevance: 0.6,
    purposes: [],
    ...overrides,
  };
}

/** legacy 聚类入口（与 service 层将来的接线一致）。 */
function legacyOf(facts: readonly ExperienceFact[]) {
  const cases = buildExperienceCases(facts);
  return ({ question }: { readonly question: string }) =>
    legacyExperiencePaths({
      question,
      facts,
      caseIdByFactId: new Map(facts.map((item) => [item.id, cases[0]?.id ?? 'case:none'])),
    });
}

const FRAME: ProblemFrame = {
  rawQuestion: '大二想参加比赛',
  currentSituation: '大二',
  desiredChange: '参加比赛',
  constraints: [],
  resources: [],
  concerns: [],
  centralTension: '',
  unknowns: [],
  parseConfidence: 0.4,
};

function routerOf(text: string, ok = true): ProviderRouter {
  const result: RoutedResult = { ok, text, provider: 'fake', model: 'fake', attempts: [] };
  return { providers: ['fake'], complete: async () => result };
}

/** 两条合法分组（引用真实 id）。 */
function validProposalPayload(caseId: string, factId: string): string {
  return JSON.stringify({
    paths: [
      {
        label: '直接报名，边做边学',
        summary: '先进队再补技术，靠比赛逼着成长。',
        supportingCaseIds: [caseId],
        opposingCaseIds: [],
        supportingFactIds: [factId],
        opposingFactIds: [],
        unknowns: [{ label: '你每周能稳定投入多少小时', whyItMatters: '它决定这条走法是否现实' }],
      },
      {
        label: '先做项目再报名',
        summary: '先把一个完整交付做出来，再决定上不上赛场。',
        supportingCaseIds: [caseId],
        opposingCaseIds: [],
        supportingFactIds: [factId],
        opposingFactIds: [],
        unknowns: [{ label: '你能不能坚持完整交付一个项目', whyItMatters: '它决定这条路走不走得到报名那天' }],
      },
    ],
  });
}

describe('model 主路径', () => {
  it('合法分组被采纳，引用的 id 全部真实存在', async () => {
    const facts = [fact()];
    const cases = buildExperienceCases(facts);
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases,
      facts,
      router: routerOf(validProposalPayload(cases[0]!.id, facts[0]!.id)),
    });
    expect(result.source).toBe('model');
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0]!.origin).toBe('model-clustered');
  });

  it('引用不存在的 id → 该条丢弃，回落 legacy', async () => {
    const facts = [fact()];
    const cases = buildExperienceCases(facts);
    const payload = JSON.stringify({
      paths: [
        {
          label: '编造的走法',
          summary: '引用了不存在的经历。',
          supportingCaseIds: ['case:live:ghost'],
          supportingFactIds: [],
          opposingCaseIds: [],
          opposingFactIds: [],
          unknowns: [{ label: '还不知道什么', whyItMatters: 'x' }],
        },
      ],
    });
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases,
      facts,
      router: routerOf(payload),
      legacyCluster: legacyOf(facts),
    });
    expect(result.source).toBe('legacy-fallback');
  });

  it('禁词（成功率/概率/匹配度…）→ 整条丢弃，回落 legacy', async () => {
    const facts = [fact()];
    const cases = buildExperienceCases(facts);
    const payload = JSON.stringify({
      paths: [
        {
          label: '直接报名',
          summary: '这样做的成功率比较高。',
          supportingCaseIds: [cases[0]!.id],
          supportingFactIds: [facts[0]!.id],
          opposingCaseIds: [],
          opposingFactIds: [],
          unknowns: [{ label: '未知', whyItMatters: 'x' }],
        },
      ],
    });
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases,
      facts,
      router: routerOf(payload),
      legacyCluster: legacyOf(facts),
    });
    expect(result.source).toBe('legacy-fallback');
  });

  it('没有反例 → 自动补「缺少反例」未知，不装作没有下行风险', async () => {
    const facts = [fact()];
    const cases = buildExperienceCases(facts);
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases,
      facts,
      router: routerOf(validProposalPayload(cases[0]!.id, facts[0]!.id)),
    });
    const labels = result.paths.flatMap((path) => path.unknowns.map((unknown) => unknown.label));
    expect(labels.some((label) => label.includes('没有找到') && label.includes('失败'))).toBe(true);
  });

  it('输出超长 label → 丢弃，回落 legacy', async () => {
    const facts = [fact()];
    const payload = JSON.stringify({
      paths: [
        {
          label: '这条路径的标签被模型写得实在太长太长太长了'.padEnd(31, '长'),
          summary: '正常摘要。',
          supportingCaseIds: [buildExperienceCases(facts)[0]!.id],
          supportingFactIds: [],
          opposingCaseIds: [],
          opposingFactIds: [],
          unknowns: [{ label: '未知', whyItMatters: 'x' }],
        },
      ],
    });
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases: buildExperienceCases(facts),
      facts,
      router: routerOf(payload),
      legacyCluster: legacyOf(facts),
    });
    expect(result.source).toBe('legacy-fallback');
  });
});

describe('fallback 纪律', () => {
  it('router 为 null → legacy 聚类仍然工作', async () => {
    const facts = [fact()];
    const cases = buildExperienceCases(facts);
    const result = await synthesizeExperiencePaths({
      frame: FRAME,
      cases,
      facts,
      router: null,
      legacyCluster: legacyOf(facts),
    });
    expect(result.source).toBe('legacy-fallback');
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths[0]!.origin).toBe('legacy-fallback');
  });

  it('legacy 也不可用（问题类型识别不了）→ insufficient，不编路径', async () => {
    const result = await synthesizeExperiencePaths({
      frame: { ...FRAME, rawQuestion: '今天天气不错' },
      cases: buildExperienceCases([fact()]),
      facts: [fact()],
      router: null,
      legacyCluster: () => [],
    });
    expect(result.source).toBe('insufficient');
    expect(result.paths).toHaveLength(0);
  });

  it('没有任何经历 → insufficient', async () => {
    const result = await synthesizeExperiencePaths({ frame: FRAME, cases: [], facts: [], router: routerOf('{}') });
    expect(result.source).toBe('insufficient');
  });
});
