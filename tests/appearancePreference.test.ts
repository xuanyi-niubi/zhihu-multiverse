import { describe, expect, it } from 'vitest';

import {
  applyReduceMotionPreference,
  preferenceRequestsReducedMotion,
  readReduceMotionPreference,
  reduceMotionAttributeValue,
  REDUCE_MOTION_ATTRIBUTE,
  REDUCE_MOTION_OPTIONS,
  REDUCE_MOTION_STORAGE_KEY,
  writeReduceMotionPreference,
  type PreferenceStorage,
  type ReduceMotionPreference,
} from '@/features/run/appearance';

/**
 * 设置页「体验」区的契约（05_AGENT §5）。
 *
 * 三件必须成立的事：
 *
 * 1. **读坏值不炸**：存储被禁、值被手改，一律回落到 `system`；
 * 2. **`off` 不等于强制播放动画**：只有主动 `on` 才写 `<html>` 属性，
 *    系统的 `prefers-reduced-motion` 永远有效；
 * 3. **文案与选项一一对应**：设置页渲染的就是这三个选项，不多不少。
 */

function storageOf(initial: Record<string, string> = {}): {
  readonly store: PreferenceStorage;
  readonly snapshot: () => Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    store: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    },
    snapshot: () => Object.fromEntries(map),
  };
}

/** 会抛异常的存储：隐私模式里 `setItem` 可能直接失败。 */
const brokenStorage: PreferenceStorage = {
  getItem: () => {
    throw new Error('storage disabled');
  },
  setItem: () => {
    throw new Error('storage disabled');
  },
  removeItem: () => {
    throw new Error('storage disabled');
  },
};

describe('读偏好', () => {
  it('没有存储 / 没有值 → system', () => {
    expect(readReduceMotionPreference(null)).toBe('system');
    expect(readReduceMotionPreference(storageOf().store)).toBe('system');
  });

  it('只认 on / off，其余一律 system（手改 localStorage 不会造出第四种状态）', () => {
    expect(readReduceMotionPreference(storageOf({ [REDUCE_MOTION_STORAGE_KEY]: 'on' }).store)).toBe('on');
    expect(readReduceMotionPreference(storageOf({ [REDUCE_MOTION_STORAGE_KEY]: 'off' }).store)).toBe('off');
    for (const junk of ['true', 'ON', '1', '', '{"x":1}']) {
      expect(readReduceMotionPreference(storageOf({ [REDUCE_MOTION_STORAGE_KEY]: junk }).store)).toBe('system');
    }
  });

  it('存储不可用时不抛异常，回 system', () => {
    expect(readReduceMotionPreference(brokenStorage)).toBe('system');
  });
});

describe('写偏好', () => {
  it('on / off 落盘，system 等于删除键', () => {
    const { store, snapshot } = storageOf();
    writeReduceMotionPreference(store, 'on');
    expect(snapshot()[REDUCE_MOTION_STORAGE_KEY]).toBe('on');

    writeReduceMotionPreference(store, 'off');
    expect(snapshot()[REDUCE_MOTION_STORAGE_KEY]).toBe('off');

    writeReduceMotionPreference(store, 'system');
    expect(REDUCE_MOTION_STORAGE_KEY in snapshot()).toBe(false);
  });

  it('存储不可用时不抛异常', () => {
    expect(() => writeReduceMotionPreference(brokenStorage, 'on')).not.toThrow();
  });
});

describe('落到 <html> 上', () => {
  it('只有主动 on 才写属性；off / system 移除属性（系统偏好仍然优先）', () => {
    expect(reduceMotionAttributeValue('on')).toBe('on');
    expect(reduceMotionAttributeValue('off')).toBeNull();
    expect(reduceMotionAttributeValue('system')).toBeNull();
  });

  it('apply 只碰 data-reduce-motion 这一个属性', () => {
    const calls: string[] = [];
    const element = {
      setAttribute: (name: string, value: string) => void calls.push(`set:${name}=${value}`),
      removeAttribute: (name: string) => void calls.push(`remove:${name}`),
    };

    applyReduceMotionPreference(element, 'on');
    applyReduceMotionPreference(element, 'off');
    applyReduceMotionPreference(element, 'system');
    applyReduceMotionPreference(null, 'on');

    expect(calls).toEqual([
      `set:${REDUCE_MOTION_ATTRIBUTE}=on`,
      `remove:${REDUCE_MOTION_ATTRIBUTE}`,
      `remove:${REDUCE_MOTION_ATTRIBUTE}`,
    ]);
  });

  it('preferenceRequestsReducedMotion 只对 on 为真', () => {
    const expected: Readonly<Record<ReduceMotionPreference, boolean>> = {
      system: false,
      on: true,
      off: false,
    };
    for (const [preference, value] of Object.entries(expected)) {
      expect(preferenceRequestsReducedMotion(preference as ReduceMotionPreference)).toBe(value);
    }
  });
});

describe('设置页的选项', () => {
  it('恰好三个选项，且都带说明（不放点了没反应的开关）', () => {
    expect(REDUCE_MOTION_OPTIONS.map((option) => option.value)).toEqual(['system', 'on', 'off']);
    for (const option of REDUCE_MOTION_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});
