import type {
  ExperienceChoiceUnlock,
  WorldActSpec,
  WorldBlueprint,
} from '@/features/game-world/domain';
import { composeEncounters } from '@/features/game-mechanics/encounterComposer';
import { buildExperienceCases } from '@/features/experience/cases';
import type {
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * 世界蓝图编译（Phase 10 / P0-F）。
 *
 * ## 这是「经验」与「游戏」之间的那道编译层
 *
 * 以前：用户输入 → AI 直接写剧情（现实由模型临场发明）。
 * 现在：用户输入 → 经验引擎 → WorldBlueprint → AI DM。
 * AI 之后只能在蓝图**里面**创作，不能重新发明现实。
 *
 * ## 纯函数、零模型
 *
 * 同样的 (frame, paths, facts) 必得同样的蓝图 —— 这让「进入游戏前」
 * 的世界结构可测试、可复现。DM 的叙事创作发生在蓝图之后。
 *
 * ## 固定的是结构，不是内容
 *
 * 每局都是三幕：走进去 → 代价出现 → 反例出现。
 *
 * 第三幕结束后不再有「终局反思幕」——终局交还给现实：把用户原来的问题
 * 重写成一个他必须自己去验证的问题（见 `RealityQuestPanel` 与 keyUnknown）。
 * 幕里的**事实引用**全部来自真实检索片段；没有事实就如实留空，
 * 绝不伪造 —— 空内容的蓝图仍然成立，只是「这一局没有可引用的真实经验」。
 */

export interface CompileWorldBlueprintInput {
  readonly sessionId: string;
  readonly frame: ProblemFrame;
  readonly paths: readonly ExperiencePath[];
  readonly facts: readonly ExperienceFact[];
}

/** DM 不允许越过的现实边界。固定不变 —— 它们是产品的宪法条款。 */
const FORBIDDEN_CLAIMS: readonly string[] = [
  '不得把模拟结局写成现实预测',
  '不得宣称成功概率',
  '不得编造知乎来源',
  '不得把 parser-synthesis 当成用户明确事实',
  '不得替玩家做最终决定',
];

/** 每幕引用的事实数上限：DM prompt 的预算纪律从这里开始。 */
const FACTS_PER_ACT = 4;

/** 从片段里截第一小句做解锁的短标签（≤12 字）。 */
function shortLabel(quote: string): string {
  const head = quote.split(/[。；;，,！!？?]/)[0] ?? quote;
  return [...head].slice(0, 12).join('');
}

function factsByIds(facts: readonly ExperienceFact[], ids: readonly string[]): readonly ExperienceFact[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return ids.map((id) => byId.get(id)).filter((fact): fact is ExperienceFact => fact !== undefined);
}

function dedupeById(facts: readonly ExperienceFact[]): readonly ExperienceFact[] {
  return facts.filter((fact, index, all) => all.findIndex((item) => item.id === fact.id) === index);
}

/** 路径标注的对立 case 对应的来源 id（`case:<sourceId>` → `sourceId`）。 */
function opposingSourceIdsOf(paths: readonly ExperiencePath[]): ReadonlySet<string> {
  const CASE_PREFIX = 'case:';
  return new Set(
    paths
      .flatMap((path) => path.opposingCaseIds)
      .map((id) => (id.startsWith(CASE_PREFIX) ? id.slice(CASE_PREFIX.length) : id)),
  );
}

/**
 * 第三幕（遇见反例）的事实来源优先级（P0-7）。
 *
 * ## 为什么要有这份优先级
 *
 * 「反例」必须是**真的反对这条走法**的经历。早先的实现把「其它任意
 * reflection」当作反例兜底，于是第三幕可能拿一条支持性反思硬充反例 ——
 * 玩家以为看到了不同的声音，其实只是换个说法的附和。
 * 这个产品最不可替代的东西就是「我们主动去找反例」，破了这条就不剩什么了。
 *
 * 四轮优先级：
 *
 * 1. 路径聚类时明确标注的对立片段（`opposingFactIds`）；
 * 2. 检索阶段**作为反例**找来的片段（`purpose: counterexample`）；
 * 3. 检索阶段**作为失败经历**找来的片段（`purpose: failure`）；
 * 4. 路径标注的对立 case 所属来源的片段。
 *
 * 四轮都没有 → **返回空**，不退化成「随便一条反思」。
 * 空的时候文案会如实说明「这一局没有找到反例」——
 * 承认没有，比编一个更像是这个产品该有的样子。
 */
export function counterexampleFacts(
  paths: readonly ExperiencePath[],
  facts: readonly ExperienceFact[],
): readonly ExperienceFact[] {
  const opposingSourceIds = opposingSourceIdsOf(paths);

  const rounds: readonly (readonly ExperienceFact[])[] = [
    factsByIds(facts, paths.flatMap((path) => path.opposingFactIds)),
    facts.filter((fact) => fact.purposes.includes('counterexample')),
    facts.filter((fact) => fact.purposes.includes('failure')),
    facts.filter((fact) => opposingSourceIds.has(fact.sourceId)),
  ];

  for (const round of rounds) {
    const picked = dedupeById(round).slice(0, FACTS_PER_ACT);
    if (picked.length > 0) {
      return picked;
    }
  }
  return [];
}

/**
 * 解锁项：一条真实**行动**经验 → 一个此后才出现的游戏选择（P0-8）。
 *
 * ## 为什么只允许 `action`
 *
 * 解锁项的文案是「按『X』的路子先试一小步」——它会被渲染成一个
 * **可执行的游戏行动**。如果来源是 condition（例如「家里能支持两年」），
 * 这句话就变成「按『家里能支持两年』的路子先试一小步」：语义荒谬，
 * 而且把一个条件伪装成了一种方法。
 *
 * 所以没有行动经验就没有解锁。**一局没有 Experience Unlock 是允许的**
 * —— 那说明我们没找到「别人具体做了什么」，编一个反而是错的。
 */
function unlocksOf(paths: readonly ExperiencePath[], facts: readonly ExperienceFact[]): readonly ExperienceChoiceUnlock[] {
  const unlocks: ExperienceChoiceUnlock[] = [];
  /**
   * 行动片段的取用顺序（P0-8 之后的放宽）：
   *
   * 1. 这条路径自己的支持片段里的行动；
   * 2. 这条路径引用的那些人（supportingCaseIds）的动作；
   * 3. 本局检索到的行动里相关性最高的那一条。
   *
   * 放宽的理由：准入仍然只认 `type === 'action'`（必须是**真的有人做过的事**），
   * 但不再要求它恰好落在这条路径的 supportingFactIds 里 —— 实测这会让
   * 「真实经验解锁新行动」这个核心机制在真实数据上常常是 0。
   */
  /**
   * 行动片段里优先挑**真的写了动作**的那条。
   *
   * 规则判型会把「说白了竞赛不是混奖状」这类表态也算成 action，
   * 而解锁文案是「按『X』的路子先试一小步」—— 拿表态去填这个空
   * 会读起来很怪。这里用一组动作词做确定性筛选，不引入模型调用。
   */
  const ACTION_HINT = /(先|打算|决定|开始|试|做|找|报|拆|写|跑|投|组队|联系|问|拆解|升级|准备|报名)/;
  const actions = [...facts].filter((fact) => fact.type === 'action');
  const byVerb = actions.filter((fact) => ACTION_HINT.test(fact.exactQuote));
  const actionPool = byVerb.length > 0 ? byVerb : actions;
  const fallbackAction = [...actionPool].sort((left, right) => right.relevance - left.relevance)[0];
  const pathAction = (path: ExperiencePath): ExperienceFact | undefined => {
    const own = factsByIds(facts, path.supportingFactIds).filter(
      (fact) => fact.type === 'action' && ACTION_HINT.test(fact.exactQuote),
    )[0];
    if (own) {
      return own;
    }
    const caseIds = new Set(path.supportingCaseIds);
    const fromCase = actionPool.find((fact) => caseIds.has(`case:${fact.sourceId}`));
    return fromCase ?? fallbackAction;
  };

  const usedActionIds = new Set<string>();
  paths.slice(0, 3).forEach((path, index) => {
    const source = pathAction(path);
    if (!source) {
      return;
    }
    // 同一条真实行动只解锁一次 —— 三条一模一样的解锁是明显的错
    if (usedActionIds.has(source.id)) {
      return;
    }
    usedActionIds.add(source.id);
    const label = shortLabel(source.exactQuote);
    unlocks.push({
      id: `unlock-${path.id}`,
      label,
      description: source.exactQuote,
      sourceFactIds: [source.id],
      choice: {
        text: `按「${label}」的路子先试一小步`,
        hint: '这个选项来自一条真实经验 —— 你可以选择不参考它。',
        tags: { efficiency: 'indirect' },
      },
      availableFromAct: Math.min(2 + index, 3),
    });
  });
  return unlocks;
}

function actsOf(
  paths: readonly ExperiencePath[],
  facts: readonly ExperienceFact[],
  unlocks: readonly ExperienceChoiceUnlock[],
): readonly WorldActSpec[] {
  const primary = paths[0];
  const enterFacts = primary
    ? factsByIds(facts, primary.supportingFactIds).slice(0, FACTS_PER_ACT)
    : [];

  const costFacts = [
    // 代价优先取主路径的支持片段里的 cost，其次其它路径的 cost
    ...factsByIds(facts, primary?.supportingFactIds ?? []).filter((fact) => fact.type === 'cost'),
    ...facts.filter((fact) => fact.type === 'cost'),
  ]
    .filter((fact, index, all) => all.findIndex((item) => item.id === fact.id) === index)
    .slice(0, FACTS_PER_ACT);

  const counterFacts = counterexampleFacts(paths, facts);

  const unlockFor = (act: number): readonly string[] =>
    unlocks.filter((unlock) => unlock.availableFromAct === act).map((unlock) => unlock.id);

  return [
    {
      act: 1,
      objective: 'enter-world',
      evidenceRole: 'support',
      titleHint: primary ? `一个关于「${primary.label}」的开始` : '一个还没有经验的开始',
      conflict: primary ? primary.summary : '还没有找到走过这条路的人，这一局只能靠假设推进。',
      primaryPathIds: primary ? [primary.id] : [],
      experienceFactIds: enterFacts.map((fact) => fact.id),
      unlockIds: [],
    },
    {
      act: 2,
      objective: 'experience-cost',
      evidenceRole: 'cost',
      titleHint: '真实出现过的代价',
      conflict:
        costFacts.length > 0
          ? '走这条路的人提到过这些代价，现在轮到你了。'
          : '目前没有找到这条路上被明确写下代价的经历 —— 这本身就是风险。',
      primaryPathIds: primary ? [primary.id] : [],
      experienceFactIds: costFacts.map((fact) => fact.id),
      unlockIds: unlockFor(2),
    },
    {
      act: 3,
      objective: 'meet-counterexample',
      /**
       * `evidenceRole` 只在**真的有反例片段**时标注（P0-7）。
       *
       * 没有反例时留空 —— 让下游（DM / UI）能从「这一幕没有证据角色」
       * 读出「本幕没有可引用的反例」，而不是把 support 错当成反例。
       */
      ...(counterFacts.length > 0 ? { evidenceRole: 'counterexample' as const } : {}),
      titleHint: '另一个人的另一种结果',
      conflict:
        counterFacts.length > 0
          ? '有人走过相似的路，但走向了不同的结果。'
          : '这一局没有找到真正的反例经历 —— 我们不会拿支持片段硬充。没有反例，不等于没有风险。',
      primaryPathIds: paths.slice(1, 3).map((path) => path.id),
      experienceFactIds: counterFacts.map((fact) => fact.id),
      unlockIds: unlockFor(3),
    },
  ];
}

/** 终局反思的关键未知：优先用户自己的缺口（priority 1），其次路径上的分歧。 */
function keyUnknownOf(frame: ProblemFrame, paths: readonly ExperiencePath[]): UnknownVariable | null {
  const frameUnknowns = [...frame.unknowns].sort((left, right) => left.priority - right.priority);
  if (frameUnknowns[0]) {
    return frameUnknowns[0];
  }
  const pathUnknown = paths.flatMap((path) => path.unknowns).sort((left, right) => left.priority - right.priority)[0];
  return pathUnknown ?? null;
}

/**
 * 编译世界蓝图。**纯函数**：同输入必得同输出。
 */
export function compileWorldBlueprint(input: CompileWorldBlueprintInput): WorldBlueprint {
  const unlocks = unlocksOf(input.paths, input.facts);
  const cases = buildExperienceCases(input.facts);
  const keyUnknown = keyUnknownOf(input.frame, input.paths);

  /**
   * Encounter 计划（玩法机制 §二十二）：**可选**、纯数据、零模型。
   *
   * 它不推翻现有三幕，也不强制每局都有 —— 证据不足时返回空数组，
   * 蓝图照常成立（旧 snapshot 的 `encounters` 缺失同样是合法状态）。
   * `unlocks` 直接复用现有 `ExperienceChoiceUnlock`（§七 / §八）。
   */
  const encounters = composeEncounters({
    facts: input.facts,
    cases,
    differences: input.paths.flatMap((path) => path.differencesFromUser),
    unlocks,
    keyUnknown,
    frame: { unknowns: input.frame.unknowns },
    paths: input.paths,
  });

  return {
    version: 'world-blueprint-v1',
    sessionId: input.sessionId,
    problemFrame: input.frame,
    centralTension: input.frame.centralTension,
    paths: input.paths,
    keyUnknown,
    acts: actsOf(input.paths, input.facts, unlocks),
    experienceFacts: input.facts,
    /**
     * 卡片数据（§13）：把片段按来源聚成「一个人的一段经历」。
     * 只做分组，不新增内容 —— 与 Experience Engine 同一套 cases 规则。
     */
    experienceCases: cases,
    unlocks,
    encounters,
    forbiddenClaims: FORBIDDEN_CLAIMS,
  };
}
