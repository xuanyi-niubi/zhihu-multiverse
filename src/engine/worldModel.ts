import { stableHash } from '@/core/run/deterministic';

import { applyAnchorEvent, createAnchor, syncAnomalies, type RealityAnchor } from '@/engine/realityAnchor';
import { applyMentalEvent, createMentalState, mentalSignals, type MentalState } from '@/engine/mentalState';

import type { ChoiceTagLike } from '@/core/run/scenarioAdapter';

/**
 * World Model（规范 §5.1–§5.4 / 重构计划 §5）。
 *
 * 把「场景」升级成「世界状态」：叙事线索（Threads）、关系图（Relationship Graph）、
 * 派系立场（Faction Standing）、心理状态与现实锚点，全部收在一个可复现的对象里。
 *
 * 三条设计约束：
 * 1. **确定性**：同一局同一输入 → 同一世界（靠 stableHash，不用随机数）；
 * 2. **无 AI 也能跑**：线索、关系、派系都由规则从"选项语义 + 结果"推出来；
 * 3. **给 AI 只给定性**：`worldModelBrief` 输出的是说法（"她开始躲着你"），不是数值。
 */

export type ThreadState = 'open' | 'advanced' | 'closed';

export interface WorldThread {
  readonly id: string;
  readonly label: string;
  readonly state: ThreadState;
  readonly openedAt: number;
  readonly advancedAt: number | null;
  readonly closedAt: number | null;
}

export interface Relationship {
  readonly id: string;
  readonly name: string;
  /** −100..100：负=躲着你，正=愿意托你一把。 */
  readonly value: number;
  readonly interactions: number;
}

export interface WorldModel {
  readonly threads: readonly WorldThread[];
  readonly relationships: readonly Relationship[];
  readonly mental: MentalState;
  readonly anchor: RealityAnchor;
  /** 已发生的事件序号（用于幂等与对账）。 */
  readonly revision: number;
}

/** 关系对象：与既有世界观一致（玩家身边真实会出现的人）。 */
const RELATIONSHIP_SEEDS: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'rel-mentor', name: '导师' },
  { id: 'rel-peer', name: '同辈' },
  { id: 'rel-family', name: '家里' },
];

/** 线索模板：按幕次开线（无 AI 也有叙事线索在推进）。 */
const THREAD_TEMPLATES: readonly { readonly act: number; readonly id: string; readonly label: string }[] = [
  { act: 1, id: 'th-goal', label: '你给自己定下的那个目标' },
  { act: 2, id: 'th-cost', label: '你正在透支的东西' },
  { act: 3, id: 'th-people', label: '你和身边人的那笔账' },
  { act: 4, id: 'th-verdict', label: '最后要交出的那份答卷' },
];

export function createWorldModel(seed: string): WorldModel {
  const hash = stableHash(`world:${seed}`);
  const base = 20 + (parseInt(hash.slice(0, 2), 16) % 21); // 20..40

  return {
    threads: [],
    relationships: RELATIONSHIP_SEEDS.map((relationship, index) => ({
      ...relationship,
      value: base - index * 5,
      interactions: 0,
    })),
    mental: createMentalState(seed),
    anchor: createAnchor(seed),
    revision: 0,
  };
}

export interface WorldEventInput {
  readonly act: number;
  readonly sanDelta: number;
  readonly outcome: 'success' | 'failure' | 'none';
  readonly tags?: ChoiceTagLike;
  /** 终局判卷结果（Boss 影响锚点，规范点名要求）。 */
  readonly bossOutcome?: 'success' | 'failure';
  /** 玩家是否已经走完最后一幕。 */
  readonly finalAct?: boolean;
}

/** 从选项语义推导关系变化量（引擎规则，AI 只提供语义）。 */
export function relationshipDeltaFor(tags: ChoiceTagLike | undefined, outcome: 'success' | 'failure' | 'none'): number {
  let delta = 0;
  if (tags?.social === 'ally') {
    delta += outcome === 'failure' ? 6 : 10;
  } else if (tags?.social === 'antagonize') {
    delta -= outcome === 'failure' ? 10 : 6;
  }
  if (tags?.moral === 'good') {
    delta += 4;
  } else if (tags?.moral === 'dark') {
    delta -= 5;
  }
  return delta;
}

/** 线索推进：按幕次开线，选择会推进当前幕的线索。 */
export function advanceThreads(
  threads: readonly WorldThread[],
  input: { readonly act: number; readonly outcome: 'success' | 'failure' | 'none'; readonly finalAct?: boolean },
): readonly WorldThread[] {
  const template = THREAD_TEMPLATES.find((item) => item.act === input.act);
  let next = [...threads];

  // 开线（幂等：同一幕只开一次）
  if (template && !next.some((thread) => thread.id === template.id)) {
    next.push({
      id: template.id,
      label: template.label,
      state: 'open',
      openedAt: input.act,
      advancedAt: null,
      closedAt: null,
    });
  }

  next = next.map((thread) => {
    // 换幕即收束上一幕的线索：故事已经往前走了，旧线不再是被推进的焦点
    if (thread.openedAt < input.act && thread.state !== 'closed') {
      return { ...thread, state: 'closed' as ThreadState, closedAt: input.act };
    }
    if (thread.openedAt !== input.act) {
      return thread;
    }
    const closing = Boolean(input.finalAct) || thread.state === 'advanced';
    return {
      ...thread,
      state: closing ? ('closed' as ThreadState) : ('advanced' as ThreadState),
      advancedAt: thread.advancedAt ?? input.act,
      closedAt: closing ? input.act : null,
    };
  });

  return next;
}

/** 单点推进整个世界模型（每回合调用一次）。 */
export function advanceWorldModel(model: WorldModel, event: WorldEventInput): WorldModel {
  const mental = applyMentalEvent(model.mental, {
    act: event.act,
    sanDelta: event.sanDelta,
    outcome: event.outcome,
    risky: event.tags?.efficiency === 'risky',
    allied: event.tags?.social === 'ally',
  });

  let anchor = model.anchor;
  if (event.bossOutcome) {
    anchor = applyAnchorEvent(anchor, event.bossOutcome === 'success' ? 'boss-success' : 'boss-failure', event.act);
  } else {
    anchor = applyAnchorEvent(
      anchor,
      anchorEventForEvent(event),
      event.act,
    );
  }
  if (mental.breakdown) {
    anchor = applyAnchorEvent(anchor, 'breakdown', event.act);
  }
  anchor = syncAnomalies(anchor, event.act);

  const relDelta = relationshipDeltaFor(event.tags, event.outcome);
  const targetId = event.tags?.social === 'ally' || event.tags?.social === 'antagonize' ? 'rel-peer' : 'rel-mentor';
  const relationships = model.relationships.map((relationship) => {
    if (relationship.id !== targetId) {
      return relationship;
    }
    return {
      ...relationship,
      value: Math.max(-100, Math.min(100, relationship.value + relDelta)),
      interactions: relationship.interactions + 1,
    };
  });

  return {
    threads: advanceThreads(model.threads, event),
    relationships,
    mental,
    anchor,
    revision: model.revision + 1,
  };
}

function anchorEventForEvent(event: WorldEventInput) {
  if (event.tags?.moral === 'dark') {
    return 'dark-choice' as const;
  }
  if (event.tags?.efficiency === 'risky') {
    return 'risky-gamble' as const;
  }
  if (event.tags?.social === 'ally') {
    return 'ally-support' as const;
  }
  return 'grounded-action' as const;
}

/* -------------------------------------------------------------------------- */
/* 定性出口：给 UI 与 prompt 用的"说法"，永远不含数值                            */
/* -------------------------------------------------------------------------- */

export function standingLabel(value: number): string {
  if (value >= 60) {
    return '愿意托你一把';
  }
  if (value >= 25) {
    return '还愿意听你说';
  }
  if (value >= -10) {
    return '保持距离';
  }
  if (value >= -50) {
    return '开始躲着你';
  }
  return '不想再理你';
}

/** 派系立场：由关系图聚合而成（规范 §5.1 Faction Standing）。 */
export function factionStanding(model: WorldModel): { readonly label: string; readonly average: number } {
  const average =
    model.relationships.length === 0
      ? 0
      : Math.round(model.relationships.reduce((sum, item) => sum + item.value, 0) / model.relationships.length);
  const label = average >= 40 ? '身边有人' : average >= 0 ? '各走各的' : '四处树敌';
  return { label, average };
}

export interface WorldModelBrief {
  readonly openThreads: readonly string[];
  readonly closedThreads: readonly string[];
  readonly relationships: readonly { readonly name: string; readonly standing: string }[];
  readonly faction: string;
  readonly mental: readonly string[];
  readonly anchor: readonly string[];
}

/** 给 prompt / UI 的定性简报：**没有任何数字**。 */
export function worldModelBrief(model: WorldModel): WorldModelBrief {
  return {
    openThreads: model.threads.filter((thread) => thread.state !== 'closed').map((thread) => thread.label),
    closedThreads: model.threads.filter((thread) => thread.state === 'closed').map((thread) => thread.label),
    relationships: model.relationships.map((relationship) => ({
      name: relationship.name,
      standing: standingLabel(relationship.value),
    })),
    faction: factionStanding(model).label,
    mental: mentalSignals(model.mental),
    anchor: anchorSignalsOf(model),
  };
}

function anchorSignalsOf(model: WorldModel): readonly string[] {
  const signals: string[] = [];
  if (model.anchor.value <= 0) {
    signals.push('这个宇宙已经撑不住了');
  } else if (model.anchor.value < 0.3) {
    signals.push('现实感在变薄');
  } else {
    signals.push('脚踏实地');
  }
  return [...signals, ...model.anchor.anomalies];
}
