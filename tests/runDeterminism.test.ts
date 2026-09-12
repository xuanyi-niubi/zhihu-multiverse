import { describe, expect, it } from 'vitest';

import { createRun, replayRun, sourceSetHash, verifyManifest } from '@/core/run/runEngine';
import {
  compileEventPlan,
  diceForChoice,
  planHash,
  selectTemplateForAct,
} from '@/core/run/scenarioCompiler';
import { SCENARIO_REVISION as REVISION, SCENE_TEMPLATES } from '@/data/sceneTemplates';
import { parseRunManifest } from '@/features/run/contracts';

import type { SceneTemplate } from '@/data/sceneTemplates';

/**
 * P1 退出门槛：**同一 Manifest 重放 100 次，事件计划、骰面和状态完全一致。**
 *
 * 这一组用例是整个确定性设计的地基 —— 如果它会飘，那么：
 * 「挑战链接可比」「种子复盘」「AI 剧本公平重玩」全部都是空话。
 */

const SEED = 'SEED-2026-GOEVT';
const STATS = { san: 60, skill: 45, bond: 40 };
const CHOICES = ['a', 'b', 'a', 'a'] as const;

function replay(seed: string, choices: readonly string[] = CHOICES, templates = SCENE_TEMPLATES) {
  const { manifest } = createRun({ seed, scenarioId: 'ai-dm' });
  return replayRun({ manifest, choices, initialStats: STATS, templates });
}

describe('① 100 次重放完全一致（退出门槛）', () => {
  it('事件计划逐字节一致', () => {
    const first = JSON.stringify(compileEventPlan({ seed: SEED, scenarioRevision: REVISION }));

    for (let i = 0; i < 100; i += 1) {
      const again = JSON.stringify(compileEventPlan({ seed: SEED, scenarioRevision: REVISION }));
      expect(again).toBe(first);
    }
  });

  it('骰面序列、状态轨迹与轨迹哈希全部一致', () => {
    const baseline = replay(SEED);
    const baselineDice = baseline.resolutions.map((item) => item.dice);
    const baselineHash = baseline.trajectoryHash;

    for (let i = 0; i < 100; i += 1) {
      const again = replay(SEED);

      expect(again.manifest.eventPlanHash).toBe(baseline.manifest.eventPlanHash);
      expect(again.resolutions.map((item) => item.dice)).toEqual(baselineDice);
      expect(again.resolutions.map((item) => item.templateId)).toEqual(
        baseline.resolutions.map((item) => item.templateId),
      );
      expect(again.finalState).toEqual(baseline.finalState);
      expect(again.trajectoryHash).toBe(baselineHash);
    }
  });

  it('100 次重放里每条决议的完整快照也一致', () => {
    const baseline = JSON.stringify(replay(SEED).resolutions);

    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(replay(SEED).resolutions)).toBe(baseline);
    }
  });
});

describe('② 换种子 / 换修订号必须换结果', () => {
  it('不同种子给出不同的事件计划哈希（抽 20 个种子至少 15 个不同）', () => {
    const hashes = new Set(
      Array.from({ length: 20 }, (_, index) =>
        planHash(compileEventPlan({ seed: `SEED-2026-${index}`, scenarioRevision: REVISION })),
      ),
    );

    expect(hashes.size).toBeGreaterThanOrEqual(15);
  });

  it('剧本修订号变化会改变计划哈希（老挑战不会静默变味道）', () => {
    const v1 = planHash(compileEventPlan({ seed: SEED, scenarioRevision: '1' }));
    const v2 = planHash(compileEventPlan({ seed: SEED, scenarioRevision: '2' }));

    expect(v1).not.toBe(v2);
  });

  it('骰面由 key 决定：同一 key 稳定，不同 key 不恒定', () => {
    const key = {
      seed: SEED,
      scenarioRevision: REVISION,
      act: 1,
      templateId: 't1-name-the-goal',
      choiceId: 'b',
    };

    // 同一 key 永远同一点数
    expect(diceForChoice(key)).toBe(diceForChoice(key));

    // 不同 key 不应退化成常数（否则等于没有随机）
    const distinct = new Set(
      Array.from({ length: 30 }, (_, index) => diceForChoice({ ...key, choiceId: `c${index}` })),
    );
    expect(distinct.size).toBeGreaterThan(5);

    // 换幕也换骰面
    const acrossActs = new Set(
      [1, 2, 3, 4].map((act) => diceForChoice({ ...key, act })),
    );
    expect(acrossActs.size).toBeGreaterThan(1);
  });

  it('所有骰面都落在 1..20', () => {
    for (let index = 0; index < 200; index += 1) {
      for (const resolution of replay(`SEED-2026-S${index}`).resolutions) {
        if (resolution.dice !== null) {
          expect(resolution.dice).toBeGreaterThanOrEqual(1);
          expect(resolution.dice).toBeLessThanOrEqual(20);
        }
      }
    }
  });
});

describe('③ 计划依赖规则而非运气：改文案不改计划', () => {
  it('只改旁白文案时，计划哈希与轨迹哈希都不变（文案属表现层）', () => {
    // 先问引擎：这局第一幕到底会选中哪个模板（别假设）
    const plan = compileEventPlan({ seed: SEED, scenarioRevision: REVISION });
    const act1 = selectTemplateForAct(plan, 1, []);
    expect(act1).not.toBeNull();
    const targetId = act1!.id;

    const mutated: readonly SceneTemplate[] = SCENE_TEMPLATES.map((template) =>
      template.id === targetId
        ? { ...template, defaultBeat: '完全换了一句话，但规则没变。' }
        : template,
    );

    const before = replay(SEED);
    const after = replay(SEED, CHOICES, mutated);

    expect(after.manifest.eventPlanHash).toBe(before.manifest.eventPlanHash);
    expect(after.trajectoryHash).toBe(before.trajectoryHash);
    // 旁白确实换掉了 —— 证明改的是文案而不是别的
    expect(after.resolutions[0].beat).toBe('完全换了一句话，但规则没变。');
    expect(before.resolutions[0].beat).not.toBe(after.resolutions[0].beat);
  });

  it('权重属于规则：把非头名模板权重拉到极高，它会排到该幕第一且计划哈希改变', () => {
    const before = compileEventPlan({ seed: SEED, scenarioRevision: REVISION });
    const currentTop = before.acts[0].rankedTemplateIds[0];
    // 挑一个当前**不是**头名的模板来加权，避免依赖具体种子的排序结果
    const challenger = before.acts[0].rankedTemplateIds.find((id) => id !== currentTop);
    expect(challenger).toBeDefined();

    const boosted: readonly SceneTemplate[] = SCENE_TEMPLATES.map((template) =>
      template.id === challenger ? { ...template, weight: 9999 } : template,
    );

    const after = compileEventPlan({ seed: SEED, scenarioRevision: REVISION, templates: boosted });

    expect(after.acts[0].rankedTemplateIds[0]).toBe(challenger);
    expect(planHash(after)).not.toBe(planHash(before));
  });
});

describe('④ Manifest 契约自洽', () => {
  it('createRun 产出的 Manifest 能通过严格解析', () => {
    const { manifest } = createRun({ seed: SEED, scenarioId: 'ai-dm' });
    const parsed = parseRunManifest(manifest);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.runId).toBe(manifest.runId);
      expect(parsed.manifest.eventPlanHash).toBe(manifest.eventPlanHash);
    }
  });

  it('同一颗种子得到同一个 runId（便于对账）', () => {
    expect(createRun({ seed: SEED, scenarioId: 'ai-dm' }).manifest.runId).toBe(
      createRun({ seed: SEED, scenarioId: 'ai-dm' }).manifest.runId,
    );
  });

  it('来源集合哈希与传入顺序无关', () => {
    expect(sourceSetHash(['s1', 's2'])).toBe(sourceSetHash(['s2', 's1']));
    expect(sourceSetHash(['s1'])).not.toBe(sourceSetHash(['s1', 's2']));
  });

  it('verifyManifest 能识破被篡改的计划哈希', () => {
    const { manifest } = createRun({ seed: SEED, scenarioId: 'ai-dm' });

    const ok = verifyManifest(manifest);
    expect(ok.ok).toBe(true);

    const tampered = verifyManifest({ ...manifest, eventPlanHash: 'f'.repeat(16) });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.reason).toBe('event-plan-hash-mismatch');
    }
  });

  it('verifyManifest 对非对象输入也不抛异常', () => {
    expect(verifyManifest(null).ok).toBe(false);
    expect(verifyManifest({ version: 99 }).ok).toBe(false);
  });
});
