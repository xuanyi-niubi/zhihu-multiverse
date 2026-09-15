import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTransitionIntent,
  clearTransitionIntentCacheForTests,
  endpointTerms,
  expandTransitionIntent,
} from '@/features/experience/transitionIntent';
import { extractProfile } from '@/core/dm/profile';
import { buildProblemFrame } from '@/features/experience/frame';
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

/** 首页那条真实输入（截图里的原句）。 */
function realFrame(question: string): ProblemFrame {
  const profile = extractProfile(question);
  return buildProblemFrame({ question, profile, analysis: null });
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

  /**
   * 回归：线上事故原句。
   *
   * 旧实现把 `desiredChange`（「转行当导游」）左剥一个 `转` 字，
   * 得到 `当导游`，于是检索词与资格门槛都建在这个碎片上，
   * 机械/电气/会计转导游的合格经历全部被判 `unrelated`。
   */
  it('真实原句「想转行当导游」只留下「导游」，不留动词碎片', () => {
    const intent = buildTransitionIntent(realFrame('我是电工专业，想转行当导游'));

    expect(intent.target.exact).toEqual(['导游']);
    expect(intent.origin.exact).toEqual(['电工']);
    expect(intent.target.exact.join('')).not.toContain('当');
    expect(intent.transition).toBe('career-change');
  });

  it('画像标签不再泄漏进端点（计算机不能被改写成「转入技术岗」）', () => {
    const frame = realFrame('大三法学，想转计算机，但怕脱产以后找不到工作');
    const intent = buildTransitionIntent(frame);

    expect(intent.target.exact).toEqual(['计算机']);
    expect(intent.target.exact.join('')).not.toContain('技术岗');
    expect(intent.origin.exact.join('')).toContain('法学');
  });

  it('端点必须是用户原话的连续子串（不变量）', () => {
    const questions = [
      '我是电工专业，想转行当导游',
      '大三法学，想转计算机，但怕脱产以后找不到工作',
      '和室友长期冲突，要不要搬宿舍',
      '我是钟表修复师，想转古籍修复师',
      '电气工程专业想做导游',
    ];

    for (const question of questions) {
      const frame = realFrame(question);
      const intent = buildTransitionIntent(frame);
      for (const side of ['origin', 'target'] as const) {
        for (const term of intent[side].exact) {
          expect(question).toContain(term);
        }
      }
    }
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

  it('端点解析失败时退回调用方给的兜底词，且不会返回碎片', () => {
    const terms = endpointTerms({ question: '想转正', side: 'target', fallback: '转正' });
    expect(terms.exact.every((term) => term.length >= 2)).toBe(true);
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

  /**
   * 成本契约：缓存键是**端点对**，不是整句问题。
   *
   * 换一种问法（「转行当导游」→「转行做导游」）只要端点相同就白吃缓存；
   * 落盘之后容器重启也不再花钱。
   */
  it('端点相同、问法不同 → 复用同一份扩展，并落盘可复用', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'transition-intent-'));
    const complete = vi.fn(async () => ({
      ok: true as const,
      text: JSON.stringify({ familyOrigins: ['电气类'], domainOrigins: ['工科'], adjacentTargets: ['领队'], counterTerms: [] }),
      provider: 'fast',
      model: 'cheap-model',
      attempts: [],
    }));
    const router = { providers: ['fast'], complete } as ProviderRouter;

    await expandTransitionIntent(realFrame('我是电工专业，想转行当导游'), { router, cacheDir });
    await expandTransitionIntent(realFrame('我是电工专业，想转行做导游'), { router, cacheDir });
    expect(complete).toHaveBeenCalledTimes(1);

    // 清掉进程内缓存：模拟容器重启，只靠落盘缓存
    clearTransitionIntentCacheForTests();
    const afterRestart = await expandTransitionIntent(realFrame('我是电工，想转行当导游'), { router, cacheDir });
    expect(afterRestart.origin.family).toContain('电气类');
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
