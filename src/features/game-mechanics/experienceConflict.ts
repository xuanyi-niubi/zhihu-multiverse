import type { ExperienceCase, ExperiencePath, UnknownVariable, UserDifference } from '@/features/experience/domain';

/**
 * EXPERIENCE CONFLICT（§7-§8 / §56 / §79）。
 *
 * ## 不裁决，只指出分歧
 *
 * 两段真实知乎人生给出不同甚至相反的经验时，系统**不给标准答案**：
 * 让玩家判断「真正决定差异的条件是什么」。玩家选出的只是
 * `focusVariable`（接下来重点观察哪一个变量），不是因果结论（§50）。
 *
 * ## 反例必须真实
 *
 * 没有两个真实 case 就不生成 conflict —— 禁止模型凭空构造反例。
 */

export interface ExperienceConflictCandidate {
  /** 两个真实 case，稳定排序。 */
  readonly caseIds: readonly [string, string];
  readonly supportingFactIds: readonly string[];
  /** 玩家可选的「重点观察变量」，来自已知差异 / 未知；不编码因果。 */
  readonly candidateFocusVariables: readonly string[];
}

export interface ExperienceConflictContext {
  readonly differences?: readonly UserDifference[];
  readonly unknowns?: readonly UnknownVariable[];
  readonly paths?: readonly ExperiencePath[];
}

function quoteKey(facts: readonly { readonly exactQuote: string }[]): string {
  return facts
    .map((fact) => fact.exactQuote.trim())
    .sort()
    .join('\u0001');
}

function diverges(
  left: readonly { readonly exactQuote: string }[],
  right: readonly { readonly exactQuote: string }[],
): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  return quoteKey(left) !== quoteKey(right);
}

/** 路径层是否明确把两个 case 标成对立。 */
function opposingPairs(paths: readonly ExperiencePath[]): ReadonlySet<string> {
  const pairs = new Set<string>();
  for (const path of paths) {
    for (const supporting of path.supportingCaseIds) {
      for (const opposing of path.opposingCaseIds) {
        pairs.add([supporting, opposing].sort().join('|'));
      }
    }
  }
  return pairs;
}

/** 玩家可选的观察变量：只来自已知差异与未知，不凭空发明。 */
function focusVariablesFrom(context: ExperienceConflictContext): readonly string[] {
  const variables = new Set<string>();
  for (const difference of context.differences ?? []) {
    if (difference.relation !== 'same') {
      variables.add(difference.variable);
    }
  }
  for (const unknown of context.unknowns ?? []) {
    variables.add(unknown.label);
  }
  return [...variables].sort().slice(0, 5);
}

/**
 * 从真实 case 中找出最有分歧的一对（§56）。
 *
 * 分歧打分（越高越显著）：
 * - 结果不同：+3（两 case 都有 outcome 且文本不同）
 * - 行动不同：+2
 * - 反思不同：+2
 * - 路径层明确标为对立：+3
 *
 * 没有任何分歧（score 0）→ 返回 null，退化为普通选择，不硬造冲突。
 */
export function findExperienceConflict(
  cases: readonly ExperienceCase[],
  context: ExperienceConflictContext = {},
): ExperienceConflictCandidate | null {
  if (cases.length < 2) {
    return null;
  }

  const ordered = [...cases].sort((left, right) => left.id.localeCompare(right.id));
  const opposing = opposingPairs(context.paths ?? []);

  let best: { readonly score: number; readonly left: ExperienceCase; readonly right: ExperienceCase } | null = null;

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const left = ordered[i]!;
      const right = ordered[j]!;
      let score = 0;
      if (diverges(left.outcomes, right.outcomes)) {
        score += 3;
      }
      if (diverges(left.actions, right.actions)) {
        score += 2;
      }
      if (diverges(left.reflections, right.reflections)) {
        score += 2;
      }
      if (opposing.has([left.id, right.id].sort().join('|'))) {
        score += 3;
      }
      if (score === 0) {
        continue;
      }
      if (!best || score > best.score) {
        best = { score, left, right };
      }
    }
  }

  if (!best) {
    return null;
  }

  const supportingFactIds = [
    ...best.left.outcomes,
    ...best.right.outcomes,
    ...best.left.actions,
    ...best.right.actions,
  ]
    .map((fact) => fact.id)
    .filter((id, index, all) => all.indexOf(id) === index);

  return {
    caseIds: [best.left.id, best.right.id] as const,
    supportingFactIds,
    candidateFocusVariables: focusVariablesFrom(context),
  };
}
