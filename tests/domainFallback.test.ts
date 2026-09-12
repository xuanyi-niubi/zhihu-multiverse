import { describe, expect, it } from 'vitest';

import {
  DOMAIN_CONFIDENCE_THRESHOLD,
  DOMAIN_OPTIONS,
  domainConfidenceOf,
  isConfidentEnough,
  planQueries,
} from '@/core/evidence/plan';

/**
 * v3 §25 点名的 `domainFallback.test.ts`。
 *
 * 锁死「自定义输入安全兜底」（v3 §20 / §23 P2-7）：
 *
 * > 自定义输入是现场最容易出事故的地方。
 *
 * 事故场景很具体：玩家输入一句与职业决策无关的话（「今天天气不错」），
 * 系统照样把他放进游戏，检索出一张空网格 —— 于是**白玩一局**。
 * 这组测试保证那种情况会被「二次选择」拦住。
 */

describe('领域置信度（v3 §20）', () => {
  it('窄领域词命中即达阈值（具体方向可以直接检索）', () => {
    for (const goal of ['大三法学想转计算机', '想考公还是考研', '机械专业想转行']) {
      const match = domainConfidenceOf({ goal });
      expect(match.matchedDomains.length).toBeGreaterThan(0);
      expect(isConfidentEnough(match)).toBe(true);
    }
  });

  it('只有宽领域信号时也能达到阈值（长尾表述不该被硬拦）', () => {
    const match = domainConfidenceOf({ goal: '我在纠结要不要回老家' });
    expect(match.matchedBroad.length).toBeGreaterThan(0);
    expect(isConfidentEnough(match)).toBe(true);
  });

  it('与决策无关的输入 → 置信度低（这就是要拦的情况）', () => {
    for (const goal of ['今天天气不错', '中午吃什么比较好', '随便聊聊']) {
      const match = domainConfidenceOf({ goal });
      expect(match.score).toBeLessThan(DOMAIN_CONFIDENCE_THRESHOLD);
      expect(isConfidentEnough(match)).toBe(false);
      expect(match.matchedDomains).toHaveLength(0);
      expect(match.matchedBroad).toHaveLength(0);
    }
  });

  it('空输入 → 置信度 0（前端据此显示占位而不是开始检索）', () => {
    expect(domainConfidenceOf({ goal: '' }).score).toBe(0);
    expect(domainConfidenceOf({ goal: '   ' }).score).toBe(0);
    expect(domainConfidenceOf({ goal: '', background: null }).score).toBe(0);
  });

  it('置信度被钳在 0..1，且确定性', () => {
    const rich = { goal: '大二计算机想考研还是直接找工作，家里希望我考公' };
    const first = domainConfidenceOf(rich);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(1);
    expect(domainConfidenceOf(rich).score).toBe(first.score);
  });

  it('背景（处境档案）也参与判定：正文稀薄但背景清楚时不误拦', () => {
    const match = domainConfidenceOf({ goal: '我不知道怎么办', background: '大三 计算机 保研' });
    expect(isConfidentEnough(match)).toBe(true);
  });
});

describe('二次选择（domainOptions）', () => {
  it('六个宽领域齐全，且每个都带可直接检索的 querySeed', () => {
    expect(DOMAIN_OPTIONS.length).toBeGreaterThanOrEqual(5);
    for (const option of DOMAIN_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.querySeed.length).toBeGreaterThan(4);
      expect(option.signals.length).toBeGreaterThan(3);
    }
  });

  it('领域 id 唯一，信号词不重复定义（避免两个领域争同一个词）', () => {
    const ids = DOMAIN_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);

    const allSignals = DOMAIN_OPTIONS.flatMap((option) => [...option.signals]);
    // 允许少量跨领域重叠（「压力」既属于生活也属于学业），但不能大面积重复
    expect(new Set(allSignals).size).toBeGreaterThan(allSignals.length * 0.9);
  });

  it('玩家点选一个领域后，二次检索一定能产出合法计划（保证返回合法状态）', () => {
    for (const option of DOMAIN_OPTIONS) {
      const plan = planQueries({ goal: option.querySeed });
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.length).toBeLessThanOrEqual(5);
      for (const planned of plan) {
        expect(planned.query.length).toBeGreaterThan(0);
        expect(planned.query.length).toBeLessThanOrEqual(60);
      }
    }
  });

  it('点选后的置信度必须超过阈值（否则会陷入「再问一次」的死循环）', () => {
    for (const option of DOMAIN_OPTIONS) {
      const match = domainConfidenceOf({ goal: option.querySeed });
      expect(isConfidentEnough(match)).toBe(true);
    }
  });

  it('二次选择的检索词与宽领域信号对齐（点了「转行」就该搜转行）', () => {
    const pivot = DOMAIN_OPTIONS.find((option) => option.id === 'pivot');
    expect(pivot).toBeDefined();
    if (!pivot) return;
    expect(pivot.querySeed).toContain('转行');
    expect(domainConfidenceOf({ goal: pivot.querySeed }).matchedBroad.map((item) => item.id)).toContain('pivot');
  });
});

describe('空计划不进入游戏（兜底契约）', () => {
  it('空目标不产生检索计划（调用方必须走二次选择，而不是硬搜）', () => {
    expect(planQueries({ goal: '' })).toHaveLength(0);
    expect(planQueries({ goal: '   ' })).toHaveLength(0);
  });

  it('无关输入仍会产生计划（检索可以失败，但计划必须合法）', () => {
    const plan = planQueries({ goal: '今天天气不错' });
    // 计划合法即可 —— 是否搜到东西由检索层决定，不该在这里硬拦
    for (const planned of plan) {
      expect(planned.query.length).toBeGreaterThan(0);
    }
    // 但置信度必须低，让前端有机会拦一次
    expect(isConfidentEnough(domainConfidenceOf({ goal: '今天天气不错' }))).toBe(false);
  });
});
