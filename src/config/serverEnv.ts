import type { DmProviderConfig } from '@/core/dm/provider';
import type { ZhihuConfig } from '@/core/zhihu/client';

/**
 * 服务端环境配置：**App-owned providers**（产品化方案 §5 / §37 / §43）。
 *
 * ## 它解决什么
 *
 * 旧架构要求每个访问者先在 `/settings` 填自己的模型 key 才能看到 AI ——
 * 对「打开就用」的成品体验不可接受：普通用户不该先理解 API、先充值、
 * 先创建 Key、再填 Base URL，然后才能玩一句。
 *
 * 现在服务器可以提供一份 App 自己的 provider 配置：
 *
 * ```env
 * APP_LLM_BASE_URL=
 * APP_LLM_API_KEY=
 * APP_LLM_FAST_MODEL=
 * APP_LLM_DEEP_MODEL=
 * APP_ZHIHU_ACCESS_SECRET=
 * ```
 *
 * 解析优先级（见 `keyResolution.ts`）：
 *
 * ```text
 * 用户自己的 key  >  App key  >  none（离线兜底）
 * ```
 *
 * ## 三条硬纪律
 *
 * 1. **绝不下发到浏览器**：这里只被路由处理器 import。函数入口有一道
 *    运行期闸门 —— 在浏览器里被调用会直接抛错，而不是静默泄露配置。
 * 2. **不编造默认值**：没有 `APP_LLM_API_KEY` 就是 null，不做任何"猜一个"。
 * 3. **env 只在这里读**：业务代码一律通过 `resolveModelConfigForRequest`
 *    这类入口拿配置，避免「某个路由忘了走统一层、结果自己读 env」的漏网。
 */

/** 在浏览器里被 import 时立刻失败（配置模块不允许出现在客户端 bundle）。 */
function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv 只能在服务端使用：App provider 的密钥不允许进入浏览器');
  }
}

function readEnv(env: Record<string, string | undefined>, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Base URL 一律去掉末尾 `/`。
 *
 * 否则 `https://x/v1` 与 `https://x/v1/` 拼出来的路径会有两副面孔
 * （`//chat/completions`），而报错信息里只会看到一个 404，很难联想到是配置。
 */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * 读一个布尔 env：只有明确的假值才算 false，其余非空值都算 true。
 *
 * 这样 `true` / `1` / `yes` 都能用，而**写错的字符串不会静默关掉结构化输出**
 * —— 关掉它主链的 JSON 解析就要走兜底，属于「现场很难查」的那类故障。
 */
function readEnvBool(
  env: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = readEnv(env, key);
  if (raw === null) {
    return fallback;
  }
  return !/^(0|false|no|off)$/i.test(raw);
}

export interface AppLlmEnv {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** 便宜的档位：理解与单幕叙事。缺省就跟着 deep 走。 */
  readonly fastModel: string | null;
  /** 贵的档位：世界编译。缺省就跟着 fast 走。 */
  readonly deepModel: string | null;
  /** 是否要求结构化输出（`APP_LLM_JSON_MODE`，缺省 true：JSON 是主链契约）。 */
  readonly jsonMode: boolean;
}

const DEFAULT_APP_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * 服务器自己的 LLM 配置；没配就是 null（调用方走离线兜底）。
 *
 * 纯函数（env 可注入），因此「配了 / 没配 / 只配一半」三种情况都能直接测。
 */
export function appLlmFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppLlmEnv | null {
  assertServerOnly();
  const apiKey = readEnv(env, 'APP_LLM_API_KEY');
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(readEnv(env, 'APP_LLM_BASE_URL') ?? DEFAULT_APP_BASE_URL),
    fastModel: readEnv(env, 'APP_LLM_FAST_MODEL'),
    deepModel: readEnv(env, 'APP_LLM_DEEP_MODEL'),
    jsonMode: readEnvBool(env, 'APP_LLM_JSON_MODE', true),
  };
}

/**
 * App 模型 → 统一的 `DmProviderConfig`。
 *
 * 单次请求只有一个 `model` 字段，所以这里取 **deep 优先**（世界编译是最需要
 * 能力的调用）；分档由 `resolveTieredModels` 用 `APP_LLM_FAST_MODEL` /
 * `APP_LLM_DEEP_MODEL` 表达，不在这里伪造两个 provider。
 */
export function appModelConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): DmProviderConfig | null {
  const app = appLlmFromEnv(env);
  if (!app) {
    return null;
  }
  const model = app.deepModel ?? app.fastModel ?? 'deepseek-chat';
  return {
    apiKey: app.apiKey,
    baseUrl: app.baseUrl,
    model,
    jsonMode: app.jsonMode,
    timeoutMs: 30_000,
    temperature: 0.85,
    maxTokens: 1_400,
  };
}

/** 服务器自己的知乎 Access Secret；没配就是 null。 */
export function appZhihuSecretFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  assertServerOnly();
  return readEnv(env, 'APP_ZHIHU_ACCESS_SECRET');
}

/** App 知乎配置（与账号配置同一形状，只是 secret 来自服务器）。 */
export function appZhihuConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ZhihuConfig | null {
  const accessSecret = appZhihuSecretFromEnv(env);
  if (!accessSecret) {
    return null;
  }
  return {
    accessSecret,
    baseUrl: 'https://developer.zhihu.com',
    timeoutMs: 20_000,
    cacheTtlMs: 600_000,
  };
}

/** 服务器是否配了 App provider（只报布尔，永不回传值）。 */
export function appProviderStatus(
  env: Record<string, string | undefined> = process.env,
): { readonly model: boolean; readonly zhihu: boolean } {
  return {
    model: appLlmFromEnv(env) !== null,
    zhihu: appZhihuSecretFromEnv(env) !== null,
  };
}


/** OAuth 应用凭证的唯一服务端入口；浏览器导入会立即失败。 */
export function oauthCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): { readonly appKey: string; readonly accessSecret: string } {
  assertServerOnly();
  return {
    appKey: readEnv(env, 'ZHIHU_OAUTH_APP_KEY') ?? '',
    accessSecret: readEnv(env, 'ZHIHU_ACCESS_SECRET') ?? '',
  };
}
