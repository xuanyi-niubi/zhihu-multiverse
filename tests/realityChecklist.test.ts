import { describe, expect, it } from 'vitest';

import {
  CHECKLIST_MAX,
  buildRealityChecklist,
  type ChecklistInput,
  type ChecklistSource,
} from '@/features/run/realityChecklist';

/**
 * 《现实破壁清单》的红线：
 * **`verified` 只可能来自真实来源。** 剧本文案（`scripted`）进不了这一档 ——
 * 它没有作者、没有赞同数、没有抓取时间，拿它冒充站内建议就是伪造证据链。
 *
 * 另外三条：可执行（祈使句 + 时间盒 + 可验证信号）、去重限量、同一局必得同一份。
 */

const SCRIPTED: ChecklistSource = {
  id: 'law-to-cs:t1',
  quote: '转码最大的成本不是学不会，是你在能学会之前就先耗光了心气',
  status: 'scripted',
};

const VERIFIED: ChecklistSource = {
  id: 'law-to-cs:t2',
  quote: '简历不是把经历写得好看，是让面试官一眼看到你能解决什么问题，投递前先改三行',
  status: 'verified',
  url: 'https://www.zhihu.com/question/1/answer/2',
  author: '秋招上岸的学姐',
  upvotes: 9421,
  retrievedAt: '2026-09-11T00:00:00.000Z',
};

const BASE: ChecklistInput = {
  goal: '双非本科怎么冲大厂实习',
  choices: ['按部就班刷题，先把八股背熟', '老老实实补一个完整项目'],
  outcome: 'failure',
  sources: [SCRIPTED],
};

describe('基本形态', () => {
  it('每条都带祈使句动作、时间盒与可验证信号', () => {
    const { items } = buildRealityChecklist(BASE);

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.action.trim().length).toBeGreaterThan(6);
      expect(item.timeBox.trim().length).toBeGreaterThan(0);
      expect(item.verifySignal.trim().length).toBeGreaterThan(6);
      expect(item.id.startsWith('cl-')).toBe(true);
    }
  });

  it('限量：再多触发词也不超过上限', () => {
    const { items } = buildRealityChecklist({
      ...BASE,
      choices: ['项目', '投递简历', '调剂上岸', '家里沟通', '兼职的钱', '通宵熬夜伤了身体'],
      bossIssues: ['没有写退路', '缺少时间单位', '没引用片段'],
    });

    expect(items.length).toBeLessThanOrEqual(CHECKLIST_MAX);
  });

  it('按动作去重', () => {
    const { items } = buildRealityChecklist({
      ...BASE,
      choices: ['补项目', '补个项目', '项目经验'],
    });

    const actions = items.map((item) => item.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('判卷点出的缺口会变成待补条目', () => {
    const { items } = buildRealityChecklist({
      ...BASE,
      bossIssues: ['没有用上本局给出的知乎片段'],
    });

    expect(items.some((item) => item.action.includes('没有用上本局给出的知乎片段'))).toBe(true);
  });

  it('没有触发词时仍给兜底条目（按结局不同）', () => {
    const failed = buildRealityChecklist({ ...BASE, choices: [], outcome: 'failure' });
    const succeeded = buildRealityChecklist({ ...BASE, choices: [], outcome: 'success' });

    expect(failed.items.length).toBeGreaterThan(0);
    expect(failed.items[0].action).not.toBe(succeeded.items[0].action);
  });
});

describe('来源真实性（红线）', () => {
  it('**只有 scripted 来源时，一条都不能标 verified**', () => {
    const result = buildRealityChecklist(BASE);

    expect(result.verifiedCount).toBe(0);
    expect(result.fallbackCount).toBe(result.items.length);
    for (const item of result.items) {
      expect(item.sourceStatus).toBe('fallback');
      expect(item.sourceId).toBeNull();
      expect(item.evidence).toBeNull();
      expect(item.sourceUrl).toBeUndefined();
    }
  });

  it('绑上真实来源时给出答主 / 赞同数 / 链接 / 抓取时间', () => {
    const result = buildRealityChecklist({ ...BASE, sources: [SCRIPTED, VERIFIED] });

    const bound = result.items.find((item) => item.sourceStatus === 'verified');
    expect(bound).toBeDefined();
    expect(bound?.sourceId).toBe('law-to-cs:t2');
    expect(bound?.sourceAuthor).toBe('秋招上岸的学姐');
    expect(bound?.sourceUpvotes).toBe(9421);
    expect(bound?.sourceUrl).toContain('https://');
    expect(bound?.sourceRetrievedAt).toBe('2026-09-11T00:00:00.000Z');
    expect(bound?.evidence?.length).toBeGreaterThan(0);
    expect(result.verifiedCount).toBe(1);
  });

  it('来源与建议没有实际重合时不会硬绑', () => {
    const unrelated: ChecklistSource = {
      id: 'x:t1',
      quote: '完全无关的一段关于摄影构图的内容',
      status: 'verified',
      url: 'https://www.zhihu.com/question/9/answer/9',
      author: '摄影师',
      retrievedAt: '2026-09-11T00:00:00.000Z',
    };

    const result = buildRealityChecklist({ ...BASE, sources: [unrelated] });
    expect(result.verifiedCount).toBe(0);
  });

  it('空引文的「认证来源」不算数', () => {
    const empty: ChecklistSource = { id: 'e:t1', quote: '   ', status: 'verified' };
    expect(buildRealityChecklist({ ...BASE, sources: [empty] }).verifiedCount).toBe(0);
  });

  it('文案里不出现百分比/统计口吻（那是上一轮清掉的东西）', () => {
    const { items } = buildRealityChecklist({ ...BASE, sources: [SCRIPTED, VERIFIED] });

    for (const item of items) {
      expect(/%/.test(item.action)).toBe(false);
      expect(/%/.test(item.verifySignal)).toBe(false);
    }
  });
});

describe('确定性', () => {
  it('同一局输入重放 20 次得到同一份清单（含顺序与指纹）', () => {
    const first = JSON.stringify(buildRealityChecklist({ ...BASE, sources: [SCRIPTED, VERIFIED] }));

    for (let index = 0; index < 20; index += 1) {
      expect(JSON.stringify(buildRealityChecklist({ ...BASE, sources: [SCRIPTED, VERIFIED] }))).toBe(first);
    }
  });

  it('结局或来源变化会改变指纹', () => {
    const a = buildRealityChecklist({ ...BASE, outcome: 'failure' });
    const b = buildRealityChecklist({ ...BASE, outcome: 'success' });
    const c = buildRealityChecklist({ ...BASE, sources: [VERIFIED] });

    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('指纹是 16 位十六进制', () => {
    expect(buildRealityChecklist(BASE).hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
