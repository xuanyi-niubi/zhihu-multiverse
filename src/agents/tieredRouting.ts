import { providersFromConfig } from '@/agents/providerRouter';

import type { ProviderCredential, RoleRouting } from '@/agents/providerRouter';
import type { AgentRole } from '@/agents/types';

/**
 * 快慢双流模型路由（冲刺蓝图 §2）。
 *
 * **背景（这是一个真实缺口）**：`providerRouter` 的 `DEFAULT_ROUTING` 表里
 * 所有角色都指向同一家的 `primary/fallback`，而 `providersFromConfig` 只注册
 * 一个 provider —— 于是「每个角色有自己的主备顺序」在单 key 场景下退化成
 * 「只能选同一家」。多 Agent 编排在模型层面并没有真正分流。
 *
 * **本模块做的事**：把角色按「对延迟敏感 / 对推理深度敏感」分两档，
 * 允许**同一个 key、同一个端点、不同模型**（这是最常见的现实配置），
 * 从而真正做到：
 *
 * - **快流**：逐幕叙事、风格、难度适配 —— 体验不能被转圈等待毁掉；
 * - **深流**：证据拆解、路径归纳、Boss 判卷 —— 需要真正的推理。
 *
 * 设计纪律：
 * - **默认零回归**：没配分档模型时，两个档位都用 `DM_MODEL`，
 *   此时只注册一个 provider，路由表里的 `dm-fast` / `dm-deep` 自然被跳过；
 * - **不猜模型名**：档位模型名一律来自环境变量，代码里不硬编码任何具体型号
 *   （型号会过时，硬编码等于写死一个很快失效的假设）。
 */

export type ModelTier = 'fast' | 'deep';

/** 需要深度推理的角色：宁慢勿浅。 */
export const DEEP_ROLES: readonly AgentRole[] = [
  // 现有角色
  'plot-director',
  'world-simulator',
  'character-actor',
];

/**
 * 快流角色：逐幕交互与轻量整理，延迟优先。
 *
 * `orchestrator` / `memory-curator` / `style-stylist` 都在这个档位 ——
 * 它们要么只是组装上下文，要么做的是短文本整理。
 */
export const FAST_ROLES: readonly AgentRole[] = [
  'orchestrator',
  'memory-curator',
  'style-stylist',
];

/** 档位标签：provider 名必须能一眼看出它是哪一流。 */
export const TIER_LABEL: Readonly<Record<ModelTier, string>> = {
  fast: 'dm-fast',
  deep: 'dm-deep',
};

export interface TieredModels {
  readonly fast: string;
  readonly deep: string;
  /** 是否真的分了两档（同名即未分档）。 */
  readonly tiered: boolean;
}

function readEnv(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 从环境变量解析两档模型。
 *
 * 变量名刻意不写具体型号（`DM_FAST_MODEL` / `DM_DEEP_MODEL`），
 * 因为型号会过时：今天最快的模型半年后可能不是。
 */
export function resolveTieredModels(env: Record<string, string | undefined> = process.env): TieredModels {
  /**
   * 档位名来源顺序（产品化方案 §5 / §8）：
   *
   * ```text
   * DM_*            —— 部署者显式指定的工作区配置（优先级最高，行为不变）
   * APP_LLM_*       —— 服务器提供的 App provider
   * deepseek-chat   —— 兜底默认
   * ```
   *
   * 便宜的 fast 用于「理解」与单幕叙事，贵的 deep 用于世界编译；
   * 两者相同即视为未分档（不制造两个同名 provider）。
   */
  const base = readEnv(env, 'DM_MODEL') ?? readEnv(env, 'APP_LLM_DEEP_MODEL') ?? 'deepseek-chat';
  const fast = readEnv(env, 'DM_FAST_MODEL') ?? readEnv(env, 'APP_LLM_FAST_MODEL') ?? base;
  const deep = readEnv(env, 'DM_DEEP_MODEL') ?? readEnv(env, 'APP_LLM_DEEP_MODEL') ?? base;
  return { fast, deep, tiered: fast !== deep };
}

export interface TieredProviderInput {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly jsonMode: boolean;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
  /** 快流单次调用上限（快流应该更短，避免拖长等待）。 */
  readonly fastMaxTokens?: number;
  /** 深流单次调用上限（深流允许更长）。 */
  readonly deepMaxTokens?: number;
}

/**
 * 构造带档位的 provider 列表。
 *
 * 未分档时只返回一个 provider（沿用 `DM_MODEL`），
 * 保证「没配分档」与「配了分档但同名」都走原来的单流路径，零回归。
 */
export function tieredProvidersFromConfig(
  input: TieredProviderInput,
  models: TieredModels = resolveTieredModels(),
): readonly ProviderCredential[] {
  if (!input.apiKey) {
    return [];
  }

  const common = { apiKey: input.apiKey, baseUrl: input.baseUrl, jsonMode: input.jsonMode };

  if (!models.tiered) {
    // 未分档：不制造两个名字相同的 provider，否则路由表会以为自己在分流
    return providersFromConfig({
      ...common,
      model: models.deep,
      timeoutMs: input.timeoutMs,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
  }

  const fast = providersFromConfig({
    ...common,
    label: TIER_LABEL.fast,
    model: models.fast,
    timeoutMs: input.timeoutMs,
    temperature: input.temperature,
    maxTokens: input.fastMaxTokens ?? Math.min(input.maxTokens, 900),
  });

  const deep = providersFromConfig({
    ...common,
    label: TIER_LABEL.deep,
    model: models.deep,
    timeoutMs: input.timeoutMs,
    temperature: input.temperature,
    maxTokens: input.deepMaxTokens ?? input.maxTokens,
  });

  return [...deep, ...fast];
}

/**
 * 档位感知的路由表。
 *
 * 与 `DEFAULT_ROUTING` 的关系：**深流角色优先深档，快流角色优先快档**，
 * 两者都保留对另一档的退避（快流模型挂了就升级到深流，总比不出内容好）。
 */
export const TIERED_ROUTING: Record<AgentRole, RoleRouting> = {
  orchestrator: { primary: TIER_LABEL.fast, fallback: TIER_LABEL.deep, timeoutMs: 8_000, maxRetries: 0 },
  'memory-curator': { primary: TIER_LABEL.fast, fallback: TIER_LABEL.deep, timeoutMs: 8_000, maxRetries: 0 },
  'style-stylist': { primary: TIER_LABEL.fast, fallback: TIER_LABEL.deep, timeoutMs: 8_000, maxRetries: 0 },

  'plot-director': { primary: TIER_LABEL.deep, fallback: TIER_LABEL.fast, timeoutMs: 20_000, maxRetries: 1 },
  'world-simulator': { primary: TIER_LABEL.deep, fallback: TIER_LABEL.fast, timeoutMs: 15_000, maxRetries: 1 },
  'character-actor': { primary: TIER_LABEL.deep, fallback: TIER_LABEL.fast, timeoutMs: 15_000, maxRetries: 1 },
};

/** 该角色属于哪一档（用于界面展示与解释「为什么这一句快/慢」）。 */
export function tierOf(role: AgentRole): ModelTier {
  return DEEP_ROLES.includes(role) ? 'deep' : 'fast';
}

/** 给界面/日志用的一句话说明，不含密钥。 */
export function describeTiers(models: TieredModels = resolveTieredModels()): string {
  if (!models.tiered) {
    return `单流模式：全部角色使用 ${models.deep}（未配置 DM_FAST_MODEL / DM_DEEP_MODEL）`;
  }
  return `快慢双流：快流 ${models.fast}（逐幕叙事与整理）· 深流 ${models.deep}（证据拆解与判卷）`;
}
