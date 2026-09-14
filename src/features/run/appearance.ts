/**
 * 外观偏好（`/settings` 的「体验」区）。
 *
 * ## 为什么这里只有一个开关
 *
 * 设置页的普通部分只该放**真正生效**的东西。动效在这个产品里不是装饰
 * （轨道旋转、轨迹生长、问题重写都是演出），所以「减少动画」是一个
 * 有实际意义的偏好；而「文本速度」目前并不存在 —— 正文用的是句读式
 * 呈现，不是打字机（`SessionStoryStage`）。宁可少一个控件，也不放一个
 * 点了没反应的开关。
 *
 * ## 三态，且系统偏好永远优先
 *
 * ```text
 * system  —— 默认，跟随操作系统（prefers-reduced-motion）
 * on      —— 用户主动要求减少动画（即使系统没要求）
 * off     —— 用户明确表示不需要额外降级（**不能**覆盖系统偏好）
 * ```
 *
 * `off` 不允许反过来强制播动画：无障碍设置是用户的底线，不是我们的默认值。
 *
 * ## 落点
 *
 * - 纯函数在这里（storage / document 都可注入，因此能直接测）；
 * - CSS 侧认 `<html data-reduce-motion="on">`（见 `globals.css` 末尾）；
 * - JS 计时的演出认 `usePrefersReducedMotion()`（`components/visual/ReducedMotion.tsx`）。
 */

/** localStorage 键：只存这一个偏好。 */
export const REDUCE_MOTION_STORAGE_KEY = 'zhihu-multiverse:reduce-motion';

/** `<html>` 上的属性名；只有 `on` 会写它。 */
export const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';

/** 同一标签页内的通知事件（设置页改完立刻生效，不必刷新）。 */
export const REDUCE_MOTION_EVENT = 'zhihu-multiverse:reduce-motion-change';

export type ReduceMotionPreference = 'system' | 'on' | 'off';

/** 读写偏好所需的最小存储接口（`localStorage` 满足它）。 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 设置页渲染选项用的文案（顺序即展示顺序）。 */
export const REDUCE_MOTION_OPTIONS: readonly {
  readonly value: ReduceMotionPreference;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'system', label: '跟随系统', hint: '系统开启「减少动态效果」时自动降级' },
  { value: 'on', label: '减少动画', hint: '关掉轨道旋转与入场演出，内容照常出现' },
  { value: 'off', label: '不需要额外降级', hint: '仍然尊重系统的无障碍设置' },
];

function isPreference(value: unknown): value is ReduceMotionPreference {
  return value === 'system' || value === 'on' || value === 'off';
}

/**
 * 读偏好：读不到、读坏了、存储不可用，一律回 `system`。
 *
 * 这里刻意**不抛异常**：隐私模式或禁用存储时，设置页仍然要能打开。
 */
export function readReduceMotionPreference(storage: PreferenceStorage | null | undefined): ReduceMotionPreference {
  if (!storage) {
    return 'system';
  }
  try {
    const raw = storage.getItem(REDUCE_MOTION_STORAGE_KEY);
    return isPreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** 写偏好：`system` 等于删除键（不留"我改过"的痕迹）。 */
export function writeReduceMotionPreference(
  storage: PreferenceStorage | null | undefined,
  preference: ReduceMotionPreference,
): void {
  if (!storage) {
    return;
  }
  try {
    if (preference === 'system') {
      storage.removeItem(REDUCE_MOTION_STORAGE_KEY);
      return;
    }
    storage.setItem(REDUCE_MOTION_STORAGE_KEY, preference);
  } catch {
    /* 存储不可用不阻断界面 */
  }
}

/** 该偏好要不要在 `<html>` 上写属性：只有主动 `on` 才写。 */
export function reduceMotionAttributeValue(
  preference: ReduceMotionPreference,
): 'on' | null {
  return preference === 'on' ? 'on' : null;
}

/** 把偏好落到 DOM：`on` → 写属性，其余 → 移除属性。 */
export function applyReduceMotionPreference(
  documentElement: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  } | null | undefined,
  preference: ReduceMotionPreference,
): void {
  if (!documentElement) {
    return;
  }
  const value = reduceMotionAttributeValue(preference);
  if (value === null) {
    documentElement.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
    return;
  }
  documentElement.setAttribute(REDUCE_MOTION_ATTRIBUTE, value);
}

/** 浏览器环境下的存储句柄；服务端渲染与禁用存储时返回 null。 */
export function browserPreferenceStorage(): PreferenceStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 该偏好是否要求「减少动画」（不含系统偏好的判断，系统侧由调用方合并）。 */
export function preferenceRequestsReducedMotion(preference: ReduceMotionPreference): boolean {
  return preference === 'on';
}
