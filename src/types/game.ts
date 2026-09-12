/**
 * 《知乎平行宇宙》装备遗物（ZhihuRelic）与 D20 检定最终接口规范
 *
 * 这是一份纯 Spec 文件：只定义类型、接口、错误契约和边界断言声明，
 * 不包含任何运行时代码、随机数实现、状态机实现或 UI 实现。
 *
 * 设计基线：
 * - 属性值统一为 0..100 的闭区间整数。
 * - 遗物栏固定为 3 个槽位，不能通过接口表达第 4 个槽位。
 * - 检定统一采用：rawRoll（1..20） + totalModifier >= difficulty。
 * - 天然 1 必定失败，天然 20 必定成功；二者优先级高于普通总值比较。
 * - 同一份请求在相同 seed、输入快照和规则版本下必须得到相同结果。
 */

// -----------------------------------------------------------------------------
// 1. 基础标量与边界类型
// -----------------------------------------------------------------------------

export type TargetStat = 'san' | 'skill' | 'bond';

export type RelicKind = 'passive' | 'active';

export type CheckOutcome = 'success' | 'failure';

export type CriticalResult = 'none' | 'critical-failure' | 'critical-success';

/**
 * 0..100 的属性值。
 *
 * 运行时边界：必须是有限整数，且 0 <= value <= 100。
 * 不得接受 NaN、Infinity、-Infinity、小数或越界值。
 */
export type StatValue = number & { readonly __brand: 'ZhihuStatValue0To100' };

/**
 * 0..1 的比例值，例如 0.25 表示 25%。
 *
 * 运行时边界：必须是有限数，且 0 <= value <= 1。
 * 百分比不得以 25 代替 0.25 传入。
 */
export type Ratio = number & { readonly __brand: 'Ratio0To1' };

/**
 * D20 的原始骰面。
 *
 * 运行时边界：只能是整数 1..20。
 */
export type D20Face = number & { readonly __brand: 'D20Face1To20' };

/**
 * 难度等级（Difficulty Class）。
 *
 * 规范允许的 DC 为 1..30 的整数。DC 不是百分比，也不是 0..100 属性值。
 * 低于 1 或高于 30 的关卡数据必须在进入检定前被拒绝。
 */
export type D20Difficulty = number & { readonly __brand: 'D20Difficulty1To30' };

/**
 * 单项 D20 修正值。
 *
 * 运行时边界：-20..20 的有限整数。
 * 遗物、临时效果和基础属性换算产生的修正均必须先分别校验，再参与求和。
 */
export type D20Modifier = number & { readonly __brand: 'D20ModifierMinus20To20' };

/**
 * 主动遗物的最大充能次数。
 *
 * 运行时边界：1..3 的有限整数；当前 Demo 不允许无限充能或负数充能。
 */
export type RelicChargeCount = number & { readonly __brand: 'RelicChargeCount1To3' };

/**
 * 所有修正值求和后的总修正。
 *
 * 运行时边界：-60..60 的有限整数。
 * 该范围为协议安全上限；超过范围意味着输入效果叠加异常，必须拒绝，
 * 不允许静默截断或自动压缩。
 */
export type D20TotalModifier = number & {
  readonly __brand: 'D20TotalModifierMinus60To60';
};

/**
 * 1..8 的局内回合编号。
 *
 * 终局规则属于上层状态机（`core/run/actEngine.ts` 的张力预算），
 * 本 Spec 只约束 D20 请求不得使用 0 或超过第 8 幕。
 * 上限的唯一事实源是 `core/run/actRun.ts` 的 `MAX_TURNS`。
 */
export type TurnIndex = number & { readonly __brand: 'TurnIndex1To8' };

/**
 * 非空、稳定且可用于复盘的局种子。
 * 建议格式：SEED-2026-X89；具体编码格式由上层生成器约束。
 */
export type RunSeed = string & { readonly __brand: 'RunSeed' };

// -----------------------------------------------------------------------------
// 2. 玩家属性快照
// -----------------------------------------------------------------------------

export interface PlayerStatsSnapshot {
  /** 心智稳定度；归零触发上层的 SAN 耗尽终局。 */
  readonly san: StatValue;

  /** 专业/技能熟练度；用于 skill 目标的检定修正换算。 */
  readonly skill: StatValue;

  /** 社区羁绊度；用于 bond 目标的检定修正换算与救场能力。 */
  readonly bond: StatValue;
}

/**
 * 属性到 D20 基础修正的规则版本标识。
 *
 * 具体换算公式不属于接口实现，但调用方必须显式声明版本，避免不同版本
 * 对同一属性快照得到不同检定结果。实现方不得在请求缺少版本时猜测默认规则。
 */
export type StatModifierRuleVersion = 'zhihu-d20-v1';

export interface StatModifierInput {
  readonly targetStat: TargetStat;
  readonly stats: PlayerStatsSnapshot;
  readonly ruleVersion: StatModifierRuleVersion;
}

export interface StatModifierOutput {
  readonly targetStat: TargetStat;
  readonly sourceValue: StatValue;
  readonly baseModifier: D20Modifier;
  readonly ruleVersion: StatModifierRuleVersion;
}

// -----------------------------------------------------------------------------
// 3. 知乎内容来源与遗物效果
// -----------------------------------------------------------------------------

export interface ZhihuContentSource {
  /** 稳定的来源标识；不得为空字符串。 */
  readonly id: string;

  /** 展示用答主/专栏作者名；不得包含未校验的 HTML。 */
  readonly author: string;

  /** 来源内容标题。 */
  readonly title: string;

  /** 知乎内容链接；必须是已允许的 https URL。 */
  readonly sourceUrl: `https://${string}`;

  /** 可选的内容类型，用于展示与审计，不参与数值计算。 */
  readonly contentType?: 'answer' | 'article' | 'column' | 'story' | 'search-snippet';

  /**
   * 来源状态：`verified` = 由官方接口真实检索/落盘（可核查抓取时间）；
   * `scripted` = 剧本文案，**不得展示赞同数等社区数字**。
   *
   * 省略时按 `scripted` 处理 —— 默认不信任，避免手写数字冒充真实数据。
   */
  readonly status?: 'verified' | 'scripted';
}

export type RelicStackRule =
  /** 同类效果相加，但最终由对应 cap 限制。 */
  | 'additive-capped'
  /** 多个同类效果只取绝对值最高者。 */
  | 'highest-only'
  /** 同一效果只能生效一次；重复效果必须被拒绝或去重。 */
  | 'unique'
  /** 每次检定最多应用一次该效果。 */
  | 'once-per-check';

export interface RelicEffectBase {
  /** 同一遗物内稳定且唯一的效果标识。 */
  readonly effectId: string;

  /** 叠加策略；实现方不得自行改变策略。 */
  readonly stackRule: RelicStackRule;
}

export interface CheckModifierEffect extends RelicEffectBase {
  readonly type: 'check-modifier';

  /** 该效果只对指定属性检定生效。 */
  readonly targetStat: TargetStat;

  /** 对 D20 总值增加/减少的平坦修正，范围 -20..20。 */
  readonly modifier: D20Modifier;
}

export interface SanDamageReductionEffect extends RelicEffectBase {
  readonly type: 'san-damage-reduction';

  /** SAN 负向变化的减伤比例，例如 0.25 表示减少 25% 损失。 */
  readonly ratio: Ratio;

  /** 所有该类效果的总减伤上限固定为 0.8（80%）。 */
  readonly aggregateCap: Ratio;
}

export interface NextCheckModifierEffect extends RelicEffectBase {
  readonly type: 'next-check-modifier';

  /** 可选目标属性；省略表示对下一次任意 D20 检定生效。 */
  readonly targetStat?: TargetStat;

  /** 下一次检定额外使用的一次性平坦修正。 */
  readonly modifier: D20Modifier;

  /** 该效果必须为一次性；固定为 1，使用后立即标记已消耗。 */
  readonly charges: 1;
}

export type ZhihuRelicEffect =
  | CheckModifierEffect
  | SanDamageReductionEffect
  | NextCheckModifierEffect;

/** 1..3 项遗物效果；通过 tuple 在类型层封死空数组和第 4 项。 */
export type ZhihuRelicEffects =
  | readonly [ZhihuRelicEffect]
  | readonly [ZhihuRelicEffect, ZhihuRelicEffect]
  | readonly [ZhihuRelicEffect, ZhihuRelicEffect, ZhihuRelicEffect];

/**
 * 遗物定义（内容配置层）。
 *
 * 注意：定义与持有状态分离。`ZhihuRelic` 描述卡牌本身；是否已经消耗、
 * 当前剩余次数等局内状态放在 `OwnedZhihuRelic`，避免同一张定义被多个存档
 * 共享时发生可变状态污染。
 */
export interface ZhihuRelic {
  /** 局内/配置内全局唯一；同一 inventory 中不得重复。 */
  readonly id: string;

  /** 展示名称；不能为空，建议不超过 40 个 Unicode 字符。 */
  readonly name: string;

  /** 来自知乎内容的短句；建议不超过 120 个 Unicode 字符。 */
  readonly quote: string;

  /** 内容来源；必须可追溯，不允许伪造或缺省链接。 */
  readonly source: ZhihuContentSource;

  readonly kind: RelicKind;

  /** 被动/主动效果列表；类型层保证至少 1 项、最多 3 项。 */
  readonly effects: ZhihuRelicEffects;

  /**
   * 叙事钩子（最终版 §6：遗物用「效果类型 × 叙事钩子」组合，而不是纯数值）。
   *
   * 它会随世界状态一起注入 DM prompt —— 于是遗物既改数值、也在剧情里有回响，
   * 不再是"口袋里一件沉默的加值道具"。
   */
  readonly narrativeHook?: string;
}

export interface OwnedZhihuRelic {
  readonly relic: ZhihuRelic;

  /** 获得该遗物的回合，必须为 1..4。 */
  readonly acquiredAtTurn: TurnIndex;

  /**
   * 当前剩余充能次数。
   * - 被动遗物必须为 null。
   * - 主动遗物必须为 0..maxCharges 的整数，其中 maxCharges 为该遗物定义的充能上限。
   */
  readonly remainingCharges: number | null;

  /**
   * 主动遗物的充能上限；被动遗物必须为 null。
   * 主动遗物必须为 1..3 的整数，且 remainingCharges 不得超过它。
   */
  readonly maxCharges: RelicChargeCount | null;

  /**
   * 是否已经完全消耗。
   * - 被动遗物必须为 false。
   * - 主动遗物在 remainingCharges === 0 时必须为 true。
   */
  readonly isConsumed: boolean;
}

/**
 * 固定 3 槽位的遗物栏。
 *
 * 使用定长 tuple 从类型层阻止第 4 件装备进入状态；空槽必须使用 null，
 * 不得使用 undefined、空对象或重复的 relic.id。
 */
export type RelicInventory = readonly [
  OwnedZhihuRelic | null,
  OwnedZhihuRelic | null,
  OwnedZhihuRelic | null,
];

export interface RelicDrop {
  /** 新掉落的遗物定义；加入前必须检查 inventory 是否存在空槽。 */
  readonly relic: ZhihuRelic;

  /** 产生掉落的回合，必须与当前检定上下文一致。 */
  readonly turnIndex: TurnIndex;

  /** 掉落来源，供复盘与 UI 展示。 */
  readonly reason: 'check-success' | 'encounter' | 'legacy-inheritance';
}

// -----------------------------------------------------------------------------
// 4. D20 检定请求、规则和结果
// -----------------------------------------------------------------------------

export type CriticalRule = 'natural-1-fail-natural-20-success';

export interface D20RuleSet {
  readonly id: 'zhihu-d20-v1';
  readonly die: 'd20';
  readonly difficultyMin: 1;
  readonly difficultyMax: 30;
  readonly rawRollMin: 1;
  readonly rawRollMax: 20;
  readonly criticalRule: CriticalRule;

  /**
   * 总修正的协议边界。任何单项或总和越界都必须返回边界错误，不能截断。
   */
  readonly modifierMin: -20;
  readonly modifierMax: 20;
  readonly totalModifierMin: -60;
  readonly totalModifierMax: 60;
}

export interface D20CheckRequest {
  /** 用于关联事件选项；不能为空且在同一事件内唯一。 */
  readonly checkId: string;

  readonly turnIndex: TurnIndex;
  readonly seed: RunSeed;
  readonly targetStat: TargetStat;
  readonly difficulty: D20Difficulty;
  readonly stats: PlayerStatsSnapshot;
  readonly inventory: RelicInventory;
  readonly ruleSet: D20RuleSet;

  /**
   * 上层已确认的基础属性修正。
   * 若由引擎计算，必须使用 ruleSet.id 对应的 StatModifierRuleVersion；
   * 不得把 0..100 的属性原值直接当作 D20 修正。
   */
  readonly baseModifier: D20Modifier;

  /**
   * 当前事件提供的临时修正；没有临时修正时必须传 0，而不是 undefined。
   */
  readonly temporaryModifier: D20Modifier;

  /**
   * 本次检定主动启用的遗物 id；只能引用 inventory 中未消耗的 active 遗物，
   * 同一个 id 不得重复出现。未使用主动遗物时传空 tuple。
   */
  readonly activatedRelicIds: readonly string[];
}

export interface D20ModifierBreakdown {
  readonly baseModifier: D20Modifier;
  readonly passiveRelicModifier: D20Modifier;
  readonly activeRelicModifier: D20Modifier;
  readonly temporaryModifier: D20Modifier;
  readonly totalModifier: D20TotalModifier;
  readonly appliedRelicIds: readonly string[];
}

export interface D20CheckResult {
  readonly checkId: string;
  readonly turnIndex: TurnIndex;
  readonly seed: RunSeed;
  readonly ruleSetId: D20RuleSet['id'];
  readonly targetStat: TargetStat;
  readonly difficulty: D20Difficulty;

  /** 原始骰面，严格为 1..20。 */
  readonly rawRoll: D20Face;

  readonly modifiers: D20ModifierBreakdown;

  /** rawRoll + totalModifier；必须为有限整数。 */
  readonly total: number;

  readonly outcome: CheckOutcome;
  readonly critical: CriticalResult;

  /** 本次实际扣除/消耗的主动遗物；必须是 activatedRelicIds 的子集。 */
  readonly consumedRelicIds: readonly string[];

  /**
   * 结果生成后的遗物掉落；没有掉落时必须为 null。
   * 该字段不负责直接修改 inventory。
   */
  readonly relicDrop: RelicDrop | null;
}

export interface D20CheckEngine {
  /**
   * 纯检定契约：不得在此接口调用中直接修改玩家属性、遗物栏、LocalStorage
   * 或网络状态。所有状态变更应由上层事务依据 D20CheckResult 一次性提交。
   */
  evaluate(request: D20CheckRequest): D20CheckResult;
}

// -----------------------------------------------------------------------------
// 5. 状态提交边界（只描述契约，不实现提交）
// -----------------------------------------------------------------------------

export interface RelicUseRequest {
  readonly relicId: string;
  readonly checkId: string;
  readonly turnIndex: TurnIndex;
  readonly inventory: RelicInventory;
}

export interface RelicUseResult {
  readonly relicId: string;
  readonly consumed: true;
  readonly remainingCharges: number;
  readonly effect: NextCheckModifierEffect;
}

export interface RelicInventoryTransition {
  readonly before: RelicInventory;
  readonly after: RelicInventory;
  readonly addedRelicId: string | null;
  readonly removedRelicIds: readonly string[];

  /**
   * 过渡必须满足：
   * - after 仍严格为 3 槽位；
   * - 非消耗型遗物不能被错误删除；
   * - 同一 relic.id 不得重复；
   * - addedRelicId 非 null 时，before 必须有空槽。
   */
  readonly reason: 'use-active' | 'drop' | 'inherit-legacy' | 'replace-empty-slot';
}

// -----------------------------------------------------------------------------
// 6. 边界断言与错误契约（声明，不提供实现）
// -----------------------------------------------------------------------------

export type ZhihuRelicSpecErrorCode =
  | 'RELIC_ID_EMPTY'
  | 'RELIC_NAME_EMPTY'
  | 'RELIC_QUOTE_TOO_LONG'
  | 'RELIC_SOURCE_INVALID'
  | 'RELIC_EFFECTS_EMPTY'
  | 'RELIC_EFFECTS_TOO_MANY'
  | 'RELIC_CHARGES_INVALID'
  | 'INVENTORY_CAPACITY_EXCEEDED'
  | 'INVENTORY_DUPLICATE_RELIC'
  | 'INVENTORY_UNDEFINED_SLOT'
  | 'STAT_OUT_OF_RANGE'
  | 'TURN_OUT_OF_RANGE'
  | 'DIFFICULTY_OUT_OF_RANGE'
  | 'D20_FACE_OUT_OF_RANGE'
  | 'MODIFIER_OUT_OF_RANGE'
  | 'TOTAL_MODIFIER_OUT_OF_RANGE'
  | 'SEED_EMPTY'
  | 'CHECK_ID_EMPTY'
  | 'ACTIVE_RELIC_NOT_OWNED'
  | 'ACTIVE_RELIC_ALREADY_CONSUMED'
  | 'PASSIVE_RELIC_CANNOT_BE_ACTIVATED'
  | 'CRITICAL_RULE_MISMATCH'
  | 'NON_DETERMINISTIC_RESULT';

export interface ZhihuRelicSpecError extends Error {
  readonly name: 'ZhihuRelicSpecError';
  readonly code: ZhihuRelicSpecErrorCode;
  readonly path: string;
  readonly received: unknown;
  readonly expected: string;
}

/** 校验未知输入是否符合 ZhihuRelic 定义及其递归效果边界。 */
export declare function assertZhihuRelic(value: unknown): asserts value is ZhihuRelic;

/** 校验持有态遗物，包括 active/passive 与 charges/isConsumed 一致性。 */
export declare function assertOwnedZhihuRelic(
  value: unknown,
): asserts value is OwnedZhihuRelic;

/** 校验固定 3 槽位、无重复 id、无 undefined 槽位的遗物栏。 */
export declare function assertRelicInventory(
  value: unknown,
): asserts value is RelicInventory;

/** 校验 0..100 属性快照。 */
export declare function assertPlayerStatsSnapshot(
  value: unknown,
): asserts value is PlayerStatsSnapshot;

/** 校验 D20 请求的所有字段、规则版本、槽位和激活遗物引用。 */
export declare function assertD20CheckRequest(
  value: unknown,
): asserts value is D20CheckRequest;

/** 校验 D20 结果的骰面、临界规则、总值、消耗集合与掉落边界。 */
export declare function assertD20CheckResult(
  value: unknown,
): asserts value is D20CheckResult;

// -----------------------------------------------------------------------------
// 7. 必须满足的跨字段不变量（实现方验收清单）
// -----------------------------------------------------------------------------

export interface ZhihuRelicD20Invariants {
  /**
   * I-01：属性边界。
   * san、skill、bond 始终为 0..100 的有限整数；任何状态提交都不得绕过钳制。
   */
  readonly statsAreClamped: true;

  /**
   * I-02：遗物容量。
   * 任意时刻 inventory.length 的语义固定为 3 个槽位，非空遗物数量 <= 3。
   */
  readonly inventoryHasAtMostThreeOwnedRelics: true;

  /**
   * I-03：遗物唯一性。
   * 同一 inventory 中所有非空 OwnedZhihuRelic.relic.id 必须互不相同。
   */
  readonly relicIdsAreUniquePerInventory: true;

  /**
   * I-04：D20 成功判定。
   * rawRoll === 1 => failure；rawRoll === 20 => success；其余骰面才比较 total >= DC。
   */
  readonly naturalOneAndTwentyHavePriority: true;

  /**
   * I-05：普通成功判定。
   * 在非天然 1/20 情况下，且仅当 total >= difficulty 时为 success。
   */
  readonly nonCriticalSuccessIsTotalAtLeastDifficulty: true;

  /**
   * I-06：修正边界。
   * 每个 D20Modifier 为 -20..20；totalModifier 为 -60..60；越界拒绝而非截断。
   */
  readonly modifiersAreValidatedBeforeSummation: true;

  /**
   * I-07：SAN 减伤上限。
   * SanDamageReductionEffect 的聚合减伤不得超过 0.8，不能通过重复遗物突破。
   */
  readonly sanReductionAggregateCapIsEightyPercent: true;

  /**
   * I-08：主动遗物消耗。
   * active 遗物每次成功激活最多消耗 1 次 charge；重复使用已消耗遗物必须失败。
   */
  readonly activeRelicConsumptionIsAtomic: true;

  /**
   * I-09：被动遗物语义。
   * passive 遗物不得出现在 activatedRelicIds，也不得被标记为 consumed。
   */
  readonly passiveRelicsAreNotActivated: true;

  /**
   * I-10：确定性复盘。
   * 相同 ruleSet、seed、checkId、属性快照、inventory 快照和激活集合，
   * 必须产生相同 rawRoll、total、outcome、consumption 与 drop 结果。
   */
  readonly evaluationIsDeterministicForSameSnapshot: true;

  /**
   * I-11：检定无副作用。
   * evaluate 只返回 D20CheckResult，不直接持久化、不直接写入全局状态。
   */
  readonly evaluationDoesNotMutateState: true;

  /**
   * I-12：来源可追溯。
   * 每个遗物必须绑定一个 https 知乎来源；sourceUrl 不得为空、不得使用 javascript:
   * 或 data: 等协议替代真实来源。
   */
  readonly relicSourceIsTraceable: true;
}

/**
 * Spec 版本。任何持久化存档或网络传输都应保存该版本，以便未来规则升级时
 * 不把旧局结果按新规则重算。
 */
export interface ZhihuRelicD20Spec {
  readonly specVersion: 'zhihu-relic-d20-spec-v1';
  readonly ruleSet: D20RuleSet;
  readonly invariants: ZhihuRelicD20Invariants;
}
