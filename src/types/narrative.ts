import type { TargetStat } from '@/types/game';

/**
 * 叙事层类型。
 *
 * 职责边界：
 * - `types/game.ts` 管数值契约（属性、遗物、D20）。
 * - 本文件管「怎么把一局推演演成一出戏」：谁在场、谁在说话、画面是什么。
 *
 * 设计约束：`NarrativeBeat` 必须能无损退化——AI DM 只返回一段 storyText 时，
 * 上层会合成一个 `kind: 'narration'` 的 beat，因此叙事层不假设 beats 一定存在。
 */

/* -------------------------------------------------------------------------- */
/* 角色                                                                        */
/* -------------------------------------------------------------------------- */

export type SpeakerId =
  | 'narrator'
  | 'kanshan'
  | 'player'
  | 'roommate'
  | 'interviewer'
  | 'parent'
  | 'mentor'
  | 'ghost';

/** 立绘造型变体；`narrator` / `player` 不占立绘位。 */
export type PortraitLook = 'fox' | 'student' | 'interviewer' | 'parent' | 'ghost';

/** 表情变体，控制眉 / 眼 / 嘴 / 腮红 / 汗滴。 */
export type Expression = 'calm' | 'tense' | 'panic' | 'hope' | 'cold' | 'soft' | 'broken';

export type StageSlot = 'left' | 'center' | 'right';

export interface CharacterPalette {
  readonly hair: string;
  readonly skin: string;
  readonly cloth: string;
  readonly accent: string;
}

export interface Character {
  readonly id: SpeakerId;
  readonly name: string;
  /** 身份说明，显示在名牌右侧，如「推演随身导师」。 */
  readonly role: string;
  readonly look: PortraitLook;
  readonly palette: CharacterPalette;
  readonly defaultExpression: Expression;
  /** 默认站位；`none` 表示不占立绘位（旁白 / 玩家内心）。 */
  readonly slot: StageSlot | 'none';
}

/** 当前舞台上正在显示的角色。 */
export interface CharacterOnStage {
  readonly speaker: SpeakerId;
  readonly slot: StageSlot;
  readonly expression: Expression;
}

/* -------------------------------------------------------------------------- */
/* 场景                                                                        */
/* -------------------------------------------------------------------------- */

export type SceneId =
  | 'library'
  | 'dorm'
  | 'classroom'
  | 'interview-room'
  | 'home'
  | 'campus'
  | 'phone';

export type SceneLayerKind =
  | 'window'
  | 'shelves'
  | 'desk'
  | 'lights'
  | 'city'
  | 'board'
  | 'bed'
  | 'trees'
  | 'screen'
  | 'rain';

export interface ScenePalette {
  readonly sky: string;
  readonly far: string;
  readonly mid: string;
  readonly near: string;
  readonly glow: string;
  readonly accent: string;
}

export interface SceneDef {
  readonly id: SceneId;
  readonly name: string;
  /** 场景副标题，如「23:40 · 三楼自习区」。 */
  readonly timeLabel: string;
  readonly palette: ScenePalette;
  /** 视差层，从远到近排列。 */
  readonly layers: readonly SceneLayerKind[];
}

/* -------------------------------------------------------------------------- */
/* 叙事节拍                                                                    */
/* -------------------------------------------------------------------------- */

export type BeatKind = 'scene' | 'narration' | 'dialogue' | 'monologue' | 'system';

export type Mood = 'calm' | 'tense' | 'panic' | 'hope';

/** 全屏演出。 */
export type ScreenEffect = 'shake' | 'flash-red' | 'flash-white' | 'glitch';

export interface NarrativeBeat {
  readonly id: string;
  readonly kind: BeatKind;
  readonly text: string;
  /** 说话人；`kind: 'narration'` 时可省略（默认旁白）。 */
  readonly speaker?: SpeakerId;
  readonly mood?: Mood;
  /**
   * SAN 阈值。仅当当前 SAN 落在区间内才播放。
   * 用于「同一个世界，在崩溃的人和清醒的人眼里不一样」。
   */
  readonly sanThreshold?: { readonly min?: number; readonly max?: number };
  /** 进入该 beat 时切换场景。 */
  readonly background?: SceneId;
  /** 进入该 beat 时让角色登场（或更新其表情）。 */
  readonly reveal?: SpeakerId;
  /** 进入该 beat 时让角色退场。 */
  readonly dismiss?: SpeakerId;
  /** 进入该 beat 时触发的全屏演出。 */
  readonly effect?: ScreenEffect;
}

/** 幕标题卡：每幕开场显示。 */
export interface ActCard {
  readonly act: number;
  readonly title: string;
  readonly subtitle: string;
}

/** 前一幕选择的回响，用于制造「因果感」。 */
export interface CallbackLine {
  readonly fromTurn: number;
  readonly text: string;
}

/** 供 HUD / 抽屉展示的运行时快照（不属于持久化契约）。 */
export interface NarrativeRuntime {
  readonly sceneId: SceneId;
  readonly beats: readonly NarrativeBeat[];
  readonly stage: readonly CharacterOnStage[];
  readonly speaker: SpeakerId | null;
  readonly mood: Mood;
  readonly actCard: ActCard | null;
}

/** 属性变化的展示描述，用于受击飘字。 */
export interface StatDeltaView {
  readonly stat: TargetStat;
  readonly value: number;
}
