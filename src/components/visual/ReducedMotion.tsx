'use client';

import * as React from 'react';

import {
  browserPreferenceStorage,
  preferenceRequestsReducedMotion,
  readReduceMotionPreference,
  REDUCE_MOTION_EVENT,
} from '@/features/run/appearance';

/**
 * Reduced Motion（04_AGENT §35）。
 *
 * 观象厅的运动量不小（轨道旋转、轨迹生长、问题重写），所以「降级」不能只靠
 * CSS 的 `@media (prefers-reduced-motion: reduce)`：有些演出是**由 JS 计时的**
 * （例如先让普通 Gate 变暗 150ms，再让新行动出现），如果只在 CSS 里掐掉动画，
 * 组件仍然会等那 900ms。因此这里提供同一个系统偏好的 JS 版本。
 *
 * ```text
 * rotation off            → 交给 CSS（.obs-dial__spin ... animation: none）
 * orbit movement off      → 交给 CSS
 * reveal → fade           → 组件读 usePrefersReducedMotion()（本文件）
 * question morph → crossfade → 同上
 * ```
 *
 * 视觉组件一律不得 fetch API（§7）：这里没有任何网络访问。
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * 是否要降低动效：**系统偏好 或 用户在设置页主动开启**。
 *
 * 两个来源必须合并，因为它们的落点不同：
 *
 * - CSS 的 `@media` 认系统偏好，`<html data-reduce-motion="on">` 认用户偏好；
 * - JS 计时的演出（如 Hidden Path Reveal 的 900ms 分拍）两边都不认，
 *   只能在这里读一次。
 *
 * `off` 不会反过来强制播放动画 —— 系统偏好仍然优先。
 *
 * SSR 首帧返回 false，挂载后再对齐真实偏好。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const userWantsReduced = () =>
      preferenceRequestsReducedMotion(readReduceMotionPreference(browserPreferenceStorage()));

    const query = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
    const sync = () => setReduced(userWantsReduced() || (query?.matches ?? false));

    sync();
    query?.addEventListener('change', sync);
    // 设置页改完偏好即刻生效：同一个标签页内不必刷新
    window.addEventListener(REDUCE_MOTION_EVENT, sync);

    return () => {
      query?.removeEventListener('change', sync);
      window.removeEventListener(REDUCE_MOTION_EVENT, sync);
    };
  }, []);

  return reduced;
}

export interface ReducedMotionProps {
  /** 允许动效时渲染的内容。 */
  readonly children: React.ReactNode;
  /** 要求降级时渲染的内容；缺省是不渲染（由 CSS 负责静态形态）。 */
  readonly fallback?: React.ReactNode;
}

/**
 * 声明式包装：只在允许动效时挂载「有演出」的那一支。
 *
 * 用在「这个分支纯粹是动画、没有信息」的位置；如果动画本身承载信息
 * （例如新行动出现），请用 `usePrefersReducedMotion()` 改走 fade，而不是不渲染。
 */
export function ReducedMotion({ children, fallback = null }: ReducedMotionProps) {
  const reduced = usePrefersReducedMotion();
  return <>{reduced ? fallback : children}</>;
}

export default ReducedMotion;
