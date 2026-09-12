import type { Character, Expression, SpeakerId } from '@/types/narrative';

/**
 * 角色库。
 *
 * 每个角色的 `palette` 直接喂给 `Portrait.tsx` 做参数化着色，
 * `look` 决定立绘造型分支，`slot` 决定默认站位。
 * 所有立绘为 SVG 自绘，不引用任何外部素材，规避版权风险。
 */

export const CHARACTERS: Record<SpeakerId, Character> = {
  narrator: {
    id: 'narrator',
    name: '旁白',
    role: '命运的叙述者',
    look: 'ghost',
    palette: { hair: '#7CC0FF', skin: '#7CC0FF', cloth: '#0B1220', accent: '#0084FF' },
    defaultExpression: 'calm',
    slot: 'none',
  },

  player: {
    id: 'player',
    name: '你',
    role: '平行宇宙的旅人',
    look: 'student',
    palette: { hair: '#2E3D57', skin: '#F0D8C4', cloth: '#1A2740', accent: '#0084FF' },
    defaultExpression: 'calm',
    slot: 'none',
  },

  kanshan: {
    id: 'kanshan',
    name: '刘看山',
    role: '推演随身导师',
    look: 'fox',
    palette: { hair: '#EAF3FF', skin: '#F6FAFF', cloth: '#DCE9FB', accent: '#0084FF' },
    defaultExpression: 'calm',
    slot: 'left',
  },

  roommate: {
    id: 'roommate',
    name: '室友',
    role: '已经拿到 offer 的人',
    look: 'student',
    palette: { hair: '#2E3D57', skin: '#F0D8C4', cloth: '#3A4A63', accent: '#7CC0FF' },
    defaultExpression: 'calm',
    slot: 'right',
  },

  interviewer: {
    id: 'interviewer',
    name: '三面官',
    role: '大厂技术终面',
    look: 'interviewer',
    palette: { hair: '#1B2536', skin: '#E8CDB6', cloth: '#F4F7FB', accent: '#FF4D6D' },
    defaultExpression: 'cold',
    slot: 'right',
  },

  parent: {
    id: 'parent',
    name: '妈妈',
    role: '电话那头的人',
    look: 'parent',
    palette: { hair: '#5A4A44', skin: '#EFD3BE', cloth: '#8A7A72', accent: '#F5B841' },
    defaultExpression: 'soft',
    slot: 'right',
  },

  mentor: {
    id: 'mentor',
    name: '导师',
    role: '实验室的负责人',
    look: 'interviewer',
    palette: { hair: '#3A3A3A', skin: '#E4C9B0', cloth: '#2A3448', accent: '#3DD6A0' },
    defaultExpression: 'cold',
    slot: 'right',
  },

  ghost: {
    id: 'ghost',
    name: '知乎答主',
    role: '来自站内的虚影',
    look: 'ghost',
    palette: { hair: '#7CC0FF', skin: '#A9D8FF', cloth: '#0084FF', accent: '#CFE8FF' },
    defaultExpression: 'calm',
    slot: 'right',
  },
};

export function getCharacter(id: SpeakerId): Character {
  return CHARACTERS[id];
}

/** SAN 越低，默认表情越接近崩溃；用于没有显式指定表情的立绘。 */
export function expressionFromSan(san: number, fallback: Expression = 'calm'): Expression {
  if (san <= 15) {
    return 'broken';
  }
  if (san < 35) {
    return 'panic';
  }
  if (san < 60) {
    return 'tense';
  }
  return fallback;
}
