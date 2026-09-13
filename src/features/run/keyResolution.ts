import { modelConfigForIdentity, readOwnSettings, resolveIdentity, zhihuConfigForIdentity } from '@/features/run/identity';
import { appModelConfigFromEnv, appProviderStatus, appZhihuConfigFromEnv } from '@/config/serverEnv';

import type { DmProviderConfig } from '@/core/dm/provider';
import type { ZhihuConfig } from '@/core/zhihu/client';

/**
 * 运行时的密钥解析：**只读「这个身份自己配置的 key」**。
 *
 * ## 三级来源：`account > app > none`（产品化方案 §5 / §6 / §43）
 *
 * | 情况 | 行为 |
 * |---|---|
 * | 用户自己配了 key（登录或匿名） | 用**他的** key —— 花他自己的钱，也最可预期 |
 * | 用户没配，但服务器配了 `APP_LLM_*` / `APP_ZHIHU_ACCESS_SECRET` | 用 **App 的** key —— 普通用户打开即用 |
 * | 两者都没有 | 返回 null → 调用方走离线兜底（离线剧本 + 落盘快照） |
 *
 * ### 为什么 App 兜底是安全的（与旧版 env 兜底的区别）
 *
 * 旧版的问题是「**无提示地**给所有访问者用部署者的 key，花他的钱且几乎无法察觉」。
 * 现在 App key 是**产品的一部分**（打开即用），并且配套：
 *
 * 1. 用量预算（`src/core/usage/`）：每局 LLM 调用上限、每身份每小时/每天局数上限；
 * 2. 服务端 key 永不下发到浏览器（见 `src/config/serverEnv.ts` 的闸门）；
 * 3. `/api/health` 只报来源（`account` / `app` / `none`），不报值。
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

/**
 * 这一请求该用的模型配置：**用户自己的 > App 的 > null（离线兜底）**。
 *
 * `env` 可注入，便于测试三种来源；生产不传即读 `process.env`。
 */
export function resolveModelConfigForRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): DmProviderConfig | null {
  const { stored } = readOwnSettings(request);
  return modelConfigForIdentity(stored) ?? appModelConfigFromEnv(env);
}

/** 这一请求该用的知乎配置：同样 `account > app > null`。 */
export function resolveZhihuConfigForRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): ZhihuConfig | null {
  const { stored } = readOwnSettings(request);
  return zhihuConfigForIdentity(stored) ?? appZhihuConfigFromEnv(env);
}

/**
 * 配置来源：给健康检查与界面用，**只报来源不报值**。
 *
 * - `account`：这个身份自己配的（优先）
 * - `app`：服务器配的 App provider（兜底，普通用户打开即用）
 * - `none`：都没配，走离线
 */
export type SecretOrigin = 'account' | 'app' | 'none';

export function secretOriginFor(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): {
  readonly model: SecretOrigin;
  readonly zhihu: SecretOrigin;
} {
  const { stored } = readOwnSettings(request);
  const app = appProviderStatus(env);
  return {
    model: stored?.modelApiKey ? 'account' : app.model ? 'app' : 'none',
    zhihu: stored?.zhihuAccessSecret ? 'account' : app.zhihu ? 'app' : 'none',
  };
}
