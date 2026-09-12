import { describe, expect, it } from 'vitest';

import {
  beatForTemplate,
  compileEventPlan,
  diceForChoice,
  ghostLinesForChoice,
  isTemplateLegal,
  planHash,
  selectTemplateForAct,
} from '@/core/run/scenarioCompiler';
import { SCENE_TEMPLATES, type SceneTemplate } from '@/data/sceneTemplates';

/**
 * 编译器的两条职责必须彼此独立：
 * **规则筛合法候选，种子定优先级。** 这一组用例分别把它们钉住。
 */

const REV = '1';

function planFor(seed: string, templates?: readonly SceneTemplate[]) {
  return compileEventPlan({ seed, scenarioRevision: REV, templates });
}

describe('isTemplateLegal（规则侧）', () => {
  it('requires 全部具备才合法', () => {
    const template: SceneTemplate = { ...SCENE_TEMPLATES[0], requires: ['a', 'b'] };

    expect(isTemplateLegal(template, ['a', 'b'])).toBe(true);
    expect(isTemplateLegal(template, ['a'])).toBe(false);
    expect(isTemplateLegal(template, [])).toBe(false);
  });

  it('excludes 命中任一即出局', () => {
    const template: SceneTemplate = { ...SCENE_TEMPLATES[0], excludes: ['x', 'y'] };

    expect(isTemplateLegal(template, [])).toBe(true);
    expect(isTemplateLegal(template, ['y'])).toBe(false);
  });

  it('没有条件的模板永远合法', () => {
    expect(isTemplateLegal({ ...SCENE_TEMPLATES[0], requires: undefined, excludes: undefined }, [])).toBe(
      true,
    );
  });
});

describe('selectTemplateForAct（规则 ∩ 种子）', () => {
  it('返回排名里第一个合法候选', () => {
    const plan = planFor('SEED-2026-PICK');
    const actPlan = plan.acts[0];
    const selected = selectTemplateForAct(plan, 1, []);

    expect(selected).not.toBeNull();
    expect(selected!.id).toBe(actPlan.rankedTemplateIds[0]);
  });

  it('头名不合法时顺延到下一个（而不是重新掷骰）', () => {
    const plan = planFor('SEED-2026-PICK');
    const [first, second] = plan.acts[0].rankedTemplateIds;
    const firstTemplate = SCENE_TEMPLATES.find((item) => item.id === first)!;

    // 给头名加一个必然不满足的条件
    const patched: readonly SceneTemplate[] = SCENE_TEMPLATES.map((item) =>
      item.id === first ? { ...item, requires: ['impossible-flag'] } : item,
    );

    const selected = selectTemplateForAct(plan, 1, [], patched);
    expect(selected!.id).toBe(second);
    // 顺延不动计划本身
    expect(plan.acts[0].rankedTemplateIds[0]).toBe(firstTemplate.id);
  });

  it('全部不合法时返回 null（调用方负责兜底，而不是崩）', () => {
    const plan = planFor('SEED-2026-NONE');
    const allIllegal: readonly SceneTemplate[] = SCENE_TEMPLATES.map((item) => ({
      ...item,
      excludes: ['everything'],
    }));

    expect(selectTemplateForAct(plan, 1, ['everything'], allIllegal)).toBeNull();
  });

  it('选出来的模板一定属于该幕（不会串幕）', () => {
    for (let act = 1; act <= 4; act += 1) {
      const plan = planFor(`SEED-2026-ACT${act}`);
      const selected = selectTemplateForAct(plan, act as 1 | 2 | 3 | 4, []);
      expect(selected?.act).toBe(act);
    }
  });

  it('计划里每一幕都覆盖了该幕的全部模板（排名是完整排列）', () => {
    const plan = planFor('SEED-2026-COVER');

    for (const actPlan of plan.acts) {
      const expected = SCENE_TEMPLATES.filter((item) => item.act === actPlan.act).map((item) => item.id);
      expect([...actPlan.rankedTemplateIds].sort()).toEqual(expected.sort());
    }
  });
});

describe('beatForTemplate（隐藏状态只影响旁白）', () => {
  it('命中第一条达标变体，否则用默认旁白', () => {
    const template: SceneTemplate = {
      ...SCENE_TEMPLATES[0],
      defaultBeat: '默认旁白',
      beatsByState: [
        { when: { hidden: 'bodyAlarm', atLeast: 70 }, line: '很高' },
        { when: { hidden: 'bodyAlarm', atLeast: 30 }, line: '偏高' },
      ],
    };
    const base = { bodyAlarm: 0, peerPressure: 0, runway: 50, mentorTrust: 50, socialDebt: 0 };

    expect(beatForTemplate(template, { ...base, bodyAlarm: 10 })).toBe('默认旁白');
    expect(beatForTemplate(template, { ...base, bodyAlarm: 30 })).toBe('偏高');
    expect(beatForTemplate(template, { ...base, bodyAlarm: 90 })).toBe('很高');
  });
});

describe('幽灵线（未选择的分支）', () => {
  it('只给没走的那条，且不泄露反馈与数值', () => {
    const template = SCENE_TEMPLATES[0];
    const ghosts = ghostLinesForChoice(template, 'a');

    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(ghost.id).not.toBe('a');
      expect(ghost.blurred).toBe(true);
      // 未走线路不能带结果信息
      expect(ghost).not.toHaveProperty('feedback');
      expect(ghost).not.toHaveProperty('effects');
      expect(ghost).not.toHaveProperty('dice');
    }
  });

  it('同输入同输出（可复盘）', () => {
    const template = SCENE_TEMPLATES[2];
    expect(JSON.stringify(ghostLinesForChoice(template, 'b'))).toBe(
      JSON.stringify(ghostLinesForChoice(template, 'b')),
    );
  });

  it('limit 生效', () => {
    expect(ghostLinesForChoice(SCENE_TEMPLATES[0], 'a', 0)).toHaveLength(0);
    expect(ghostLinesForChoice(SCENE_TEMPLATES[0], 'a', 1)).toHaveLength(1);
  });
});

describe('计划与骰面（种子侧）', () => {
  it('计划哈希是 16 位十六进制', () => {
    expect(planHash(planFor('SEED-2026-H'))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('骰面稳定且落在 1..20', () => {
    const key = {
      seed: 'SEED-2026-D',
      scenarioRevision: REV,
      act: 2,
      templateId: 't2-resource-squeeze',
      choiceId: 'b',
    };

    const roll = diceForChoice(key);
    expect(roll).toBe(diceForChoice(key));
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(20);
  });
});
