import { rollD20 } from '@/core/d20';
import { hashValue, rngFor, sortByStableId } from '@/core/run/deterministic';
import { CAUSAL_ENGINE_VERSION, SCENE_TEMPLATES, type HiddenKey, type SceneTemplate } from '@/data/sceneTemplates';

import type { WorldHidden } from '@/features/run/contracts';

/**
 * 场景编译器（P1）：把「模板库 + 种子 + 世界状态」编译成事件计划。
 *
 * 两条职责必须分开，这是整个确定性设计的核心：
 *
 * - **规则**决定谁合法：`requires` / `excludes` 对着当前 flags 筛。
 * - **种子**决定优先级：对合法候选做稳定加权抽取。
 *
 * 如果让种子直接决定「抽哪个」，条件筛选就没意义；如果让规则决定优先级，
 * 种子挑战就退化成同一条固定路线。分开之后，同一颗种子在**相同选择历史**下
 * 必然走出完全相同的事件计划、骰面与状态；不同选择则走向不同模板。
 *
 * 优先级用 Efraimidis–Spirakis 加权无放回抽样：`key = u^(1/weight)`，
 * 对 key 降序排。它既尊重权重，又由种子决定，而且天然产出一个**完整排名**
 * （而不只是第一名）—— 这样「第一名不合法」时可以直接顺延，无需重新掷骰。
 */

export interface ActPlan {
  readonly act: 1 | 2 | 3 | 4;
  /** 该幕模板的稳定优先级（种子 + 修订号决定，与运行时状态无关）。 */
  readonly rankedTemplateIds: readonly string[];
}

export interface EventPlan {
  readonly engine: string;
  readonly scenarioRevision: string;
  readonly seed: string;
  readonly acts: readonly ActPlan[];
}

const ACTS = [1, 2, 3, 4] as const;

/** 加权无放回抽样的 key：u^(1/w)。u 取 (0,1)，避免 0 导致的退化。 */
function weightedKey(seed: string, revision: string, act: number, templateId: string, weight: number): number {
  const rng = rngFor(seed, revision, 'plan', act, templateId);
  const u = 1 - rng(); // (0, 1]
  return Math.pow(u, 1 / weight);
}

/**
 * 编译事件计划：**只吃 seed + 剧本修订号**，与运行时状态无关。
 * 因此同一份 Manifest 重放任意次，计划都逐字相同。
 */
export function compileEventPlan(input: {
  readonly seed: string;
  readonly scenarioRevision: string;
  readonly templates?: readonly SceneTemplate[];
}): EventPlan {
  const templates = input.templates ?? SCENE_TEMPLATES;

  const acts: ActPlan[] = ACTS.map((act) => {
    const candidates = templates.filter((template) => template.act === act);
    const ranked = [...candidates].sort((left, right) => {
      const a = weightedKey(input.seed, input.scenarioRevision, act, left.id, Math.max(left.weight, 0.0001));
      const b = weightedKey(input.seed, input.scenarioRevision, act, right.id, Math.max(right.weight, 0.0001));
      if (a === b) {
        // 极端碰撞：退回字典序，保证排序仍然是全序且稳定
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      }
      return b - a;
    });

    return { act, rankedTemplateIds: ranked.map((template) => template.id) };
  });

  return {
    engine: CAUSAL_ENGINE_VERSION,
    scenarioRevision: input.scenarioRevision,
    seed: input.seed,
    acts,
  };
}

/** 计划哈希：写进 `RunManifest.eventPlanHash`，用于挑战链接校验。 */
export function planHash(plan: EventPlan): string {
  return hashValue(plan);
}

/** 模板是否满足进入条件（纯规则，不看种子）。 */
export function isTemplateLegal(
  template: SceneTemplate,
  flags: readonly string[],
): boolean {
  const flagSet = new Set(flags);

  if (template.requires && !template.requires.every((flag) => flagSet.has(flag))) {
    return false;
  }
  if (template.excludes && template.excludes.some((flag) => flagSet.has(flag))) {
    return false;
  }
  return true;
}

/**
 * 按计划优先级挑出这一幕真正使用的模板。
 *
 * 从排名头部顺延到第一个合法候选 —— 这就是「规则筛候选、种子定顺序」的落点。
 * 全部不合法时返回 null，调用方应回落到该幕的默认模板（而不是崩掉）。
 */
export function selectTemplateForAct(
  plan: EventPlan,
  act: 1 | 2 | 3 | 4,
  flags: readonly string[],
  templates: readonly SceneTemplate[] = SCENE_TEMPLATES,
): SceneTemplate | null {
  const actPlan = plan.acts.find((item) => item.act === act);
  if (!actPlan) {
    return null;
  }

  const byId = new Map(templates.map((template) => [template.id, template]));

  for (const id of actPlan.rankedTemplateIds) {
    const template = byId.get(id);
    if (template && isTemplateLegal(template, flags)) {
      return template;
    }
  }

  return null;
}

/**
 * 某一幕某个选项的**唯一随机源**。
 *
 * 骰面预览（`diceForChoice`）与真正的检定（`runEngine` 里的 `evaluateCheck`）
 * 必须共用这一个工厂 —— 两处各写一份 key 迟早会漂移，而「挑战者看到同一组骰面」
 * 正是种子挑战的立身之本。
 *
 * key 里带 `templateId + choiceId`：换模板或换选项都换骰面，但同一 Manifest
 * 的同一选择永远同一点数。
 */
export function choiceRng(input: {
  readonly seed: string;
  readonly scenarioRevision: string;
  readonly act: number;
  readonly templateId: string;
  readonly choiceId: string;
}): () => number {
  return rngFor(
    input.seed,
    input.scenarioRevision,
    'dice',
    input.act,
    input.templateId,
    input.choiceId,
  );
}

/** 骰面预览（1..20），与检定共用同一个随机源。 */
export function diceForChoice(input: {
  readonly seed: string;
  readonly scenarioRevision: string;
  readonly act: number;
  readonly templateId: string;
  readonly choiceId: string;
}): number {
  return rollD20(choiceRng(input));
}

/** 该幕的旁白：命中第一条「隐藏状态达标」的变体，否则用默认旁白。 */
export function beatForTemplate(template: SceneTemplate, hidden: WorldHidden): string {
  for (const variant of template.beatsByState ?? []) {
    const key: HiddenKey = variant.when.hidden;
    if (hidden[key] >= variant.when.atLeast) {
      return variant.line;
    }
  }
  return template.defaultBeat;
}

/**
 * 幽灵线：一幕里**没走**的那条分支。
 *
 * 命运树要展示「走过的节点 + 未选择的幽灵线」，但未走线路不能泄露完整结果，
 * 所以这里只给标签与模糊标记，不给反馈文案与数值。
 *
 * 对「模板」与「既有剧本的选项」都适用 —— 只依赖 `{ id, text }` 这两个字段，
 * 因此预置剧本 / AI 关卡也能复用它来画幽灵线。
 */
export interface GhostLine {
  readonly id: string;
  readonly label: string;
  /** 永远是 true：提醒 UI 这是被遮蔽的分支。 */
  readonly blurred: true;
}

/** 从任意「有 id 与 text 的选项列表」里取未选择的幽灵线。 */
export function ghostLinesFrom(
  choices: readonly { readonly id: string; readonly text: string }[],
  chosenId: string,
  limit = 2,
): readonly GhostLine[] {
  return sortByStableId(
    choices.filter((choice) => choice.id !== chosenId),
    (choice) => choice.id,
  )
    .slice(0, Math.max(0, limit))
    .map((choice) => ({ id: choice.id, label: choice.text, blurred: true as const }));
}

/** 模板版本：等价于 `ghostLinesFrom(template.choices, chosenChoiceId, limit)`。 */
export function ghostLinesForChoice(
  template: SceneTemplate,
  chosenChoiceId: string,
  limit = 2,
): readonly GhostLine[] {
  return ghostLinesFrom(template.choices, chosenChoiceId, limit);
}
