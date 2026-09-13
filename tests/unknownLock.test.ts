import { describe, expect, it } from 'vitest';

import { buildInitialActionSpace, findAction } from '@/features/game-mechanics/actionSpace';
import {
  applyUnknownLock,
  releaseUnknownLock,
  unknownLockCandidate,
} from '@/features/game-mechanics/unknownLock';
import { initialSessionMechanics, resolveUnknown } from '@/features/game-mechanics/sessionMechanics';
import { validateEncounterPlan } from '@/features/game-mechanics/validate';
import type { ActionOption } from '@/features/game-mechanics/domain';
import type { UnknownVariable } from '@/features/experience/domain';

/**
 * UNKNOWN LOCK（§11-§12 / §48 / §58 / §80）。
 *
 * > 把「模型不知道」从一个缺陷变成玩法。
 */

const unknown: UnknownVariable = {
  id: 'unknown-hours',
  label: '每周能否稳定投入 8 小时',
  whyItMatters: '它直接决定高强度比赛这条路是否成立。',
  kind: 'time-capacity',
  origin: 'missing-user-context',
  priority: 1,
};

function action(id: string, overrides: Partial<ActionOption> = {}): ActionOption {
  return { id, label: `行动 ${id}`, source: 'user', sourceFactIds: [], requirements: [], ...overrides };
}

describe('unknownLockCandidate', () => {
  it('unknown 存在即生成锁定说明', () => {
    const candidate = unknownLockCandidate({ unknown, affectsActionIds: ['action-比赛'] });
    expect(candidate.unknownId).toBe('unknown-hours');
    expect(candidate.explanation).toContain('每周能否稳定投入 8 小时');
    expect(candidate.explanation).toContain('现实验证');
  });

  it('世界线整体锁定（没有具体行动）也成立', () => {
    const candidate = unknownLockCandidate({ unknown, affectsActionIds: [] });
    expect(candidate.affectsActionIds).toEqual([]);
    expect(candidate.explanation.length).toBeGreaterThan(0);
  });
});

describe('applyUnknownLock / releaseUnknownLock', () => {
  it('锁定后行动不可用，且带 unknownId', () => {
    const space = buildInitialActionSpace([action('action-比赛'), action('action-退课')]);
    const next = applyUnknownLock(space, unknownLockCandidate({ unknown, affectsActionIds: ['action-比赛'] }));
    expect(next.available.map((item) => item.id)).toEqual(['action-退课']);
    expect(next.locked[0]!.reason).toBe('unknown_variable');
    expect(next.locked[0]!.unknownId).toBe('unknown-hours');
  });

  it('现实回填后解除锁定（§58）', () => {
    const space = buildInitialActionSpace([action('action-比赛')]);
    const locked = applyUnknownLock(space, unknownLockCandidate({ unknown, affectsActionIds: ['action-比赛'] }));
    const released = releaseUnknownLock(locked, 'unknown-hours');
    expect(released.available.map((item) => item.id)).toEqual(['action-比赛']);
    expect(released.locked).toHaveLength(0);
    expect(findAction(released, 'action-比赛')).not.toBeNull();
  });
});

describe('SessionMechanics.resolveUnknown', () => {
  it('清空 unknownLocks 并恢复行动', () => {
    const mechanics = initialSessionMechanics([action('action-比赛')]);
    const locked = {
      space: applyUnknownLock(mechanics.space, unknownLockCandidate({ unknown, affectsActionIds: ['action-比赛'] })),
      state: {
        ...mechanics.state,
        lockedActionIds: ['action-比赛'],
        availableActionIds: [],
        unknownLocks: ['unknown-hours'],
      },
    };
    const resolved = resolveUnknown(locked, 'unknown-hours');
    expect(resolved.state.unknownLocks).toEqual([]);
    expect(resolved.state.availableActionIds).toEqual(['action-比赛']);
    expect(resolved.state.lockedActionIds).toEqual([]);
  });
});

describe('validateEncounterPlan：unknown_lock 只能引用真实未知', () => {
  const payload = {
    kind: 'unknown_lock' as const,
    unknownId: 'unknown-hours',
    unknownLabel: '每周能否稳定投入 8 小时',
    affectsActionIds: [],
    explanation: '这条世界线还不能确认。',
  };

  it('真实未知 → 无 issue', () => {
    const issues = validateEncounterPlan(
      { id: 'e1', type: 'unknown_lock', act: 3, sourceFactIds: [], sourceCaseIds: [], payload },
      { facts: [], cases: [], differences: [], unknownIds: ['unknown-hours'] },
    );
    expect(issues).toEqual([]);
  });

  it('模型凭空猜的未知 → 报错', () => {
    const issues = validateEncounterPlan(
      { id: 'e1', type: 'unknown_lock', act: 3, sourceFactIds: [], sourceCaseIds: [], payload },
      { facts: [], cases: [], differences: [], unknownIds: [] },
    );
    expect(issues.join(' ')).toContain('不存在的未知');
  });
});
