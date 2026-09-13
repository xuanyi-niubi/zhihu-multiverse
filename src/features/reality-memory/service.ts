import { checkExperimentResult, checkRealityMemory } from '@/features/experience/invariants';

import type { ExperimentResult, RealityMemoryEntry } from '@/features/reality-memory/domain';

/**
 * 现实记忆的生成（P1-3）。
 *
 * ## 它把「七天后回来的那份结果」变成下一次会话能用的知识
 *
 * 此前闭环是断的：产品问用户结果，但不因此变聪明。这一层的全部职责
 * 就是把**实验观测**写成可复用的记忆条目，并在第二次观测到同一件事时
 * 把置信度从「观测到一次」升到「反复观测到」。
 *
 * ## 三条纪律（写死在代码结构里）
 *
 * 1. **只记用户填的、实验真的产出的**：实际投入、产出物、命中的信号、
 *    他自己写下的判断。系统**不**从结果里推断人格（「执行力差」「风险偏好低」）
 *    —— 那种句子看起来更像洞察，实际是把一次行为放大成一个人的属性。
 * 2. **观察与自述分开**：用户自己写的判断是 `user-stated / stated`，
 *    实验观测到的是 `experiment-observed / observed-once`；后者才允许升级。
 * 3. **一条 claim 只留一条**：同一句话再次被观测到，就把置信度升一档，
 *    而不是堆两条几乎相同的记忆。
 */

/** 结果里的状态 → 可读标签。 */
const STATUS_LABEL: Readonly<Record<ExperimentResult['status'], string>> = {
  completed: '做完了',
  partial: '做了一部分',
  stopped: '按停止信号停下',
  abandoned: '中途放弃',
};

export interface MemoryFromResultInput {
  readonly sessionId: string;
  readonly result: ExperimentResult;
  readonly createdAt: string;
  /** 该身份已有的记忆（用来把重复观测升级为 observed-repeatedly）。 */
  readonly existing?: readonly RealityMemoryEntry[];
}

export interface MemoryFromResultOutput {
  /**
   * 新写入的记忆条目（已去重、已升级置信度）。
   * 没有可记录的内容时是空数组 —— 不写一条泛泛的「我做过一次实验」。
   */
  readonly entries: readonly RealityMemoryEntry[];
  /** 全部记忆（含未被这次更新的既有条目），按写入顺序。 */
  readonly merged: readonly RealityMemoryEntry[];
}

/** 一句可读的观测陈述（不含解释、不含评价）。 */
function claimsOf(result: ExperimentResult): readonly {
  readonly claim: string;
  readonly source: RealityMemoryEntry['source'];
}[] {
  const claims: { claim: string; source: RealityMemoryEntry['source'] }[] = [];

  if (result.actualTime && result.actualTime.trim().length > 0) {
    claims.push({ claim: `实际投入：${result.actualTime.trim()}`, source: 'experiment-observed' });
  }
  if (result.producedArtifact && result.producedArtifact.trim().length > 0) {
    claims.push({ claim: `实际产出：${result.producedArtifact.trim()}`, source: 'experiment-observed' });
  }
  if (result.hitStopSignal === true) {
    // 按停止信号停下是**正确执行**，值得被记成一条经验而不是失败
    claims.push({ claim: '碰到停止信号时停下了，没有继续加注', source: 'experiment-observed' });
  }
  if (result.hitSuccessSignal === true) {
    claims.push({ claim: '碰到了自己事先写下的成功信号', source: 'experiment-observed' });
  }
  if (result.whatChanged.trim().length > 0) {
    claims.push({ claim: result.whatChanged.trim(), source: 'user-stated' });
  }

  return claims;
}

/**
 * 从一次实验结果生成记忆条目。**纯函数**。
 *
 * 不可写入的内容（空 claim、置信度与来源不匹配、命中停止信号却报完成）
 * 一律**丢掉** —— 与其写入一条自相矛盾的记忆，不如这一次不留痕。
 */
export function memoryEntriesFromResult(input: MemoryFromResultInput): MemoryFromResultOutput {
  const existing = input.existing ?? [];

  // 自相矛盾的结果不接受（例如命中停止信号却报 completed）
  if (checkExperimentResult(input.result) !== null) {
    return { entries: [], merged: existing };
  }

  const merged: RealityMemoryEntry[] = [...existing];
  const entries: RealityMemoryEntry[] = [];

  claimsOf(input.result).forEach((item, index) => {
    const claim = item.claim;
    const previousIndex = merged.findIndex((entry) => entry.claim === claim);

    const entry: RealityMemoryEntry = {
      id: `rm:${input.sessionId}:${index}`,
      claim,
      source: item.source,
      /**
       * 第二次观测到同一件事 → 升级为「反复观测到」。
       * 但**只有实验观测**能升级：用户自己重复说同一句话不构成验证。
       */
      confidence:
        item.source === 'experiment-observed'
          ? previousIndex >= 0
            ? 'observed-repeatedly'
            : 'observed-once'
          : 'stated',
      sessionId: input.sessionId,
      createdAt: input.createdAt,
    };

    if (checkRealityMemory(entry) !== null) {
      return;
    }

    if (previousIndex >= 0) {
      merged[previousIndex] = entry;
    } else {
      merged.push(entry);
    }
    entries.push(entry);
  });

  return { entries, merged };
}

/**
 * 供**下一次会话**当硬条件使用的观测声明。
 *
 * 只取 `experiment-observed` 的条目：用户随口说的自我估计不该在下一局
 * 被系统当成既成事实（那正是这条产品线最容易自欺的地方）。
 *
 * 上限 4 条 —— 记忆越多，越容易把新问题往旧结论上套。
 */
export function observedClaimsOf(
  entries: readonly RealityMemoryEntry[],
  limit = 4,
): readonly string[] {
  return entries
    .filter((entry) => entry.source === 'experiment-observed')
    .slice(-limit)
    .map((entry) => entry.claim);
}

/** 状态标签：日志与结果卡片共用一份文案。 */
export function resultStatusLabel(status: ExperimentResult['status']): string {
  return STATUS_LABEL[status];
}
