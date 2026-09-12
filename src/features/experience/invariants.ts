import type {
  ExperienceCase,
  ExperienceFact,
  ExperiencePath,
  FrameStatement,
  StatementOrigin,
} from '@/features/experience/domain';
import type { RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * Experience Engine 的不变量（迁移期新增）。
 *
 * 这些不是「类型检查」——TypeScript 管形状，这里管**语义纪律**：
 * 形状对但内容违规的数据，必须在校验层被拒绝，而不是流到界面。
 *
 * 三条最重要的：
 *
 * 1. `exactQuote` 必须是来源原文的**逐字子串**；
 * 2. `parser-synthesis` **不能**当现实硬条件；
 * 3. 没有来源、没有事实的 Case / Path **不允许存在**（宁可不给）。
 */

/* -------------------------------------------------------------------------- */
/* 1. 硬条件规则                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 这条陈述能不能作为现实硬条件。
 *
 * 只有「用户自己说的」与「实验观测到的」可以为 true。
 * 解析器归纳出来的东西一律不能 —— 系统的一点猜测不该成为
 * 后续所有推理的前提。
 */
export function mayBeHard(origin: StatementOrigin): boolean {
  return origin === 'user-explicit' || origin === 'experiment-observed';
}

/**
 * 校验一条陈述的 `hard` 标记是否合法。
 *
 * @returns 违规原因，合法时返回 null。
 */
export function checkFrameStatement(statement: FrameStatement): string | null {
  if (statement.hard && !mayBeHard(statement.origin)) {
    return `origin=${statement.origin} 的陈述不能标记为硬条件`;
  }
  if (statement.text.trim().length === 0) {
    return '陈述文本为空';
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 2. 逐字引用规则                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 事实的 `exactQuote` 必须是来源原文的子串。
 *
 * 这是本产品最不能破的一条：**AI 可以挑片段，不能改写片段**。
 * 一旦允许改写，整条「可追溯到原文」的承诺就失效了。
 */
export function checkExactQuote(fact: ExperienceFact, sourceQuote: string): string | null {
  if (fact.exactQuote.trim().length === 0) {
    return 'exactQuote 为空';
  }
  if (!sourceQuote.includes(fact.exactQuote)) {
    return 'exactQuote 不是来源原文的逐字子串（疑似被改写）';
  }
  if (fact.sourceUrl.trim().length === 0) {
    return 'sourceUrl 为空（不可溯源）';
  }
  if (fact.author.trim().length === 0) {
    return 'author 为空（不可溯源）';
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 3. 空来源 / 空路径禁止                                                       */
/* -------------------------------------------------------------------------- */

/** 一条 Case 必须至少有一个片段，且来源可溯源。 */
export function checkExperienceCase(item: ExperienceCase): string | null {
  const facts = [
    ...item.conditions,
    ...item.actions,
    ...item.costs,
    ...item.outcomes,
    ...item.reflections,
  ];
  if (facts.length === 0) {
    return '这个 Case 没有任何片段';
  }
  if (item.sourceUrl.trim().length === 0 || item.author.trim().length === 0) {
    return '这个 Case 的来源不可溯源';
  }
  return null;
}

/**
 * 一条 Path 必须真的立得住。
 *
 * `legacy-fallback` 来自人工词表，允许暂时没有独立事实
 * （它的证据在 Case 上）；但 `model-clustered` 必须有事实支撑，
 * 否则就是模型凭印象编的一条路。
 */
export function checkExperiencePath(path: ExperiencePath): string | null {
  if (path.label.trim().length === 0 || path.summary.trim().length === 0) {
    return '这条路径没有名称或说明';
  }
  if (path.origin === 'model-clustered' && path.supportingFactIds.length === 0) {
    return '模型聚类的路径没有任何事实支撑';
  }
  if (path.origin === 'legacy-fallback' && path.supportingCaseIds.length === 0) {
    return 'legacy 路径没有关联任何 Case';
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 4. 现实记忆规则                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 记忆的 `source` 与 `confidence` 不能错配。
 *
 * 「他自己说的」最多只能到 `stated`；只有实验观测才能升级置信度。
 * 否则「随口一说」会被系统当成反复验证过的事实 ——
 * 而这正是这类产品最容易自我欺骗的地方。
 */
export function checkRealityMemory(entry: RealityMemoryEntry): string | null {
  if (entry.source === 'user-stated' && entry.confidence !== 'stated') {
    return 'user-stated 的记忆置信度只能是 stated';
  }
  if (entry.source === 'experiment-observed' && entry.confidence === 'stated') {
    return 'experiment-observed 的记忆不该退化成 stated';
  }
  if (entry.claim.trim().length === 0) {
    return '记忆内容为空';
  }
  return null;
}

/** 实验结果的 `status` 与信号是否自洽。 */
export function checkExperimentResult(input: {
  readonly status: 'completed' | 'partial' | 'stopped' | 'abandoned';
  readonly hitStopSignal: boolean | null;
}): string | null {
  // 命中停止信号却报「completed」是矛盾的：按停止信号停下是正确执行，
  // 不是「做完了」。
  if (input.hitStopSignal === true && input.status === 'completed') {
    return '命中停止信号时不应报 completed（应报 stopped）';
  }
  return null;
}
