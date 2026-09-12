import type { SceneDef, SceneId } from '@/types/narrative';

/**
 * 场景库。
 *
 * 每个场景由「色板 + 视差层」驱动，`SceneStage.tsx` 按 `layers` 顺序绘制：
 * 先远景后近景，各层用不同的位移系数做视差。
 */

export const SCENES: Record<SceneId, SceneDef> = {
  library: {
    id: 'library',
    name: '图书馆',
    timeLabel: '23:40 · 三楼自习区',
    palette: {
      sky: '#070B14',
      far: '#0C1526',
      mid: '#111B2E',
      near: '#1A2740',
      glow: '#0084FF',
      accent: '#7CC0FF',
    },
    layers: ['window', 'shelves', 'desk', 'lights'],
  },

  dorm: {
    id: 'dorm',
    name: '宿舍',
    timeLabel: '01:12 · 熄灯后',
    palette: {
      sky: '#05070D',
      far: '#0A101C',
      mid: '#111B2E',
      near: '#1A2740',
      glow: '#3D9BFF',
      accent: '#A78BFA',
    },
    layers: ['window', 'bed', 'desk', 'screen'],
  },

  classroom: {
    id: 'classroom',
    name: '教学楼',
    timeLabel: '19:20 · 空教室',
    palette: {
      sky: '#070B14',
      far: '#0C1526',
      mid: '#111B2E',
      near: '#1A2740',
      glow: '#F5B841',
      accent: '#7CC0FF',
    },
    layers: ['window', 'board', 'desk', 'lights'],
  },

  'interview-room': {
    id: 'interview-room',
    name: '面试会议室',
    timeLabel: '14:05 · 玻璃隔间',
    palette: {
      sky: '#0B1220',
      far: '#141F33',
      mid: '#1A2740',
      near: '#22314C',
      glow: '#FF4D6D',
      accent: '#F4F7FB',
    },
    layers: ['window', 'board', 'desk', 'lights'],
  },

  home: {
    id: 'home',
    name: '家里',
    timeLabel: '21:30 · 客厅灯下',
    palette: {
      sky: '#070B14',
      far: '#12141C',
      mid: '#1A1F2B',
      near: '#242B3A',
      glow: '#F5B841',
      accent: '#EFD3BE',
    },
    layers: ['window', 'bed', 'desk', 'lights'],
  },

  campus: {
    id: 'campus',
    name: '校园',
    timeLabel: '17:50 · 操场边',
    palette: {
      sky: '#0A1220',
      far: '#122036',
      mid: '#1A2C46',
      near: '#22314C',
      glow: '#3DD6A0',
      accent: '#A9D8FF',
    },
    layers: ['city', 'trees', 'desk'],
  },

  phone: {
    id: 'phone',
    name: '电话里',
    timeLabel: '通话中 · 信号一般',
    palette: {
      sky: '#05070D',
      far: '#0A101C',
      mid: '#111B2E',
      near: '#1A2740',
      glow: '#F5B841',
      accent: '#7CC0FF',
    },
    layers: ['rain', 'city', 'screen'],
  },
};

export const DEFAULT_SCENE_ID: SceneId = 'library';

export function getScene(id: SceneId | undefined): SceneDef {
  return (id ? SCENES[id] : undefined) ?? SCENES[DEFAULT_SCENE_ID];
}
