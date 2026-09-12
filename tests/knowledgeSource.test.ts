import { describe, expect, it } from 'vitest';

import { allVerifiedSources, getVerifiedSource, verifiedSourceCount } from '@/data/knowledgeSources';
import { PREBUILT_SCENARIOS } from '@/data/prebuiltScenarios';
import {
  isVerifiedSource,
  normalizeKnowledgeSource,
  sourceBadgeLabel,
} from '@/features/run/knowledgeSource';

/**
 * 「不许编数字」的执行点测试。
 *
 * 起因：预置剧本里曾写着 `知乎高赞 9,421`（9421/6733/12870/4102 全是手写占位值），
 * 对外宣称了并不存在的社区数据。现在规则是：
 * **只有 verified 来源能出现数字；没有真数据就说「剧本模拟引用」。**
 */

const DIGITS = /[0-9]/;

describe('sourceBadgeLabel', () => {
  it('verified + 赞同数 → 显示真实数字', () => {
    const badge = sourceBadgeLabel({ status: 'verified', upvotes: 9421 });

    expect(badge.tone).toBe('verified');
    expect(badge.label).toBe('知乎高赞 9,421');
  });

  it('verified 但接口没给赞同数 → 只说「知乎来源」，不编数字', () => {
    const badge = sourceBadgeLabel({ status: 'verified', upvotes: null });

    expect(badge.label).toBe('知乎来源');
    expect(DIGITS.test(badge.label)).toBe(false);
  });

  it('scripted → 「剧本模拟引用」，文案里不含任何数字', () => {
    for (const input of [
      { status: 'scripted' as const },
      { status: 'scripted' as const, upvotes: 9421 },
      { upvotes: 9421 },
      {},
    ]) {
      const badge = sourceBadgeLabel(input);
      expect(badge.label).toBe('剧本模拟引用');
      expect(badge.tone).toBe('scripted');
      expect(DIGITS.test(badge.label)).toBe(false);
    }
  });

  it('异常赞同数（NaN / 0 / 负数）一律不进文案', () => {
    for (const value of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      const badge = sourceBadgeLabel({ status: 'verified', upvotes: value });
      expect(DIGITS.test(badge.label)).toBe(false);
      expect(badge.label).toBe('知乎来源');
    }
  });
});

describe('isVerifiedSource', () => {
  it('只有显式 verified 才算', () => {
    expect(isVerifiedSource({ status: 'verified' })).toBe(true);
    expect(isVerifiedSource({ status: 'scripted' })).toBe(false);
    expect(isVerifiedSource({})).toBe(false);
    expect(isVerifiedSource(null)).toBe(false);
  });
});

describe('normalizeKnowledgeSource', () => {
  const base = {
    author: '真实答主',
    quote: '这是一段真实摘录。',
    url: 'https://www.zhihu.com/question/1/answer/2',
    upvotes: 1234,
    retrievedAt: '2026-09-11T00:00:00.000Z',
    status: 'verified',
  };

  it('字段齐全时保留 verified', () => {
    const source = normalizeKnowledgeSource(base, 'fallback-id');

    expect(source?.status).toBe('verified');
    expect(source?.upvotes).toBe(1234);
    expect(source?.id).toBe('fallback-id');
  });

  it('**没有抓取时间的「真实数据」降级为 scripted**（无法核查就不算真实）', () => {
    const source = normalizeKnowledgeSource({ ...base, retrievedAt: '' }, 'id');

    expect(source?.status).toBe('scripted');
  });

  it('非 https 链接 / 缺作者 / 缺摘录直接丢弃', () => {
    expect(normalizeKnowledgeSource({ ...base, url: 'http://x.com' }, 'id')).toBeNull();
    expect(normalizeKnowledgeSource({ ...base, author: '  ' }, 'id')).toBeNull();
    expect(normalizeKnowledgeSource({ ...base, quote: '' }, 'id')).toBeNull();
    expect(normalizeKnowledgeSource(null, 'id')).toBeNull();
  });

  it('长度被钳制（防止把整篇长文塞进角标）', () => {
    const source = normalizeKnowledgeSource({ ...base, quote: 'x'.repeat(500), author: 'y'.repeat(200) }, 'id');

    expect(source?.quote.length).toBe(200);
    expect(source?.author.length).toBe(64);
  });
});

describe('落盘来源（生成物）读取', () => {
  /**
   * 这一组刻意**不假设快照是空的**。
   *
   * 早期写法断言 `verifiedSourceCount() === 0`（「仓库尚未 sync」），
   * 但快照是**运行时会变的产物**：跑过一次 `npm run sync:zhihu` 之后
   * 这个断言必然失败 —— 而失败原因是「数据变好了」，不是代码坏了。
   *
   * 改成断言两种状态都成立的不变量：拿到的每一条都必须是可核查的 verified，
   * 且按 id 反查能拿回同一条。既能守住「不许伪造来源」，又不会因为
   * 真实数据的多寡而红。
   */
  it('verified 来源永远自洽：有 https 链接、有抓取时间、可反查', () => {
    const sources = allVerifiedSources();
    expect(sources.length).toBe(verifiedSourceCount());

    for (const source of sources) {
      expect(source.status).toBe('verified');
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.retrievedAt.length).toBeGreaterThan(0);
      expect(source.author.length).toBeGreaterThan(0);
      expect(getVerifiedSource(source.id)?.id).toBe(source.id);
    }
  });

  it('已知锚点在两种状态下都自洽：要么不存在，要么是一条合法 verified 来源', () => {
    const known = getVerifiedSource('law-to-cs:t1');
    if (known) {
      expect(known.status).toBe('verified');
      // 赞同数只能来自接口：不给就是 null，绝不为 0 或负数
      if (known.upvotes !== null) {
        expect(known.upvotes).toBeGreaterThan(0);
      }
    } else {
      // 没跑过 sync 是**正常态**：调用方据此显示「剧本模拟引用」
      expect(verifiedSourceCount()).toBe(0);
    }
  });

  it('未知 id 与空 id 都安全返回 null', () => {
    expect(getVerifiedSource('does-not-exist')).toBeNull();
    expect(getVerifiedSource(null)).toBeNull();
    expect(getVerifiedSource('')).toBeNull();
  });
});

describe('数据层守卫：预置剧本里不许出现手写数字', () => {
  it('所有 zhihuBullet 都没有 upvotes / answerId，且标记为 scripted', () => {
    const offenders: string[] = [];

    for (const scenario of PREBUILT_SCENARIOS) {
      for (const turn of scenario.turns) {
        const bullet = turn.zhihuBullet as {
          upvotes?: number;
          answerId?: string;
          status?: string;
        };

        if (typeof bullet.upvotes === 'number') {
          offenders.push(`${scenario.id}:t${turn.turnIndex} 手写 upvotes=${bullet.upvotes}`);
        }
        if (typeof bullet.answerId === 'string') {
          offenders.push(`${scenario.id}:t${turn.turnIndex} 手写 answerId=${bullet.answerId}`);
        }
        if (bullet.status !== 'scripted') {
          offenders.push(`${scenario.id}:t${turn.turnIndex} status=${bullet.status ?? '(缺失)'}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('兜底关卡同样不携带数字', () => {
    const bullet = PREBUILT_SCENARIOS[0].turns[0].zhihuBullet as { upvotes?: number };
    expect(typeof bullet.upvotes).toBe('undefined');
  });
});
