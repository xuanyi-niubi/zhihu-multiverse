import { describe, expect, it } from 'vitest';

import { candidatesFor } from '@/agents/providerRouter';
import {
  DEEP_ROLES,
  FAST_ROLES,
  TIERED_ROUTING,
  TIER_LABEL,
  describeTiers,
  resolveTieredModels,
  tierOf,
  tieredProvidersFromConfig,
} from '@/agents/tieredRouting';

import type { AgentRole } from '@/agents/types';

/**
 * 快慢双流路由的契约测试（冲刺蓝图 §2）。
 *
 * 这一层的价值是**把延迟预算花在对的地方**：逐幕叙事不能被转圈等待毁掉，
 * 而证据拆解与情节结构值得等。测试要钉死两件事：
 * 1. 分档真的生效（深流角色拿到深档模型）；
 * 2. 不分档时零回归（不制造两个同名 provider，不改变原行为）。
 */

const BASE_CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  jsonMode: true,
  timeoutMs: 30_000,
  temperature: 0.85,
  maxTokens: 1_400,
};

describe('resolveTieredModels', () => {
  it('没配分档时两档都退回 DM_MODEL（零回归）', () => {
    const models = resolveTieredModels({ DM_MODEL: 'base-model' });
    expect(models.fast).toBe('base-model');
    expect(models.deep).toBe('base-model');
    expect(models.tiered).toBe(false);
  });

  it('配了分档时如实分档', () => {
    const models = resolveTieredModels({
      DM_MODEL: 'base-model',
      DM_FAST_MODEL: 'fast-model',
      DM_DEEP_MODEL: 'deep-model',
    });
    expect(models.fast).toBe('fast-model');
    expect(models.deep).toBe('deep-model');
    expect(models.tiered).toBe(true);
  });

  it('代码里不硬编码任何具体型号：只认环境变量', () => {
    // 用一个明显不存在于源码里的型号名，确认它被原样采用
    const models = resolveTieredModels({ DM_FAST_MODEL: 'zzz-not-a-real-model', DM_DEEP_MODEL: 'yyy-other' });
    expect(models.fast).toBe('zzz-not-a-real-model');
    expect(models.deep).toBe('yyy-other');
  });
});

describe('tieredProvidersFromConfig', () => {
  it('不分档时只注册一个 provider（不制造同名分流假象）', () => {
    const providers = tieredProvidersFromConfig(BASE_CONFIG, { fast: 'same', deep: 'same', tiered: false });
    expect(providers).toHaveLength(1);
    expect(providers[0].model).toBe('same');
  });

  it('分档时两个 provider 都注册，且各自带正确模型', () => {
    const providers = tieredProvidersFromConfig(BASE_CONFIG, {
      fast: 'fast-model',
      deep: 'deep-model',
      tiered: true,
    });
    expect(providers).toHaveLength(2);

    const fast = providers.find((item) => item.name === TIER_LABEL.fast);
    const deep = providers.find((item) => item.name === TIER_LABEL.deep);
    expect(fast?.model).toBe('fast-model');
    expect(deep?.model).toBe('deep-model');
  });

  it('快流的单次输出上限更小（延迟优先）', () => {
    const providers = tieredProvidersFromConfig(BASE_CONFIG, {
      fast: 'fast-model',
      deep: 'deep-model',
      tiered: true,
    });
    const fast = providers.find((item) => item.name === TIER_LABEL.fast);
    const deep = providers.find((item) => item.name === TIER_LABEL.deep);
    expect((fast?.maxTokens ?? 0) < (deep?.maxTokens ?? 0)).toBe(true);
  });

  it('没有 key 时返回空列表（不发明一个不能用的 provider）', () => {
    expect(tieredProvidersFromConfig({ ...BASE_CONFIG, apiKey: null })).toHaveLength(0);
  });
});

describe('TIERED_ROUTING / candidatesFor', () => {
  const tiered = tieredProvidersFromConfig(BASE_CONFIG, {
    fast: 'fast-model',
    deep: 'deep-model',
    tiered: true,
  });

  it('深流角色优先深档，快流角色优先快档', () => {
    for (const role of DEEP_ROLES) {
      expect(candidatesFor(role, tiered, TIERED_ROUTING)[0].name).toBe(TIER_LABEL.deep);
    }
    for (const role of FAST_ROLES) {
      expect(candidatesFor(role, tiered, TIERED_ROUTING)[0].name).toBe(TIER_LABEL.fast);
    }
  });

  it('每一档都能退避到另一档（快流挂了总比不出内容好）', () => {
    for (const role of [...DEEP_ROLES, ...FAST_ROLES]) {
      const candidates = candidatesFor(role, tiered, TIERED_ROUTING);
      expect(candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('不分档时路由表里的档位名不存在，候选自动退回唯一 provider（零回归）', () => {
    const single = tieredProvidersFromConfig(BASE_CONFIG, { fast: 'same', deep: 'same', tiered: false });
    for (const role of [...DEEP_ROLES, ...FAST_ROLES]) {
      const candidates = candidatesFor(role, single, TIERED_ROUTING);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].model).toBe('same');
    }
  });

  it('所有 AgentRole 都在路由表里有条目（不漏角色）', () => {
    const roles: readonly AgentRole[] = [
      'orchestrator',
      'plot-director',
      'character-actor',
      'world-simulator',
      'memory-curator',
      'style-stylist',
    ];
    for (const role of roles) {
      expect(TIERED_ROUTING[role]).toBeDefined();
    }
  });

  it('tierOf 与两个角色列表一致', () => {
    expect(tierOf('plot-director')).toBe('deep');
    expect(tierOf('style-stylist')).toBe('fast');
  });

  it('describeTiers 说明分档状态，且不含任何密钥', () => {
    const single = describeTiers({ fast: 'a', deep: 'a', tiered: false });
    const tieredText = describeTiers({ fast: 'a', deep: 'b', tiered: true });
    expect(single).toContain('单流');
    expect(tieredText).toContain('快慢双流');
    expect(tieredText).not.toContain('test-key');
  });
});
