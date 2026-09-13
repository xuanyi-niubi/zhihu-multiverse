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
3. 每条来源抽 2～5 条，并**尽量覆盖不同类型**：尤其别漏 action（他具体做了什么）。
   同一段原文里既有处境又有行动时，要分别抽出来，不要只给一条；
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
/**
 * 把一条较长的原文按**句子边界**切成最多两段。
 *
 * 切点在句末（。；！？），所以两段都是原文的逐字子串 —— 不产生任何"改写"。
 * 目的：让同一条来源能贡献两种类型（例如前段是处境、后段是结果），
 * 从而够得上「一个人的一段经历」的准入规则（见 `cases.ts`）。
 */
function splitQuoteAtSentence(quote: string, maxParts = 2): readonly string[] {
  const text = quote.trim();
  if (text.length < 60 || maxParts < 2) {
    return [text];
  }
  const boundaries: number[] = [];
  const re = /[。；！？]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    boundaries.push(match.index + 1);
  }
  const middle = Math.floor(text.length / 2);
  const candidates = boundaries.filter((index) => index >= 24 && text.length - index >= 24);
  if (candidates.length === 0) {
    return [text];
  }
  const cut = candidates.reduce(
    (best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best),
    candidates[0]!,
  );
  return [text.slice(0, cut).trim(), text.slice(cut).trim()].filter((part) => part.length >= 12);
}

/**
 * 无模型路径：整段原文就是一条片段。
 *
 * 原文足够长时按句拆成两段（都是逐字子串），让同一来源能同时提供
 * 「当时的处境」与「后来的结果」——否则 12 条来源会聚不出任何一段经历。
 * 复用现有 `factTypeOf` / `relevanceOf`，不复制第二套判型逻辑。
 */
export function fallbackFactsFor(input: {
  readonly source: KnowledgeSource;
  readonly question: string;
  readonly purposes?: readonly SearchPurpose[];
  readonly index?: number;
}): readonly ExperienceFact[] {
  return splitQuoteAtSentence(input.source.quote).flatMap((part, partIndex) => {
    const fact = validateExtractedFact({
      source: input.source,
      exactQuote: part,
      type: mapFactType(factTypeOf(part)),
      id: `fact:${input.source.id}:${input.index ?? 0}${partIndex === 0 ? '' : `-${partIndex}`}`,
      relevance: relevanceOf(input.question, part),
      purposes: input.purposes ?? [],
    });
    return fact ? [fact] : [];
  });
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
  /**
   * 模型提议了几条 / 其中逐字校验通过几条。
   *
   * 这两个数字是「模型有没有在改写原文」的直接证据：提议很多但采纳很少，
   * 说明它在润色，而不是我们的校验坏了。
   */
  readonly proposed?: number;
  readonly accepted?: number;
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
    const attempt = await extractWithModel({ bundles, question: input.question, router: input.router });
    const facts = attempt.facts;
    if (facts.length > 0) {
      /**
       * 模型对某些来源只给了一条时，用**规则兜底**把那条来源的原文整段补成一条片段。
       *
       * 为什么需要它：经历聚合成「一个人的一段经历」要求来源同时有
       * condition+outcome（或 action）。实测模型很常见只抽出 1 条（且集中在
       * cost），于是 12 条来源 → 0 张经验卡 → 0 个经验解锁 ——
       * 产品最核心的「真实经验解锁新行动」当场消失。
       *
       * 兜底那一条是**原文整段**，逐字成立（它本身就是 source.quote），
       * 类型由既有的确定性规则判，不经过任何模型。
       */
      const topped = topUpThinSources(bundles, facts, input.question);
      return {
        facts: topped.slice(0, MAX_TOTAL_FACTS),
        source: 'model',
        proposed: attempt.proposed,
        accepted: facts.length,
      };
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
  return { facts: facts.slice(0, MAX_TOTAL_FACTS), source: 'fallback', proposed: 0, accepted: 0 };
}


/**
 * 给「只抽到一条」的来源补一条规则兜底片段（见 extractExperienceFacts 的说明）。
 *
 * 只补不删：模型抽出来的片段一条不动；已出现过的原文整段不重复补。
 */
function topUpThinSources(
  bundles: readonly SourceBundle[],
  facts: readonly ExperienceFact[],
  question: string,
): readonly ExperienceFact[] {
  const countBySource = new Map<string, number>();
  const seen = new Set<string>();
  for (const fact of facts) {
    countBySource.set(fact.sourceId, (countBySource.get(fact.sourceId) ?? 0) + 1);
    seen.add(`${fact.sourceId}:${fact.exactQuote}`);
  }

  const topped: ExperienceFact[] = [...facts];
  bundles.forEach((bundle, index) => {
    if ((countBySource.get(bundle.source.id) ?? 0) >= 2) {
      return;
    }
    const key = `${bundle.source.id}:${bundle.source.quote.trim()}`;
    if (seen.has(key) || bundle.source.quote.trim().length < 12) {
      return;
    }
    const extra = fallbackFactsFor({
      source: bundle.source,
      question,
      purposes: bundle.purposes,
      index,
    });
    for (const fact of extra) {
      topped.push(fact);
      seen.add(`${fact.sourceId}:${fact.exactQuote}`);
    }
  });

  return topped;
}

async function extractWithModel(input: {
  readonly bundles: readonly SourceBundle[];
  readonly question: string;
  readonly router: ProviderRouter;
}): Promise<{ readonly facts: readonly ExperienceFact[]; readonly proposed: number }> {
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
    return { facts: [], proposed: 0 };
  }
  if (!routed.ok) {
    return { facts: [], proposed: 0 };
  }

  const relevanceCache = new Map<string, number>();
  const perSourceCount = new Map<string, number>();
  const facts: ExperienceFact[] = [];

  const proposals = parseProposals(routed.text);
  for (const proposal of proposals) {
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

  return { facts, proposed: proposals.length };
}
