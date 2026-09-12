import type { WorldBlueprint } from '@/features/game-world/domain';
import type { PlayerProfile } from '@/core/dm/profile';

/**
 * Session ↔ Play ↔ DM 的桥接契约（Phase 12-13 / P0-G）。
 *
 * ## 为什么不把整个 DecisionSession 搬进客户端
 *
 * Session 是服务端概念（ownerId、检索运行记录、legacy 字段都在里面）。
 * `/play` 需要的只有四样：问题、档案、分析、蓝图。窄接口让
 * 「游戏消费世界」这件事一目了然，也让未来换专用 endpoint 不用动游戏代码。
 */

/** `/play?session=<id>` 从 `GET /api/sessions/:id` 里取的最小视图。 */
export interface PlaySessionView {
  readonly id: string;
  readonly question: string;
  readonly profile: PlayerProfile | null;
  readonly profileAnalysis: string | null;
  readonly worldBlueprint: WorldBlueprint;
}

/** 注入 DM prompt 的本幕世界上下文（长度有硬上限，防 prompt 爆炸）。 */
export interface DmWorldContext {
  readonly sessionId: string;
  readonly centralTension: string;
  readonly actObjective:
    | 'enter-world'
    | 'experience-cost'
    | 'meet-counterexample'
    | 'final-reflection';
  readonly actConflict: string;
  readonly keyUnknown: string | null;
  readonly sourceFacts: readonly {
    readonly id: string;
    readonly quote: string;
    readonly sourceUrl: string;
    readonly author: string;
  }[];
  readonly differences: readonly {
    readonly variable: string;
    readonly relation: 'same' | 'different' | 'unknown';
    readonly userValue?: string;
    readonly experienceValue?: string;
  }[];
  readonly forbiddenClaims: readonly string[];
}

/** 注入 DM 的经验解锁（P0-H：让真实经验变成一个新选项）。 */
export interface DmExperienceUnlock {
  readonly unlockId: string;
  readonly label: string;
  readonly choiceText: string;
  readonly hint: string;
  readonly sourceFactIds: readonly string[];
}

const MAX_CONTEXT_FACTS = 6;
const MAX_CONTEXT_DIFFERENCES = 4;

/**
 * 取某一幕的世界上下文。**纯函数**。
 *
 * turnIndex 是 0 基（第 1 幕 = 0）；超过四幕时钳到终局反思 ——
 * AI 动态幕可能跑到 7-8 幕，那些幕都按「final-reflection」处理。
 */
export function worldContextForTurn(
  blueprint: WorldBlueprint,
  turnIndex: number,
): DmWorldContext {
  const actSpec = blueprint.acts[Math.min(Math.max(turnIndex, 0), blueprint.acts.length - 1)]
    ?? blueprint.acts[blueprint.acts.length - 1];

  const factById = new Map(blueprint.experienceFacts.map((fact) => [fact.id, fact]));
  const sourceFacts = (actSpec?.experienceFactIds ?? [])
    .map((id) => factById.get(id))
    .filter((fact): fact is NonNullable<typeof fact> => fact !== undefined)
    .slice(0, MAX_CONTEXT_FACTS)
    .map((fact) => ({
      id: fact.id,
      quote: fact.exactQuote,
      sourceUrl: fact.sourceUrl,
      author: fact.author,
    }));

  // 差异：different 最有信息量，排前面；封顶 4 条
  const DIFFERENT_FIRST: Record<string, number> = { different: 0, same: 1, unknown: 2 };
  const differences = blueprint.paths
    .flatMap((path) => path.differencesFromUser)
    .sort((left, right) => (DIFFERENT_FIRST[left.relation] ?? 3) - (DIFFERENT_FIRST[right.relation] ?? 3))
    .filter((difference, index, all) => all.findIndex((item) => item.variable === difference.variable) === index)
    .slice(0, MAX_CONTEXT_DIFFERENCES)
    .map((difference) => ({
      variable: difference.variable,
      relation: difference.relation,
      ...(difference.userValue !== undefined ? { userValue: difference.userValue } : {}),
      ...(difference.experienceValue !== undefined ? { experienceValue: difference.experienceValue } : {}),
    }));

  return {
    sessionId: blueprint.sessionId,
    centralTension: blueprint.centralTension,
    actObjective: actSpec?.objective ?? 'final-reflection',
    actConflict: actSpec?.conflict ?? '',
    keyUnknown: blueprint.keyUnknown?.label ?? null,
    sourceFacts,
    differences,
    forbiddenClaims: [...blueprint.forbiddenClaims],
  };
}

/**
 * 取当前应该注入的解锁项。
 *
 * 规则：该解锁已到出场幕（availableFromAct ≤ 当前幕）且尚未使用。
 * 一次只注入一个 —— 两个新选项同时出现会稀释「这条选择来自真实经验」
 * 的可感知度。
 */
export function unlockForTurn(
  blueprint: WorldBlueprint,
  turnIndex: number,
  usedUnlockIds: readonly string[],
): DmExperienceUnlock | null {
  const used = new Set(usedUnlockIds);
  const currentAct = turnIndex + 1;
  const unlock = blueprint.unlocks.find(
    (item) => item.availableFromAct <= currentAct && !used.has(item.id),
  );
  if (!unlock) {
    return null;
  }
  return {
    unlockId: unlock.id,
    label: unlock.label,
    choiceText: unlock.choice.text,
    hint: unlock.choice.hint,
    sourceFactIds: [...unlock.sourceFactIds],
  };
}
