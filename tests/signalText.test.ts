import { describe, expect, it } from 'vitest';

import {
  SIGNAL_ORDER,
  allSignalItems,
  signalItem,
  stripItems,
} from '@/core/run/signalText';
import { HIDDEN_KEYS, createInitialWorld } from '@/core/run/worldState';

import type { HiddenSignal } from '@/features/run/contracts';

/**
 * 隐藏状态对玩家的**唯一出口**是定性文案。
 *
 * 两条硬约束：
 * ① 五键 × 四档全部有文案，且**不含任何数字**（否则等于把后台数值泄露出去）；
 * ② 需要提醒的判定只有一处（复用 `worldState.alertingSignals`），UI 不得自行判断。
 */

const LEVELS: readonly HiddenSignal[] = ['calm', 'watch', 'alert', 'critical'];
const DIGITS = /[0-9０-９%％]/;

const BASE = { san: 60, skill: 50, bond: 40 };
const world = (hidden: Partial<Record<(typeof HIDDEN_KEYS)[number], number>>) => ({
  ...createInitialWorld('SEED-SIGNAL', BASE),
  hidden: { ...createInitialWorld('SEED-SIGNAL', BASE).hidden, ...hidden },
});

describe('信号文案', () => {
  it('五键 × 四档都有文案，且都不含数字或百分号', () => {
    for (const key of HIDDEN_KEYS) {
      for (const level of LEVELS) {
        const text = signalItem(key, level).text;
        expect(text.length).toBeGreaterThan(1);
        expect(DIGITS.test(text)).toBe(false);
      }
    }
  });

  it('同一档位在不同键上给不同说法（不是一句通用话术）', () => {
    const texts = HIDDEN_KEYS.map((key) => signalItem(key, 'alert').text);
    expect(new Set(texts).size).toBe(HIDDEN_KEYS.length);
  });

  it('tone 与档位一一对应', () => {
    expect(signalItem('bodyAlarm', 'calm').tone).toBe('calm');
    expect(signalItem('bodyAlarm', 'watch').tone).toBe('watch');
    expect(signalItem('bodyAlarm', 'alert').tone).toBe('warn');
    expect(signalItem('bodyAlarm', 'critical').tone).toBe('danger');
  });
});

describe('stripItems（常驻窄条）', () => {
  it('只保留 alert / critical', () => {
    const items = stripItems(
      world({ bodyAlarm: 80, peerPressure: 10, runway: 65, mentorTrust: 60, socialDebt: 60 }),
    );

    expect(items.map((item) => item.key)).toEqual(['bodyAlarm', 'socialDebt']);
    expect(items.every((item) => item.level === 'alert' || item.level === 'critical')).toBe(true);
  });

  it('没有任何警报时返回空数组（UI 据此不占版面）', () => {
    expect(stripItems(world({ bodyAlarm: 5, peerPressure: 5, runway: 80, mentorTrust: 80, socialDebt: 5 }))).toEqual(
      [],
    );
  });

  it('顺序固定，不随对象键顺序变化', () => {
    const items = stripItems(
      world({ bodyAlarm: 90, peerPressure: 90, runway: 5, mentorTrust: 5, socialDebt: 90 }),
    );

    expect(items.map((item) => item.key)).toEqual(SIGNAL_ORDER);
  });
});

describe('allSignalItems（展开态）', () => {
  it('永远五项、顺序固定、无数字', () => {
    const items = allSignalItems(world({ bodyAlarm: 50 }));

    expect(items.map((item) => item.key)).toEqual(SIGNAL_ORDER);
    for (const item of items) {
      expect(DIGITS.test(item.text)).toBe(false);
    }
  });

  it('「越高越好」的两个键方向正确：时间紧 / 信任低才报警', () => {
    const tight = stripItems(world({ bodyAlarm: 0, peerPressure: 0, runway: 5, mentorTrust: 5, socialDebt: 0 }));

    expect(tight.map((item) => item.key).sort()).toEqual(['mentorTrust', 'runway']);
    const comfortable = stripItems(
      world({ bodyAlarm: 0, peerPressure: 0, runway: 95, mentorTrust: 95, socialDebt: 0 }),
    );
    expect(comfortable).toEqual([]);
  });
});
