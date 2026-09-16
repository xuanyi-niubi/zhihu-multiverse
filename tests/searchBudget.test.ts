import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  consumeSearchRequest,
  isSearchBudgetExhausted,
  resetSearchBudgetForTests,
  searchBudgetState,
  SearchBudgetExhaustedError,
  withSearchBudget,
} from '@/core/usage/searchBudget';

import type { ExperienceSearch } from '@/features/experience/retrieve';

/**
 * 知乎检索的全站日预算（P2 护栏）。
 *
 * 它守的是一条诚实纪律：**额度用尽 ≠ 没有人讨论**。
 * 所以额度用尽时抛类型化错误（由检索层记成 `budget`），而不是返回空数组。
 */

const originalLimit = process.env.APP_MAX_SEARCHES_PER_DAY;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetSearchBudgetForTests();
  process.env.APP_MAX_SEARCHES_PER_DAY = '3';
});

afterEach(() => {
  resetSearchBudgetForTests();
  if (originalLimit === undefined) {
    delete process.env.APP_MAX_SEARCHES_PER_DAY;
  } else {
    process.env.APP_MAX_SEARCHES_PER_DAY = originalLimit;
  }
});

describe('日预算计数', () => {
  it('允许时计数并给出剩余', () => {
    const first = consumeSearchRequest();
    expect(first.allowed).toBe(true);
    expect(first.used).toBe(1);
    expect(first.limit).toBe(3);
    expect(searchBudgetState().remaining).toBe(2);
  });

  it('用满即拒，且**被拒的请求不推高数字**', () => {
    consumeSearchRequest();
    consumeSearchRequest();
    consumeSearchRequest();

    const blocked = consumeSearchRequest();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('额度已用完');
    // 再拒几次，已用数不变（否则恢复窗口会被自己的重试无限延后）
    consumeSearchRequest();
    expect(searchBudgetState().used).toBe(3);
    expect(searchBudgetState().remaining).toBe(0);
  });

  it('跨天自动重置', () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    consumeSearchRequest(1, now);
    consumeSearchRequest(1, now);
    expect(searchBudgetState(now).used).toBe(2);

    const tomorrow = now + DAY;
    const decision = consumeSearchRequest(1, tomorrow);
    expect(decision.allowed).toBe(true);
    expect(searchBudgetState(tomorrow).used).toBe(1);
  });

  it('默认上限是 900（不写死在业务里）', () => {
    delete process.env.APP_MAX_SEARCHES_PER_DAY;
    resetSearchBudgetForTests();
    expect(searchBudgetState().limit).toBe(900);
  });
});

describe('套在检索函数上', () => {
  it('额度没满时原样透传', async () => {
    const inner: ExperienceSearch = async () => [
      {
        id: 's1',
        author: '答主',
        title: null,
        authorBadge: null,
        quote: '一段真实的经历。',
        upvotes: 1,
        url: 'https://www.zhihu.com/answer/1',
        retrievedAt: '2026-09-16T00:00:00.000Z',
        status: 'verified',
        editTime: 1_700_000_000,
        authority: 1,
      },
    ];
    const wrapped = withSearchBudget(inner);

    const found = await wrapped('电工 导游 亲身经历');
    expect(found).toHaveLength(1);
    expect(searchBudgetState().used).toBe(1);
  });

  it('额度用尽时抛类型化错误，而不是返回空数组', async () => {
    const wrapped = withSearchBudget(async () => []);
    consumeSearchRequest();
    consumeSearchRequest();
    consumeSearchRequest();

    await expect(wrapped('任何查询')).rejects.toBeInstanceOf(SearchBudgetExhaustedError);
  });

  it('isSearchBudgetExhausted 只认这一种错误', () => {
    expect(isSearchBudgetExhausted(new SearchBudgetExhaustedError(1))).toBe(true);
    expect(isSearchBudgetExhausted(Object.assign(new Error('x'), { code: 'search-budget-exhausted' }))).toBe(true);
    expect(isSearchBudgetExhausted(new Error('network'))).toBe(false);
    expect(isSearchBudgetExhausted(null)).toBe(false);
  });
});
