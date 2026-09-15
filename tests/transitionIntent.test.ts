import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTransitionIntent,
  clearTransitionIntentCacheForTests,
  expandTransitionIntent,
} from '@/features/experience/transitionIntent';
import type { ProviderRouter } from '@/agents/providerRouter';
import type { ProblemFrame } from '@/features/experience/domain';

function frameOf(
  rawQuestion: string,
  currentSituation = rawQuestion,
  desiredChange = rawQuestion,
): ProblemFrame {
  return {
    rawQuestion,
    currentSituation,
    desiredChange,
    constraints: [],
    resources: [],
    concerns: [],
    centralTension: '',
    unknowns: [],
    parseConfidence: 0.8,
  };
}

describe('转变意图', () => {
  beforeEach(() => clearTransitionIntentCacheForTests());

  it('确定性路径只抽取原话端点，不用主题词典猜同类', () => {
    const intent = buildTransitionIntent(
      frameOf('我是电工专业，然后想转导游', '电工专业', '转导游'),
    );

    expect(intent.origin.exact).toContain('电工');
    expect(intent.target.exact).toContain('导游');
    expect(intent.origin.family).toEqual([]);
    expect(intent.origin.domain).toEqual([]);
    expect(intent.target.adjacent).toEqual([]);
    expect(intent.transition).toBe('career-change');
  });

  it('经校验的开放扩展适用于任何主题', () => {
    const intent = buildTransitionIntent(
      frameOf('和室友长期冲突，要不要搬宿舍', '和室友长期冲突', '搬宿舍'),
      {
        familyOrigins: ['宿舍关系冲突'],
        domainOrigins: ['共同居住矛盾'],
        adjacentTargets: ['校外租房', '申请调宿舍'],
        counterTerms: ['搬走后悔', '成本增加'],
      },
    );
    expect(intent.origin.family).toEqual(['宿舍关系冲突']);
    expect(intent.target.adjacent).toEqual(['校外租房', '申请调宿舍']);
    expect(intent.counterTerms).toEqual(['搬走后悔', '成本增加']);
  });

  it('未知职业只保留用户明确写出的词，不猜行业族', () => {
    const intent = buildTransitionIntent(
      frameOf('我是钟表修复师，想转古籍修复师', '钟表修复师', '转古籍修复师'),
    );

    expect(intent.origin.exact).toContain('钟表修复师');
    expect(intent.target.exact).toContain('古籍修复师');
    expect(intent.origin.family).toEqual([]);
    expect(intent.origin.domain).toEqual([]);
    expect(intent.target.adjacent).toEqual([]);
  });

  it('相同输入确定性地产生相同结果', () => {
    const frame = frameOf('电气工程专业想做导游', '电气工程专业', '做导游');
    expect(buildTransitionIntent(frame)).toEqual(buildTransitionIntent(frame));
  });

  it('模型扩展最多调用一次并被相同问题缓存复用', async () => {
    const complete = vi.fn(async () => ({
      ok: true as const,
      text: JSON.stringify({
        familyOrigins: ['电气类', '自动化'],
        domainOrigins: ['工科', '机械专业'],
        adjacentTargets: ['领队', '旅游从业'],
        counterTerms: ['退出', '后悔'],
      }),
      provider: 'fast',
      model: 'cheap-model',
      attempts: [],
    }));
    const router = { providers: ['fast'], complete } as ProviderRouter;
    const frame = frameOf('我是电工专业，然后想转导游', '电工专业', '转导游');

    const first = await expandTransitionIntent(frame, { router });
    const second = await expandTransitionIntent(frame, { router });

    expect(first.origin.family).toContain('电气类');
    expect(first.origin.domain).toContain('机械专业');
    expect(first.target.adjacent).toContain('领队');
    expect(second).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('过滤过长、泛化和非数组扩展词', async () => {
    const router = {
      providers: ['fast'],
      complete: vi.fn(async () => ({
        ok: true as const,
        text: JSON.stringify({
          familyOrigins: ['人生', '电气类', '这是一段明显过长而且没有检索价值的完整句子'],
          domainOrigins: '工科',
          adjacentTargets: ['工作', '领队'],
          counterTerms: ['建议', '退出'],
        }),
        provider: 'fast',
        model: 'cheap-model',
        attempts: [],
      })),
    } as ProviderRouter;
    const result = await expandTransitionIntent(
      frameOf('我是电工专业，然后想转导游', '电工专业', '转导游'),
      { router },
    );
    expect(result.origin.family).toEqual(['电气类']);
    expect(result.origin.domain).toEqual([]);
    expect(result.target.adjacent).toEqual(['领队']);
    expect(result.counterTerms).toEqual(['退出']);
  });
});
