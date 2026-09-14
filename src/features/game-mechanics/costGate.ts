import type {
  ActionSpace,
  CostCategory,
  CostGate,
  PlayAction,
} from '@/features/game-mechanics/domain';
import { lockAction, removeAction } from '@/features/game-mechanics/actionSpace';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * COST GATE：玩家选择有**真实机会成本**（§九-§十一）。
 *
 * ## 初版只支持高置信映射
 *
 * 刻意**不做**复杂 NLP 因果引擎。只允许容易解释的五种代价：
 *
 * ```text
 * time                  时间
 * money                 钱
 * exclusive commitment  排他承诺
 * responsibility load   责任负荷
 * schedule conflict     时间表冲突
 * ```
 *
 * 如果一条 `cost` 事实无法安全映射到其中一种：**不生成 gate**（§十）。
 * 宁可少一个机制，也不要一个解释不通的机制。
 *
 * ## 不是体力条
 *
 * 禁止「体力不足 / SAN 不够 / 等级不够」这类数值托词。每一条 gate
 * 都必须带 `reason`（人话）与 `sourceFactId`（真实代价原文）。
 */

/** 代价类别 → 中文名（只用于文案，不用于判断）。 */
export const COST_CATEGORY_LABELS: Readonly<Record<CostCategory, string>> = {
  time: '时间',
  money: '钱',
  'exclusive-commitment': '排他承诺',
  'responsibility-load': '责任负荷',
  'schedule-conflict': '时间表冲突',
};

/**
 * 高置信关键词表。
 *
 * 刻意用**确定性关键词**而不是模型判断：这样「为什么这条 gate 会生成」
 * 永远可解释、可复现，也不会因为模型波动而时有时无。
 */
const CATEGORY_PATTERNS: readonly (readonly [CostCategory, readonly string[]])[] = [
  [
    'schedule-conflict',
    [
      '冲突',
      '撞上',
      '撞了',
      '撞车',
      '同一时间',
      '同一个周末',
      '同一个假期',
      '同一周',
      '都在这个周末',
      '腾不出',
      '排不开',
    ],
  ],
  [
    'exclusive-commitment',
    [
      '答应了',
      '承诺',
      '说好了',
      '已经答应',
      '签了',
      '签约',
      '入伙',
      '绑定',
      '排他',
      '先答应了',
      '占住了',
      '被占',
    ],
  ],
  [
    'responsibility-load',
    [
      '责任',
      '带队',
      '负责',
      '必须带',
      '担子',
      '不能不管',
      '要照顾',
      '离不开',
      '顶上去',
      '接了这摊',
      '扛',
    ],
  ],
  [
    'time',
    ['时间', '每周', '每天', '小时', '时长', '投入', '精力', '熬夜', '加到', '腾出来', '花掉'],
  ],
  [
    'money',
    ['钱', '费用', '学费', '报班', '花了', '花钱', '万元', '块钱', '预算', '开销', '自费', '押金'],
  ],
];

/**
 * 一条代价事实属于哪一种容易解释的代价。
 *
 * 命中多条时按 `CATEGORY_PATTERNS` 的固定顺序取第一条 —— 完全确定。
 * 一条都命中不了 → `null`（调用方必须据此放弃，不得硬塞一个类别）。
 */
export function costCategoryOf(fact: ExperienceFact): CostCategory | null {
  if (fact.type !== 'cost') {
    return null;
  }
  const text = fact.exactQuote;
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((pattern) => text.includes(pattern))) {
      return category;
    }
  }
  return null;
}

/** 真实代价片段（稳定排序：相关性高在前，同分按 id）。 */
export function costFacts(facts: readonly ExperienceFact[]): readonly ExperienceFact[] {
  return facts
    .filter((fact) => fact.type === 'cost')
    .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id));
}

/** 可被代价关闭的**原始**行动（确定性：id 升序）。 */
export function closableScenarioActions(space: ActionSpace): readonly PlayAction[] {
  return [...space.actions]
    .filter((action) => action.origin === 'scenario' && action.state === 'available')
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** 从全部可见行动里挑出可被代价关闭的 id（默认取第一条，最多 `limit` 条）。 */
export function closableActionIds(space: ActionSpace, limit = 1): readonly string[] {
  const candidates = [...space.actions]
    .filter((action) => action.state === 'available' || action.state === 'unlocked')
    .sort((left, right) => left.id.localeCompare(right.id));
  return candidates.slice(0, Math.max(0, limit)).map((action) => action.id);
}

/**
 * 代价事实 → 代价闸门（§九-§十一）。
 *
 * 三个必要条件缺一不可：
 *
 * 1. 存在 `ExperienceFact.type === 'cost'` 的事实；
 * 2. 该事实能安全映射到 §十 的五种代价之一；
 * 3. `targetActionIds` 非空（否则只是文案，不是机制）。
 *
 * `targetActionIds` 必须由调用方从真实的行动空间里给出 ——
 * 这个模块**不发明**「代价影响了哪条路」。
 *
 * 返回 `null` 时调用方必须真的什么都不做；**禁止**在这里兜底造一个 gate。
 */
export function costGateFromFacts(input: {
  readonly facts: readonly ExperienceFact[];
  readonly targetActionIds: readonly string[];
  readonly effect?: 'lock' | 'remove';
}): CostGate | null {
  const targets = [...new Set(input.targetActionIds)].filter((id) => id.length > 0).sort();
  if (targets.length === 0) {
    return null;
  }

  for (const fact of costFacts(input.facts)) {
    const category = costCategoryOf(fact);
    // 无法安全映射 → 这条代价不生成 gate，继续看下一条
    if (!category) {
      continue;
    }
    return {
      id: `cost-gate-${fact.id}`,
      sourceFactId: fact.id,
      targetActionIds: targets,
      effect: input.effect ?? 'remove',
      category,
      reason: `这条路暂时关闭：${fact.exactQuote}`,
    };
  }

  return null;
}

/** 把代价闸门落进行动空间（`effect` 决定锁住还是移除）。 */
export function applyCostGate(space: ActionSpace, gate: CostGate): ActionSpace {
  let next = space;
  for (const actionId of gate.targetActionIds) {
    next =
      gate.effect === 'lock'
        ? lockAction(next, actionId, gate.reason)
        : removeAction(next, actionId, gate.reason);
  }
  return next;
}

/**
 * 代价闸门必须可追溯。
 *
 * 空的 `sourceFactId` / `targetActionIds`、或缺失 `reason`，
 * 都意味着这条 gate 必须被丢弃，而不是照常展示。
 */
export function validateCostGate(gate: CostGate): readonly string[] {
  const issues: string[] = [];
  if (gate.sourceFactId.trim().length === 0) {
    issues.push('cost gate 缺少来源事实');
  }
  if (gate.targetActionIds.length === 0) {
    issues.push('cost gate 必须真正改变行动空间');
  }
  if (gate.reason.trim().length === 0) {
    issues.push('cost gate 必须说明原因');
  }
  return issues;
}
