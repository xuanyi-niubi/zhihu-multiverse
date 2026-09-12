import { modelConfigForIdentity, readOwnSettings, resolveIdentity, zhihuConfigForIdentity } from '@/features/run/identity';

import type { DmProviderConfig } from '@/core/dm/provider';
import type { ZhihuConfig } from '@/core/zhihu/client';

/**
 * 运行时的密钥解析：**只读「这个身份自己配置的 key」**。
 *
 * ## 2026-09-13 的关键修订
 *
 * 旧版优先级是「账号配置 > 环境变量」。那个「环境变量兜底」有一个
 * 在公开部署下**不可接受**的后果：
 *
 * > 部署者把自己的一把 key 放进服务端 env 后，**任何访问者都能白用它**
 * > —— 花的是部署者的钱，而且几乎无法察觉。
 *
 * 因此现在**彻底移除 env 兜底**：
 *
 * | 情况 | 行为 |
 * |---|---|
 * | 已登录并配了自己的 key | 用他的 key |
 * | 未登录但配了自己的 key | 用他的 key（匿名身份隔离） |
 * | 都没配 | 返回 null → 调用方走 **DEMO MODE**（离线剧本 + 落盘快照） |
 *
 * 部署者不配 env 不会让站点打不开：没有 key 只是没有实时 AI 与实时检索，
 * 而 DEMO MODE 本身是完全可玩的路径（这正是 v2 §11.2 的设计）。
 *
 * ## 为什么统一改这一层
 *
 * 所有业务接口（`/api/dm` `/api/mesh` `/api/health` `/api/profile`
 * `/api/report` `/api/boss/evaluate` `/api/zhihu/hot` 与 `bossRoute`）
 * 都经由此模块取 key。改这一处即等于八处同时修好 ——
 * 不会出现「某个路由忘了改、结果还在用共享 key」的漏网。
 */

/**
 * 这些接口在**首次访问时**需要把匿名 cookie 写回响应，
 * 否则玩家的配置会在下次请求时「丢」掉（换了一个匿名 id）。
 */
export function identityCookieFor(request: Request): string | null {
  return resolveIdentity(request).setCookie;
}

/** 这一请求该用的模型配置；没配就是 null（调用方走离线兜底）。 */
export function resolveModelConfigForRequest(request: Request): DmProviderConfig | null {
  const { stored } = readOwnSettings(request);
  return modelConfigForIdentity(stored);
}

/** 这一请求该用的知乎配置；没配就是 null（检索走落盘快照 / 离线）。 */
export function resolveZhihuConfigForRequest(request: Request): ZhihuConfig | null {
  const { stored } = readOwnSettings(request);
  return zhihuConfigForIdentity(stored);
}

/**
 * 配置来源：给健康检查与界面用，**只报来源不报值**。
 *
 * 只有两种取值了：`account`（这个身份自己配的）与 `none`（没配）。
 * 原来的 `env` 已移除 —— 保留一个永不出现的枚举值只会误导读者。
 */
export type SecretOrigin = 'account' | 'none';

export function secretOriginFor(request: Request): {
  readonly model: SecretOrigin;
  readonly zhihu: SecretOrigin;
} {
  const { stored } = readOwnSettings(request);
  return {
    model: stored?.modelApiKey ? 'account' : 'none',
    zhihu: stored?.zhihuAccessSecret ? 'account' : 'none',
  };
}
