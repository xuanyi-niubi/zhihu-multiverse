import { describe, expect, it } from 'vitest';

import { PREBUILT_SCENARIOS, RELIC_LIBRARY } from '@/data/prebuiltScenarios';
import { ORIGINS } from '@/data/origins';
import { SCENE_TEMPLATES } from '@/data/sceneTemplates';

/**
 * 内容扩容的契约测试（最终版 §6 P0-2）。
 *
 * 文档的判断是「真实问题是内容规模与结构自由度太小」，所以内容量必须**被测试钉住**，
 * 否则以后一次重构就可能把它缩回去，而且没人发现。
 *
 * 同时钉住三件事：
 * ① 遗物不是"沉默的加值道具"——每件都要有叙事钩子（效果类型 × 叙事钩子）；
 * ② 效果类型要有多样性，不能 15 件全是同一个 check-modifier；
 * ③ 来源字段必须完整且是 https（沿用既有来源分级纪律）。
 */

const relics = Object.values(RELIC_LIBRARY);

describe('遗物库规模与质量', () => {
  it('至少 15 件（最终版要求 6 → 15+）', () => {
    expect(relics.length).toBeGreaterThanOrEqual(15);
  });

  it('id 唯一且与键一致', () => {
    const ids = relics.map((relic) => relic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, relic] of Object.entries(RELIC_LIBRARY)) {
      expect(relic.id).toBe(key);
    }
  });

  it('每件都有名字、引文与可追溯来源', () => {
    for (const relic of relics) {
      expect(relic.name.trim().length).toBeGreaterThan(0);
      expect(relic.quote.trim().length).toBeGreaterThan(8);
      expect(relic.source.author.trim().length).toBeGreaterThan(0);
      expect(relic.source.title.trim().length).toBeGreaterThan(0);
      expect(relic.source.sourceUrl.startsWith('https://')).toBe(true);
      expect(['verified', 'scripted']).toContain(relic.source.status);
    }
  });

  it('**每件遗物都有叙事钩子**（不只是加数值）', () => {
    const missing = relics.filter((relic) => !relic.narrativeHook || relic.narrativeHook.trim().length < 6);
    expect(missing.map((relic) => relic.id)).toEqual([]);
  });

  it('效果数量在 1..3 之间（类型层不变量）', () => {
    for (const relic of relics) {
      expect(relic.effects.length).toBeGreaterThanOrEqual(1);
      expect(relic.effects.length).toBeLessThanOrEqual(3);
    }
  });

  it('效果类型有多样性（三种至少各出现一次）', () => {
    const types = new Set(relics.flatMap((relic) => relic.effects.map((effect) => effect.type)));
    expect(types.has('check-modifier')).toBe(true);
    expect(types.has('san-damage-reduction')).toBe(true);
    expect(types.has('next-check-modifier')).toBe(true);
  });

  it('主动遗物带充能、被动遗物不带（互斥约束）', () => {
    const active = relics.filter((relic) => relic.kind === 'active');
    expect(active.length).toBeGreaterThan(0);
    for (const relic of active) {
      expect(relic.effects.some((effect) => effect.type === 'next-check-modifier')).toBe(true);
    }
  });

  it('引文里不出现编造的百分比（沿用来源真实性纪律）', () => {
    for (const relic of relics) {
      expect(/\d+\s*[%％]/.test(relic.quote)).toBe(false);
    }
  });
});

describe('内容可达性（内容库里有 ≠ 玩家拿得到）', () => {
  const referenced = (() => {
    const ids = new Set<string>();
    for (const scenario of PREBUILT_SCENARIOS) {
      for (const turn of scenario.turns) {
        for (const choice of turn.choices) {
          for (const outcome of [choice.onSuccess, choice.onFail]) {
            if (outcome?.relicId) {
              ids.add(outcome.relicId);
            }
          }
        }
      }
    }
    return ids;
  })();

  it('预置剧本引用的遗物 id 全部存在于库中（不会掉出空遗物）', () => {
    const unknown = [...referenced].filter((id) => !RELIC_LIBRARY[id]);
    expect(unknown).toEqual([]);
  });

  it('**至少 12 件遗物在无 AI 的预置剧本里可达**（内容扩容必须真的能玩到）', () => {
    expect(referenced.size).toBeGreaterThanOrEqual(12);
  });

  it('失败分支也会掉落（失败留下的是教训，不是空白）', () => {
    const failDrops = PREBUILT_SCENARIOS.flatMap((scenario) =>
      scenario.turns.flatMap((turn) =>
        turn.choices.map((choice) => choice.onFail?.relicId).filter((id): id is string => Boolean(id)),
      ),
    );
    expect(failDrops.length).toBeGreaterThanOrEqual(6);
  });

  it('成功与失败掉的是不同的东西（不是同一件重复发）', () => {
    const successIds = new Set(
      PREBUILT_SCENARIOS.flatMap((scenario) =>
        scenario.turns.flatMap((turn) =>
          turn.choices.map((choice) => choice.onSuccess.relicId).filter((id): id is string => Boolean(id)),
        ),
      ),
    );
    const failIds = new Set(
      PREBUILT_SCENARIOS.flatMap((scenario) =>
        scenario.turns.flatMap((turn) =>
          turn.choices.map((choice) => choice.onFail?.relicId).filter((id): id is string => Boolean(id)),
        ),
      ),
    );
    const overlap = [...failIds].filter((id) => successIds.has(id));
    expect(overlap).toEqual([]);
  });
});

describe('场景骨架规模（文档称 3 个，实测已达标）', () => {
  it('至少 12 个模板，且每一幕都有骨架', () => {
    expect(SCENE_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    const acts = new Set(SCENE_TEMPLATES.map((template) => template.act));
    expect([...acts].sort()).toEqual([1, 2, 3, 4]);
  });

  it('每个模板都有旁白与选择，且权重为正', () => {
    for (const template of SCENE_TEMPLATES) {
      expect(template.defaultBeat.trim().length).toBeGreaterThan(10);
      expect(template.choices.length).toBeGreaterThanOrEqual(2);
      expect(template.weight).toBeGreaterThan(0);
    }
  });

  it('模板 id 唯一', () => {
    const ids = SCENE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('起源数量与结构', () => {
  it('至少 3 个起源，每个都有开局遗物或属性画像', () => {
    expect(ORIGINS.length).toBeGreaterThanOrEqual(3);
    for (const origin of ORIGINS) {
      expect(origin.id.trim().length).toBeGreaterThan(0);
      expect(origin.name.trim().length).toBeGreaterThan(0);
      expect(origin.stats.san).toBeGreaterThan(0);
    }
  });
});
