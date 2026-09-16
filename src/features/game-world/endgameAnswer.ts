import type { RealityExperiment } from '@/features/decision-session/domain';
import { editedYearOf, eraTrackOf } from '@/features/experience/eraTrack';
import type { ExperienceFact, ProblemFrame } from '@/features/experience/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';

/**
 * 终局答案（P1-2 加强）。
 *
 * ## 为什么要有这一层
 *
 * 原来终局那张暖色纸上的内容**完全来自一张模板**：`experimentFromUnknown()`
 * 只吃「未知 + 问题框定 + 差异 + 用户上下文」，一条真实经历都拿不到。
 * 于是纸上的字是对的，但读起来是"水"的 —— 它没有回答用户进来时的那句话。
 *
 * 这一层把**这一局真实发生过的事**凝练成一份答案：
 *
 * ```text
 * 你问的是什么           frame.rawQuestion（原句，不润色）
 * 你补上了哪些条件        frame.constraints（澄清里真的答过的硬条件）
 * 你走过哪些路           本局的行动轨迹（玩家真的选过）
 * 你采用了谁的经验       真实经历解锁、且你真的用过的行动 → 逐字片段
 * 真实的人是怎么做的     逐字片段 + 答主 + 可点回原文的链接
 * 他们付出了什么代价     逐字片段
 * 哪条路是走坏的         反例片段（真的出现过反例才有）
 * 同一个问题不同年代的人   有年份的片段按时代分组（**平行的时间**）
 * 仍然不知道什么         WorldBlueprint.keyUnknown
 * 所以要验证的一件事     真实实验的六要素
 * ```
 *
 * ## 三条纪律（全部写进类型与测试）
 *
 * 1. **零模型**：纯函数，同输入必得同输出 —— 终局不能是"这一刻模型心情好"。
 * 2. **每一句都有出处**：所有经历类内容都是 `exactQuote` 的**前缀**（逐字），
 *    并带答主与原文链接；没有片段就**如实留空**，不写"你成长了"。
 * 3. **不给结论**：不出现成功率 / 匹配度 / 推荐分；答案的形态是
 *    「别人真实做过什么 + 你还不知道什么 + 去验证什么」。
 */

/** 一条可点回原文的真实证据。 */
export interface EndgameEvidence {
  readonly id: string;
  /**
   * 它在答案里扮演什么：
   * - `taken`   玩家真的采用过的经验（来自经验解锁）
   * - `step`    真实的人做过的具体一步
   * - `cost`    真实的人付出的代价
   * - `counter` 走坏的那条路（反例）
   * - `era`     时代对照里的片段（平行的时间）
   */
  readonly kind: 'taken' | 'step' | 'cost' | 'counter' | 'era';
  /** **逐字**片段（原文的连续前缀，不是改写）。 */
  readonly quote: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string | null;
  /**
   * 这条回答的**最后编辑年份**（不是首次发布时间；字段里没有那个）。
   * 没有时间信息时为 null —— 页面必须当"不知道"处理。
   */
  readonly editedYear: number | null;
}

/** 时代对照里的一个年代。 */
export interface EndgameEraGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly EndgameEvidence[];
}

/**
 * 平行的时间：同一个问题，不同年代的人说法不一样。
 *
 * 只有当**两个以上时代都有人**时 `comparable` 才为真；否则如实说明
 * 「这一局只找到了一个时代」，不硬凑对照。
 */
export interface EndgameEraTrack {
  readonly comparable: boolean;
  readonly gapYears: number;
  readonly note: string;
  readonly groups: readonly EndgameEraGroup[];
}

export interface EndgameAnswer {
  /** 你进来时问的那句话（原句）。 */
  readonly question: string;
  /** 你补上的硬条件（只收用户明确说过的）。 */
  readonly conditions: readonly string[];
  /** 你走过的路（本局行动轨迹，按顺序）。 */
  readonly walked: readonly string[];
  /** 你采用了谁的真实经验。 */
  readonly taken: readonly EndgameEvidence[];
  /** 真实的人是怎么做过的。 */
  readonly borrowed: readonly EndgameEvidence[];
  /** 他们付出的代价。 */
  readonly costs: readonly EndgameEvidence[];
  /** 走坏的那条路（有反例才有）。 */
  readonly counter: EndgameEvidence | null;
  /**
   * 平行的时间：同一个问题在不同年代的说法（第三条维度）。
   *
   * 与相似等级正交 —— 相似等级回答"这个人像不像你"，时代回答
   * "这条路在当时成不成立"。凑不出两个时代时为 null 或 comparable=false。
   */
  readonly eras: EndgameEraTrack | null;
  /** 仍然不知道的那一项（没有就是 null，不编）。 */
  readonly unknown: string | null;
  /** 要验证的一件事（来自真实实验的六要素）。 */
  readonly nextStep: {
    readonly action: string;
    readonly timebox: string;
    readonly successSignal: string;
    readonly stopSignal: string;
  } | null;
  /** 这份答案的诚实边界（一句话，随内容变化）。 */
  readonly note: string;
}

/** 相似等级越好排越前（用于"先拿最像的那个人"。 */
const TIER_RANK: Readonly<Record<string, number>> = {
  exact: 0,
  'same-family': 1,
  'same-domain': 2,
  'same-target': 3,
  'adjacent-target': 4,
  unrelated: 9,
};

/** 反例信号：这些话说明那条路是走坏的。 */
const COUNTER_HINT = /(后悔|退出|放弃|失败|踩坑|踩了坑|劝退|崩溃|腰斩|亏|赔|白费|没坚持|撑不下去)/;

/**
 * 槽位合理性。
 *
 * ## 为什么不能只信 `fact.type`
 *
 * 线上实测：被抽取层标成 `action` 的片段里，有一句是
 * 「后来遇到疫情爆发，旅游业收到了重创」—— 它是**处境**，不是谁做了什么。
 * 若照抄类型，纸面上就会出现「真实的人是怎么做的：疫情重创旅游业」，
 * 标签当场撒谎。所以每个槽位都再要求一次**语义词**：
 *
 * - 行动：必须出现一个真做过的动作词；
 * - 代价：必须真的在讲投入或损失；
 * - 反例：必须真的在讲走坏。
 *
 * 不满足就**留空**（留空是诚实的，标错是撒谎）。全程零模型、可复现。
 */
const ACTION_TELL =
  /(考了|考证|考过|报名|辞职|辞了|搬|投递|投了|联系|学了|学习|做了|做|开始|决定|去找|试了|练习|练|写了|申请|准备|转了|转行|换了|进了|加入|干了|坚持|选|去|兼职)/;

const COST_TELL =
  /(代价|成本|花了|用了|投入|熬|压力|耽误|失去|亏|赔|收入|积蓄|焦虑|崩溃|后悔|没收入|借钱|透支|存款|时间)/;

const COUNTER_TELL =
  /(失败|退出|放弃|后悔|腰斩|亏|赔|没坚持|撑不下去|劝退|重创|消失|倒闭|不建议|踩坑|白费|裁员|回去了|转回)/;

/** 排版噪音：字幕式括号说明、图片注脚 —— 不是经历本身。 */
const NOT_EVIDENCE = /^(（|\(|《|\[)|左边是我|右边是我|图源|图片|字幕/;

/**
 * 逐字片段 → 纸面上可读的一句。
 *
 * **只做前缀截断**：绝不改写、绝不拼接。这是"可点回原文"的前提。
 */
function displayQuote(quote: string): string {
  const cleaned = quote.replace(/\s+/g, ' ').trim();
  const firstSentence = cleaned.split(/(?<=[。！？!?；;])/)[0]?.trim() ?? cleaned;
  const picked = firstSentence.length >= 12 ? firstSentence : cleaned;
  return picked.length > 64 ? `${picked.slice(0, 64)}…` : picked;
}

function evidenceOf(fact: ExperienceFact, kind: EndgameEvidence['kind']): EndgameEvidence {
  return {
    id: fact.id,
    kind,
    quote: displayQuote(fact.exactQuote),
    author: fact.author,
    sourceUrl: fact.sourceUrl,
    sourceTitle: fact.sourceTitle ?? null,
    editedYear: editedYearOf(fact),
  };
}

function tierRankOf(fact: ExperienceFact): number {
  const tier = fact.qualification?.similarityTier;
  return tier ? TIER_RANK[tier] ?? 5 : 5;
}

/** 好证据优先：先看相似等级，再看内部相关度，最后按 id 稳定排序。 */
function compareEvidence(left: ExperienceFact, right: ExperienceFact): number {
  const tierGap = tierRankOf(left) - tierRankOf(right);
  if (tierGap !== 0) return tierGap;
  if (right.relevance !== left.relevance) return right.relevance - left.relevance;
  return left.id.localeCompare(right.id);
}

function usableFacts(
  facts: readonly ExperienceFact[],
  types: readonly ExperienceFact['type'][],
  mustMatch: RegExp,
): readonly ExperienceFact[] {
  return facts
    .filter((fact) => types.includes(fact.type))
    .filter((fact) => fact.exactQuote.replace(/\s+/g, '').length >= 12)
    .filter((fact) => !NOT_EVIDENCE.test(fact.exactQuote.trim()))
    .filter((fact) => mustMatch.test(fact.exactQuote))
    .filter((fact) => fact.author.trim().length > 0 && fact.sourceUrl.trim().length > 0)
    .slice()
    .sort(compareEvidence);
}

/**
 * 反例：优先带"走坏"信号的片段，其次反例查询/失败查询捞到的片段。
 *
 * 但**必须真的在讲走坏**（`COUNTER_TELL`）—— 否则宁可返回 null。
 * 线上实测过：不加这一道，第三幕会拿一句「（小时候舞蹈班，左边是我）
 * 不过，家庭中的爱却如同温暖的阳光」当反例，那是彻底的撒谎。
 */
function counterEvidenceOf(
  facts: readonly ExperienceFact[],
  counterFactIds: ReadonlySet<string>,
): EndgameEvidence | null {
  const candidates = facts
    .filter((fact) => fact.author.trim().length > 0 && fact.sourceUrl.trim().length > 0)
    .filter((fact) => !NOT_EVIDENCE.test(fact.exactQuote.trim()))
    .filter((fact) => COUNTER_TELL.test(fact.exactQuote));
  if (candidates.length === 0) return null;
  const scored = candidates.slice().sort((left, right) => {
    const leftWeight = (counterFactIds.has(left.id) ? 0 : 1) + (COUNTER_HINT.test(left.exactQuote) ? 0 : 1);
    const rightWeight = (counterFactIds.has(right.id) ? 0 : 1) + (COUNTER_HINT.test(right.exactQuote) ? 0 : 1);
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    return compareEvidence(left, right);
  });
  return evidenceOf(scored[0]!, 'counter');
}

export interface EndgameAnswerInput {
  readonly frame: ProblemFrame;
  readonly blueprint: WorldBlueprint;
  /** 本局行动轨迹（玩家真的走过的路）。 */
  readonly walked: readonly string[];
  /** 玩家真的采用过的经验解锁 id。 */
  readonly usedUnlockIds: readonly string[];
  readonly experiment: RealityExperiment | null;
}

/**
 * 凝练终局答案。**纯函数、零模型**。
 *
 * 没有任何真实片段时，答案依然成立 —— 它只写「你走过的路 + 还不知道的那一项」，
 * 并在 `note` 里如实说明为什么这里没有别人的经历。
 */
export function endgameAnswerOf(input: EndgameAnswerInput): EndgameAnswer {
  const { frame, blueprint } = input;
  const facts = blueprint.experienceFacts ?? [];
  const counterAct = blueprint.acts.find((act) => act.objective === 'meet-counterexample');
  const counterFactIds = new Set(counterAct?.experienceFactIds ?? []);

  const factById = new Map(facts.map((fact) => [fact.id, fact]));

  /** 你采用过的真实经验：解锁 → sourceFactIds → 逐字片段。 */
  const usedUnlocks = new Set(input.usedUnlockIds);
  const taken = blueprint.unlocks
    .filter((unlock) => usedUnlocks.has(unlock.id))
    .flatMap((unlock) =>
      unlock.sourceFactIds
        .map((id) => factById.get(id))
        .filter((fact): fact is ExperienceFact => Boolean(fact))
        // 只有"确实像他做过的一步"的片段才配出现在这里
        .filter((fact) => ACTION_TELL.test(fact.exactQuote))
        .filter((fact) => !NOT_EVIDENCE.test(fact.exactQuote.trim()))
        .slice(0, 1)
        .map((fact) => evidenceOf(fact, 'taken')),
    )
    .slice(0, 2);

  const actions = usableFacts(facts, ['action'], ACTION_TELL);
  const borrowed = (actions.length > 0 ? actions : usableFacts(facts, ['outcome'], ACTION_TELL))
    .slice(0, 2)
    .map((fact) => evidenceOf(fact, 'step'));

  const costs = usableFacts(facts, ['cost'], COST_TELL)
    .slice(0, 1)
    .map((fact) => evidenceOf(fact, 'cost'));

  const counter = counterEvidenceOf(
    facts.filter((fact) => fact.exactQuote.replace(/\s+/g, '').length >= 12),
    counterFactIds,
  );

  const conditions = frame.constraints
    .filter((item) => item.hard)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .slice(0, 3);

  const walked = input.walked.map((step) => step.trim()).filter(Boolean).slice(0, 4);

  const unknown =
    blueprint.keyUnknown?.label?.trim() ||
    frame.unknowns[0]?.label?.trim() ||
    null;

  const experiment = input.experiment;
  const hasEvidence = taken.length > 0 || borrowed.length > 0 || costs.length > 0 || counter !== null;

  /**
   * 平行的时间（第三条维度）：把有年份的片段按时代分组。
   *
   * 与相似等级正交 —— 相似等级回答"这个人像不像你"，时代回答
   * "这条路在当时成不成立"。只有合格来源进桶，凑不出两个时代就
   * `comparable: false`，页面上如实说明而不是硬凑对照。
   */
  const track = eraTrackOf(facts);
  const eras: EndgameEraTrack | null =
    track.buckets.length > 0
      ? {
          comparable: track.comparable,
          gapYears: track.gapYears,
          note: track.note,
          groups: track.buckets.map((bucket) => ({
            id: bucket.id,
            label: bucket.label,
            items: bucket.items.map((item) => evidenceOf(item.fact, 'era')),
          })),
        }
      : null;

  return {
    question: frame.rawQuestion,
    conditions,
    walked,
    taken,
    borrowed,
    costs,
    counter,
    eras,
    unknown,
    nextStep: experiment
      ? {
          action: experiment.action,
          timebox: experiment.timebox,
          successSignal: experiment.successSignal,
          stopSignal: experiment.stopSignal,
        }
      : null,
    note: hasEvidence
      ? '上面每一句都来自真实答主的原文（可点开核对）。这不是我们的结论 —— 是别人真的做过的事，加上你还没有验证的那一项。'
      : '这一局没有拿到可核验的本人亲历片段，所以这份答案只写你走过的路和仍然未知的那一项 —— 我们不替你补一段。',
  };
}
