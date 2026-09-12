import { describe, expect, it } from 'vitest';

import {
  costForChoice,
  demandCapsForChoice,
  drawdownDemandFor,
  fateQualityOf,
  makeFateRoll,
  resolveChoice,
} from '@/core/decision/choiceResolution';
import { verdictForCaps } from '@/core/decision/verdict';

import type { ConstraintProfile } from '@/types/evidence';

/**
 * v3 §25 点名的 `verdictIsolation.test.ts`。
 *
 * 锁死一条世界观级契约（v3 §5.1 / §2.2 原则 D）：
 *
 * > **随机决定遭遇，不决定真相。**
 *
 * 具体说：命运掷骰（Fate Roll）**不能**改变一条路是否 viable / breached。
 * 这个测试是这个承诺的唯一执行点 —— 一旦有人把骰子重新塞回成败判定，
 * 它会立刻红。
 */

const generous: ConstraintProfile = { runwayMonths: 24, drawdown: 100, ally: 100 };
const tight: ConstraintProfile = { runwayMonths: 2, drawdown: 5, ally: 0 };

const riskyChoice = {
  id: 'b',
  text: '裸辞，全力冲一次',
  check: { targetStat: 'skill' as const, difficulty: 16 },
  tags: { efficiency: 'risky' as const, social: 'ally' as const },
};

const safeChoice = {
  id: 'a',
  text: '先把手上这门课稳住',
  tags: { efficiency: 'direct' as const },
};

describe('随机不决定真相（v3 §5.1 核心契约）', () => {
  it('命运掷骰面改变时，verdict 完全不变', () => {
    const results = Array.from({ length: 20 }, (_, index) =>
      resolveChoice({ choice: riskyChoice, constraints: tight, fateFace: index + 1 }).verdict,
    );

    // 20 个骰面 → 20 个完全相同的与骰面无关的结论
    const kinds = new Set(results.map((verdict) => verdict.kind));
    expect(kinds.size).toBe(1);
    expect([...kinds][0]).toBe('breached');

    // 相同的 breached 轴与缺口也必须一致（不能「运气好就少差一点」）
    const serialised = new Set(results.map((verdict) => JSON.stringify(verdict)));
    expect(serialised.size).toBe(1);
  });

  it('可行路线不会因为骰子差而变成不可行', () => {
    for (let face = 1; face <= 20; face += 1) {
      const resolution = resolveChoice({ choice: riskyChoice, constraints: generous, fateFace: face });
      expect(resolution.verdict.kind).toBe('viable');
      expect(resolution.isSuccess).toBe(true);
    }
  });

  it('不给骰面时结论与给骰面时一致（骰子是可选的叙事装饰）', () => {
    const withoutFate = resolveChoice({ choice: riskyChoice, constraints: tight });
    const withFate = resolveChoice({ choice: riskyChoice, constraints: tight, fateFace: 20 });
    expect(JSON.stringify(withoutFate.verdict)).toBe(JSON.stringify(withFate.verdict));
    expect(withoutFate.isSuccess).toBe(withFate.isSuccess);
  });

  it('isSuccess 只由 verdict 推出：breached 才失败', () => {
    expect(resolveChoice({ choice: riskyChoice, constraints: tight }).isSuccess).toBe(false);
    expect(resolveChoice({ choice: riskyChoice, constraints: generous }).isSuccess).toBe(true);
    expect(resolveChoice({ choice: safeChoice, constraints: tight }).isSuccess).toBe(true);
  });

  it('Fate Roll 仍然存在且携带遭遇品质（骰子没被删掉，只是换了职责）', () => {
    const fate = resolveChoice({ choice: riskyChoice, constraints: tight, fateFace: 20 }).fate;
    expect(fate).not.toBeNull();
    expect(fate?.face).toBe(20);
    expect(fate?.quality).toBe('breakthrough');
    expect(fate?.label.length).toBeGreaterThan(0);
  });

  it('Fate Roll 的品质分档单调且覆盖四档', () => {
    expect(fateQualityOf(1)).toBe('mishap');
    expect(fateQualityOf(10)).toBe('ordinary');
    expect(fateQualityOf(18)).toBe('fortunate');
    expect(fateQualityOf(20)).toBe('breakthrough');
    expect(makeFateRoll(20).quality).toBe('breakthrough');
  });
});

describe('选项需求推导（不发明新数值，只翻译既有语义）', () => {
  it('稳妥选项（无 check）不产生任何硬需求 → 永远可行', () => {
    const cost = costForChoice(safeChoice);
    expect(cost.timeCostMonths).toBeNull();
    expect(cost.irreversible).toBeNull();
    expect(cost.requiresAlly).toBeNull();

    const caps = demandCapsForChoice(safeChoice);
    const hard = caps.filter((cap) => cap.axis === 'runway' || cap.axis === 'drawdown');
    expect(hard).toHaveLength(0);

    // 最紧的条件下也走得动
    expect(verdictForCaps({ caps, constraints: tight, grade: null }).kind).toBe('viable');
  });

  it('DC 越高，承压需求越大（单调）', () => {
    const values = [8, 12, 16, 20, 24, 30].map(drawdownDemandFor);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    }
    expect(drawdownDemandFor(8)).toBeLessThan(drawdownDemandFor(30));
  });

  it('DC 边界钳制：低于 8 取下限，高于 30 取上限', () => {
    expect(drawdownDemandFor(0)).toBe(drawdownDemandFor(8));
    expect(drawdownDemandFor(99)).toBe(drawdownDemandFor(30));
    expect(drawdownDemandFor(NaN)).toBe(drawdownDemandFor(8));
  });

  it('高风险选项额外要求时间余量，普通风险选项不要求', () => {
    const risky = costForChoice(riskyChoice);
    expect(risky.timeCostMonths).not.toBeNull();

    const normal = costForChoice({
      id: 'b',
      text: '稳一点',
      check: { targetStat: 'skill', difficulty: 16 },
    });
    expect(normal.timeCostMonths).toBeNull();
  });

  it('social 语义映射到 ally 需求，且 antagonist 表示不依赖同伴', () => {
    expect(costForChoice({ id: 'b', text: 'x', tags: { social: 'ally' } }).requiresAlly).toBe(true);
    expect(costForChoice({ id: 'b', text: 'x', tags: { social: 'antagonize' } }).requiresAlly).toBe(false);
    expect(costForChoice({ id: 'b', text: 'x', tags: { social: 'neutral' } }).requiresAlly).toBeNull();
  });

  it('缺项不产生需求：没有 tags 的选项不会被凭空加上 ally 门槛', () => {
    const caps = demandCapsForChoice({ id: 'b', text: 'x', check: { targetStat: 'san', difficulty: 12 } });
    expect(caps.some((cap) => cap.axis === 'ally')).toBe(false);
    expect(caps.some((cap) => cap.axis === 'reversibility')).toBe(false);
  });

  it('drawdown 需求取 DC 与高风险之间更高的那条（不能互相抵消）', () => {
    const caps = demandCapsForChoice(riskyChoice);
    const drawdown = caps.find((cap) => cap.axis === 'drawdown');
    expect(drawdown).toBeDefined();
    // 高风险给 55；DC 16 换算后应高于 55，因此取 DC 那条
    expect(drawdown?.requirement).toBe(Math.max(55, drawdownDemandFor(16)));
  });

  it('确定性：同输入必得同输出（无隐藏随机）', () => {
    const input = { choice: riskyChoice, constraints: tight, fateFace: 7 };
    expect(JSON.stringify(resolveChoice(input))).toBe(JSON.stringify(resolveChoice(input)));
  });

  it('需求永远落在轴区间内（不会造出不可能达成的门槛）', () => {
    for (const difficulty of [1, 8, 15, 22, 30]) {
      const caps = demandCapsForChoice({
        id: 'b',
        text: 'x',
        check: { targetStat: 'skill', difficulty },
        tags: { efficiency: 'risky' },
      });
      for (const cap of caps) {
        expect(cap.requirement).toBeGreaterThanOrEqual(0);
        if (cap.axis === 'drawdown' || cap.axis === 'reversibility' || cap.axis === 'ally') {
          expect(cap.requirement).toBeLessThanOrEqual(100);
        }
        if (cap.axis === 'runway') {
          expect(cap.requirement).toBeLessThanOrEqual(24);
        }
      }
    }
  });
});
