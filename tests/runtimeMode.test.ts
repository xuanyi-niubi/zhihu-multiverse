import { describe, expect, it } from 'vitest';

import { engineLights, fallbackChain, modeMeta, modeOf } from '@/core/run/runtimeMode';

/**
 * 运行模式的契约测试（v2 §11 / §20.2 / §22.3）。
 *
 * 这一层存在的唯一理由是**路演不能翻车**：任何外部服务挂掉，
 * 都必须能退到一个「保证可用」的模式，并且界面必须如实告知降级。
 */

describe('modeOf', () => {
  it('两个 key 都有 → full', () => {
    expect(modeOf({ aiKey: true, zhihuKey: true })).toBe('full');
  });

  it('只有 AI key → ai（必须显式告知没有实时证据）', () => {
    expect(modeOf({ aiKey: true, zhihuKey: false })).toBe('ai');
  });

  it('没有 AI key → demo（哪怕有知乎 key，也就是没有动态叙事）', () => {
    expect(modeOf({ aiKey: false, zhihuKey: true })).toBe('demo');
    expect(modeOf({ aiKey: false, zhihuKey: false })).toBe('demo');
  });
});

describe('modeMeta', () => {
  it('三种模式都有标题、指示灯与诚实的能力说明', () => {
    for (const mode of ['full', 'ai', 'demo'] as const) {
      const meta = modeMeta(mode);
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.notice.length).toBeGreaterThan(10);
      expect(meta.engine).toMatch(/ONLINE|OFFLINE/);
      expect(meta.evidence).toMatch(/ONLINE|OFFLINE/);
    }
  });

  it('只有 full 模式声称证据可用于硬裁决', () => {
    expect(modeMeta('full').evidenceCanJudge).toBe(true);
    expect(modeMeta('ai').evidenceCanJudge).toBe(false);
    expect(modeMeta('demo').evidenceCanJudge).toBe(false);
  });

  it('ai 模式必须明说「不包含实时知乎证据」（v2 §11.3 的硬要求）', () => {
    expect(modeMeta('ai').notice).toContain('不包含实时知乎证据');
    expect(modeMeta('ai').notice).toContain('不决定胜负');
  });

  it('demo 模式必须明说「不会编造真人经历」', () => {
    expect(modeMeta('demo').notice).toContain('不会编造');
  });
});

describe('engineLights', () => {
  it('世界引擎永远 READY（它是纯函数，不依赖外部服务）', () => {
    for (const mode of ['full', 'ai', 'demo'] as const) {
      expect(engineLights(mode).world).toContain('READY');
      expect(engineLights(mode).world).toContain('●');
    }
  });

  it('full 模式三个灯两个在线；demo 模式两个离线', () => {
    expect(engineLights('full').ai).toContain('●');
    expect(engineLights('full').zhihu).toContain('●');
    expect(engineLights('demo').ai).toContain('○');
    expect(engineLights('demo').zhihu).toContain('○');
  });

  it('ai 模式：AI 在线但知乎离线', () => {
    expect(engineLights('ai').ai).toContain('●');
    expect(engineLights('ai').zhihu).toContain('○');
  });
});

describe('fallbackChain', () => {
  it('full 模式：实时 → 快照 → 离线（三层保险）', () => {
    expect(fallbackChain('full')).toEqual(['live', 'snapshot', 'offline']);
  });

  it('ai 模式不尝试实时检索', () => {
    expect(fallbackChain('ai')).not.toContain('live');
  });

  it('demo 模式只有离线 —— 但一定可用（含 offline 是硬保证）', () => {
    expect(fallbackChain('demo')).toEqual(['offline']);
  });

  it('每条链都以 offline 结尾：任何模式都不会无路可走', () => {
    for (const mode of ['full', 'ai', 'demo'] as const) {
      const chain = fallbackChain(mode);
      expect(chain[chain.length - 1]).toBe('offline');
      expect(chain.length).toBeGreaterThan(0);
    }
  });
});
