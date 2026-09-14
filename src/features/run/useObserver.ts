'use client';

import * as React from 'react';

import {
  browserObserverStorage,
  clearObserverChoice,
  OBSERVER_CHANGE_EVENT,
  readObserverChoice,
  writeObserverChoice,
  type ObserverChoice,
  type ObserverSession,
} from '@/features/run/observer';

/**
 * 观测者身份状态（登录门与页头徽标共用）。
 *
 * ## 为什么做成 hook 而不是各组件自己 fetch
 *
 * 登录门和页头徽标需要**同一份**会话状态。各拉一次的话：
 *   · 一次进站打两次 `/api/oauth/session`；
 *   · 更糟的是两处结果可能不一致（一处已授权、一处还没有），
 *     用户会看到「门关了但徽标还写着访客」这种自相矛盾的画面。
 *
 * 这里用一个模块级缓存 + 事件订阅，让同一次进站只请求一次。
 *
 * ## 为什么首帧是 `null` 而不是「未登录」
 *
 * `/api/oauth/session` 是动态接口。若首帧就假定「未登录」，
 * 已登录用户每次刷新都会先闪一下登录门。所以 `session` 在读到之前保持
 * `null`，由 `shouldShowObserverGate` 决定「状态未知 = 先不显示」。
 */

interface ObserverState {
  session: ObserverSession | null;
  choice: ObserverChoice | null;
}

/** 模块级缓存：同一次进站内只请求一次。 */
let cached: ObserverState | null = null;
let inflight: Promise<ObserverSession | null> | null = null;

/** 仅供测试使用：清掉模块级缓存。 */
export function resetObserverCache(): void {
  cached = null;
  inflight = null;
}

async function fetchSession(): Promise<ObserverSession | null> {
  try {
    const response = await fetch('/api/oauth/session', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as Partial<ObserverSession>;
    return {
      authorized: payload.authorized === true,
      profile: payload.profile ?? null,
      configured: payload.configured === true,
      localPreviewOnly: payload.localPreviewOnly === true,
    };
  } catch {
    // 网络失败不该把入口卡死：当作「状态未知」，门不显示
    return null;
  }
}

export function useObserver(): {
  readonly session: ObserverSession | null;
  readonly choice: ObserverChoice | null;
  /** 状态是否已经读过一次（用来区分「还在读」与「读完了是访客」）。 */
  readonly ready: boolean;
  readonly continueAsGuest: () => void;
  readonly requestLogin: () => void;
} {
  const [state, setState] = React.useState<ObserverState>(
    () => cached ?? { session: null, choice: null },
  );
  const [ready, setReady] = React.useState(Boolean(cached));

  React.useEffect(() => {
    let alive = true;

    const publish = (next: ObserverState) => {
      cached = next;
      if (alive) {
        setState(next);
        setReady(true);
      }
    };

    // 挂在首帧的同步读：本地选择不需要等网络
    const choice = readObserverChoice(browserObserverStorage());

    if (cached && cached.session) {
      publish({ ...cached, choice });
    } else {
      if (!inflight) {
        inflight = fetchSession();
      }
      void inflight.then((session) => {
        inflight = null;
        publish({ session, choice: readObserverChoice(browserObserverStorage()) });
      });
    }

    // 其他组件在本标签页内改了选择 → 同步
    const onChange = () => {
      if (alive) {
        setState((prev) => ({ ...prev, choice: readObserverChoice(browserObserverStorage()) }));
      }
    };
    window.addEventListener(OBSERVER_CHANGE_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(OBSERVER_CHANGE_EVENT, onChange);
    };
  }, []);

  const continueAsGuest = React.useCallback(() => {
    writeObserverChoice(browserObserverStorage(), 'guest');
    setState((prev) => ({ ...prev, choice: 'guest' }));
    window.dispatchEvent(new Event(OBSERVER_CHANGE_EVENT));
  }, []);

  const requestLogin = React.useCallback(() => {
    // 清掉「随便逛逛」的记忆，让登录门重新出现
    clearObserverChoice(browserObserverStorage());
    setState((prev) => ({ ...prev, choice: null }));
    window.dispatchEvent(new Event(OBSERVER_CHANGE_EVENT));
  }, []);

  return { session: state.session, choice: state.choice, ready, continueAsGuest, requestLogin };
}
