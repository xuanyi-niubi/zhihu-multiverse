import { createOpenAiCompatibleClient, type DmModelClient } from '@/core/dm/provider';

import type { AgentRole } from '@/agents/types';
import type { DmMessage } from '@/core/dm/prompt';

/**
 * Provider 智能路由（规范 §3.5 / §4.6 / 附录 12.3）。
 *
 * 规则：**每个角色有自己的主备顺序**，一次失败就按顺序退避，全部失败就交给上层降级。
 * - DM / Plot Director：主力 DeepSeek（性价比），备用 OpenAI（更稳）
 * - Boss Evaluator：主力 OpenAI（推理更强），备用 Anthropic
 * - NPC / Memory：轻量模型优先（便宜快）
 *
 * 设计上刻意**不发散**：路由只做「选谁 + 退避 + 记录」，不缓存、不并发编排——
 * 缓存与幂等属于各自的功能层（Boss 有自己的缓存，DM 有自己的降级）。
 */

export interface ProviderCredential {
  readonly name: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly jsonMode: boolean;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
}

export interface RoleRouting {
  readonly primary: string;
  readonly fallback: string | null;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

/** 默认路由表：名字即 provider 名，未配置的会被自动跳过。 */
export const DEFAULT_ROUTING: Record<AgentRole, RoleRouting> = {
  orchestrator: { primary: 'deepseek', fallback: 'openai', timeoutMs: 8_000, maxRetries: 0 },
  'plot-director': { primary: 'deepseek', fallback: 'openai', timeoutMs: 15_000, maxRetries: 1 },
  'character-actor': { primary: 'deepseek', fallback: 'openai', timeoutMs: 12_000, maxRetries: 1 },
  'world-simulator': { primary: 'deepseek', fallback: 'openai', timeoutMs: 12_000, maxRetries: 1 },
  'memory-curator': { primary: 'deepseek', fallback: 'openai', timeoutMs: 8_000, maxRetries: 0 },
  'style-stylist': { primary: 'deepseek', fallback: 'openai', timeoutMs: 8_000, maxRetries: 0 },
};

export interface RouteAttempt {
  readonly role: AgentRole;
  readonly provider: string;
  readonly ok: boolean;
  /** 失败原因码（ok=false 时给出）。 */
  readonly code?: string;
  readonly ms: number;
}

export interface RoutedResult {
  readonly ok: boolean;
  readonly text: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly attempts: readonly RouteAttempt[];
}

export interface ProviderRouter {
  readonly providers: readonly string[];
  /** 为某角色选一次 provider 并调用；失败按路由表退避。 */
  complete(
    role: AgentRole,
    messages: readonly DmMessage[],
    options?: { readonly jsonMode?: boolean; readonly signal?: AbortSignal; readonly now?: () => number },
  ): Promise<RoutedResult>;
}

/** 按角色列出候选 provider（主 → 备），自动跳过没配 key 的。 */
export function candidatesFor(role: AgentRole, available: readonly ProviderCredential[], routing = DEFAULT_ROUTING): readonly ProviderCredential[] {
  const plan = routing[role] ?? DEFAULT_ROUTING['plot-director'];
  const byName = new Map(available.map((credential) => [credential.name, credential]));
  const ordered = [plan.primary, plan.fallback].filter((name): name is string => typeof name === 'string');

  const picked = ordered.map((name) => byName.get(name)).filter((c): c is ProviderCredential => Boolean(c));
  // 路由表里没提到的 provider 作为最后兜底，避免"配了却用不上"
  for (const credential of available) {
    if (!picked.includes(credential)) {
      picked.push(credential);
    }
  }
  return picked;
}

export interface RouterInput {
  readonly providers: readonly ProviderCredential[];
  /** 允许注入工厂，便于测试。 */
  readonly clientFactory?: (credential: ProviderCredential) => DmModelClient;
  readonly routing?: Record<AgentRole, RoleRouting>;
  readonly now?: () => number;
}

export function createProviderRouter(input: RouterInput): ProviderRouter {
  const routing = input.routing ?? DEFAULT_ROUTING;
  const now = input.now ?? Date.now;
  const factory =
    input.clientFactory ??
    ((credential: ProviderCredential) =>
      createOpenAiCompatibleClient({
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
        model: credential.model,
        jsonMode: credential.jsonMode,
        timeoutMs: credential.timeoutMs,
        temperature: credential.temperature,
        maxTokens: credential.maxTokens,
      }));

  return {
    providers: input.providers.map((credential) => credential.name),

    async complete(role, messages, options = {}) {
      const attempts: RouteAttempt[] = [];
      const plan = routing[role] ?? DEFAULT_ROUTING['plot-director'];
      const candidates = candidatesFor(role, input.providers, routing);

      for (const credential of candidates) {
        const startedAt = (options.now ?? now)();
        try {
          // 角色级超时必须真的落到 provider。旧实现虽然配置了 8/15/20 秒，
          // 实际 client 仍使用全局 30 秒，失败时会把整条链拖到分钟级。
          const client = factory({
            ...credential,
            timeoutMs: Math.min(credential.timeoutMs, plan.timeoutMs),
          });
          const result = await client.complete(messages, {
            jsonMode: options.jsonMode ?? credential.jsonMode,
            ...(options.signal ? { signal: options.signal } : {}),
          });

          const ms = (options.now ?? now)() - startedAt;
          if (result.ok) {
            attempts.push({ role, provider: credential.name, ok: true, ms });
            return {
              ok: true,
              text: result.text,
              provider: credential.name,
              model: credential.model,
              attempts,
            };
          }

          attempts.push({ role, provider: credential.name, ok: false, code: result.code, ms });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempts.push({
            role,
            provider: credential.name,
            ok: false,
            code: /abort/i.test(message) ? 'timeout' : 'exception',
            ms: (options.now ?? now)() - startedAt,
          });
        }

        // 主没倒就别退避（规范：maxRetries 控制的是同 provider 重试；
        // 这里保持简单：一次失败即换下一个 provider，避免把预算耗在同一家）
        if (attempts.length > plan.maxRetries + 1) {
          break;
        }
      }

      return { ok: false, text: '', provider: null, model: null, attempts };
    },
  };
}

/**
 * 从「已解析的运行时配置」构造 provider 列表。
 *
 * 只有真正配了 key 的才进列表——路由表里写了但没配的会被自动跳过，
 * 而不是让用户看到一堆"看起来能用其实没配"的 provider。
 */
export function providersFromConfig(config: {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly jsonMode: boolean;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly label?: string;
}): readonly ProviderCredential[] {
  if (!config.apiKey) {
    return [];
  }
  return [
    {
      name: config.label ?? 'deepseek',
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      jsonMode: config.jsonMode,
      timeoutMs: config.timeoutMs,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    },
  ];
}
