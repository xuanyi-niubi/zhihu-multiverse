/**
 * 知乎内容飞回路 · 世界线存档卡（纯函数，零模型）。
 *
 * ## 它解决什么
 *
 * 在这之前，「七天现实支线」是**单机**的：玩家复制走一张票，一局就散了。
 * 产品只有消费端 —— 从知乎取，不回知乎给。计划书里「为知乎生态创造价值」
 * 因此只是说法，没有回路。
 *
 * 这一层把终局变成**生产端**：玩家带走的不只是一张计划票，还有一份
 * 可以直接粘进知乎回答框的**写作脚手架**。他去知乎写下自己的经历，
 * 那条回答就成了真实站内内容。
 *
 * ## 回路为什么不需要"登记"，也不需要给玩家开后门
 *
 * 直觉方案是「让玩家把回答登记进来，成为经验来源」—— 但那会直接砸掉
 * 这个产品最硬的招牌：证据层只接受 `status: 'verified'`，且 `exactQuote`
 * 必须是知乎原文的逐字子串（`experience/validate.ts`）。玩家自述是
 * **未经核验的一面之词**，一旦进入证据层，「逐字可溯源」就废了。
 *
 * 所以这里**种到知乎上，而不是收进库里**：
 *
 * ```text
 * 玩家终局 → 脚手架引导他回知乎写回答
 *   ↓（他真写了，知乎上多了一条真实回答）
 * 下一次别人检索相似处境 → 官方检索把它抓回来
 *   ↓（与任何一条站内内容走完全相同的路径）
 * searchItemToSource → status: 'verified'
 *   ↓
 * validateExtractedFact 逐字校验通过 → 成为下一位玩家的经验来源
 * ```
 *
 * 回路通过**知乎自身**闭合，核验纪律一个字都不用改。
 * 今天的玩家，就是未来玩家的经验来源 —— 而且是真的。
 *
 * ## 一条不可违反的纪律：不替玩家写他自己的经历
 *
 * 脚手架只**预填系统真的知道的东西**（他的问题、本局收敛出的未知、
 * 他采用过的真实引用）。属于他个人的四栏 —— 处境 / 做了什么 / 代价 /
 * 后来怎样 —— **一律留空**，等他写。
 *
 * 替他填一句「我脱产备考了三个月」，就是在制造一条假经历，
 * 而且会被他真的粘到知乎上去。那比编一条来源更坏。
 */

/* -------------------------------------------------------------------------- */
/* 输入：只声明真正用到的字段（结构兼容 SessionEndgameView，不做深度耦合）        */
/* -------------------------------------------------------------------------- */

/** 一条有出处的引用（与 `EndgameEvidence` 结构一致）。 */
export interface CitedQuote {
  readonly quote: string;
  readonly author: string;
  readonly sourceUrl: string;
}

/** 本局终局里**真实发生过**的素材。缺一项就不写那一项，绝不补。 */
export interface WorldlineCardInput {
  readonly sessionId: string;
  /** 玩家进来时问的原句（不允许模型润色覆盖）。 */
  readonly originalQuestion: string;
  /** 本局收敛出的、只有现实能回答的那个问题；没有就是 null。 */
  readonly rewrittenQuestion: string | null;
  readonly walked: readonly string[];
  readonly taken: readonly CitedQuote[];
  readonly borrowed: readonly CitedQuote[];
  readonly costs: readonly CitedQuote[];
  readonly counter: CitedQuote | null;
  readonly unknown: string | null;
  readonly realityPass: {
    readonly timebox: string;
    readonly action: string;
    readonly successSignal: string;
    readonly stopSignal: string;
  } | null;
  /** 有出处的回顾条目（可为空）。 */
  readonly highlights: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 输出                                                                        */
/* -------------------------------------------------------------------------- */

export interface WorldlineCard {
  /** 卡号，例如 `WL-7f3a91c2`。稳定可复现（同 sessionId 必得同卡号）。 */
  readonly code: string;
  /** 玩家的问题（存档卡抬头）。 */
  readonly question: string;
  /** 这一局真正走过的路（≤3 条）。 */
  readonly walked: readonly string[];
  /** 撞见的反例（没有就不显示 —— 不拿支持片段硬充）。 */
  readonly counter: CitedQuote | null;
  /** 仍然不知道的那一项。 */
  readonly unknown: string | null;
  /** 带走的一整段存档文本（可直接复制/截图/手抄）。 */
  readonly archiveText: string;
  /** 可直接粘进知乎回答框的写作脚手架。 */
  readonly draftText: string;
  /**
   * 去知乎写回答的入口。
   *
   * 不能直接构造「新建回答」链接（知乎没有公开的这样的 URL），
   * 所以给的是**按问题检索**的入口 —— 他顺着能找到那个问题并作答。
   */
  readonly zhihuHref: string;
  /** 给玩家看的一句话闭环说明。 */
  readonly loopStatement: string;
}

/* -------------------------------------------------------------------------- */
/* 纯函数                                                                      */
/* -------------------------------------------------------------------------- */

/** 卡号：从 sessionId 取 8 位稳定短码（同输入必得同输出）。 */
export function worldlineCode(sessionId: string): string {
  const compact = sessionId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (compact.length === 0) {
    return 'WL-00000000';
  }
  // 短码本身不可逆推 sessionId，也不承载任何"评分"含义 —— 它只是编号。
  return `WL-${compact.slice(-8).padStart(8, '0')}`;
}

/** 去知乎找/答这个问题的入口（检索页，不放任何伪造的 deep link）。 */
export function zhihuHrefFor(question: string): string {
  const q = question.trim();
  return `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`;
}

/** 给玩家看的闭环说明 —— 这一句就是「为知乎生态创造价值」的可读版本。 */
export const LOOP_STATEMENT =
  '你写下的这条回答，会在被知乎检索核验之后，成为下一个和你处境相同的人检索到的经验来源。' +
  '今天的你，就是明天别人的「另一种走法」。';

function citedLines(label: string, items: readonly CitedQuote[]): readonly string[] {
  if (items.length === 0) {
    return [];
  }
  return [label, ...items.map((item) => `  「${item.quote}」—— ${item.author} ${item.sourceUrl}`)];
}

/**
 * 组装世界线存档卡。**纯函数**：同输入必得同输出。
 *
 * 一切"没有就不写"：没有反例就不提反例，没有实验就不写支线，
 * 没有走过的路就如实说这一局没有引用到真实经历。
 */
export function worldlineCardOf(input: WorldlineCardInput): WorldlineCard {
  const walked = input.walked.slice(0, 3);
  const unknown = input.unknown ?? input.rewrittenQuestion;

  const archiveText = [
    '知乎平行宇宙 · 世界线存档',
    `卡号：${worldlineCode(input.sessionId)}`,
    '',
    `我带来的问题：${input.originalQuestion}`,
    unknown ? `这一局收敛出的未知：${unknown}` : '这一局没有收敛出新的未知 —— 我们没替你编一个。',
    '',
    ...(walked.length > 0
      ? ['这一局真实走过的路：', ...walked.map((w) => `  · ${w}`)]
      : ['这一局没有引用到真实经历 —— 我们不为了填满这张卡编一段。']),
    ...(input.highlights.length > 0 ? ['', '这一局发生过：', ...input.highlights.map((h) => `  · ${h}`)] : []),
    ...(input.taken.length > 0 ? ['', ...citedLines('我采用过的真实经验：', input.taken)] : []),
    ...(input.borrowed.length > 0 ? ['', ...citedLines('真实的人是怎么做的：', input.borrowed)] : []),
    ...(input.costs.length > 0 ? ['', ...citedLines('他们付出的代价：', input.costs)] : []),
    ...(input.counter
      ? ['', '撞见的反例（结果完全相反的人）：', `  「${input.counter.quote}」—— ${input.counter.author} ${input.counter.sourceUrl}`]
      : []),
    ...(input.realityPass
      ? [
          '',
          '带回现实的支线：',
          `  时间盒：${input.realityPass.timebox}`,
          `  要做的事：${input.realityPass.action}`,
          `  成功信号：${input.realityPass.successSignal}`,
          `  停止信号：${input.realityPass.stopSignal}`,
        ]
      : []),
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  /**
   * 写作脚手架。
   *
   * 四栏**故意留空**：那是他的经历，只能他自己写。
   * 预填的每一项都有出处（来自本局真实数据），没有一项是我们编的。
   */
  const draftText = [
    '【把下面这段粘进知乎回答框，再按你自己的真实经历填完】',
    '',
    `问题：${input.originalQuestion}`,
    '',
    '我的处境：（写下你当时的条件 —— 时间、钱、基础、退路）',
    '',
    '我做了什么：（具体到能被人复现的动作，别写"努力了"）',
    '',
    '我付出的代价：（花了多久、失去了什么、有没有后悔）',
    '',
    '后来怎么样：（真实的进展或结果，包括没成）',
    '',
    `我还没有弄清：${unknown ?? '（这一栏由你写）'}`,
    '',
    ...(input.taken.length + input.borrowed.length > 0
      ? [
          '帮到我的真实经历：（可选，把真的有用的那条附上出处）',
          ...[...input.taken, ...input.borrowed].slice(0, 2).map((c) => `  「${c.quote}」—— ${c.author} ${c.sourceUrl}`),
          '',
        ]
      : []),
    '——',
    LOOP_STATEMENT,
  ].join('\n');

  return {
    code: worldlineCode(input.sessionId),
    question: input.originalQuestion,
    walked,
    counter: input.counter,
    unknown,
    archiveText,
    draftText,
    zhihuHref: zhihuHrefFor(input.originalQuestion),
    loopStatement: LOOP_STATEMENT,
  };
}
