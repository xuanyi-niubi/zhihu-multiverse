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

/**
 * 反例强度信号：失败 / 退出 / 后悔 / 代价。
 *
 * 只服务「反例轨补位排序」—— 让补进反例轨的确实是那条读起来像反例的经历，
 * 而不是位置碰巧空出来的顺利故事。它不参与相似等级，也没有用户可见分数。
 */
const COUNTER_SIGNALS: readonly RegExp[] = [
  /(?:失败|没成功|没成|白费|亏|赔|腰斩|下降|不如以前|没赚到)/,
  /(?:退出|放弃|转回|回去|劝退|没坚持|撑不下去|半途|打退堂鼓)/,
  /(?:后悔|踩坑|踩了坑|教训|不建议|别学我)/,
  /(?:崩溃|焦虑|抑郁|压力很大|熬不住|痛苦|收入不稳定)/,
];

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

/** 强相似等级：够得着「相似」轨道的位置，不需要靠查询目的来兜。 */
const STRONG_SIMILAR_TIERS: readonly SimilarityTier[] = [
  'exact',
  'same-family',
  'same-domain',
  'same-target',
];

function assignedTrackOf(
  purposes: readonly SearchPurpose[],
  similarityTier: SimilarityTier,
): QualificationTrack {
  /**
   * 先让**相似等级**决定它有没有资格坐相似轨道的位置。
   *
   * 起因是一个真实缺陷：反例查询（`导游 失败 退出 后悔`）会捞出真正的
   * 同路人（「会计转行做导游，后来很焦虑」），而按查询目的优先的旧规则
   * 会把它判进反例轨 —— 反例轨只有 2 个名额，于是它被顶掉、相似轨空着，
   * 用户看到「没有相似经历」，其实那条经历就在候选里。
   *
   * 只保护**被相似查询命中过**（`similar-person`）且等级够强的来源；
   * 只被反例查询捞到的同路人仍然留在反例轨（那才是它的叙事角色）。
   */
  if (purposes.includes('similar-person') && STRONG_SIMILAR_TIERS.includes(similarityTier)) {
    return 'similar';
  }
  if (purposes.includes('counterexample') || purposes.includes('failure')) return 'counter';
  if (purposes.includes('alternative')) return 'alternative';
  if (similarityTier === 'adjacent-target' || similarityTier === 'unrelated') return 'adjacent';
  return 'similar';
}

function matchingTerms(terms: readonly string[], text: string): readonly string[] {
  return unique(terms.filter((term) => text.includes(term.toLowerCase())));
}

/**
 * 作者**本身就是**目标身份吗（`我是导游` / `原来是导游` / `一直从事导游`）。
 *
 * 为什么 `same-target` 需要这一道：这一层只要求「命中了目标 + 有转变动作」，
 * 没有任何起点证据。于是「我原来是导游，后来转行去写代码」会被算成
 * 「其他背景进入导游行业」—— 方向正好反过来，而用户会把它读成
 * 「有人和我一样在往导游走」。层级名称一旦撒谎，整棵树都不可信。
 */
const ORIGIN_FRAME = /(?:我是|我是做|我做|我干|我在做|我原来是|原来是|我之前是|之前是|本来是|以前是|一直在做|我一直在做|从事)$/;

function targetIsTheStorysOrigin(text: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    let index = text.indexOf(term);
    while (index >= 0) {
      if (ORIGIN_FRAME.test(text.slice(Math.max(0, index - 8), index))) return true;
      index = text.indexOf(term, index + 1);
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 二手转述：讲的是别人的经历                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ## 为什么必须单独判一次
 *
 * 亲历的判断原来是「出现『我』+ 有行动 + 有结果」，于是
 * 「**我朋友**原来是电工，后来转行做导游，第一年收入很低」会被当成
 * 完整亲历，甚至拿到最高等级 `exact` —— 而它讲的是别人的人生。
 * 产品卖点正是「别人真实走过的路」，把转述当本人经历，等于把
 * 二手总结冒充第一手经验，这是比检索不到更糟的错。
 *
 * 判定只看**含目标词的那个子句**及其前一子句：
 * - 子句里出现「我…转行/做/成为」→ 本人是动作发出者，不算二手；
 * - 子句里出现「朋友/同学/…/他/她」紧接转变动词 → 二手；
 * - 子句里没有「我」，而上一子句的主语是第三方 → 二手；
 * - 判不出来时**保持原判**（宁可放行也不误杀，误杀会让真实经历消失）。
 */
const THIRD_PARTY_NOUNS =
  '朋友|同学|同事|室友|亲戚|家人|表哥|表姐|堂哥|堂姐|哥哥|姐姐|弟弟|妹妹|老师|导师|邻居|老板|学长|学姐';

const TRANSITION_MOVES = '转行|转专业|改行|跨行|去做|去当|成为|入行|进入|做了|当了|开始做';

const SELF_ACTOR = new RegExp(`我[^，,。！？；;]{0,4}(?:${TRANSITION_MOVES})`);
const THIRD_PARTY_ACTOR = new RegExp(
  `(?:${THIRD_PARTY_NOUNS}|他|她|别人|人家)[^，,。！？；;]{0,8}(?:${TRANSITION_MOVES})`,
);
const THIRD_PARTY_SUBJECT = new RegExp(
  `^(?:因为|后来|之后|然后|所以|而|但|但是|不过)?(?:我(?:的)?)?(?:${THIRD_PARTY_NOUNS})|` +
    `^(?:因为|后来|之后|然后|所以|而|但|但是|不过)?(?:他|她|别人|人家)`,
);

function textClauses(text: string): readonly string[] {
  return text.split(/[，,。！？；;\n]/).map((item) => item.trim()).filter(Boolean);
}

function isSecondhandStory(text: string, targetTerms: readonly string[]): boolean {
  if (targetTerms.length === 0) return false;
  const clauses = textClauses(text);
  const at = clauses.findIndex((clause) => targetTerms.some((term) => clause.includes(term)));
  if (at < 0) return false;
  const clause = clauses[at]!;
  if (SELF_ACTOR.test(clause)) return false;
  if (THIRD_PARTY_ACTOR.test(clause)) return true;
  const previous = clauses[at - 1];
  return Boolean(previous && THIRD_PARTY_SUBJECT.test(previous) && !/我/.test(clause));
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
  } else if (
    input.hasTransitionAction &&
    targetExact.length > 0 &&
    !targetIsTheStorysOrigin(input.sourceText, targetExact)
  ) {
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

  /**
   * 二手判定只看**逐字引文**（`quote`），不看标题与作者徽章。
   * 标题里出现「我朋友…」大多是标题党；而引文才是要被引用进游戏的那段证据。
   */
  const secondhand = isSecondhandStory(input.source.quote, similarity.matchedTargetTerms);
  const strongFirsthand =
    !secondhand &&
    (FIRSTHAND_STRONG.test(sourceText) ||
      (FIRST_PERSON.test(sourceText) && ACTION.test(sourceText) && OUTCOME.test(sourceText)));
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

  /**
   * 反例强度 = 正文信号（80%）+ 「它确实是被反例/失败查询捞到的」（20%）。
   * 全确定性、可复现；只用排序，不写进任何用户可见数字。
   */
  const counterHits = COUNTER_SIGNALS.filter((signal) => signal.test(sourceText)).length;
  const counterPurposeHit =
    input.purposes.includes('counterexample') || input.purposes.includes('failure');
  const counterStrength = Number(
    Math.min(1, (counterHits / COUNTER_SIGNALS.length) * 0.8 + (counterPurposeHit ? 0.2 : 0)).toFixed(3),
  );

  const eligibleAsCase =
    similarity.tier !== 'unrelated' &&
    firsthand === 'yes' &&
    commercialRisk !== 'high' &&
    (completeness.action || completeness.outcome);
  const assignedTrack = assignedTrackOf(input.purposes, similarity.tier);
  const reasons: string[] = [];
  if (topicRelation === 'irrelevant') reasons.push('主题关联不足');
  if (secondhand) reasons.push('讲的是别人的经历，不是本人亲历');
  else if (firsthand !== 'yes') reasons.push(firsthand === 'uncertain' ? '无法确认是完整亲历' : '更像观点而非亲历');
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
    counterStrength,
    reasons,
  };
}
