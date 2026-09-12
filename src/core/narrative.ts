import { expressionFromSan, getCharacter } from '@/data/characters';

import type { ScenarioTurn } from '@/data/prebuiltScenarios';
import type {
  CharacterOnStage,
  Expression,
  Mood,
  NarrativeBeat,
  SceneId,
  ScreenEffect,
  SpeakerId,
  StageSlot,
} from '@/types/narrative';

/**
 * 叙事编排纯函数。
 *
 * 从 `play/page.tsx` 抽出来有两个原因：
 * 1. Next.js 的页面文件不允许导出任意符号（只允许 metadata / default 等）；
 * 2. 这些逻辑是纯函数，抽出来才能单测。
 */

export const MOOD_EXPRESSION: Record<Mood, Expression> = {
  calm: 'calm',
  tense: 'tense',
  panic: 'panic',
  hope: 'hope',
};

/**
 * 把一回合解析成可播放的 beat 序列。
 *
 * - 优先使用剧本自带的 beats；
 * - 没有 beats（例如 AI DM 只返回一段 storyText）时，退化为单个旁白 beat；
 * - 按 `sanThreshold` 过滤「只有在特定心智状态下才出现」的句子；
 * - 把幕标题卡与伏笔回响插到最前面。
 */
export function resolveBeats(
  turn: ScenarioTurn,
  san: number,
  prevChoiceText: string | null,
): NarrativeBeat[] {
  const source: NarrativeBeat[] =
    turn.beats && turn.beats.length > 0
      ? [...turn.beats]
      : [
          {
            id: `fallback-${turn.turnIndex}`,
            kind: 'narration',
            text: turn.storyText,
          },
        ];

  const filtered = source.filter((beat) => {
    if (!beat.sanThreshold) {
      return true;
    }

    const { min, max } = beat.sanThreshold;
    if (typeof min === 'number' && san < min) {
      return false;
    }
    if (typeof max === 'number' && san > max) {
      return false;
    }
    return true;
  });

  const head: NarrativeBeat[] = [];

  if (turn.act) {
    head.push({
      id: `act-${turn.act.act}`,
      kind: 'system',
      mood: 'calm',
      effect: 'glitch',
      // 幕标题由舞台上的标题卡呈现，对话框只负责副标题，避免同一句话出现两遍
      text: turn.act.subtitle,
    });
  }

  if (turn.callback) {
    head.push({
      id: `cb-${turn.turnIndex}`,
      kind: 'monologue',
      speaker: 'player',
      mood: 'tense',
      text: turn.callback.text.replace('{choice}', prevChoiceText ?? '继续往前走'),
    });
  }

  return [...head, ...filtered];
}

export interface BeatView {
  readonly sceneId: SceneId;
  readonly stage: CharacterOnStage[];
  readonly speaker: SpeakerId | null;
  readonly mood: Mood;
  readonly text: string;
  readonly shake: boolean;
  readonly transition: { readonly kind: 'glitch' | 'flash-white' | 'flash-red'; readonly label: string; readonly key: number } | null;
}

function mapEffect(
  effect: ScreenEffect | undefined,
  text: string,
  key: number,
): BeatView['transition'] {
  if (!effect || effect === 'shake') {
    return null;
  }

  if (effect === 'glitch') {
    return { kind: 'glitch', label: text.slice(0, 12), key };
  }

  return { kind: effect, label: '', key };
}

/** 应用一个 beat，产出新的舞台视图。纯函数。 */
export function applyBeat(
  beat: NarrativeBeat,
  prev: { readonly sceneId: SceneId; readonly stage: CharacterOnStage[]; readonly san: number },
  transitionKey: number,
): BeatView {
  const sceneId = beat.background ?? prev.sceneId;
  const mood = beat.mood ?? 'calm';
  let stage = prev.stage;

  if (beat.dismiss) {
    stage = stage.filter((member) => member.speaker !== beat.dismiss);
  }

  const revealId =
    beat.reveal ??
    (beat.speaker && beat.speaker !== 'narrator' && beat.speaker !== 'player'
      ? beat.speaker
      : undefined);

  if (revealId) {
    const character = getCharacter(revealId);

    if (character.slot !== 'none') {
      const slot = character.slot as StageSlot;
      const expression = expressionFromSan(prev.san, MOOD_EXPRESSION[mood]);
      const existing = stage.find((member) => member.speaker === revealId);

      stage = existing
        ? stage.map((member) =>
            member.speaker === revealId ? { ...member, expression } : member,
          )
        : [
            ...stage.filter((member) => member.slot !== slot),
            { speaker: revealId, slot, expression },
          ];
    }
  }

  const speaker =
    beat.kind === 'dialogue' || beat.kind === 'monologue' ? (beat.speaker ?? null) : null;

  return {
    sceneId,
    stage,
    speaker,
    mood,
    text: beat.text,
    shake: beat.effect === 'shake',
    transition: mapEffect(beat.effect, beat.text, transitionKey),
  };
}

/** 取 beat 序列的第一个视图；序列为空时返回空视图。 */
export function viewForBeats(
  beats: readonly NarrativeBeat[],
  base: { readonly sceneId: SceneId; readonly stage: CharacterOnStage[]; readonly san: number },
): { readonly view: BeatView; readonly beatIndex: number } {
  const first = beats[0];

  if (!first) {
    return {
      view: {
        sceneId: base.sceneId,
        stage: base.stage,
        speaker: null,
        mood: 'calm',
        text: '',
        shake: false,
        transition: null,
      },
      beatIndex: 0,
    };
  }

  return { view: applyBeat(first, base, 1), beatIndex: 0 };
}
