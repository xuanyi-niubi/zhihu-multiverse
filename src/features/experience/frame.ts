import type { PlayerProfile } from '@/core/dm/profile';

import type {
  FrameStatement,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * 问题框定（Phase 2 / P0-A）。
 *
 * ## 为什么不新建一个「ProblemFrame Agent」
 *
 * `src/core/dm/profile.ts` 已经有整套档案能力，`/api/profile` 也已经能
 * 「模型解析 → 失败回退确定性规则 → 永远 200」。再写一个同义的 Agent
 * 就是两套画像并存 —— 而那正是这次迁移要消除的问题。
 *
 * 所以这里**只做转换**：把已有的 `PlayerProfile` 翻译成 `ProblemFrame`，
 * 并额外做一件旧实现没做的事 —— **区分「用户说的」与「解析推断的」**。
 *
 * ## 这件事为什么重要
 *
 * `PlayerProfile` 里的 `constraints` / `fears` / `resources` / `keyTension`
 * 混着两类东西：
 *
 * ```text
 * 用户原话：「大二基础一般」「每周大概 8 小时」
 * 解析推断：「风险偏好低」「家庭期待是主要压力」
 * ```
 *
 * 旧实现把两者一视同仁地喂给下游，于是**系统的一点猜测会变成
 * 后续所有推理的前提**。用户从没说过家庭压力，系统却拿它当约束，
 * 然后据此给他一条「先缓一缓」的建议 —— 那是无中生有。
 *
 * 现在：只有**在用户原话里逐字找得到**的陈述才是硬条件，
 * 其余一律 `parser-synthesis` + `hard: false`，只能用于叙事与检索提示。
 */

/* -------------------------------------------------------------------------- */
/* 1. 逐字判定                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 这条陈述是否**明确出现在**用户原话里。
 *
 * 刻意不用 NLP：一个可解释、可复核的规则，比一个说不清为什么的模型
 * 更适合守这条纪律。判不出来就返回 false —— **宁可保守**。
 *
 * 三种命中方式：
 * 1. 原话包含整条陈述（用户基本是把这句抄下来的）；
 * 2. 陈述里的实词有**足够比例**出现在原话里；
 * 3. 陈述本身就是原话的一小段。
 */
export function appearsExplicitly(rawQuestion: string, statement: string): boolean {
  const question = normalize(rawQuestion);
  const text = normalize(statement);
  if (text.length === 0 || question.length === 0) {
    return false;
  }

  // 1) 原话直接包含整句
  if (question.includes(text)) {
    return true;
  }

  /**
   * 2) 实词覆盖率。
   *
   * 取长度 ≥2 的中文片段与数字/单位作为「实词」——它们才是信息，
   * 「的 / 是 / 我」这类虚词命中没有意义。
   * 阈值 0.6：宁可漏判（降级为软条件），也不要误判（把猜测当事实）。
   */
  const tokens = contentTokens(text);
  if (tokens.length === 0) {
    return false;
  }
  const hit = tokens.filter((token) => question.includes(token)).length;
  return hit / tokens.length >= 0.6;
}

/** 归一化：去掉空白与常见标点，统一大小写。 */
function normalize(text: string): string {
  return text.replace(/[\s，,。.；;：:、！!？?（）()【】\[\]「」“”"'’‘]/g, '').toLowerCase();
}

/**
 * 抽取「实词」：连续 2 字以上的中文串，以及数字带单位。
 *
 * 单字不成词（「的」「了」命中毫无意义），所以下限是 2。
 */
function contentTokens(text: string): readonly string[] {
  const chinese = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const numeric = text.match(/\d+(?:\.\d+)?(?:小时|个月|年|周|天|次|门|个|元|万|k|K)?/g) ?? [];
  return [...chinese, ...numeric];
}

/* -------------------------------------------------------------------------- */
/* 2. 陈述构建                                                                 */
/* -------------------------------------------------------------------------- */

function statementOf(
  rawQuestion: string,
  text: string,
  index: number,
  prefix: string,
): FrameStatement {
  const explicit = appearsExplicitly(rawQuestion, text);
  return {
    id: `${prefix}-${index + 1}`,
    text,
    // 逐字找得到 = 用户说的；否则是解析推断
    origin: explicit ? 'user-explicit' : 'parser-synthesis',
    hard: explicit,
  };
}

function statementsOf(
  rawQuestion: string,
  items: readonly string[],
  prefix: string,
): readonly FrameStatement[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item, index) => statementOf(rawQuestion, item, index, prefix));
}

/* -------------------------------------------------------------------------- */
/* 3. 未知变量                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 从档案里推出「还缺什么信息」。
 *
 * 这些未知**不是**「系统想知道更多」，而是**会改变结论的缺口**：
 * 同一个问题，时间余量不同、能不能承受失败不同，答案就不同。
 *
 * `priority` 决定先问哪一个：时间与损失承受力是 1 档（它们直接决定
 * 实验能做多大、停止信号画在哪），其余是 2 档。
 */
function unknownsOf(rawQuestion: string, profile: PlayerProfile): readonly UnknownVariable[] {
  const unknowns: UnknownVariable[] = [];
  const question = normalize(rawQuestion);

  /** 原话里有没有提到「时间」。 */
  const mentionsTime = /小时|时间|月|周|天|忙|空|精力/.test(question);
  if (!mentionsTime) {
    unknowns.push({
      id: 'unknown-time',
      label: '你未来两周能稳定拿出多少时间',
      whyItMatters: '它决定后面那个实验做多大 —— 不该要求你挤出没有的时间。',
      origin: 'missing-user-context',
      priority: 1,
    });
  }

  const mentionsLoss = /不能|不敢|怕|担心|影响|损失|代价/.test(question);
  if (!mentionsLoss) {
    unknowns.push({
      id: 'unknown-loss',
      label: '哪种损失是你不愿意接受的',
      whyItMatters: '它会变成实验的停止信号 —— 一旦碰到这条线就不该继续加注。',
      origin: 'missing-user-context',
      priority: 1,
    });
  }

  /**
   * 档案里没有任何资源信息 → 不知道他能迁移什么。
   *
   * 这是 `evidence-gap` 而不是 `missing-user-context`：
   * 即使他写了原话，我们也可能没从中提取出可迁移的资源，
   * 这时缺的是**证据**，不是他的表述。
   */
  if (profile.resources.length === 0) {
    unknowns.push({
      id: 'unknown-resources',
      label: '你手上已有的资源（时间、技能、人脉）',
      whyItMatters: '它决定这条走法的启动成本 —— 别人从零开始，你可能不用。',
      origin: 'evidence-gap',
      priority: 2,
    });
  }

  return unknowns;
}

/* -------------------------------------------------------------------------- */
/* 4. 主函数                                                                   */
/* -------------------------------------------------------------------------- */

export interface BuildProblemFrameInput {
  readonly question: string;
  readonly profile: PlayerProfile;
  /** 模型写的自由文本处境分析；没有就 null。 */
  readonly analysis: string | null;
}

/**
 * 把已有的 `PlayerProfile` 转成 `ProblemFrame`。
 *
 * **纯函数**：同样的输入必得同样的 frame。这一点很重要 ——
 * 后面 `/api/sessions` 会在请求里复用同一次档案结果，
 * 如果 frame 里带了时间或随机，会话之间就不可复现了。
 */
export function buildProblemFrame(input: BuildProblemFrameInput): ProblemFrame {
  const { question, profile, analysis } = input;

  /**
   * 解析完整度。
   *
   * **只表示「我们解析得有多完整」，不是成功概率、不是匹配度。**
   * 计算方式刻意简单可复核：硬条件越多、分析越完整，分越高。
   */
  const hardCount = [
    ...profile.constraints,
    ...profile.fears,
    ...profile.resources,
  ].filter((item) => appearsExplicitly(question, item)).length;
  const completeness =
    (hardCount >= 3 ? 0.5 : hardCount >= 1 ? 0.3 : 0.1) +
    (profile.keyTension.trim().length > 0 ? 0.2 : 0) +
    (analysis && analysis.trim().length > 0 ? 0.2 : 0) +
    (profile.target.trim().length > 0 ? 0.1 : 0);
  const parseConfidence = Number(Math.min(1, Math.max(0, completeness)).toFixed(2));

  return {
    rawQuestion: question,

    currentSituation: profile.background,
    desiredChange: profile.target,

    constraints: statementsOf(question, profile.constraints, 'constraint'),
    resources: statementsOf(question, profile.resources, 'resource'),
    // 恐惧属于主观状态，一律不标 hard：连「我害怕」也不是一个可核对的现实条件
    concerns: statementsOf(question, profile.fears, 'concern').map((item) => ({
      ...item,
      hard: false,
      origin: item.origin === 'user-explicit' ? item.origin : 'parser-synthesis',
    })),

    centralTension: profile.keyTension,
    unknowns: unknownsOf(question, profile),
    parseConfidence,
  };
}
