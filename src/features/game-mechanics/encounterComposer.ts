import type {
  EncounterComposerInput,
  EncounterPlan,
  EncounterType,
  ExperienceCollision,
  PlayAction,
  UnknownLock,
} from '@/features/game-mechanics/domain';
import { actionFromExperienceUnlock } from '@/features/game-mechanics/pathReveal';
import { findExperienceCollision } from '@/features/game-mechanics/experienceCollision';
import { unknownLockFromKey } from '@/features/game-mechanics/unknownLock';
import type {
  ExperienceFact,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Encounter Composer（§十九-§二十）。
 *
 * ## 数据决定这一局用哪几种
 *
 * 固定顺序的机制表会让玩第二局就猜到套路。正确做法是让数据决定：
 *
 * ```text
 * 有有效 unlock           → PATH REVEAL（act 2）
 * 有 counterexample
 *   + primary case
 *   + difference          → EXPERIENCE COLLISION（act 3）
 * 有 keyUnknown           → UNKNOWN LOCK（act 3）
 * ```
 *
 * ## 最多 3 个，不随机，不硬补
 *
 * 上限 3；证据不足时允许只生成 1 个甚至 0 个。这里只有代码规则，
 * **不调用任何模型**（§二十八：不调用 LLM / 不调用 API / 不使用 React）。
 */

/** 类型去重与排序时的稳定顺序。 */
export const ENCOUNTER_TYPE_ORDER: readonly EncounterType[] = [
  'path-reveal',
  'experience-collision',
  'unknown-lock',
];

/** 有效差异：入参优先，为空时从路径上补齐（按变量去重，保持顺序）。 */
export function effectiveDifferences(input: EncounterComposerInput): readonly UserDifference[] {
  const fromInput = input.differences.length > 0 ? input.differences : [];
  const fromPaths = (input.paths ?? []).flatMap((path) => path.differencesFromUser);
  const merged = [...fromInput, ...fromPaths];
  const seen = new Set<string>();
  return merged.filter((difference) => {
    if (seen.has(difference.variable)) {
      return false;
    }
    seen.add(difference.variable);
    return true;
  });
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

function factsByIds(facts: readonly ExperienceFact[], ids: readonly string[]): readonly ExperienceFact[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return ids.map((id) => byId.get(id)).filter((fact): fact is ExperienceFact => fact !== undefined);
}

/* -------------------------------------------------------------------------- */
/* 三个机制各自的候选                                                           */
/* -------------------------------------------------------------------------- */

/**
 * PATH REVEAL 的真正来源是 `ExperienceChoiceUnlock`（§七）。
 *
 * 这里**复用** `actionFromExperienceUnlock` 的准入判断：没有 action fact
 * 的解锁不会变成行动，也就不会产生 plan。
 */
export function pathRevealActionFrom(
  input: EncounterComposerInput,
): { readonly unlockId: string; readonly action: PlayAction } | null {
  const ordered = [...input.unlocks].sort(
    (left, right) => left.availableFromAct - right.availableFromAct || left.id.localeCompare(right.id),
  );
  // 同一条真实行动只 reveal 一次（口径与 actionsFromExperienceUnlocks 一致）
  const seen = new Set<string>();
  for (const unlock of ordered) {
    const action = actionFromExperienceUnlock(unlock, input.facts);
    if (!action) {
      continue;
    }
    const key = action.sourceFactIds.join('\u0001');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    return { unlockId: unlock.id, action };
  }
  return null;
}

function pathRevealPlan(input: EncounterComposerInput): EncounterPlan | null {
  const revealed = pathRevealActionFrom(input);
  if (!revealed) {
    return null;
  }
  const action = revealed.action;
  const cases = uniqueSorted(
    factsByIds(input.facts, action.sourceFactIds).map((fact) => `case:${fact.sourceId}`),
  );

  return {
    id: `encounter-path-reveal-${revealed.unlockId}`,
    type: 'path-reveal',
    act: 2,
    sourceFactIds: uniqueSorted(action.sourceFactIds),
    sourceCaseIds: cases,
    unlockId: revealed.unlockId,
  };
}

function collisionPlan(
  input: EncounterComposerInput,
  differences: readonly UserDifference[],
): EncounterPlan | null {
  const collision: ExperienceCollision | null = findExperienceCollision(input.cases, differences);
  if (!collision) {
    return null;
  }

  return {
    id: `encounter-experience-collision-${collision.primaryCaseId}-${collision.counterCaseId}`,
    type: 'experience-collision',
    act: 3,
    sourceFactIds: uniqueSorted([...collision.primaryFactIds, ...collision.counterFactIds]),
    sourceCaseIds: [collision.primaryCaseId, collision.counterCaseId],
    primaryCaseId: collision.primaryCaseId,
    counterCaseId: collision.counterCaseId,
    focusCandidates: collision.focusCandidates,
  };
}

function unknownLockPlan(input: EncounterComposerInput): EncounterPlan | null {
  const lock: UnknownLock | null = unknownLockFromKey({ keyUnknown: input.keyUnknown });
  if (!lock) {
    return null;
  }

  return {
    id: lock.id,
    type: 'unknown-lock',
    act: 3,
    sourceFactIds: [],
    sourceCaseIds: [],
    unknownId: lock.id,
    unknownLabel: lock.label,
  };
}

/* -------------------------------------------------------------------------- */
/* 主入口                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 根据真实数据组成 0～3 个 Encounter（§二十）。
 *
 * 返回按 (act, 类型顺序) 排序的计划；证据不足时**允许 0 个**，
 * 绝不为了凑满 3 个而硬补，也绝不随机。
 */
export function composeEncounters(input: EncounterComposerInput): readonly EncounterPlan[] {
  const differences = effectiveDifferences(input);
  const candidates: readonly (EncounterPlan | null)[] = [
    pathRevealPlan(input),
    collisionPlan(input, differences),
    unknownLockPlan(input),
  ];

  const byType = new Map<EncounterType, EncounterPlan>();
  for (const plan of candidates) {
    if (!plan || byType.has(plan.type)) {
      continue;
    }
    byType.set(plan.type, plan);
  }

  return [...byType.values()]
    .sort(
      (left, right) =>
        left.act - right.act ||
        ENCOUNTER_TYPE_ORDER.indexOf(left.type) - ENCOUNTER_TYPE_ORDER.indexOf(right.type),
    )
    .slice(0, 3);
}
