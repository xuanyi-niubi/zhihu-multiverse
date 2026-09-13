import type { EncounterPlan } from '@/features/game-mechanics/domain';
import type {
  ExperienceCase,
  ExperienceFact,
  UserDifference,
} from '@/features/experience/domain';

/**
 * Encounter 的诚实校验（§54-§60 / §81）。
 *
 * 这是这套玩法机制的最高纪律：**不为了「游戏性」造假**。
 *
 * ```text
 * 没有真实 action  → 不要 PATH UNLOCK
 * 没有真实 cost    → 不要 COST REVEAL
 * 没有真实反例     → 不要 EXPERIENCE CONFLICT
 * ```
 *
 * 校验器把这些纪律变成可断言的形状：返回的非空 issues 意味着
 * 这条 Encounter 必须被丢弃，而不是照常展示。
 */

export interface EncounterValidationInput {
  readonly facts: readonly ExperienceFact[];
  readonly cases: readonly ExperienceCase[];
  readonly differences: readonly UserDifference[];
  readonly unknownIds: readonly string[];
}

export function validateEncounterPlan(
  plan: EncounterPlan,
  input: EncounterValidationInput,
): readonly string[] {
  const issues: string[] = [];
  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));

  switch (plan.payload.kind) {
    case 'path_unlock': {
      if (plan.sourceFactIds.length === 0) {
        issues.push('path_unlock 缺少来源事实');
      }
      for (const factId of plan.sourceFactIds) {
        const fact = factById.get(factId);
        if (!fact) {
          issues.push(`path_unlock 引用了不存在的事实 ${factId}`);
          continue;
        }
        if (fact.type !== 'action') {
          issues.push(`path_unlock 只能由 action 事实解锁：${factId} 是 ${fact.type}`);
        }
      }
      break;
    }

    case 'condition_shift': {
      for (const change of plan.payload.changes) {
        const difference = input.differences.find((item) => item.variable === change.variable);
        if (!difference) {
          issues.push(`condition_shift 借用了未记录的差异：${change.variable}`);
          continue;
        }
        if (change.hypothetical !== true) {
          issues.push(`condition_shift 条件未标记 hypothetical：${change.variable}`);
        }
      }
      if (plan.payload.changes.length === 0) {
        issues.push('condition_shift 没有任何可借用条件');
      }
      break;
    }

    case 'experience_conflict': {
      if (plan.sourceCaseIds.length < 2) {
        issues.push('experience_conflict 至少需要两个真实 case');
      }
      for (const caseId of plan.sourceCaseIds) {
        if (!input.cases.some((item) => item.id === caseId)) {
          issues.push(`experience_conflict 引用了不存在的 case：${caseId}`);
        }
      }
      break;
    }

    case 'cost_reveal': {
      const supported = plan.sourceFactIds.some(
        (factId) => factById.get(factId)?.type === 'cost',
      );
      if (!supported) {
        issues.push('cost_reveal 必须由 cost 事实支撑');
      }
      if (plan.payload.affectedActionIds.length === 0) {
        issues.push('cost_reveal 必须真正改变行动空间');
      }
      break;
    }

    case 'unknown_lock': {
      if (!input.unknownIds.includes(plan.payload.unknownId)) {
        issues.push(`unknown_lock 引用了不存在的未知：${plan.payload.unknownId}`);
      }
      break;
    }
  }

  return issues;
}

/** 批量校验，过滤掉不诚实的 Encounter。 */
export function filterValidEncounters(
  plans: readonly EncounterPlan[],
  input: EncounterValidationInput,
): readonly EncounterPlan[] {
  return plans.filter((plan) => validateEncounterPlan(plan, input).length === 0);
}
