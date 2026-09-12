import { anonymousCookieHeader, anonymousStorageKey, ensureAnonymousIdentity } from '@/core/anonymousId';
import { sessionUrlToken } from '@/core/oauth/zhihu';
import { readSettings, type StoredSettings } from '@/core/settingsStore';

import type { DmProviderConfig } from '@/core/dm/provider';
import type { ZhihuConfig } from '@/core/zhihu/client';

/**
 * 配置身份解析（v3 之后的唯一入口）。
 *
 * ## 两件必须一起做的事
 *
 * ### 1. 访客也有身份
 *
 * 原本 `/settings` 必须登录知乎账号。对「配置我自己的 AI key」这件事，
 * 那个门槛是过度约束 —— 玩家只想用自己的 key 玩一局，不该被迫走 OAuth。
 * 现在：登录用户按 `url_token` 隔离，**未登录用户按匿名 cookie 隔离**。
 *
 * ### 2. 环境变量**不再**作为访客的兜底
 *
 * 这是本次改动的真正原因，也是一个安全与成本问题：
 *
 * > 如果服务端环境变量里留着一把共享 key，而访客没有自己的 key 时回退到它，
 * > 那**任何访问者都能白用那把 key**（花的是部署者的钱）。
 *
 * 因此本模块**只读「这个身份自己配置的 key」**，绝不回退到 `process.env`。
 * 部署者要跑 DEMO MODE 时不需要 key（离线剧本 + 落盘快照），
 * 所以「不配 env」不会让站点打不开 —— 只是不会替访客付账。
 *
 * ## 与记忆存储的区别（刻意不同）
 *
 * 记忆（`memoryStore`）**仍然只认知乎账号**：
 * 那是「你的宇宙记得你」这件事的承诺，跨设备可见，必须绑定真实身份。
 * 而「你用的哪把 model key」是实现细节，匿名身份足够。
 */

export interface ResolvedIdentity {
  /** 落盘用的身份键（登录用户为 url_token，访客为 `anon:<id>`）。 */
  readonly key: string;
  readonly authenticated: boolean;
  /** 本次请求是否需要把匿名 cookie 写回响应。 */
  readonly setCookie: string | null;
}

export function resolveIdentity(request: Request): ResolvedIdentity {
  const urlToken = sessionUrlToken(request);
  if (urlToken) {
    return { key: urlToken, authenticated: true, setCookie: null };
  }

  const anon = ensureAnonymousIdentity(request);
  return {
    key: anonymousStorageKey(anon.id),
    authenticated: false,
    setCookie: anon.created ? anonymousCookieHeader(anon.id) : null,
  };
}

/** 读取该身份自己保存的配置（**不做任何 env 回退**）。 */
export function readOwnSettings(request: Request): {
  readonly identity: ResolvedIdentity;
  readonly stored: StoredSettings | null;
} {
  const identity = resolveIdentity(request);
  return { identity, stored: readSettings(identity.key) };
}

/* -------------------------------------------------------------------------- */
/* 运行模式：由「这个身份是否配了 key」决定，而不是由服务端 env 决定            */
/* -------------------------------------------------------------------------- */

const DEFAULT_MODEL_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

/**
 * 该身份可用的模型配置。
 *
 * **完全来自用户自己在 `/settings` 填的内容**（含端点与模型名，
 * 因此也支持任意 OpenAI 兼容服务）。没有配置就返回 null ——
 * 调用方据此走离线兜底，而不是偷偷用服务端的 key。
 */
export function modelConfigForIdentity(stored: StoredSettings | null): DmProviderConfig | null {
  const apiKey = stored?.modelApiKey ?? null;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: stored?.modelBaseUrl ?? DEFAULT_MODEL_BASE_URL,
    model: stored?.modelModel ?? DEFAULT_MODEL,
    jsonMode: stored?.modelJsonMode ?? true,
    timeoutMs: 30_000,
    temperature: 0.85,
    maxTokens: 1_400,
  };
}

/** 该身份可用的知乎配置（同样只来自用户自己填的）。 */
export function zhihuConfigForIdentity(stored: StoredSettings | null): ZhihuConfig | null {
  const accessSecret = stored?.zhihuAccessSecret ?? null;
  if (!accessSecret) {
    return null;
  }

  return {
    accessSecret,
    baseUrl: 'https://developer.zhihu.com',
    timeoutMs: 20_000,
    cacheTtlMs: 600_000,
    storyPath: '/api/v1/content/story',
  };
}
