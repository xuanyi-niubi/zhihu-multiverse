import type { ProviderRouter } from '@/agents/providerRouter';
import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';
import { attachDifferencesToPaths } from '@/features/experience/compare';
import { buildExperienceCases } from '@/features/experience/cases';

/**
 * 动态路径合成（Phase 8 / P0-E）。
 *
 * ## 它替代什么
 *
 * 旧主路径是 `decision-session/routes.ts` 的固定走法表：
 * 问题类型 → 三选一模板。它的标签永远属于模板，不属于用户的问题。
 *
 * ## 模型只有「分组权」
 *
 * 模型拿到的是**已经过逐字校验的片段与经历**，它只能做一件事：
 * 把它们**分组**成几条走法（引用 id，不创作内容）。
 * 每一条分组结果都过 validator：id 必须存在、禁词必须没有、
 * 反例缺失必须如实标注。验证不过 → 整条丢弃；剩下的不足 2 条
 * → 回落 legacy 聚类。**宁可少一条路径，不可多一句编造。**
 */

/** 模型输出里绝不允许出现的词（伪精确 / 替用户做决定的表达）。 */
const BANNED_WORDS: readonly string[] = ['成功率', '概率', '推荐指数', '推荐分', '匹配度', '至少需要'];

export const MAX_PATH_LABEL_LENGTH = 30;
export const MAX_PATH_SUMMARY_LENGTH = 120;
/** 合成结果下限：少于这个数就走 legacy fallback。 */
export const MIN_SYNTHESIZED_PATHS = 2;

interface ModelPathProposal {
  readonly label: string;
  readonly summary: string;
  readonly supportingCaseIds: readonly string[];
  readonly opposingCaseIds: readonly string[];
  readonly supportingFactIds: readonly string[];
  readonly opposingFactIds: readonly string[];
  readonly unknowns: readonly { readonly label: string; readonly whyItMatters: string }[];
}

export type PathSource = 'model' | 'legacy-fallback' | 'insufficient';

export interface SynthesizeExperiencePathsResult {
  readonly paths: readonly ExperiencePath[];
  readonly source: PathSource;
}

/* -------------------------------------------------------------------------- */
/* 片段 → 观察到的条件/行动/代价/结果（文本直接取自片段，不创作）                */
/* -------------------------------------------------------------------------- */

function observedOf(
  facts: readonly ExperienceFact[],
  factIds: readonly string[],
  type: ExperienceFact['type'],
  limit = 3,
): readonly string[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return factIds
    .map((id) => byId.get(id))
    .filter((fact): fact is ExperienceFact => fact !== undefined && fact.type === type)
    .map((fact) => fact.exactQuote)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* validator                                                                  */
/* -------------------------------------------------------------------------- */

function containsBannedWord(text: string): boolean {
  return BANNED_WORDS.some((word) => text.includes(word));
}

interface PathValidation {
  readonly ok: boolean;
  readonly reason?: string;
  readonly proposal?: ModelPathProposal;
}

/**
 * 校验一条模型分组提议。
 *
 * 六条规则缺一不可（任务书 §12.1）；禁词命中 → **整条丢弃**
 * （任务书明确：宁可整条 fallback，不要截句缝合）。
 */
function validateProposal(
  raw: unknown,
  context: { readonly caseIds: ReadonlySet<string>; readonly factIds: ReadonlySet<string> },
): PathValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'not-an-object' };
  }
  const record = raw as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  if (label.length === 0 || label.length > MAX_PATH_LABEL_LENGTH) {
    return { ok: false, reason: 'label-length' };
  }
  if (summary.length === 0 || summary.length > MAX_PATH_SUMMARY_LENGTH) {
    return { ok: false, reason: 'summary-length' };
  }
  if (containsBannedWord(label) || containsBannedWord(summary)) {
    return { ok: false, reason: 'banned-word' };
  }

  const stringList = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const supportingCaseIds = stringList(record.supportingCaseIds);
  if (supportingCaseIds.length === 0) {
    return { ok: false, reason: 'no-supporting-case' };
  }
  // 所有 id 必须真实存在 —— 引用不存在的证据 = 伪造
  const allReferenced = [
    ...supportingCaseIds,
    ...stringList(record.opposingCaseIds),
    ...stringList(record.supportingFactIds),
    ...stringList(record.opposingFactIds),
  ];
  for (const id of allReferenced) {
    if (!context.caseIds.has(id) && !context.factIds.has(id)) {
      return { ok: false, reason: `unknown-id:${id}` };
    }
  }

  const rawUnknowns = Array.isArray(record.unknowns) ? record.unknowns : [];
  const unknowns = rawUnknowns
    .filter((item): item is { label: string; whyItMatters: string } => {
      if (typeof item !== 'object' || item === null) return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.label === 'string' && entry.label.trim().length > 0;
    })
    .map((item) => ({
      label: item.label.trim(),
      whyItMatters: typeof item.whyItMatters === 'string' ? item.whyItMatters.trim() : '',
    }));

  const opposingCaseIds = stringList(record.opposingCaseIds);
  const opposingFactIds = stringList(record.opposingFactIds);

  let finalUnknowns = unknowns;
  if (opposingCaseIds.length === 0 && opposingFactIds.length === 0) {
    // 没有反例必须如实说出来，不许装作「这条路没有下行风险」
    finalUnknowns = [
      ...unknowns,
      {
        label: '目前没有找到走过这条路但后悔或失败的经历，它的下行风险仍是未知。',
        whyItMatters: '缺少反例的走法看起来总是美好的。',
      },
    ];
  }
  if (finalUnknowns.length === 0) {
    return { ok: false, reason: 'no-unknown' };
  }

  return {
    ok: true,
    proposal: {
      label,
      summary,
      supportingCaseIds,
      opposingCaseIds,
      supportingFactIds: stringList(record.supportingFactIds),
      opposingFactIds,
      unknowns: finalUnknowns,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 主函数                                                                     */
/* -------------------------------------------------------------------------- */

export interface SynthesizeExperiencePathsInput {
  readonly frame: ProblemFrame;
  readonly cases: readonly ExperienceCase[];
  readonly facts: readonly ExperienceFact[];
  readonly router: ProviderRouter | null;
  /** 旧聚类接口（fallback 用）；不传时 fallback 不可用。 */
  readonly legacyCluster?: (input: { readonly question: string }) => readonly ExperiencePath[];
}

/**
 * 由真实经历合成当前问题的走法。
 *
 * - 没有任何可用经历 → `insufficient`（零路径，诚实说没有）；
 * - 模型不可用或产出不足 → `legacy-fallback`（旧聚类仍在，不掉链子）；
 * - 模型产出经过全部校验 → `model`。
 */
export async function synthesizeExperiencePaths(
  input: SynthesizeExperiencePathsInput,
): Promise<SynthesizeExperiencePathsResult> {
  const facts = input.facts;
  const cases = input.cases.length > 0 ? input.cases : buildExperienceCases(facts);

  if (cases.length === 0) {
    return { paths: [], source: 'insufficient' };
  }

  const caseIds = new Set(cases.map((item) => item.id));
  const factIds = new Set(facts.map((item) => item.id));

  let modelPaths: readonly ExperiencePath[] = [];
  if (input.router) {
    modelPaths = await synthesizeWithModel({
      frame: input.frame,
      cases,
      facts,
      caseIds,
      factIds,
      router: input.router,
    });
  }

  if (modelPaths.length >= MIN_SYNTHESIZED_PATHS) {
    return {
      paths: attachDifferencesToPaths({ frame: input.frame, paths: modelPaths, cases }),
      source: 'model',
    };
  }

  if (input.legacyCluster) {
    const legacy = input.legacyCluster({ question: input.frame.rawQuestion });
    if (legacy.length > 0) {
      return {
        paths: attachDifferencesToPaths({ frame: input.frame, paths: legacy, cases }),
        source: 'legacy-fallback',
      };
    }
  }

  return { paths: modelPaths, source: modelPaths.length > 0 ? 'model' : 'insufficient' };
}

async function synthesizeWithModel(input: {
  readonly frame: ProblemFrame;
  readonly cases: readonly ExperienceCase[];
  readonly facts: readonly ExperienceFact[];
  readonly caseIds: ReadonlySet<string>;
  readonly factIds: ReadonlySet<string>;
  readonly router: ProviderRouter;
}): Promise<readonly ExperiencePath[]> {
  const system = `你是人生走法分组器。输入一个真实问题与若干段**已经核验过原文**的经历，输出 2～4 条当前问题真实存在的走法。

规则：
1. 只能引用输入里给出的 caseId / factId，不得发明 id；
2. label ≤ 30 字，summary ≤ 120 字；
3. 每条走法至少 1 个 supportingCaseId；
4. 每条走法至少 1 个 unknown（还不知道的信息）；没有反例要如实说明；
5. 禁止输出成功率、概率、推荐指数、匹配度、「至少需要」等表述；
6. 输出 JSON：{"paths":[{"label","summary","supportingCaseIds","opposingCaseIds","supportingFactIds","opposingFactIds","unknowns":[{"label","whyItMatters"}]}]}`;

  const user = JSON.stringify({
    question: input.frame.rawQuestion,
    desiredChange: input.frame.desiredChange,
    cases: input.cases.map((item) => ({
      caseId: item.id,
      conditions: item.conditions.map((fact) => fact.exactQuote),
      actions: item.actions.map((fact) => fact.exactQuote),
      costs: item.costs.map((fact) => fact.exactQuote),
      outcomes: item.outcomes.map((fact) => fact.exactQuote),
    })),
  });

  let routed;
  try {
    routed = await input.router.complete(
      'orchestrator',
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { jsonMode: true },
    );
  } catch {
    return [];
  }
  if (!routed.ok) {
    return [];
  }

  const parsed = parsePathsPayload(routed.text);
  const paths: ExperiencePath[] = [];
  let unknownSeq = 0;
  for (const raw of parsed) {
    const verdict = validateProposal(raw, { caseIds: input.caseIds, factIds: input.factIds });
    if (!verdict.ok || !verdict.proposal) {
      continue;
    }
    const proposal = verdict.proposal;
    const id = `path-model-${paths.length + 1}`;
    paths.push({
      id,
      label: proposal.label,
      summary: proposal.summary,
      supportingCaseIds: proposal.supportingCaseIds,
      opposingCaseIds: proposal.opposingCaseIds,
      supportingFactIds: proposal.supportingFactIds,
      opposingFactIds: proposal.opposingFactIds,
      observedConditions: observedOf(input.facts, proposal.supportingFactIds, 'condition'),
      observedActions: observedOf(input.facts, proposal.supportingFactIds, 'action'),
      observedCosts: observedOf(input.facts, [...proposal.supportingFactIds, ...proposal.opposingFactIds], 'cost'),
      observedOutcomes: observedOf(input.facts, proposal.supportingFactIds, 'outcome'),
      differencesFromUser: [],
      unknowns: proposal.unknowns.map((item) => {
        unknownSeq += 1;
        return {
          id: `${id}-unknown-${unknownSeq}`,
          label: item.label,
          whyItMatters: item.whyItMatters,
          origin: 'experience-disagreement',
          priority: 2,
        } satisfies UnknownVariable;
      }),
      origin: 'model-clustered',
    });
  }
  return paths;
}

/** 从模型文本里抠 `{"paths":[...]}`（容忍围栏与废话）。 */
function parsePathsPayload(text: string): readonly unknown[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { paths?: unknown };
    return Array.isArray(parsed.paths) ? parsed.paths : [];
  } catch {
    return [];
  }
}
