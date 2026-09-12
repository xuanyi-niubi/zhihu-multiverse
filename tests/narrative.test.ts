import { describe, expect, it } from 'vitest';

import { applyBeat, resolveBeats, viewForBeats } from '@/core/narrative';
import { expressionFromSan, getCharacter } from '@/data/characters';

import type { ScenarioTurn } from '@/data/prebuiltScenarios';
import type { NarrativeBeat } from '@/types/narrative';

/**
 * 叙事编排层测试。
 *
 * 覆盖三件事：
 * 1. beat 序列的组装与 SAN 阈值过滤；
 * 2. 舞台状态推导（登场 / 退场 / 同槽位替换 / 表情随 mood 变化）；
 * 3. AI DM 只有 storyText 时的退化路径。
 */

function makeTurn(overrides: Partial<ScenarioTurn> = {}): ScenarioTurn {
  return {
    turnIndex: 2,
    title: '测试幕',
    storyText: '这是一段没有 beats 的兜底旁白。',
    zhihuBullet: {
      author: '匿名用户',
      quote: '一句金句。',
      sourceUrl: 'https://www.zhihu.com',
    },
    choices: [
      {
        id: 'a',
        text: '稳妥选项',
        hint: '无检定',
        ghostEchoStat: '很多人这么选',
        onSuccess: { feedback: '反馈', statDeltas: { skill: 1 } },
      },
      {
        id: 'b',
        text: '高危选项',
        hint: '有检定',
        ghostEchoStat: '少数人这么选',
        check: { targetStat: 'skill', difficulty: 13 },
        onSuccess: { feedback: '反馈', statDeltas: { skill: 2 } },
        onFail: { feedback: '失败', statDeltas: { san: -10 } },
      },
    ],
    ...overrides,
  };
}

const BEATS: NarrativeBeat[] = [
  { id: 'b1', kind: 'scene', background: 'library', mood: 'calm', text: '场景一。' },
  { id: 'b2', kind: 'dialogue', speaker: 'roommate', mood: 'tense', text: '对白一。' },
  {
    id: 'b3',
    kind: 'monologue',
    speaker: 'player',
    sanThreshold: { max: 40 },
    text: '低 SAN 专属独白。',
  },
  { id: 'b4', kind: 'system', mood: 'tense', text: '系统提示。' },
];

describe('resolveBeats', () => {
  it('没有 beats 时退化为单个旁白 beat', () => {
    const beats = resolveBeats(makeTurn(), 100, null);

    expect(beats).toHaveLength(1);
    expect(beats[0].kind).toBe('narration');
    expect(beats[0].text).toBe('这是一段没有 beats 的兜底旁白。');
  });

  it('按 SAN 阈值过滤低心智专属句子', () => {
    const high = resolveBeats(makeTurn({ beats: BEATS }), 90, null);
    const low = resolveBeats(makeTurn({ beats: BEATS }), 20, null);

    expect(high.some((beat) => beat.id === 'b3')).toBe(false);
    expect(low.some((beat) => beat.id === 'b3')).toBe(true);
  });

  it('幕标题卡与伏笔回响插到最前面', () => {
    const beats = resolveBeats(
      makeTurn({
        beats: BEATS,
        act: { act: 2, title: '第二幕 · 测试', subtitle: '副标题' },
        callback: { fromTurn: 1, text: '你上一幕选了「{choice}」。' },
      }),
      90,
      '通宵手撕分布式开源项目',
    );

    expect(beats[0].id).toBe('act-2');
    expect(beats[0].effect).toBe('glitch');
    expect(beats[1].id).toBe('cb-2');
    expect(beats[1].text).toContain('通宵手撕分布式开源项目');
    expect(beats[1].text).not.toContain('{choice}');
  });

  it('没有上一幕选择时伏笔占位符被安全替换', () => {
    const beats = resolveBeats(
      makeTurn({ callback: { fromTurn: 1, text: '你选了「{choice}」。' } }),
      90,
      null,
    );

    expect(beats[0].text).not.toContain('{choice}');
  });
});

describe('applyBeat', () => {
  const base = { sceneId: 'dorm' as const, stage: [], san: 80 };

  it('背景切换与说话人推导', () => {
    const view = applyBeat(BEATS[1], base, 1);

    expect(view.sceneId).toBe('dorm');
    expect(view.speaker).toBe('roommate');
    expect(view.text).toBe('对白一。');
    expect(view.stage.some((member) => member.speaker === 'roommate')).toBe(true);
  });

  it('scene beat 会切换场景', () => {
    const view = applyBeat(BEATS[0], base, 1);
    expect(view.sceneId).toBe('library');
    expect(view.speaker).toBeNull();
  });

  it('同槽位角色被替换，不同槽位共存', () => {
    const withRoommate = applyBeat(BEATS[1], base, 1);
    const withKanshan = applyBeat(
      { id: 'k', kind: 'dialogue', speaker: 'kanshan', text: '看山说话。' },
      { ...base, stage: withRoommate.stage },
      2,
    );

    // 室友在右位、看山在左位 → 两人共存
    expect(withKanshan.stage).toHaveLength(2);

    const replaced = applyBeat(
      { id: 'i', kind: 'dialogue', speaker: 'interviewer', text: '面试官说话。' },
      { ...base, stage: withKanshan.stage },
      3,
    );

    // 面试官也在右位 → 顶掉室友
    expect(replaced.stage.some((member) => member.speaker === 'roommate')).toBe(false);
    expect(replaced.stage.some((member) => member.speaker === 'interviewer')).toBe(true);
  });

  it('dismiss 让角色退场', () => {
    const withRoommate = applyBeat(BEATS[1], base, 1);
    const dismissed = applyBeat(
      { id: 'd', kind: 'narration', dismiss: 'roommate', text: '他走了。' },
      { ...base, stage: withRoommate.stage },
      2,
    );

    expect(dismissed.stage).toHaveLength(0);
  });

  it('表情跟随 mood 与 SAN 变化', () => {
    const tense = applyBeat(BEATS[1], base, 1);
    const panic = applyBeat({ ...BEATS[1], mood: 'panic' }, base, 2);

    expect(tense.stage[0].expression).toBe('tense');
    expect(panic.stage[0].expression).toBe('panic');

    const broken = applyBeat(BEATS[1], { ...base, san: 8 }, 3);
    expect(broken.stage[0].expression).toBe('broken');
  });

  it('effect 映射为演出指令', () => {
    expect(applyBeat({ ...BEATS[0], effect: 'shake' }, base, 1).shake).toBe(true);

    const glitch = applyBeat({ ...BEATS[0], effect: 'glitch' }, base, 7);
    expect(glitch.transition?.kind).toBe('glitch');
    expect(glitch.transition?.key).toBe(7);

    expect(applyBeat({ ...BEATS[0], effect: 'flash-red' }, base, 8).transition?.kind).toBe(
      'flash-red',
    );
  });
});

describe('viewForBeats', () => {
  it('空序列返回空视图且不抛异常', () => {
    const { view, beatIndex } = viewForBeats([], {
      sceneId: 'library',
      stage: [],
      san: 100,
    });

    expect(beatIndex).toBe(0);
    expect(view.text).toBe('');
    expect(view.stage).toHaveLength(0);
  });

  it('取第一个 beat 作为初始视图', () => {
    const { view, beatIndex } = viewForBeats(BEATS, {
      sceneId: 'dorm',
      stage: [],
      san: 80,
    });

    expect(beatIndex).toBe(0);
    expect(view.sceneId).toBe('library');
  });
});

describe('角色库与表情映射', () => {
  it('每个角色都有可辨识的立绘造型与色板', () => {
    const kanshan = getCharacter('kanshan');
    const interviewer = getCharacter('interviewer');

    expect(kanshan.look).toBe('fox');
    expect(interviewer.look).toBe('interviewer');
    expect(kanshan.palette.accent).not.toBe(interviewer.palette.accent);
  });

  it('expressionFromSan 按 SAN 分档', () => {
    expect(expressionFromSan(90, 'calm')).toBe('calm');
    expect(expressionFromSan(50, 'calm')).toBe('tense');
    expect(expressionFromSan(20, 'calm')).toBe('panic');
    expect(expressionFromSan(5, 'calm')).toBe('broken');
  });
});
