import { factTypeOf, relevanceOf } from '@/features/decision-session/facts';
import type { ProviderRouter } from '@/agents/providerRouter';
import type { AgentRole } from '@/agents/types';
import type {
  ExperienceFact,
  ExperienceFactType,
  RetrievedExperienceSource,
  SearchPurpose,
} from '@/features/experience/domain';
import { MAX_EXPERIENCE_SOURCES } from '@/features/experience/retrieve';
import {
  MAX_FACTS_PER_SOURCE,
  MAX_TOTAL_FACTS,
  validateExtractedFact,
} from '@/features/experience/validate';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 经验片段提取（Phase 6 / P0-D）。
 *
 * ## 两条路径，永远至少有一条能走
 *
 * - **无模型**：整段原文就是一条片段（复用现有 `factTypeOf` 判型）。
 *   零模型也能工作 —— 这是降级链的最后一环，不能断；
 * - **有模型**：模型只拥有**提议权**（提出「哪句是原文 + 它是什么类型」），
 *   每一条提议都过 `validateExtractedFact` 逐字校验。
 *
 * ## 模型路径的一次调用
 *
 * 所有来源打包进**一次**模型请求（比赛演示等不起 12 次串行调用）。
 * 响应格式：`{ "facts": [{ "sourceId", "exactQuote", "type" }] }`。
 * 解析失败 / 返回烂 JSON → 整体回落 fallback，**绝不部分采信**。
 */

/** 提取层进入的来源上限（与检索层封顶一致）。 */
export const MAX_EXTRACT_SOURCES = MAX_EXPERIENCE_SOURCES;

const EXTRACTION_ROLE: AgentRole = 'world-simulator';

const EXTRACTION_SYSTEM_PROMPT = `你是经历片段提取器。输入若干条知乎回答原文，输出其中真实的经验片段。

规则：
1. exactQuote 必须逐字复制输入原文，不得改写、缩写、翻译或修正标点；
2. 每条 12～160 字；
3. 每条来源最多 5 条；
4. 只提取五类：condition（处境条件）/ action（做了什么）/ cost（代价）/ outcome（结果）/ reflection（反思）；
5. 输出 JSON：{"facts":[{"sourceId":"...","exactQuote":"...","type":"condition"}]}；
6. 没有值得提取的内容就输出 {"facts":[]}。`;

/* -------------------------------------------------------------------------- */
/* fallback：无模型路径                                                        */
/* -------------------------------------------------------------------------- */

/** EvidenceFact 的 FactType → 经验片段类型（opinion 归入 reflection）。 */
function mapFactType(type: ReturnType<typeof factTypeOf>): ExperienceFactType {
  return type === 'opinion' ? 'reflection' : type;
}

/**
 * 无模型路径：整段原文就是一条片段。
 *
 * 复用现有 `factTypeOf` / `relevanceOf`，不复制第二套判型逻辑。
 */
export function fallbackFactsFor(input: {
  readonly source: KnowledgeSource;
  readonly question: string;
  readonly purposes?: readonly SearchPurpose[];
  readonly index?: number;
}): readonly ExperienceFact[] {
  const fact = validateExtractedFact({
    source: input.source,
    exactQuote: input.source.quote,
    type: mapFactType(factTypeOf(input.source.quote)),
    id: `fact:${input.source.id}:${input.index ?? 0}`,
    relevance: relevanceOf(input.question, input.source.quote),
    purposes: input.purposes ?? [],
  });
  return fact ? [fact] : [];
}

/* -------------------------------------------------------------------------- */
/* model 路径                                                                 */
/* -------------------------------------------------------------------------- */

/** 模型对一条片段的提议（只有提议权）。 */
interface ProposedFact {
  readonly sourceId: string;
  readonly exactQuote: string;
  readonly type: ExperienceFactType;
}

interface SourceBundle {
  readonly source: KnowledgeSource;
  readonly purposes: readonly SearchPurpose[];
}

function sourceIndex(sources: readonly KnowledgeSource[]): Map<string, KnowledgeSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

/** 从模型文本里抠 JSON（容忍 ```json 围栏与前后废话）。 */
function parseProposals(text: string): readonly ProposedFact[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) {
      return [];
    }
    const proposals: ProposedFact[] = [];
    for (const item of parsed.facts) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const sourceId = typeof record.sourceId === 'string' ? record.sourceId : '';
      const exactQuote = typeof record.exactQuote === 'string' ? record.exactQuote : '';
      const type = record.type;
      if (!sourceId || !exactQuote || typeof type !== 'string') {
        continue;
      }
      if (!['condition', 'action', 'cost', 'outcome', 'reflection'].includes(type)) {
        continue;
      }
      proposals.push({ sourceId, exactQuote, type: type as ExperienceFactType });
    }
    return proposals;
  } catch {
    return [];
  }
}

export interface ExtractExperienceFactsInput {
  /**
   * 来源。两种写法都接受：
   *
   * - `RetrievedExperienceSource`（**新主链走这条**）：每条来源自带
   *   `purposes` —— 检索阶段已经知道「这条是作为相似经历、替代走法还是
   *   反例被找来的」，这份意图必须一路传到片段上；
   * - 裸 `KnowledgeSource` + 全局 `purposes`（旧写法，测试与兼容路径用）。
   *
   * ## 为什么必须区分
   *
   * 早先的实现把「全局所有意图」赋给每一条片段，于是每条片段都声称自己
   * 同时是相似经历、替代走法和反例 —— 意图信息被抹平，第三幕就没法
   * 优先去挑真正来自反例检索的片段（P0-7）。
   */
  readonly sources: readonly ExtractSourceInput[];
  readonly question: string;
  /** 旧写法下的全局意图。新写法请让每条来源自带 `purposes`。 */
  readonly purposes?: readonly SearchPurpose[];
  /** 模型路由；null = 无模型，走 fallback。 */
  readonly router: ProviderRouter | null;
}

/**
 * 提取层来源入参。
 *
 * `RetrievedExperienceSource` 带 `source` 字段，`KnowledgeSource` 没有 ——
 * 这就是两者在运行时可区分的地方。
 */
export type ExtractSourceInput = KnowledgeSource | RetrievedExperienceSource;

function isRetrievedSource(item: ExtractSourceInput): item is RetrievedExperienceSource {
  const candidate = (item as { source?: unknown }).source;
  return typeof candidate === 'object' && candidate !== null;
}

/**
 * 把两种来源写法归一成「来源 + 它自己的意图」。
 *
 * 裸来源（旧写法）只能拿到全局 `purposes`；带意图的来源用自己的，
 * **绝不合并全局并集** —— 合并就等于把意图抹平。
 */
function bundlesOf(input: ExtractExperienceFactsInput): readonly SourceBundle[] {
  const globalPurposes = input.purposes ?? [];
  return input.sources.slice(0, MAX_EXTRACT_SOURCES).map((item) =>
    isRetrievedSource(item)
      ? { source: item.source, purposes: item.purposes }
      : { source: item, purposes: globalPurposes },
  );
}

export interface ExtractExperienceFactsResult {
  readonly facts: readonly ExperienceFact[];
  readonly source: 'model' | 'fallback';
}

/**
 * 主提取入口。
 *
 * 上限三道闸：来源 ≤ 12、单来源 ≤ 5 条、全局 ≤ 30 条。
 * 模型失败 / 返回空 → 整体回落 fallback，零模型也保底产出。
 */
export async function extractExperienceFacts(
  input: ExtractExperienceFactsInput,
): Promise<ExtractExperienceFactsResult> {
  // 第一道闸：来源封顶。意图按来源归一（见 `bundlesOf` 的纪律）。
  const bundles: readonly SourceBundle[] = bundlesOf(input);

  if (bundles.length === 0) {
    return { facts: [], source: 'fallback' };
  }

  if (input.router) {
    const facts = await extractWithModel({ bundles, question: input.question, router: input.router });
    if (facts.length > 0) {
      return { facts: facts.slice(0, MAX_TOTAL_FACTS), source: 'model' };
    }
  }

  // fallback：每来源一条（第三道闸 30 条在总出口再截一次）
  const facts = bundles.flatMap((bundle, index) =>
    fallbackFactsFor({
      source: bundle.source,
      question: input.question,
      purposes: bundle.purposes,
      index,
    }),
  );
  return { facts: facts.slice(0, MAX_TOTAL_FACTS), source: 'fallback' };
}

async function extractWithModel(input: {
  readonly bundles: readonly SourceBundle[];
  readonly question: string;
  readonly router: ProviderRouter;
}): Promise<readonly ExperienceFact[]> {
  const indexById = sourceIndex(input.bundles.map((bundle) => bundle.source));
  const purposesBySource = new Map(input.bundles.map((bundle) => [bundle.source.id, bundle.purposes]));

  const userContent = JSON.stringify({
    question: input.question,
    sources: input.bundles.map((bundle) => ({ sourceId: bundle.source.id, quote: bundle.source.quote })),
  });

  let routed;
  try {
    routed = await input.router.complete(
      EXTRACTION_ROLE,
      [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { jsonMode: true },
    );
  } catch {
    return [];
  }
  if (!routed.ok) {
    return [];
  }

  const relevanceCache = new Map<string, number>();
  const perSourceCount = new Map<string, number>();
  const facts: ExperienceFact[] = [];

  for (const proposal of parseProposals(routed.text)) {
    const source = indexById.get(proposal.sourceId);
    if (!source) {
      continue; // 提议了不存在的来源 → 丢
    }
    const used = perSourceCount.get(proposal.sourceId) ?? 0;
    if (used >= MAX_FACTS_PER_SOURCE) {
      continue; // 第二道闸：单来源封顶
    }
    let relevance = relevanceCache.get(proposal.sourceId);
    if (relevance === undefined) {
      relevance = relevanceOf(input.question, source.quote);
      relevanceCache.set(proposal.sourceId, relevance);
    }
    const fact = validateExtractedFact({
      source,
      exactQuote: proposal.exactQuote,
      type: proposal.type,
      id: `fact:${proposal.sourceId}:${used}`,
      relevance,
      purposes: purposesBySource.get(proposal.sourceId) ?? [],
    });
    if (fact) {
      facts.push(fact);
      perSourceCount.set(proposal.sourceId, used + 1);
    }
  }

  return facts;
}
