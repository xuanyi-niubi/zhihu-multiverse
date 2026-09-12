import { describe, expect, it } from 'vitest';

import { validateExtractedFact } from '@/features/experience/validate';

import type { ExperienceFactType } from '@/features/experience/domain';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 片段逐字完整性（Phase 6 / P0-D 的诚信底线）。
 *
 * 这组负例守的是一句话：
 *
 * > **AI 改写过的句子，永远不能冒充原文。**
 */

const SOURCE: KnowledgeSource = {
  id: 'live:integrity-1',
  author: '某位走过这条路的人',
  quote: '我当时大二，基础一般，边上课边准备比赛，每周大概花十个小时，最后拿了省二。',
  upvotes: 321,
  url: 'https://www.zhihu.com/question/9/answer/1',
  retrievedAt: '2026-09-01T00:00:00.000Z',
  status: 'verified',
  editTime: 1756684800,
  authority: 3,
};

function validate(exactQuote: string, type: ExperienceFactType = 'action') {
  return validateExtractedFact({ source: SOURCE, exactQuote, type });
}

describe('逐字子串判定', () => {
  it('原文中段的逐字片段 → 通过', () => {
    const fact = validate('边上课边准备比赛，每周大概花十个小时', 'cost');
    expect(fact).not.toBeNull();
    expect(fact!.sourceId).toBe(SOURCE.id);
    expect(fact!.exactQuote).not.toContain('\n');
  });

  it('整个原文当作片段 → 通过（fall back 路径就是这么走的）', () => {
    expect(validate(SOURCE.quote, 'reflection')).not.toBeNull();
  });

  it('改一个字 → 拒绝', () => {
    expect(validate('边上课边准备考试，每周大概花十个小时')).toBeNull();
  });

  it('改动标点 → 拒绝（不许「自动修标点」强行命中）', () => {
    expect(validate('边上课边准备比赛，每周大概花十个小时。', 'cost')).toBeNull();
  });

  it('删字后再拼回去的「近似句」→ 拒绝', () => {
    expect(validate('边上课准备比赛每周大概花十个小时')).toBeNull();
  });

  it('首尾空白 → 允许（trim 后仍是逐字子串）', () => {
    expect(validate('  边上课边准备比赛，每周大概花十个小时  ', 'cost')).not.toBeNull();
  });

  it('不在原文里的句子 → 拒绝', () => {
    expect(validate('建议先找一份实习再说，比赛不重要。')).toBeNull();
  });
});

describe('长度下限', () => {
  it('短于 12 字 → 拒绝（太短无法独立成经验）', () => {
    expect(validate('边上课边准备')).toBeNull();
  });

  it('恰好 12 字 → 通过', () => {
    const twelve = '边上课边准备比赛，每周大';
    expect([...twelve].length).toBe(12);
    expect(validate(twelve, 'cost')).not.toBeNull();
  });
});

describe('来源与类型门槛', () => {
  it('scripted 来源 → 拒绝（哪怕逐字）', () => {
    const result = validateExtractedFact({
      source: { ...SOURCE, status: 'scripted' },
      exactQuote: SOURCE.quote,
      type: 'action',
    });
    expect(result).toBeNull();
  });

  it('非法类型 → 拒绝', () => {
    const result = validateExtractedFact({
      source: SOURCE,
      exactQuote: '边上课边准备比赛',
      // @ts-expect-error 故意传入非法类型，运行时必须兜住
      type: 'success-rate',
    });
    expect(result).toBeNull();
  });
});
