import { describe, expect, it } from 'vitest';

import {
  actionFromExperienceUnlock,
  actionFromFact,
  actionsFromExperienceUnlocks,
  isActionFact,
} from '@/features/game-mechanics/pathReveal';
import { buildActionSpace, unlockAction } from '@/features/game-mechanics/actionSpace';
import type { ExperienceUnlockInput } from '@/features/game-mechanics/domain';
import type { ExperienceFact, ExperienceFactType } from '@/features/experience/domain';

/**
 * PATH REVEAL（§七 / §二十五）。
 *
 * 唯一准入是 `ExperienceFact.type === 'action'`：
 *
 * ```text
 * action fact    → 能 reveal
 * cost fact      → 不能 reveal
 * reflection     → 不能 reveal
 * ```
 */

let seq = 0;
function fact(type: ExperienceFactType, overrides: Partial<ExperienceFact> = {}): ExperienceFact {
  seq += 1;
  return {
    id: `fact-${seq}`,
    sourceId: 'src-1',
    sourceUrl: 'https://www.zhihu.com/q/1',
    author: '某人',
    exactQuote: '我先做了一个 48 小时的最小 Demo 再决定。',
    type,
    relevance: 0.5,
    purposes: [],
    ...overrides,
  };
}

function unlock(sourceFactIds: readonly string[], overrides: Partial<ExperienceUnlockInput> = {}): ExperienceUnlockInput {
  return {
    id: 'unlock-1',
    label: '先做最小 Demo',
    sourceFactIds,
    choice: { text: '按「先做最小 Demo」的路子先试一小步', hint: '来自一条真实经验。' },
    availableFromAct: 2,
    ...overrides,
  };
}

describe('isActionFact / actionFromFact', () => {
  it('只有 action 事实能变成行动', () => {
    expect(isActionFact(fact('action'))).toBe(true);
    expect(isActionFact(fact('cost'))).toBe(false);
    expect(isActionFact(fact('reflection'))).toBe(false);
  });

  it('行动事实 → 带 sourceFactIds 的行动', () => {
    const source = fact('action', { id: 'act-1', exactQuote: '先把课程表排出来，再决定要不要报名。' });
    const action = actionFromFact(source);
    expect(action).not.toBeNull();
    expect(action!.id).toBe('action-act-1');
    expect(action!.state).toBe('unlocked');
    expect(action!.origin).toBe('experience');
    expect(action!.sourceFactIds).toEqual(['act-1']);
  });

  it('非行动事实 → null', () => {
    expect(actionFromFact(fact('cost'))).toBeNull();
    expect(actionFromFact(fact('outcome'))).toBeNull();
  });
});

describe('actionFromExperienceUnlock', () => {
  it('action fact → 能 reveal', () => {
    const source = fact('action', { id: 'act-1' });
    const action = actionFromExperienceUnlock(unlock(['act-1']), [source]);
    expect(action).not.toBeNull();
    expect(action!.label).toBe('先做最小 Demo');
    expect(action!.state).toBe('unlocked');
    expect(action!.origin).toBe('experience');
    expect(action!.sourceFactIds).toEqual(['act-1']);
  });

  it('cost fact → 不能 reveal', () => {
    const source = fact('cost', { id: 'cost-1' });
    expect(actionFromExperienceUnlock(unlock(['cost-1']), [source])).toBeNull();
  });

  it('reflection → 不能 reveal', () => {
    const source = fact('reflection', { id: 'ref-1' });
    expect(actionFromExperienceUnlock(unlock(['ref-1']), [source])).toBeNull();
  });

  it('condition / outcome 也不能 reveal', () => {
    const condition = fact('condition', { id: 'cond-1' });
    const outcome = fact('outcome', { id: 'out-1' });
    expect(actionFromExperienceUnlock(unlock(['cond-1']), [condition])).toBeNull();
    expect(actionFromExperienceUnlock(unlock(['out-1']), [outcome])).toBeNull();
  });

  it('sourceFactIds 为空 → null', () => {
    expect(actionFromExperienceUnlock(unlock([]), [fact('action')])).toBeNull();
  });

  it('引用了不存在的事实 → null（不可追溯）', () => {
    expect(actionFromExperienceUnlock(unlock(['ghost']), [fact('action')])).toBeNull();
  });

  it('多个来源里只要有一个 action 就成立，且取相关性最高的那个做描述', () => {
    const low = fact('action', { id: 'act-low', relevance: 0.2, exactQuote: '低相关的行动' });
    const high = fact('action', { id: 'act-high', relevance: 0.9, exactQuote: '高相关的行动' });
    const action = actionFromExperienceUnlock(unlock(['act-low', 'act-high']), [low, high]);
    expect(action!.description).toBe('高相关的行动');
    expect(action!.sourceFactIds).toEqual(['act-low', 'act-high']);
  });
});

describe('actionsFromExperienceUnlocks', () => {
  it('同一条解锁只 reveal 一次（去重）', () => {
    const source = fact('action', { id: 'act-1' });
    const actions = actionsFromExperienceUnlocks(
      [unlock(['act-1']), unlock(['act-1'], { id: 'unlock-2' })],
      [source],
    );
    expect(actions).toHaveLength(1);
  });

  it('没有任何合法解锁时诚实为空', () => {
    expect(actionsFromExperienceUnlocks([unlock([])], [fact('cost')])).toEqual([]);
    expect(actionsFromExperienceUnlocks([], [])).toEqual([]);
  });
});

describe('reveal 之后的行动空间', () => {
  it('reveal 出来的行动真的进入可选项', () => {
    const source = fact('action', { id: 'act-1' });
    const action = actionFromExperienceUnlock(unlock(['act-1']), [source])!;
    const space = unlockAction(buildActionSpace([]), action);
    expect(space.actions.map((item) => item.id)).toEqual([action.id]);
    expect(space.actions[0]!.state).toBe('unlocked');
  });
});
