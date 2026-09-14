import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACT_HEADINGS,
  actIndexFromTurn,
  actObjectiveAt,
  displayActNumber,
  loadingPhaseOf,
  sessionPhaseOf,
} from '@/components/game/session/viewModel';

/**
 * 幕号与阶段的契约（Agent 03 §十三 / §二十五 / §二十六）。
 *
 * ## 为什么值得单独一个测试文件
 *
 * 幕号错位是这类项目最隐蔽的 bug：UI 显示 Act 0、第三幕拿到第二幕的
 * blueprint、解锁项晚一幕出现 —— 它们都不会崩，只会让人觉得「哪里不对」。
 * 所以这里把三套口径钉死：
 *
 * ```text
 * blueprint.acts[] / UI actIndex   0 基
 * DM 协议 / reducer turnIndex      1 基
 * 显示给人看的幕号                  永远 1..N
 * ```
 *
 * 并且**禁止**在组件层再写一次 ±1：换算只允许发生在 ViewModel 的两个
 * helper 里（`displayActNumber` / `actIndexFromTurn`）。
 */

const sessionDir = fileURLToPath(new URL('../src/components/game/session/', import.meta.url));

describe('displayActNumber：唯一的 +1 落点（§十三）', () => {
  it('0 基幕下标 → 1 基显示幕号', () => {
    expect(displayActNumber(0)).toBe(1);
    expect(displayActNumber(1)).toBe(2);
    expect(displayActNumber(2)).toBe(3);
  });

  it('永远不产出 Act 0', () => {
    expect(displayActNumber(-1)).toBe(1);
    expect(displayActNumber(-99)).toBe(1);
  });

  it('小数与非法值被钳到整数幕', () => {
    expect(displayActNumber(1.9)).toBe(2);
    expect(displayActNumber(Number.NaN)).toBe(1);
  });
});

describe('actIndexFromTurn：唯一的 -1 落点（§十三）', () => {
  it('reducer 的 1 基 turnIndex → UI 的 0 基 actIndex', () => {
    expect(actIndexFromTurn(1)).toBe(0);
    expect(actIndexFromTurn(2)).toBe(1);
    expect(actIndexFromTurn(3)).toBe(2);
  });

  it('turnIndex <= 0 时钳到第一幕，不出现负数幕', () => {
    expect(actIndexFromTurn(0)).toBe(0);
    expect(actIndexFromTurn(-3)).toBe(0);
  });

  it('两套口径往返一致（1..3 幕）', () => {
    for (const turnIndex of [1, 2, 3]) {
      expect(displayActNumber(actIndexFromTurn(turnIndex))).toBe(turnIndex);
    }
  });

  it('三轮里显示幕号只可能是 1 / 2 / 3（没有 Act 0、没有 Act 4）', () => {
    const shown = [1, 2, 3].map((turnIndex) => displayActNumber(actIndexFromTurn(turnIndex)));
    expect(shown).toEqual([1, 2, 3]);
    expect(shown).not.toContain(0);
    expect(shown).not.toContain(4);
  });
});

describe('actObjectiveAt：越界钳到最后一幕（与 DM 同口径）', () => {
  const acts = [
    { objective: 'enter-world' as const },
    { objective: 'experience-cost' as const },
    { objective: 'meet-counterexample' as const },
  ];

  it('按下标取本幕目标', () => {
    expect(actObjectiveAt({ acts }, 0)).toBe('enter-world');
    expect(actObjectiveAt({ acts }, 2)).toBe('meet-counterexample');
  });

  it('超出三幕时按反例幕处理，而不是崩掉或回第一幕', () => {
    expect(actObjectiveAt({ acts }, 7)).toBe('meet-counterexample');
  });

  it('负数或空蓝图不产出 Act 0 的语义', () => {
    expect(actObjectiveAt({ acts }, -2)).toBe('enter-world');
    expect(actObjectiveAt({ acts: [] }, 0)).toBe('meet-counterexample');
  });
});

describe('三幕固定文案（§十二）', () => {
  it('ACT I 走进去 / ACT II 代价出现 / ACT III 另一个答案', () => {
    expect(ACT_HEADINGS['enter-world']).toMatchObject({ roman: 'ACT I', label: '走进去' });
    expect(ACT_HEADINGS['experience-cost']).toMatchObject({ roman: 'ACT II', label: '代价出现' });
    expect(ACT_HEADINGS['meet-counterexample']).toMatchObject({ roman: 'ACT III', label: '另一个答案' });
  });
});

describe('阶段折叠（§六 / §二十五 / §二十六）', () => {
  it('reducer 的内部阶段折叠成屏幕的四种', () => {
    expect(sessionPhaseOf('story')).toBe('story');
    expect(sessionPhaseOf('choices')).toBe('choice');
    expect(sessionPhaseOf('outcome')).toBe('reflection');
    expect(sessionPhaseOf('ended')).toBe('ended');
    // critical 只是状态机里的一个瞬间：页面会立刻收束到终局，不该造一个死界面
    expect(sessionPhaseOf('critical')).toBe('reflection');
  });

  it('loading 有优先级：会话 → 场景 → 检定 → 经验', () => {
    expect(
      loadingPhaseOf({
        waitingForSession: true,
        generatingScene: true,
        resolvingChoice: true,
        loadingExperience: true,
      }),
    ).toBe('loading-session');
    expect(
      loadingPhaseOf({
        waitingForSession: false,
        generatingScene: true,
        resolvingChoice: true,
        loadingExperience: true,
      }),
    ).toBe('generating-scene');
    expect(
      loadingPhaseOf({
        waitingForSession: false,
        generatingScene: false,
        resolvingChoice: true,
        loadingExperience: true,
      }),
    ).toBe('resolving-choice');
    expect(
      loadingPhaseOf({
        waitingForSession: false,
        generatingScene: false,
        resolvingChoice: false,
        loadingExperience: true,
      }),
    ).toBe('loading-experience');
  });

  it('什么都没在等时是 null（不假装在加载）', () => {
    expect(
      loadingPhaseOf({
        waitingForSession: false,
        generatingScene: false,
        resolvingChoice: false,
        loadingExperience: false,
      }),
    ).toBeNull();
  });
});

describe('组件层禁止自己做幕号换算（§十三）', () => {
  it('session/*.tsx 里不出现 act.index / actIndex / turnIndex 的 ±1', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(sessionDir).filter((file) => file.endsWith('.tsx'))) {
      const text = readFileSync(join(sessionDir, name), 'utf8');
      if (/(act\.index|actIndex|turnIndex)\s*[-+]\s*1/.test(text)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ViewModel 是纯逻辑层：不 import React', () => {
    const viewModel = readFileSync(join(sessionDir, 'viewModel.ts'), 'utf8');
    expect(viewModel).not.toMatch(/from ['"]react['"]/);
    expect(viewModel).not.toMatch(/useState|useEffect|useMemo/);
  });
});
