/**
 * AI 叙事引擎的契约层。
 *
 * 设计原则（两份规范一致要求）：
 * - **AI 决定「发生了什么」，引擎决定「数值是多少」**：Agent 输出情节意图、选项语义与
 *   检定请求，但骰面、DC、胜负、掉落永远由确定性引擎裁决。
 * - **每个 Agent 的输出都要能被校验**：进不了 schema 的输出等于没输出，一律降级。
 * - **只用定性信息喂模型**：隐藏状态以「身体报警 / 时间很紧」这类说法注入，
 *   不把后台数值直接交给模型（否则模型会开始"算数"，而算数是引擎的活）。
 */

/** 六个 Agent 角色（对应规范里的 6 个叙事智能体）。 */
export type AgentRole =
  | 'orchestrator'
  | 'plot-director'
  | 'character-actor'
  | 'world-simulator'
  | 'memory-curator'
  | 'style-stylist';

/** 玩家意图分类：路由的第一层判断。 */
export type UserIntentKind = 'action' | 'dialogue' | 'explore' | 'system';

export interface UserIntent {
  readonly kind: UserIntentKind;
  /** 玩家原话（可选；选项式玩法下为空）。 */
  readonly utterance?: string;
}

/** 选项语义标签：AI 生成，引擎消费。 */
export interface ChoiceTags {
  readonly moral: 'good' | 'neutral' | 'dark';
  readonly efficiency: 'direct' | 'indirect' | 'risky';
  readonly social: 'ally' | 'neutral' | 'antagonize';
}

/** 检定请求：AI 只能提出，难度最终由引擎钳制。 */
export interface CheckRequest {
  readonly stat: 'san' | 'skill' | 'bond';
  /** AI 的直觉难度；引擎会按世界状态与动态难度重新钳制。 */
  readonly difficulty: number;
  /** 失败/成功时的风味描述（只影响文案）。 */
  readonly flavor?: string;
}

export interface PlotChoice {
  readonly id: string;
  readonly text: string;
  readonly hint: string;
  readonly tags: ChoiceTags;
  readonly check?: CheckRequest;
  /** 选项自身的记忆钩子：AI 用它说明"为什么这个选择值得记住"。 */
  readonly memoryHook?: string;
}

/** 情节简报：Plot Director 的产出，也是「故事是什么」的决策结果。 */
export interface PlotBrief {
  readonly title: string;
  readonly scene: string;
  readonly dilemma: string;
  readonly choices: readonly PlotChoice[];
  /** 本幕引用的知乎素材 id（必须在白名单内）。 */
  readonly referencedKnowledgeIds: readonly string[];
  /** 本幕要推进/收束的叙事线索 id。 */
  readonly threadIds: readonly string[];
}

/** 世界模型的定性快照：喂给模型的形状。 */
export interface WorldBrief {
  readonly act: number;
  readonly totalActs: number;
  readonly sceneName: string;
  readonly timeLabel: string;
  readonly stats: { readonly san: number; readonly skill: number; readonly bond: number };
  /** 定性状态词（不含数值）。 */
  readonly signals: readonly string[];
  /** 携带的遗物名与叙事钩子。 */
  readonly relics: readonly { readonly name: string; readonly hook?: string }[];
}

/** 玩家画像：跨局累积的身份与历史。 */
export interface PlayerBrief {
  readonly originName: string;
  readonly goal: string;
  readonly archetypes: readonly string[];
  /** 上一局留下的遗念（跨局记忆）。 */
  readonly legacyWords: string | null;
  readonly totalRuns: number;
}

/** 结构化记忆（对应规范的 episodic / semantic / procedural / relationship / narrative）。 */
export type MemoryKind = 'episodic' | 'semantic' | 'procedural' | 'relationship' | 'narrative';

export interface StructuredMemory {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly act: number;
  /** 0..1：用于 MAG 检索排序。 */
  readonly weight: number;
}

/** MAG：注入模型的完整上下文。 */
export interface NarrativeContext {
  readonly intent: UserIntent;
  readonly world: WorldBrief;
  readonly player: PlayerBrief;
  /** 已按相关度排序、可直接注入的记忆。 */
  readonly memories: readonly StructuredMemory[];
  /** 本幕可用的知乎素材（含 id，供模型引用）。 */
  readonly knowledge: readonly { readonly id: string; readonly title: string; readonly quote: string }[];
  /** 动态难度偏移（引擎算好，模型只读）。 */
  readonly difficultyOffset: number;
  /** 风格指令（Style Stylist 产出）。 */
  readonly style: StyleDirective;
}

/** 风格指令：只影响措辞与节奏，不影响机制。 */
export interface StyleDirective {
  readonly tone: 'calm' | 'tense' | 'hopeful' | 'desperate';
  readonly pace: 'slow' | 'normal' | 'fast';
  readonly maxChars: number;
}

/** 编排器的最终产出。 */
export interface AgentOutput {
  readonly brief: PlotBrief;
  /** 实际使用的情节来源：模型 / 本地模板。 */
  readonly source: 'model' | 'fallback';
  /** 失败原因码（source=fallback 时给出）。 */
  readonly issue: string | null;
  /** 本回合使用的 provider 与模型（用于评审展示与对账）。 */
  readonly provider: string | null;
  readonly model: string | null;
  /** 阶段耗时（毫秒），供可观测性使用。 */
  readonly timings: readonly { readonly stage: string; readonly ms: number }[];
}

/** 把 AI 的直觉难度钳制到引擎允许的区间。 */
export const CHECK_DIFFICULTY_MIN = 8;
export const CHECK_DIFFICULTY_MAX = 22;

export function clampCheckDifficulty(value: number, offset = 0): number {
  const raw = Number.isFinite(value) ? value + offset : 14 + offset;
  return Math.min(CHECK_DIFFICULTY_MAX, Math.max(CHECK_DIFFICULTY_MIN, Math.round(raw)));
}
