import { describe, expect, it } from 'vitest';

import { caseSources } from '@/data/demoCases';
import { clusterPaths, detectProblemType, routeLabelsFor } from '@/features/decision-session/routes';
import {
  explicitValueIn,
  factTypeOf,
  relevanceOf,
  toEvidenceFacts,
} from '@/features/decision-session/facts';
import { observationOf, unknownClaim } from '@/features/decision-session/domain';

import type { EvidenceFact } from '@/features/decision-session/domain';

/**
 * DecisionSession 的契约测试（重构方案 §5 / §13）。
 *
 * 这组测试守的是**本方案最重要的两条纪律**：
 *
 * 1. **路径必须属于当前问题**。旧版本对「大二参加比赛」显示「在职转型 / 平级跳板」，
 *    用户会立刻质疑内容与问题无关（方案 §1.2 实测）。这是 P0 第一条要修的东西。
 * 2. **不许从轶事推导精度**。旧链路为单点时长生成 ±20% 浮动范围，
 *    再把样本上沿变成用户的硬门槛（方案 §7.3 点名要删）。
 */

const SOPHOMORE_QUESTION = '大二基础一般，要不要参加这次比赛？';
const SOPHOMORE_SOURCES = caseSources('demo-sophomore');

/** 旧版本会出现的职业转型类标签 —— 它们绝不能出现在比赛类问题里。 */
const CAREER_LABELS = ['脱产转型', '在职转型', '跨行换赛道', '原地深耕', '平级跳板', '求稳路线', '先缓一缓'];

describe('问题类型判定', () => {
  it('比赛类问题被识别为 competition', () => {
    expect(detectProblemType(SOPHOMORE_QUESTION)).toBe('competition');
  });

  it('四类目标问题都能被识别（方案 §2.2 的首版范围）', () => {
    expect(detectProblemType('考研还是直接就业')).toBe('postgrad-or-job');
    expect(detectProblemType('第一份实习应该怎么选')).toBe('first-job');
    expect(detectProblemType('要不要转专业')).toBe('pivot');
  });

  it('**识别不出就返回 null，不兜底成某一类**', () => {
    // 兜底会让「今天天气不错」也被归成「比赛与项目」——那是错配的源头
    expect(detectProblemType('今天天气不错')).toBeNull();
    expect(detectProblemType('')).toBeNull();
    expect(detectProblemType('   ')).toBeNull();
  });

  it('多类型同时命中时取命中数最多的那个', () => {
    // 「考研」+「就业」都属 postgrad-or-job，应稳定归到它
    expect(detectProblemType('考研、就业还是考公，怎么选')).toBe('postgrad-or-job');
  });
});

describe('原文忠实度（方案 §5.1 / §13）', () => {
  it('quote 必须是来源原文的精确片段，不得改写', () => {
    if (SOPHOMORE_SOURCES.length === 0) {
      return;
    }
    const { facts } = toEvidenceFacts({
      sources: SOPHOMORE_SOURCES,
      question: SOPHOMORE_QUESTION,
    });

    for (const fact of facts) {
      const source = SOPHOMORE_SOURCES.find((item) => item.id === fact.sourceId);
      expect(source).toBeDefined();
      // 事实文本必须能在原来源里逐字找到
      expect(source?.quote).toBe(fact.quote);
    }
  });

  it('只有 verified 来源能进入事实层', () => {
    const mixed = [
      ...SOPHOMORE_SOURCES,
      {
        id: 'scripted-1',
        author: '伪造',
        quote: '这是一条剧本里写死的引用',
        upvotes: null,
        url: 'https://www.zhihu.com/question/1/answer/1',
        retrievedAt: '2026-09-12T00:00:00.000Z',
        status: 'scripted' as const,
        editTime: null,
        authority: null,
      },
    ];
    const { facts } = toEvidenceFacts({ sources: mixed, question: SOPHOMORE_QUESTION });
    expect(facts.some((fact) => fact.sourceId === 'scripted-1')).toBe(false);
  });

  it('来源 id 与 url 被完整带出（可点回原回答）', () => {
    if (SOPHOMORE_SOURCES.length === 0) {
      return;
    }
    const { facts } = toEvidenceFacts({ sources: SOPHOMORE_SOURCES, question: SOPHOMORE_QUESTION });
    for (const fact of facts) {
      expect(fact.sourceUrl).toMatch(/^https?:\/\//);
      expect(fact.sourceId.length).toBeGreaterThan(0);
    }
  });
});

describe('不许从轶事推导精度（方案 §7.3 点名删除）', () => {
  it('**单点时长不再生成浮动范围**：explicitValue 是原文措辞，不是区间', () => {
    // 原文写「两个月」→ 只记「两个月」，绝不产出「1.6–2.4 个月」
    expect(explicitValueIn('前后花了两个月才上手')).toBe('两个月');
    // 原文本来写了区间 → 保留原文的区间写法
    expect(explicitValueIn('大概 2-3 个月能出结果')).toBe('2-3个月');
  });

  it('原文没有数值时返回 undefined（展示层会标「待验证」，不填空）', () => {
    expect(explicitValueIn('主要还是看个人的投入程度')).toBeUndefined();
    expect(explicitValueIn('坚持下来就有收获')).toBeUndefined();
  });

  /**
   * **实测踩到的 bug**：初版把日期与时长混在一起匹配，于是
   * 「2025年11月14日09:00-11月18日10:00举行」被提取成 `00-11月`、
   * 「一般每年的一月份」被提取成 `一月` —— 把**日期**当成了**时长**。
   *
   * 这正是方案 §1.2 点名要消灭的伪精确。这组用例把它钉死。
   */
  it('日期与时刻不得被当成时长', () => {
    expect(explicitValueIn('2025年11月14日09:00-11月18日10:00举行')).toBeUndefined();
    expect(explicitValueIn('11月14日开始')).toBeUndefined();
    expect(explicitValueIn('2021年高教社杯数学建模竞赛')).toBeUndefined();
  });

  it('月份名不得被当成时长（「每年的一月份」不是「一个月」）', () => {
    expect(explicitValueIn('一般每年的一月份，大部分赛题公布并开始报名')).toBeUndefined();
    expect(explicitValueIn('报名截止在三月中旬')).toBeUndefined();
  });

  it('真正的时长仍能被正确提取（修 bug 不能把功能修没）', () => {
    expect(explicitValueIn('前后花了两个月才上手')).toBe('两个月');
    expect(explicitValueIn('大概 2-3 个月能出结果')).toBe('2-3个月');
    expect(explicitValueIn('花了半年时间准备')).toBe('半年');
    expect(explicitValueIn('我用了两年半才转过来')).toBe('两年半');
  });

  it('事实里不会出现推导出的小数或百分比区间', () => {
    if (SOPHOMORE_SOURCES.length === 0) {
      return;
    }
    const { facts } = toEvidenceFacts({ sources: SOPHOMORE_SOURCES, question: SOPHOMORE_QUESTION });
    for (const fact of facts) {
      if (fact.explicitValue) {
        // 不允许出现「1.6 个月」这类由代码算出来的精度
        expect(fact.explicitValue).not.toMatch(/\d+\.\d/);
      }
    }
  });

  it('事实类型只取五种合法值之一', () => {
    const legal = ['action', 'condition', 'cost', 'outcome', 'opinion'];
    expect(legal).toContain(factTypeOf('我建议先做项目'));
    expect(legal).toContain(factTypeOf('当时我大二，基础一般'));
    expect(legal).toContain(factTypeOf('花了半年时间'));
    expect(legal).toContain(factTypeOf('最后上岸了'));
    expect(legal).toContain(factTypeOf('参加了一个比赛'));
  });
});

describe('路径属于当前问题（P0 第一条验收）', () => {
  const built = (() => {
    const { facts } = toEvidenceFacts({ sources: SOPHOMORE_SOURCES, question: SOPHOMORE_QUESTION });
    return { facts, result: clusterPaths({ question: SOPHOMORE_QUESTION, facts, type: 'competition' }) };
  })();

  it('**比赛类问题绝不出现职业转型类路径标签**', () => {
    const labels = built.result.clusters.map((cluster) => cluster.label);
    for (const career of CAREER_LABELS) {
      expect(labels).not.toContain(career);
    }
  });

  it('路径标签来自比赛类问题的走法表，而不是全局职业路径', () => {
    const allowed = routeLabelsFor('competition');
    for (const cluster of built.result.clusters) {
      expect(allowed).toContain(cluster.label);
    }
  });

  it('每条路径都至少有一条真实支持事实（不生成空壳路径）', () => {
    for (const cluster of built.result.clusters) {
      expect(cluster.supportingFactIds.length).toBeGreaterThan(0);
    }
  });

  it('每条路径都带「仍未知的问题」（方案 §3.1 第四步的核心输出）', () => {
    for (const cluster of built.result.clusters) {
      expect(cluster.unknowns.length).toBeGreaterThan(0);
    }
  });

  it('证据不足的走法被如实列出，而不是悄悄删掉', () => {
    // 有证据的走法 + 证据不足的走法 = 该问题类型的全部走法
    const withEvidence = built.result.clusters.length;
    const withoutEvidence = built.result.insufficientRoutes.length;
    expect(withEvidence + withoutEvidence).toBe(routeLabelsFor('competition').length);
  });

  it('聚类确定性：同输入必得同输出', () => {
    const again = clusterPaths({
      question: SOPHOMORE_QUESTION,
      facts: built.facts,
      type: 'competition',
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(built.result));
  });

  it('相关性过滤真的会滤掉不相关来源（并可统计过滤数）', () => {
    const strict = toEvidenceFacts({
      sources: SOPHOMORE_SOURCES,
      question: SOPHOMORE_QUESTION,
      minRelevance: 0.35,
    });
    expect(strict.filteredCount).toBeGreaterThan(0);
    expect(strict.facts.length).toBeLessThan(SOPHOMORE_SOURCES.length);
  });
});

describe('可信度语言（方案 §4.3）', () => {
  it('样本观察用「在当前 N 条中，有 M 人」的口吻，并声明样本局限', () => {
    const claim = observationOf({ totalFacts: 4, mentionCount: 3, subject: '时间不够' });
    expect(claim.kind).toBe('sample-observation');
    expect(claim.text).toContain('在当前 4 条可核对经历中');
    expect(claim.text).toContain('有 3 人提到时间不够');
    // 必须声明局限性，否则它会被读成普遍规律
    expect(claim.text).toContain('不能视为你的预计情况');
  });

  it('信息缺口是待验证，且不填空', () => {
    const claim = unknownClaim('每周 8 小时是否足以完成最小作品');
    expect(claim.kind).toBe('unknown');
    expect(claim.text).toContain('每周 8 小时');
  });

  it('**展示层不允许出现裁决式措辞**', () => {
    const banned = ['可行', '不可行', '成功概率', '还差', '至少需要'];
    const texts = [
      observationOf({ totalFacts: 3, mentionCount: 2, subject: '这件事' }).text,
      unknownClaim('某个未知').text,
    ];
    for (const text of texts) {
      for (const word of banned) {
        expect(text).not.toContain(word);
      }
    }
  });
});

describe('相关性只用于排序，不用于判断真伪', () => {
  it('返回 0..1 之间的稳定值', () => {
    const value = relevanceOf('大二参加比赛', '大二的时候我参加了一个比赛，很累');
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
    expect(relevanceOf('大二参加比赛', '大二的时候我参加了一个比赛，很累')).toBe(value);
  });

  it('空问题返回 0（不产生虚假相关性）', () => {
    expect(relevanceOf('', '任何文本')).toBe(0);
  });
});

describe('事实层与领域模型的类型一致性', () => {
  it('事实对象形状完整', () => {
    if (SOPHOMORE_SOURCES.length === 0) {
      return;
    }
    const { facts } = toEvidenceFacts({ sources: SOPHOMORE_SOURCES, question: SOPHOMORE_QUESTION });
    const fact: EvidenceFact | undefined = facts[0];
    expect(fact).toBeDefined();
    if (!fact) return;
    expect(typeof fact.id).toBe('string');
    expect(typeof fact.retrievedAt).toBe('string');
    expect(fact.relevance).toBeGreaterThanOrEqual(0);
  });
});
