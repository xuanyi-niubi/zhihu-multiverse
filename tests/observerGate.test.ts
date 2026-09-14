import { describe, expect, it } from 'vitest';

import {
  OBSERVER_CHOICE_STORAGE_KEY,
  browserObserverStorage,
  clearObserverChoice,
  observerChipState,
  observerDisplayName,
  readObserverChoice,
  shouldShowObserverGate,
  writeObserverChoice,
  type ObserverSession,
  type ObserverStorage,
} from '@/features/run/observer';

/**
 * 观测者登记门（入口 OAuth 引导）的判据契约。
 *
 * ## 为什么这些判据值得单独测
 *
 * 进门弹窗是所有交互里**最容易惹人烦**的一种，而它的正确性完全取决于
 * 五个条件的组合。任何一条写错都会造成两种坏结果之一：
 *
 * - 该问没问 → OAuth 又变成「藏在设置页里的能力」，回到这次要修的问题；
 * - 不该问却问 → 已登记的人每次刷新被拦一次，或访客被反复追问。
 *
 * 这两种都不会抛异常、不会让测试变红，只会让人觉得烦 ——
 * 所以必须用测试把判据钉住。
 */

/** 内存版存储，模拟 localStorage。 */
function memoryStorage(initial: Record<string, string> = {}): ObserverStorage & {
  readonly dump: () => Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

/** 会抛异常的存储：模拟隐私模式 / 禁用存储。 */
const hostileStorage: ObserverStorage = {
  getItem() {
    throw new Error('storage disabled');
  },
  setItem() {
    throw new Error('storage disabled');
  },
  removeItem() {
    throw new Error('storage disabled');
  },
};

const member: ObserverSession = {
  authorized: true,
  profile: { name: '张三', avatarUrl: 'https://pic.example/a.jpg', headline: '在转型', url: null },
  configured: true,
  localPreviewOnly: false,
};

const anonymousButConfigured: ObserverSession = {
  authorized: false,
  profile: null,
  configured: true,
  localPreviewOnly: false,
};

describe('观测者选择：读写', () => {
  it('没存过 → null', () => {
    expect(readObserverChoice(memoryStorage())).toBeNull();
  });

  it('存过 guest → 读回 guest', () => {
    const storage = memoryStorage();
    writeObserverChoice(storage, 'guest');
    expect(readObserverChoice(storage)).toBe('guest');
    expect(storage.dump()[OBSERVER_CHOICE_STORAGE_KEY]).toBe('guest');
  });

  it('存了别的值（人为改坏 / 旧版本残留）→ 当作没选择过', () => {
    // 不能把任何非空字符串都当成「选过随便逛逛」：那样一个脏值
    // 会让登记门永远不再出现，且用户无从发现。
    expect(readObserverChoice(memoryStorage({ [OBSERVER_CHOICE_STORAGE_KEY]: 'yes' }))).toBeNull();
    expect(readObserverChoice(memoryStorage({ [OBSERVER_CHOICE_STORAGE_KEY]: '' }))).toBeNull();
  });

  it('清除后回到「没选择过」', () => {
    const storage = memoryStorage();
    writeObserverChoice(storage, 'guest');
    clearObserverChoice(storage);
    expect(readObserverChoice(storage)).toBeNull();
  });

  it('存储不可用时不抛异常（隐私模式仍要能进站）', () => {
    expect(() => writeObserverChoice(hostileStorage, 'guest')).not.toThrow();
    expect(() => clearObserverChoice(hostileStorage)).not.toThrow();
    expect(readObserverChoice(hostileStorage)).toBeNull();
    expect(readObserverChoice(null)).toBeNull();
    expect(readObserverChoice(undefined)).toBeNull();
  });

  it('服务端没有 window → 返回 null 而不是崩', () => {
    // vitest 的 environment 是 node，本来就没有 window
    expect(browserObserverStorage()).toBeNull();
  });
});

describe('登记门：什么时候出现', () => {
  const base = { choice: null, suppressed: false } as const;

  it('未登记 + OAuth 已配齐 → 出现', () => {
    expect(shouldShowObserverGate({ ...base, session: anonymousButConfigured })).toBe(true);
  });

  it('已登记 → 不出现（不能每次刷新都拦一次）', () => {
    expect(shouldShowObserverGate({ ...base, session: member })).toBe(false);
  });

  it('已经选过「随便逛逛」→ 不出现（问一次就够）', () => {
    expect(
      shouldShowObserverGate({ ...base, choice: 'guest', session: anonymousButConfigured }),
    ).toBe(false);
  });

  it('OAuth 没配齐 → 不出现（给一个点不通的按钮比不问更糟）', () => {
    expect(
      shouldShowObserverGate({
        ...base,
        session: { ...anonymousButConfigured, configured: false },
      }),
    ).toBe(false);
  });

  it('回调还是本地地址 → 不出现（真实登录不可能成功）', () => {
    expect(
      shouldShowObserverGate({
        ...base,
        session: { ...anonymousButConfigured, localPreviewOnly: true },
      }),
    ).toBe(false);
  });

  it('正在 OAuth 回调页 → 不出现（在登录流程上再叠一层门会让人以为没登上）', () => {
    expect(
      shouldShowObserverGate({ ...base, session: anonymousButConfigured, suppressed: true }),
    ).toBe(false);
  });

  it('会话状态还没读到 → 先不出现（避免已登录用户刷新时闪一下门）', () => {
    expect(shouldShowObserverGate({ ...base, session: null })).toBe(false);
  });
});

describe('页头徽标', () => {
  it('已登记 → 显示头像与昵称', () => {
    const state = observerChipState(member, null);
    expect(state?.kind).toBe('member');
  });

  it('访客且 OAuth 可用 → 显示访客态（这是唯一的回头路）', () => {
    expect(observerChipState(anonymousButConfigured, null)?.kind).toBe('guest');
    expect(observerChipState(anonymousButConfigured, 'guest')?.kind).toBe('guest');
  });

  it('OAuth 不可用且没选过 → 什么都不显示', () => {
    expect(observerChipState({ ...anonymousButConfigured, configured: false }, null)).toBeNull();
    expect(observerChipState({ ...anonymousButConfigured, localPreviewOnly: true }, null)).toBeNull();
  });

  it('会话未读到 → 什么都不显示', () => {
    expect(observerChipState(null, null)).toBeNull();
  });

  it('昵称缺失时不留空（否则徽标像加载失败）', () => {
    expect(observerDisplayName(null)).toBe('未署名观测者');
    expect(observerDisplayName({ ...member.profile!, name: null })).toBe('未署名观测者');
    expect(observerDisplayName({ ...member.profile!, name: '   ' })).toBe('未署名观测者');
    expect(observerDisplayName(member.profile)).toBe('张三');
  });
});
