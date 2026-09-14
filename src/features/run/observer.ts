/**
 * 观测者身份（入口登记的「随便逛逛」选择）。
 *
 * ## 为什么需要这个东西
 *
 * 知乎 OAuth 之前只存在于一个独立面板 `/oauth`：用户要主动点进设置页、
 * 再点一个链接，才看得到「可以登录」这件事。结果是**能力在，但体验上不存在** ——
 * 访客从头到尾不知道这个站点可以记住他。
 *
 * 所以入口要有一个登记门：进来先问一次「要不要用知乎账号登记」，
 * 同时明确给出「随便逛逛」这条路。
 *
 * ## 三条纪律
 *
 * 1. **必须能拒绝。** 这一局的核心体验（检索 → 三幕 → 终局）对访客完全可用。
 *    登记换来的是「这个宇宙记得你」：跨设备可见的经历、未知与决策画像。
 *    所以拒绝不是降级，只是不记账。
 * 2. **拒绝一次就不再问。** 每次进站都弹一次是最招人烦的模式。
 *    选择写进 localStorage，之后只有用户主动点「登记」才会再出现。
 * 3. **存储不可用也不能崩。** 隐私模式下 `localStorage` 会抛异常；
 *    此时按「没做过选择」处理 —— 门会出现，但点「随便逛逛」仍然关得掉
 *    （只是下次刷新还会问，这是无法避免的，不该为此阻断界面）。
 *
 * 纯逻辑都在这里（storage 可注入，因此能直接测）；组件是
 * `components/session/ObserverGate.tsx` 与 `ObserverChip.tsx`。
 */

/** localStorage 键：只存「用户选择过以访客身份继续」这一个事实。 */
export const OBSERVER_CHOICE_STORAGE_KEY = 'zhihu-multiverse:observer-guest';

/** 同标签页内的通知事件（登记门关闭后，页头的小徽标要立刻换成访客态）。 */
export const OBSERVER_CHANGE_EVENT = 'zhihu-multiverse:observer-change';

/** 用户对登记门的回答。没做过回答就是 `null`。 */
export type ObserverChoice = 'guest';

/** 读写所需的最小存储接口（`localStorage` 满足它）。 */
export interface ObserverStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 知乎账号资料（`/api/oauth/session` 的 `profile`）。 */
export interface ObserverProfile {
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly headline: string | null;
  readonly url: string | null;
}

/** 登记门与页头徽标共同需要的会话视图。 */
export interface ObserverSession {
  readonly authorized: boolean;
  readonly profile: ObserverProfile | null;
  /** 服务端是否配齐了 OAuth（没配齐时不该给用户一个点不通的登录按钮）。 */
  readonly configured: boolean;
  /** 回调地址仍是本地地址 → 真实登录不可能完成。 */
  readonly localPreviewOnly: boolean;
}

/**
 * 读用户的选择。
 *
 * 读不到、读坏了、存储不可用，一律当「没选择过」——
 * 与 `appearance.ts` 同样的取舍：宁可多问一次，也不要因为
 * 一个读不出来的值把入口逻辑弄成不确定状态。
 */
export function readObserverChoice(storage: ObserverStorage | null | undefined): ObserverChoice | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(OBSERVER_CHOICE_STORAGE_KEY) === 'guest' ? 'guest' : null;
  } catch {
    return null;
  }
}

/** 记住「以访客身份继续」。 */
export function writeObserverChoice(
  storage: ObserverStorage | null | undefined,
  choice: ObserverChoice,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(OBSERVER_CHOICE_STORAGE_KEY, choice);
  } catch {
    /* 存储不可用不阻断界面 */
  }
}

/** 忘记这个选择（用户在页头主动点「登记」时调用，门会重新出现）。 */
export function clearObserverChoice(storage: ObserverStorage | null | undefined): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(OBSERVER_CHOICE_STORAGE_KEY);
  } catch {
    /* 同上 */
  }
}

/** 浏览器环境下的存储句柄；服务端渲染与禁用存储时返回 null。 */
export function browserObserverStorage(): ObserverStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 页头徽标上显示的名字。
 *
 * 知乎的 `/user` 接口没有正式响应 schema，`name` 可能是空的 ——
 * 这时**不留空白**，给一个明确的占位，否则徽标会看起来像一个加载失败的头像。
 */
export function observerDisplayName(profile: ObserverProfile | null): string {
  const name = profile?.name?.trim();
  return name && name.length > 0 ? name : '未署名观测者';
}

/**
 * 登记门要不要出现。
 *
 * 判据集中在这里，而不是散在组件里 —— 因为它有五个条件，
 * 漏掉任何一个都会造成「进门就被拦」或「该问却没问」。
 *
 * - 已登记 → 不问
 * - 已经选过随便逛逛 → 不问
 * - OAuth 没配齐 → 不问（给一个点不通的按钮比不问更糟）
 * - 回调还是本地地址 → 不问（真实登录不可能成功，登录后会停在知乎回调页）
 * - 正在登录路上（`?oauth=` 回调带结果 / `/oauth` 页）→ 不问
 */
export function shouldShowObserverGate(input: {
  readonly session: ObserverSession | null;
  readonly choice: ObserverChoice | null;
  readonly suppressed: boolean;
}): boolean {
  const { session, choice, suppressed } = input;
  if (suppressed) return false;
  if (!session) return false; // 状态还没读到：宁可晚一帧出现，也不要先弹再收
  if (session.authorized) return false;
  if (choice === 'guest') return false;
  if (!session.configured || session.localPreviewOnly) return false;
  return true;
}

/** 页头徽标该显示什么（`null` = 两个分支都不需要渲染）。 */
export function observerChipState(
  session: ObserverSession | null,
  choice: ObserverChoice | null,
): { readonly kind: 'member'; readonly profile: ObserverProfile | null } | { readonly kind: 'guest' } | null {
  if (!session) return null;
  if (session.authorized) {
    return { kind: 'member', profile: session.profile };
  }
  /*
    访客态只在「他其实有得选」时才显示 ——
    OAuth 没配齐时显示「访客 · 登记」会引导到一个不存在的动作。
  */
  if (session.configured && !session.localPreviewOnly) {
    return { kind: 'guest' };
  }
  /*
    已选择随便逛逛的访客：仍然显示访客态。
    这是用户唯一能重新找到「登记」入口的地方，藏起来会让这个选择变成不可逆的。
  */
  if (choice === 'guest') {
    return { kind: 'guest' };
  }
  return null;
}
