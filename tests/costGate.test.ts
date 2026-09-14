import { describe, expect, it } from 'vitest';

import {
  applyCostGate,
  closableActionIds,
  costCategoryOf,
  costFacts,
  costGateFromFacts,
  validateCostGate,
} from '@/features/game-mechanics/costGate';
import {
  buildActionSpace,
  getActionsByState,
  getSelectableActions,
  getVisibleActions,
} from '@/features/game-mechanics/actionSpace';
import type { CostGate, PlayAction } from '@/features/game-mechanics/domain';
import type { ExperienceFact, ExperienceFactType } from '@/features/experience/domain';

/**
 * COST GATE（§九-§十一 / §二十五）。
 *
 * 玩家的选择有真实机会成本 —— 但只允许容易解释的五种代价，
 * 映射不了就不生成，而且**绝不用数值托词**（体力 / SAN / 等级）。
 */

let seq = 0;
function fact(type: ExperienceFactType, exactQuote: string, overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact-${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote,
    type,
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

function costFact(exactQuote: string, id?: string): ExperienceFact {
  return fact('cost', exactQuote, id ? { id } : {});
}

function action(id: string, overrides: Partial<PlayAction> = {}): PlayAction {
  return {
    id,
    label: `行动 ${id}`,
    state: 'available',
    origin: 'scenario',
    sourceFactIds: [],
    ...overrides,
  };
}

describe('costCategoryOf：只认五种容易解释的代价', () => {
  it('时间 / 钱 / 排他承诺 / 责任负荷 / 时间表冲突都能识别', () => {
    expect(costCategoryOf(costFact('每周要投入 12 小时'))).toBe('time');
    expect(costCategoryOf(costFact('报班花了两万块钱'))).toBe('money');
    expect(costCategoryOf(costFact('我已经答应了队友要做完整赛季'))).toBe('exclusive-commitment');
    expect(costCategoryOf(costFact('我还得负责带下一届新人'))).toBe('responsibility-load');
    expect(costCategoryOf(costFact('和期末冲突了'))).toBe('schedule-conflict');
  });

  it('无法安全映射 → null（不硬塞类别）', () => {
    expect(costCategoryOf(costFact('感觉有点累'))).toBeNull();
    expect(costCategoryOf(costFact('后来就没有联系了'))).toBeNull();
  });

  it('非 cost 事实永远不参与（即使文案像代价）', () => {
    expect(costCategoryOf(fact('reflection', '这件事花了我很多时间'))).toBeNull();
    expect(costCategoryOf(fact('action', '我答应了队友'))).toBeNull();
  });
});

describe('costGateFromFacts', () => {
  it('cost fact + 明确 target → 生成 gate（带 reason 与 sourceFactId）', () => {
    const source = costFact('我已经答应了队友要做完整赛季', 'cost-1');
    const gate = costGateFromFacts({ facts: [source], targetActionIds: ['action-比赛'] });
    expect(gate).not.toBeNull();
    expect(gate!.sourceFactId).toBe('cost-1');
    expect(gate!.targetActionIds).toEqual(['action-比赛']);
    expect(gate!.category).toBe('exclusive-commitment');
    expect(gate!.reason).toContain('这条路暂时关闭');
    expect(gate!.reason).toContain('我已经答应了队友要做完整赛季');
  });

  it('cost 没有明确 target → no gate', () => {
    expect(costGateFromFacts({ facts: [costFact('每周要投入 12 小时')], targetActionIds: [] })).toBeNull();
  });

  it('无法安全映射的 cost → no gate', () => {
    expect(
      costGateFromFacts({ facts: [costFact('感觉有点累')], targetActionIds: ['action-比赛'] }),
    ).toBeNull();
  });

  it('没有 cost 事实 → no gate（action / reflection 都不算）', () => {
    const facts = [fact('action', '我先做最小 Demo'), fact('reflection', '这件事花了我很多时间')];
    expect(costGateFromFacts({ facts, targetActionIds: ['action-比赛'] })).toBeNull();
  });

  it('effect 默认 remove，可显式改成 lock', () => {
    const facts = [costFact('每周要投入 12 小时')];
    expect(costGateFromFacts({ facts, targetActionIds: ['a'] })!.effect).toBe('remove');
    expect(costGateFromFacts({ facts, targetActionIds: ['a'], effect: 'lock' })!.effect).toBe('lock');
  });

  it('targetActionIds 去重并稳定排序', () => {
    const gate = costGateFromFacts({
      facts: [costFact('每周要投入 12 小时')],
      targetActionIds: ['b', 'a', 'b'],
    });
    expect(gate!.targetActionIds).toEqual(['a', 'b']);
  });

  it('成本事实优先取相关性最高的那一条', () => {
    const low = costFact('每周要投入 3 小时', 'cost-low');
    const high = costFact('每周要投入 12 小时', 'cost-high');
    const facts = [
      { ...low, relevance: 0.2 },
      { ...high, relevance: 0.9 },
    ];
    const gate = costGateFromFacts({ facts, targetActionIds: ['a'] });
    expect(gate!.sourceFactId).toBe('cost-high');
  });
});

describe('validateCostGate：cost reason 必须存在', () => {
  it('合法 gate 没有问题', () => {
    const gate = costGateFromFacts({
      facts: [costFact('每周要投入 12 小时', 'cost-1')],
      targetActionIds: ['a'],
    })!;
    expect(validateCostGate(gate)).toEqual([]);
  });

  it('缺 reason / 缺 sourceFactId / 缺 target 都会被指出', () => {
    const broken: CostGate = {
      id: 'g',
      sourceFactId: '',
      targetActionIds: [],
      effect: 'remove',
      reason: '   ',
      category: 'time',
    };
    expect(validateCostGate(broken)).toEqual([
      'cost gate 缺少来源事实',
      'cost gate 必须真正改变行动空间',
      'cost gate 必须说明原因',
    ]);
  });
});

describe('applyCostGate', () => {
  it('remove：行动默认不再展示，但保留审计', () => {
    const space = buildActionSpace([action('a'), action('b')]);
    const gate = costGateFromFacts({
      facts: [costFact('每周要投入 12 小时', 'cost-1')],
      targetActionIds: ['b'],
    })!;
    const next = applyCostGate(space, gate);
    expect(getVisibleActions(next).map((item) => item.id)).toEqual(['a']);
    expect(getActionsByState(next, 'removed').map((item) => item.id)).toEqual(['b']);
  });

  it('lock：行动仍可见且带 reason，但不可选', () => {
    const space = buildActionSpace([action('a'), action('b')]);
    const gate = costGateFromFacts({
      facts: [costFact('和期末冲突了', 'cost-1')],
      targetActionIds: ['b'],
      effect: 'lock',
    })!;
    const next = applyCostGate(space, gate);
    expect(getVisibleActions(next).map((item) => item.id)).toEqual(['a', 'b']);
    expect(getSelectableActions(next).map((item) => item.id)).toEqual(['a']);
    expect(getActionsByState(next, 'locked')[0]!.reason).toContain('这条路暂时关闭');
  });

  it('禁止数值托词：reason 里不出现体力 / SAN / 等级', () => {
    const gate = costGateFromFacts({
      facts: [costFact('每周要投入 12 小时', 'cost-1')],
      targetActionIds: ['a'],
    })!;
    expect(gate.reason).not.toMatch(/体力|SAN|等级|生命|法力/);
  });
});

describe('closableActionIds / costFacts', () => {
  it('只挑可做状态下的行动，稳定排序', () => {
    const space = buildActionSpace([
      action('c'),
      action('a'),
      action('b', { state: 'locked', reason: '先锁着' }),
    ]);
    expect(closableActionIds(space, 2)).toEqual(['a', 'c']);
  });

  it('costFacts 只取 cost，按相关性排序', () => {
    const facts = [
      fact('action', '我先做最小 Demo', { relevance: 0.9 }),
      { ...costFact('每周要投入 3 小时', 'c-low'), relevance: 0.2 },
      { ...costFact('每周要投入 12 小时', 'c-high'), relevance: 0.8 },
    ];
    expect(costFacts(facts).map((item) => item.id)).toEqual(['c-high', 'c-low']);
  });
});
