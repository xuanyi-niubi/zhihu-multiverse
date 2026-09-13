import type {
  ActionOption,
  EncounterPlan,
  EncounterType,
  ExperienceConflictPayload,
  PathUnlockPayload,
} from '@/features/game-mechanics/domain';
import { conditionShiftOptionsFromDifferences } from '@/features/game-mechanics/conditionShift';
import { costRevealCandidate, costRevealPayload, closableUserActions } from '@/features/game-mechanics/costReveal';
import { findExperienceConflict } from '@/features/game-mechanics/experienceConflict';
import {
  actionFacts,
  pathUnlockPayloadFromFact,
  pathUnlockPayloadFromUnlock,
  type UnlockSource,
} from '@/features/game-mechanics/pathUnlock';
import { unknownLockCandidate, unknownLockPayload } from '@/features/game-mechanics/unknownLock';
import { filterValidEncounters } from '@/features/game-mechanics/validate';
import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Encounter Composer（§13-§16 / §44-§45 / §59 / §81）。
 *
 * ## 每局不使用全部 Encounter
 *
 * 固定「PATH → CONDITION → CONFLICT → COST → UNKNOWN」会再次公式化。
 * 正确的做法是让**数据决定**这一局用哪 2～3 种：
 *
 * ```text
 * 有 action fact        → PATH UNLOCK 可用
 * 有 meaningful diff     → CONDITION SHIFT 可用
 * 有相反 outcome 的 case → EXPERIENCE CONFLICT 可用
 * 有 cost fact + 可关行动 → COST REVEAL 可用
 * 有 unresolved variable → UNKNOWN LOCK 可用
 * ```
 *
 * ## Composer 不是 AI 自由发挥
 *
 * 这里只有代码规则 + 确定性打分，**不新增 EncounterAgent**，
 * 不调用任何模型。证据不足时允许只生成 1 个甚至 0 个。
 */

/** 类型去重时的稳定顺序。 */
const TYPE_ORDER: readonly EncounterType[] = [
  'path_unlock',
  'condition_shift',
  'cost_reveal',
  'experience_conflict',
  'unknown_lock',
];

export interface ComposeEncountersInput {
  readonly frame: ProblemFrame;
  readonly cases: readonly ExperienceCase[];
  readonly facts: readonly ExperienceFact[];
  readonly differences: readonly UserDifference[];
  readonly paths?: readonly ExperiencePath[];
  /** 现有 `ExperienceChoiceUnlock`（PATH UNLOCK 直接复用，§35）。 */
  readonly unlocks?: readonly UnlockSource[];
  /** 当前已知的用户行动空间（用于判断「新行动确实不在其中」）。 */
  readonly actions?: readonly ActionOption[];
  readonly keyUnknown: UnknownVariable | null;
  /** 上限，默认 3；下限 0（§59）。 */
  readonly maxEncounters?: number;
}

interface RankedEncounter {
  readonly type: EncounterType;
  readonly score: number;
  readonly plan: EncounterPlan;
}

function toAct(value: number): 1 | 2 | 3 {
  if (value <= 1) {
    return 1;
  }
  if (value >= 3) {
    return 3;
  }
  return 2;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

/** 有效差异：入参优先，否则从路径上取（去重后交给各模块）。 */
function effectiveDifferences(input: ComposeEncountersInput): readonly UserDifference[] {
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

/** 有效未知：显式 keyUnknown 优先，否则取问题框定里优先级最高的未知。 */
function effectiveUnknown(input: ComposeEncountersInput): UnknownVariable | null {
  if (input.keyUnknown) {
    return input.keyUnknown;
  }
  return [...input.frame.unknowns].sort((left, right) => left.priority - right.priority)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* 各 Encounter 的候选构造                                                      */
/* -------------------------------------------------------------------------- */

function pathUnlockCandidate(input: ComposeEncountersInput): RankedEncounter | null {
  const userFactIds = new Set((input.actions ?? []).flatMap((action) => action.sourceFactIds));

  const unlocks = [...(input.unlocks ?? [])].sort(
    (left, right) => left.availableFromAct - right.availableFromAct || left.id.localeCompare(right.id),
  );

  if (unlocks.length > 0) {
    const unlock = unlocks[0]!;
    const isNew = unlock.sourceFactIds.every((id) => !userFactIds.has(id));
    const payload: PathUnlockPayload = pathUnlockPayloadFromUnlock(unlock);
    return {
      type: 'path_unlock',
      score: 3 + (isNew ? 2 : 0),
      plan: {
        id: `encounter-path-unlock-${unlock.id}`,
        type: 'path_unlock',
        act: toAct(unlock.availableFromAct),
        sourceFactIds: uniqueSorted(unlock.sourceFactIds),
        sourceCaseIds: [],
        payload,
      },
    };
  }

  // 兜底：没有现成 unlock 时，从真实行动片段直接构造
  const actions = actionFacts(input.facts);
  if (actions.length === 0) {
    return null;
  }
  const fact = actions[0]!;
  const payload = pathUnlockPayloadFromFact(fact);
  if (!payload) {
    return null;
  }
  const isNew = !userFactIds.has(fact.id);
  return {
    type: 'path_unlock',
    score: 3 + (isNew ? 2 : 0),
    plan: {
      id: `encounter-path-unlock-${fact.id}`,
      type: 'path_unlock',
      act: toAct(2),
      sourceFactIds: [fact.id],
      sourceCaseIds: [`case:${fact.sourceId}`],
      payload,
    },
  };
}

function conditionShiftCandidate(input: ComposeEncountersInput, differences: readonly UserDifference[]): RankedEncounter | null {
  const changes = conditionShiftOptionsFromDifferences(differences);
  if (changes.length === 0) {
    return null;
  }
  const variables = changes.map((change) => change.variable);
  const sourceFactIds = uniqueSorted(
    differences
      .filter((difference) => variables.includes(difference.variable))
      .flatMap((difference) => difference.evidenceFactIds),
  );
  return {
    type: 'condition_shift',
    score: 3 + 2,
    plan: {
      id: 'encounter-condition-shift',
      type: 'condition_shift',
      act: 1,
      sourceFactIds,
      sourceCaseIds: [],
      requiredDifferenceKeys: variables,
      payload: { kind: 'condition_shift', changes },
    },
  };
}

function experienceConflictCandidate(input: ComposeEncountersInput, differences: readonly UserDifference[]): RankedEncounter | null {
  const conflict = findExperienceConflict(input.cases, {
    differences,
    unknowns: input.frame.unknowns,
    paths: input.paths ?? [],
  });
  if (!conflict) {
    return null;
  }
  const payload: ExperienceConflictPayload = {
    kind: 'experience_conflict',
    caseIds: [...conflict.caseIds],
    supportingFactIds: uniqueSorted(conflict.supportingFactIds),
    candidateFocusVariables: conflict.candidateFocusVariables,
  };
  return {
    type: 'experience_conflict',
    score: 3 + 2,
    plan: {
      id: `encounter-experience-conflict-${conflict.caseIds.join('-')}`,
      type: 'experience_conflict',
      act: 3,
      sourceFactIds: uniqueSorted(conflict.supportingFactIds),
      sourceCaseIds: [...conflict.caseIds],
      payload,
    },
  };
}

function costRevealCandidateFor(input: ComposeEncountersInput): RankedEncounter | null {
  const closable = closableUserActions({
    available: input.actions ?? [],
    locked: [],
    unlocked: [],
    removed: [],
  });
  const candidate = costRevealCandidate({
    facts: input.facts,
    affectedActionIds: closable.slice(0, 1).map((action) => action.id),
  });
  if (!candidate) {
    return null;
  }
  return {
    type: 'cost_reveal',
    score: 3 + 2,
    plan: {
      id: 'encounter-cost-reveal',
      type: 'cost_reveal',
      act: 2,
      sourceFactIds: candidate.sourceFactIds,
      sourceCaseIds: candidate.sourceCaseIds,
      payload: costRevealPayload(candidate),
    },
  };
}

function unknownLockCandidateFor(input: ComposeEncountersInput): RankedEncounter | null {
  const unknown = effectiveUnknown(input);
  if (!unknown) {
    return null;
  }
  const userActions = (input.actions ?? []).filter((action) => action.source === 'user');
  const candidate = unknownLockCandidate({
    unknown,
    affectsActionIds: userActions.slice(0, 1).map((action) => action.id),
  });
  return {
    type: 'unknown_lock',
    score: 3 + (candidate.affectsActionIds.length > 0 ? 2 : 0),
    plan: {
      id: `encounter-unknown-lock-${unknown.id}`,
      type: 'unknown_lock',
      act: 3,
      sourceFactIds: [],
      sourceCaseIds: [],
      unknownId: unknown.id,
      payload: unknownLockPayload(candidate),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 主入口                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 根据真实数据组成 0～3 个 Encounter（§59）。
 *
 * 返回按 (act, 类型顺序) 排序的计划；证据不足时**允许 0 个**，
 * 绝不强行填满。
 */
export function composeEncounters(input: ComposeEncountersInput): readonly EncounterPlan[] {
  const max = Math.max(0, Math.min(3, input.maxEncounters ?? 3));
  if (max === 0) {
    return [];
  }

  const differences = effectiveDifferences(input);

  const ranked = [
    pathUnlockCandidate(input),
    conditionShiftCandidate(input, differences),
    costRevealCandidateFor(input),
    experienceConflictCandidate(input, differences),
    unknownLockCandidateFor(input),
  ].filter((candidate): candidate is RankedEncounter => candidate !== null);

  const selected = ranked
    .sort((left, right) => right.score - left.score || TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type))
    .slice(0, max);

  const valid = filterValidEncounters(
    selected.map((candidate) => candidate.plan),
    {
      facts: input.facts,
      cases: input.cases,
      differences,
      unknownIds: effectiveUnknown(input) ? [effectiveUnknown(input)!.id] : [],
    },
  );

  return [...valid].sort(
    (left, right) => left.act - right.act || TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type),
  );
}
