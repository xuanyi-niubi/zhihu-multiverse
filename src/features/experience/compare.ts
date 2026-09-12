import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UserDifference,
} from '@/features/experience/domain';

/**
 * 用户差异对照（Phase 9 / P0-E）。
 *
 * ## 这是产品价值核心，不是 UI 点缀
 *
 * 任何一段别人的经历，用户真正想问的是：
 *
 * ```text
 * 他和我哪里一样？哪里不同？哪里我们还不知道？
 * ```
 *
 * ## 纪律：不能明确比较 → unknown
 *
 * P0 不用模型，只做两类**能算清**的比较：
 *
 * 1. **数值可比**：双方都写了同单位的数字（每周 8 小时 vs 每周 30 小时）
 *    → 算术比较，差距大就是 different。这不是语义猜测，是四则运算；
 * 2. **逐字可比**：经历的条件片段里逐字含着用户的硬条件 → same。
 *
 * 其余一律 `unknown`。**绝不根据语义「猜差不多」** ——
 * 用户没说自己家境，系统猜「和他差不多」，那就是无中生有。
 */

/** 数值差异判定窗口：双方数值相差在此比例内算 same，否则 different。 */
const NUMERIC_TOLERANCE = 0.25;

/** 可比的数值单位。只有同单位才能做算术比较。 */
const COMPARABLE_UNITS: readonly string[] = ['小时', '个月', '年', '万元', '元'];

interface NumericClaim {
  readonly value: number;
  readonly unit: string;
}

/** 抽「数字 + 单位」声明（阿拉伯数字；中文数字不可靠，不猜）。 */
function numericClaims(text: string): readonly NumericClaim[] {
  const claims: NumericClaim[] = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*个?\s*(小时|个月|年|万元|元)/g)) {
    claims.push({ value: Number(match[1]), unit: match[2]! });
  }
  return claims;
}

/** 用户硬条件（只有 hard 的才参与比较 —— 推断出来的不是事实）。 */
function hardStatements(frame: ProblemFrame): readonly string[] {
  return frame.constraints.filter((item) => item.hard).map((item) => item.text);
}

function conditionFactsOf(experienceCase: ExperienceCase): readonly ExperienceFact[] {
  return experienceCase.conditions;
}

/**
 * 一条硬条件 vs 一段经历的条件片段 → 零到多个差异。
 *
 * 返回顺序稳定：数值比较在前（最可核查），逐字命中在后。
 */
export function compareUserToCase(input: {
  readonly frame: ProblemFrame;
  readonly experienceCase: ExperienceCase;
}): readonly UserDifference[] {
  const differences: UserDifference[] = [];
  const conditions = conditionFactsOf(input.experienceCase);
  const statements = hardStatements(input.frame);

  for (const statement of statements) {
    const userNumbers = numericClaims(statement);

    if (userNumbers.length > 0) {
      // 数值可比：找经历里同单位的第一个数字声明
      let resolved = false;
      for (const claim of userNumbers) {
        if (!COMPARABLE_UNITS.includes(claim.unit)) {
          continue;
        }
        for (const condition of conditions) {
          const counterpart = numericClaims(condition.exactQuote).find((item) => item.unit === claim.unit);
          if (counterpart === undefined) {
            continue;
          }
          const gap = Math.abs(counterpart.value - claim.value) / Math.max(claim.value, 1e-9);
          differences.push({
            variable: statement,
            userValue: `${claim.value}${claim.unit}`,
            experienceValue: `${counterpart.value}${counterpart.unit}`,
            relation: gap <= NUMERIC_TOLERANCE ? 'same' : 'different',
            evidenceFactIds: [condition.id],
          });
          resolved = true;
          break;
        }
        if (resolved) {
          break;
        }
      }
      if (!resolved) {
        // 用户给了数字，但这段经历没有同单位的声明 → 不可比，如实 unknown
        differences.push({
          variable: statement,
          userValue: statement,
          relation: 'unknown',
          evidenceFactIds: conditions.slice(0, 2).map((condition) => condition.id),
        });
      }
      continue;
    }

    // 非数值：只有逐字命中才敢说 same
    const hit = conditions.find((condition) => condition.exactQuote.includes(statement));
    differences.push({
      variable: statement,
      ...(hit ? { relation: 'same' as const, evidenceFactIds: [hit.id] } : { relation: 'unknown' as const, evidenceFactIds: conditions.slice(0, 2).map((condition) => condition.id) }),
      ...(hit
        ? {}
        : {
            userValue: statement,
          }),
    });
  }

  return differences;
}

/**
 * 把差异汇总到路径上：从支持经历里取，每条路径最多 3 条。
 *
 * 「最重要」的顺序是刻意的：**different 最有信息量**（它直接提醒用户
 * 「这个人的结果未必会发生在你身上」），same 次之，unknown 兜底。
 */
export function attachDifferencesToPaths(input: {
  readonly frame: ProblemFrame;
  readonly paths: readonly ExperiencePath[];
  readonly cases: readonly ExperienceCase[];
}): readonly ExperiencePath[] {
  const caseById = new Map(input.cases.map((item) => [item.id, item]));
  const DIFFERENT_BEFORE_SAME: Record<UserDifference['relation'], number> = {
    different: 0,
    same: 1,
    unknown: 2,
  };

  return input.paths.map((path) => {
    const collected: UserDifference[] = [];
    const seenVariables = new Set<string>();

    for (const caseId of path.supportingCaseIds) {
      const experienceCase = caseById.get(caseId);
      if (!experienceCase) {
        continue;
      }
      for (const difference of compareUserToCase({ frame: input.frame, experienceCase })) {
        if (seenVariables.has(difference.variable)) {
          continue;
        }
        seenVariables.add(difference.variable);
        collected.push(difference);
      }
    }

    const top = collected
      .sort((left, right) => DIFFERENT_BEFORE_SAME[left.relation] - DIFFERENT_BEFORE_SAME[right.relation])
      .slice(0, 3);

    return { ...path, differencesFromUser: top };
  });
}
