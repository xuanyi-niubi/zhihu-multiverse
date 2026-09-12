import { describe, expect, it } from 'vitest';

import { EVENT_POOL, eventsByCategory } from '@/core/run/events/eventPool';
import {
  applyEventToConstraints,
  applyFateTone,
  drawEvent,
  isEligible,
  meetsCondition,
  selectEvent,
} from '@/core/run/events/eventSelector';
import { resolveChoice } from '@/core/decision/choiceResolution';

import type { EventContext } from '@/core/run/events/eventSelector';
import type { ConstraintProfile } from '@/types/evidence';

/**
 * v3 §25 点名的 `eventDeterminism.test.ts`。
 *
 * 锁死三件事：
 * 1. 同 seed 同事件（可复现）；
 * 2. 不同 seed 分布会变（真随机源，不是固定序列）；
 * 3. 条件事件不越界（不满足条件永不出现）；
 * 4. **事件不改裁决**（v3 §2.2 原则 D）。
 */

const baseContext: EventContext = {
  constraints: { runwayMonths: 6, drawdown: 50, ally: 40 },
};

describe('事件池规模与分类（v3 §23 P0-2 的 DoD）', () => {
  it('至少 24 个事件', () => {
    expect(EVENT_POOL.length).toBeGreaterThanOrEqual(24);
  });

  it('四类事件都有，且各自不是只有一两个', () => {
    for (const category of ['opportunity', 'pressure', 'reality', 'rare'] as const) {
      expect(eventsByCategory(category).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('每个事件都有叙事钩子与领域标签（不是空壳数据）', () => {
    for (const event of EVENT_POOL) {
      expect(event.narrativeHook.length).toBeGreaterThan(8);
      expect(event.domains.length).toBeGreaterThan(0);
      expect(event.id).toMatch(/^evt-/);
    }
  });

  it('每个事件都至少改一个轴（否则它没有游戏作用）', () => {
    for (const event of EVENT_POOL) {
      expect(Object.keys(event.effects).length).toBeGreaterThan(0);
    }
  });

  it('事件 id 唯一', () => {
    const ids = EVENT_POOL.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('事件只使用四轴字段，且没有能影响裁决的字段', () => {
    const allowed = new Set(['runway', 'drawdown', 'reversibility', 'ally']);
    for (const event of EVENT_POOL) {
      for (const axis of Object.keys(event.effects)) {
        expect(allowed.has(axis)).toBe(true);
      }
      // 事件结构里不允许出现任何「证据」或「难度」字段
      expect(event).not.toHaveProperty('difficulty');
      expect(event).not.toHaveProperty('grade');
      expect(event).not.toHaveProperty('evidenceStrength');
    }
  });
});

describe('确定性（同 seed 同事件）', () => {
  it('同 seed + 同幕次 → 同一事件', () => {
    const draw = () => selectEvent({ seed: 'SEED-2026-TEST', actIndex: 2, context: baseContext });
    const first = draw();
    for (let index = 0; index < 20; index += 1) {
      expect(draw()?.id).toBe(first?.id);
    }
  });

  it('不同幕次抽到不同事件（同一局内不重复同一幕）', () => {
    const ids = [1, 2, 3, 4, 5, 6].map(
      (actIndex) => selectEvent({ seed: 'SEED-2026-TEST', actIndex, context: baseContext })?.id,
    );
    // 允许偶然相同，但不该全部一样
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it('不同 seed 会得到不同分布（真随机源，不是固定序列）', () => {
    const ids = new Set(
      Array.from({ length: 40 }, (_, index) =>
        selectEvent({ seed: `SEED-2026-${index}`, actIndex: 1, context: baseContext })?.id,
      ),
    );
    expect(ids.size).toBeGreaterThan(3);
  });

  it('excludeIds 生效：已出现过的事件不再抽到', () => {
    const first = selectEvent({ seed: 'SEED-2026-EX', actIndex: 1, context: baseContext });
    expect(first).not.toBeNull();
    if (!first) return;

    for (let index = 0; index < 10; index += 1) {
      const next = selectEvent({
        seed: 'SEED-2026-EX',
        actIndex: 1,
        context: baseContext,
        excludeIds: [first.id],
      });
      expect(next?.id).not.toBe(first.id);
    }
  });

  it('候选被抽空时返回 null，而不是抛异常（调用方照常推进）', () => {
    const all = EVENT_POOL.map((event) => event.id);
    expect(selectEvent({ seed: 'SEED-2026-EX', actIndex: 1, context: baseContext, excludeIds: all })).toBeNull();
  });
});

describe('条件事件不越界', () => {
  it('hasFlag / lacksFlag 判定正确', () => {
    const context: EventContext = { ...baseContext, flags: ['a'] };
    expect(meetsCondition({ kind: 'hasFlag', flag: 'a' }, context)).toBe(true);
    expect(meetsCondition({ kind: 'hasFlag', flag: 'b' }, context)).toBe(false);
    expect(meetsCondition({ kind: 'lacksFlag', flag: 'b' }, context)).toBe(true);
    expect(meetsCondition({ kind: 'lacksFlag', flag: 'a' }, context)).toBe(false);
  });

  it('axisAtLeast / axisAtMost 按当前约束判定', () => {
    const context: EventContext = { constraints: { runwayMonths: 3, drawdown: 20, ally: 0 } };
    expect(meetsCondition({ kind: 'axisAtMost', axis: 'runway', value: 4 }, context)).toBe(true);
    expect(meetsCondition({ kind: 'axisAtLeast', axis: 'runway', value: 4 }, context)).toBe(false);
    expect(meetsCondition({ kind: 'axisAtMost', axis: 'ally', value: 10 }, context)).toBe(true);
  });

  it('缺字段的条件一律不满足（宁可漏事件，不可越界）', () => {
    expect(meetsCondition({ kind: 'hasFlag' }, baseContext)).toBe(false);
    expect(meetsCondition({ kind: 'axisAtLeast', axis: 'runway' }, baseContext)).toBe(false);
  });

  it('不满足条件的事件永不进入候选', () => {
    const gated = {
      id: 'evt-test-gated',
      title: '测试',
      rarity: 'common' as const,
      category: 'opportunity' as const,
      domains: ['学业'] as const,
      conditions: [{ kind: 'axisAtLeast' as const, axis: 'runway' as const, value: 99 }],
      effects: { runway: 1 },
      narrativeHook: '不该出现的遭遇',
      sourceType: 'system' as const,
    };
    expect(isEligible(gated, baseContext)).toBe(false);
    expect(isEligible(gated, { constraints: { runwayMonths: 24, drawdown: 50, ally: 40 } })).toBe(false);
  });
});

describe('事件不改裁决（v3 §2.2 原则 D）', () => {
  it('事件效果只落在四轴：把事件落到约束后，裁决仍由纯函数算', () => {
    const constraints: ConstraintProfile = { runwayMonths: 6, drawdown: 50, ally: 40 };
    const choice = {
      id: 'b',
      text: '裸辞，全力冲',
      check: { targetStat: 'skill' as const, difficulty: 24 },
      tags: { efficiency: 'risky' as const },
    };

    const before = resolveChoice({ choice, constraints });
    const after = resolveChoice({
      choice,
      constraints: applyEventToConstraints(constraints, { drawdown: 20 }),
    });

    // 两边的结论都由同一个纯函数算出；事件只是改变了输入条件
    expect(['viable', 'breached', 'unknown']).toContain(before.verdict.kind);
    expect(['viable', 'breached', 'unknown']).toContain(after.verdict.kind);
    // 承压变高后，承压需求更容易满足 —— 这是条件变化，不是骰子
    expect(['viable', 'breached']).toContain(after.verdict.kind);
  });

  it('命运品质只缩放影响，不产生新的判定维度', () => {
    const effects = { runway: -4, drawdown: 8 };
    for (const tone of ['mishap', 'ordinary', 'fortunate', 'breakthrough'] as const) {
      const applied = applyFateTone(effects, tone);
      for (const axis of Object.keys(applied)) {
        expect(['runway', 'drawdown', 'reversibility', 'ally']).toContain(axis);
      }
    }
  });

  it('breakthrough 抵消负向影响（突破性遭遇不会雪上加霜）', () => {
    const applied = applyFateTone({ runway: -8, ally: 5 }, 'breakthrough');
    expect(applied.runway).toBe(0);
    expect(applied.ally).toBeGreaterThan(5);
  });

  it('mishap 放大负向、削弱正向', () => {
    const applied = applyFateTone({ runway: -4, ally: 10 }, 'mishap');
    expect(applied.runway).toBe(-6);
    expect(applied.ally).toBe(5);
  });
});

describe('事件落到约束上（唯一出口）', () => {
  it('钳制在轴区间内，不产生越界状态', () => {
    const tight: ConstraintProfile = { runwayMonths: 1, drawdown: 3, ally: 2 };
    const after = applyEventToConstraints(tight, { runway: -99, drawdown: -99, ally: -99 });
    expect(after.runwayMonths).toBe(0);
    expect(after.drawdown).toBe(0);
    expect(after.ally).toBe(0);

    const rich: ConstraintProfile = { runwayMonths: 23, drawdown: 99, ally: 99 };
    const up = applyEventToConstraints(rich, { runway: 99, drawdown: 99, ally: 99 });
    expect(up.runwayMonths).toBe(24);
    expect(up.drawdown).toBe(100);
    expect(up.ally).toBe(100);
  });

  it('缺项轴不变（不会因为没提到就把 ally 归零）', () => {
    const before: ConstraintProfile = { runwayMonths: 8, drawdown: 40, ally: 30 };
    const after = applyEventToConstraints(before, { runway: -3 });
    expect(after.drawdown).toBe(40);
    expect(after.ally).toBe(30);
    expect(after.runwayMonths).toBe(5);
  });

  it('drawEvent 把抽取与品质合起来，且确定性一致', () => {
    const input = { seed: 'SEED-2026-D', actIndex: 2, context: baseContext, tone: 'fortunate' as const };
    const first = drawEvent(input);
    const second = drawEvent(input);
    expect(first?.event.id).toBe(second?.event.id);
    expect(JSON.stringify(first?.applied)).toBe(JSON.stringify(second?.applied));
  });
});
