import type {
  ProblemFrame,
  QualificationTrack,
  SearchPurpose,
  SimilarityTier,
  SourceQualification,
  TransitionIntent,
} from '@/features/experience/domain';
import {
  buildTransitionIntent,
} from '@/features/experience/transitionIntent';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

const FIRSTHAND_STRONG = /(我当时|我曾经|我自己|我在.{0,12}(?:参加|选择|开始|转|辞|读|学|做)|后来我|最后我|我的经历|亲身经历|本人经历)/;
const FIRST_PERSON = /(^|[，。！？；\s])我(?:们)?/;
const ACTION = /(参加|报名|开始|决定|选择|准备|学习|复习|做了|转行|转专业|投递|联系|组队|退出|辞职)/;
const OUTCOME = /(后来|最后|结果|拿到|录取|上岸|获奖|失败|放弃|退出|后悔|转正|毕业)/;
const CONDITION = /(当时|大[一二三四五]|研[一二三]|应届|本科|专科|硕士|博士|基础|非科班|双非|二本|在职|零基础)/;
const COST = /(代价|成本|花了|用了|投入|熬夜|压力|耽误|失去|焦虑|痛苦|一年|个月|小时)/;
const PROMO = /(私信|加微|微信|咨询|付费|课程|训练营|辅导|保过|报名链接|点击链接|闭眼复制|领取资料|扫码)/g;
const STAGE = /大[一二三四五]|研[一二三]|应届|本科|专科|硕士|博士|高[一二三]/g;
const IDENTITY = /数据科学|计算机|软件工程|人工智能|非科班|跨专业|双非|二本|一本|基础一般|基础薄弱|零基础/g;
const STOP = new Set(['一个', '一种', '这个', '那个', '可以', '应该', '还是', '是否', '怎么', '什么', '自己', '现在']);

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function ngrams(text: string): readonly string[] {
  const normalized = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const result: string[] = [];
  for (const part of normalized.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 2) result.push(part);
      continue;
    }
    if (part.length <= 6 && part.length >= 2 && !STOP.has(part)) result.push(part);
    for (let index = 0; index < part.length - 1; index += 1) {
      const pair = part.slice(index, index + 2);
      if (!STOP.has(pair)) result.push(pair);
    }
  }
  return unique(result);
}

function explicitLabels(frame: ProblemFrame): readonly string[] {
  const labels: string[] = [];
  for (const match of frame.rawQuestion.match(STAGE) ?? []) labels.push(match);
  for (const match of frame.rawQuestion.match(IDENTITY) ?? []) labels.push(match);
  for (const item of frame.constraints.filter((entry) => entry.hard)) labels.push(item.text);
  return unique(labels).slice(0, 8);
}

function labelMatches(label: string, text: string): boolean {
  if (text.includes(label)) return true;
  const tokens = ngrams(label).filter((token) => token.length >= 2);
  return tokens.length > 0 && tokens.some((token) => text.includes(token));
}

function assignedTrackOf(
  purposes: readonly SearchPurpose[],
  similarityTier: SimilarityTier,
): QualificationTrack {
  if (purposes.includes('counterexample') || purposes.includes('failure')) return 'counter';
  if (purposes.includes('alternative')) return 'alternative';
  if (similarityTier === 'adjacent-target' || similarityTier === 'unrelated') return 'adjacent';
  return 'similar';
}

function matchingTerms(terms: readonly string[], text: string): readonly string[] {
  return unique(terms.filter((term) => text.includes(term.toLowerCase())));
}

function similarityOf(input: {
  readonly sourceText: string;
  readonly frame: ProblemFrame;
  readonly intent?: TransitionIntent;
  readonly hasTransitionAction: boolean;
}): {
  readonly tier: SimilarityTier;
  readonly matchedOriginTerms: readonly string[];
  readonly matchedTargetTerms: readonly string[];
} {
  const intent = input.intent ?? buildTransitionIntent(input.frame);
  const originExact = matchingTerms(intent.origin.exact, input.sourceText);
  const originFamily = matchingTerms(
    intent.origin.family.filter((term) => !intent.origin.exact.includes(term)),
    input.sourceText,
  );
  const originDomain = matchingTerms(intent.origin.domain, input.sourceText);
  const targetExact = matchingTerms(intent.target.exact, input.sourceText);
  const targetAdjacent = matchingTerms(intent.target.adjacent, input.sourceText);

  let tier: SimilarityTier = 'unrelated';
  if (input.hasTransitionAction && targetExact.length > 0 && originExact.length > 0) {
    tier = 'exact';
  } else if (input.hasTransitionAction && targetExact.length > 0 && originFamily.length > 0) {
    tier = 'same-family';
  } else if (input.hasTransitionAction && targetExact.length > 0 && originDomain.length > 0) {
    tier = 'same-domain';
  } else if (input.hasTransitionAction && targetExact.length > 0) {
    tier = 'same-target';
  } else if (input.hasTransitionAction && targetAdjacent.length > 0) {
    tier = 'adjacent-target';
  }

  return {
    tier,
    matchedOriginTerms: unique([...originExact, ...originFamily, ...originDomain]),
    matchedTargetTerms: unique([...targetExact, ...targetAdjacent]),
  };
}

export function qualifyExperienceSource(input: {
  readonly source: KnowledgeSource;
  readonly frame: ProblemFrame;
  readonly purposes: readonly SearchPurpose[];
  readonly intent?: TransitionIntent;
}): SourceQualification {
  const sourceText = `${input.source.title ?? ''} ${input.source.authorBadge ?? ''} ${input.source.quote}`;
  const normalizedSourceText = sourceText.toLowerCase();
  const similarity = similarityOf({
    sourceText: normalizedSourceText,
    frame: input.frame,
    ...(input.intent ? { intent: input.intent } : {}),
    hasTransitionAction: ACTION.test(sourceText),
  });
  const targetTerms = ngrams(`${input.frame.desiredChange} ${input.frame.rawQuestion}`).slice(0, 24);
  const targetHits = targetTerms.filter((term) => normalizedSourceText.includes(term)).length;
  const topicScore = targetTerms.length > 0 ? targetHits / targetTerms.length : 0;
  const topicRelation = similarity.tier === 'unrelated'
    ? 'irrelevant'
    : similarity.tier === 'adjacent-target'
      ? 'partial'
      : 'relevant';

  const labels = explicitLabels(input.frame);
  const matchedConstraints = labels.filter((label) => labelMatches(label, sourceText));
  const userStage = input.frame.rawQuestion.match(STAGE)?.[0];
  const sourceStage = sourceText.match(STAGE)?.[0];
  const differentConstraints =
    userStage && sourceStage && userStage !== sourceStage ? [`${userStage} / 对方为${sourceStage}`] : [];
  const unknownConstraints = labels.filter((label) => !matchedConstraints.includes(label));

  const strongFirsthand = FIRSTHAND_STRONG.test(sourceText) || (FIRST_PERSON.test(sourceText) && ACTION.test(sourceText) && OUTCOME.test(sourceText));
  const firsthand = strongFirsthand ? 'yes' : FIRST_PERSON.test(sourceText) ? 'uncertain' : 'no';
  const promoHits = sourceText.match(PROMO)?.length ?? 0;
  const commercialRisk = promoHits >= 2 ? 'high' : promoHits === 1 ? 'medium' : 'low';
  const completeness = {
    condition: CONDITION.test(sourceText),
    action: ACTION.test(sourceText),
    cost: COST.test(sourceText),
    outcome: OUTCOME.test(sourceText),
  };
  const completenessScore = Object.values(completeness).filter(Boolean).length / 4;
  const personaScore = labels.length > 0 ? matchedConstraints.length / labels.length : 0;
  const firsthandScore = firsthand === 'yes' ? 1 : firsthand === 'uncertain' ? 0.35 : 0;
  const authorityScore = Math.min(1, Math.log10(Math.max(1, (input.source.upvotes ?? 0) + 1)) / 4);
  const rankScore = Number(Math.max(0, Math.min(1,
    topicScore * 0.35 + personaScore * 0.3 + firsthandScore * 0.2 + completenessScore * 0.1 + authorityScore * 0.05
  )).toFixed(3));

  const eligibleAsCase =
    similarity.tier !== 'unrelated' &&
    firsthand === 'yes' &&
    commercialRisk !== 'high' &&
    (completeness.action || completeness.outcome);
  const assignedTrack = assignedTrackOf(input.purposes, similarity.tier);
  const reasons: string[] = [];
  if (topicRelation === 'irrelevant') reasons.push('主题关联不足');
  if (firsthand !== 'yes') reasons.push(firsthand === 'uncertain' ? '无法确认是完整亲历' : '更像观点而非亲历');
  if (commercialRisk === 'high') reasons.push('商业推广风险较高');
  if (!completeness.action && !completeness.outcome) reasons.push('缺少明确行动或结果');
  if (similarity.tier === 'same-target') reasons.push('目标相同，但起点背景不同或未确认');
  if (similarity.tier === 'adjacent-target') reasons.push('只命中相邻目标，未命中完全相同的目标');

  return {
    topicRelation,
    firsthand,
    matchedConstraints,
    differentConstraints,
    unknownConstraints,
    completeness,
    commercialRisk,
    eligibleAsCase,
    rankScore,
    similarityTier: similarity.tier,
    matchedOriginTerms: similarity.matchedOriginTerms,
    matchedTargetTerms: similarity.matchedTargetTerms,
    assignedTrack,
    reasons,
  };
}
