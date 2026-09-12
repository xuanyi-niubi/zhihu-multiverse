import type { DmMessage } from '@/core/dm/prompt';

/**
 * 传输层：OpenAI 兼容的 Chat Completions 适配器。
 *
 * 覆盖 DeepSeek / 智谱 GLM / OpenAI / 各类中转端点，只要对方兼容
 * `POST {baseUrl}/chat/completions` 且支持 `response_format: { type: "json_object" }`。
 *
 * 说明：知乎直答（zhida-*）曾作为模型接入，但它只保证 model/messages/stream 三个字段、
 * 不支持结构化输出，实测会把 JSON 指令写成 markdown 长文，因此**已从模型链路移除**。
 * 知乎开放平台现在只用于「知乎搜索」——提供真实站内语料，见 `core/zhihu/client.ts`。
 *
 * 与解析层一样，`complete()` 的契约是**永不抛出**：
 * 网络错误、超时、HTTP 4xx/5xx、空响应全部转成 `{ ok: false, code }`。
 */

export interface DmModelRequestOptions {
  /** 传 false 可对不支持 json_object 的端点关掉结构化输出。 */
  readonly jsonMode?: boolean;
  readonly signal?: AbortSignal;
}

export type DmModelResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface DmModelClient {
  readonly id: string;
  complete(messages: readonly DmMessage[], options?: DmModelRequestOptions): Promise<DmModelResult>;
}

export interface DmProviderConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly jsonMode: boolean;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

function readEnv(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
): boolean {
  const value = readEnv(env, key);
  if (value === null) {
    return fallback;
  }
  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
}

function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = readEnv(env, key);
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * 从环境变量解析模型配置。
 * 没有 key 时返回 null——调用方据此走离线兜底，而不是报错。
 */
export function resolveProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): DmProviderConfig | null {
  const apiKey = readEnv(env, 'DM_API_KEY') ?? readEnv(env, 'OPENAI_API_KEY');

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: readEnv(env, 'DM_BASE_URL') ?? DEFAULT_BASE_URL,
    model: readEnv(env, 'DM_MODEL') ?? DEFAULT_MODEL,
    jsonMode: readBoolean(env, 'DM_JSON_MODE', true),
    timeoutMs: readNumber(env, 'DM_TIMEOUT_MS', 30_000, 1_000, 120_000),
    temperature: readNumber(env, 'DM_TEMPERATURE', 0.85, 0, 2),
    maxTokens: readNumber(env, 'DM_MAX_TOKENS', 1_400, 200, 8_000),
  };
}

/** 从多种可能的响应形状里取出正文；取不到返回 null。 */
function extractContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    return null;
  }

  const message = (first as { message?: unknown }).message;
  if (typeof message === 'object' && message !== null) {
    const content = (message as { content?: unknown }).content;

    if (typeof content === 'string') {
      return content;
    }

    // 多模态内容数组：[{ type: 'text', text: '...' }]
    if (Array.isArray(content)) {
      const joined = content
        .map((part) =>
          typeof part === 'object' &&
          part !== null &&
          typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('');

      return joined.length > 0 ? joined : null;
    }
  }

  const text = (first as { text?: unknown }).text;
  if (typeof text === 'string') {
    return text;
  }

  return null;
}

export function createOpenAiCompatibleClient(config: DmProviderConfig): DmModelClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    id: `openai-compatible:${config.model}`,

    async complete(messages, options = {}) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      const externalAbort = () => controller.abort();
      options.signal?.addEventListener('abort', externalAbort, { once: true });

      const useJsonMode = config.jsonMode && options.jsonMode !== false;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            stream: false,
            messages,
            ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          return {
            ok: false,
            code: `http-${response.status}`,
            message: detail.slice(0, 300) || response.statusText,
          };
        }

        const payload: unknown = await response.json().catch(() => null);
        const text = extractContent(payload);

        if (!text) {
          return { ok: false, code: 'empty-content', message: '模型返回内容为空' };
        }

        return { ok: true, text };
      } catch (error) {
        const aborted = controller.signal.aborted;
        return {
          ok: false,
          code: aborted ? 'timeout-or-abort' : 'network-error',
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', externalAbort);
      }
    },
  };
}
