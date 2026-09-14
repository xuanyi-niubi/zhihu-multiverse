import { describe, expect, it } from 'vitest';

import {
  actAtmosphereOf,
  archiveFragments,
  compileHeadline,
  fragmentTrackOf,
  questionMorphOf,
  roleTrackOf,
} from '@/features/visual/archive';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 档案馆纯函数层的契约（报告 §8 / §24 / §26）。
 *
 * 这些断言只锁**判断**，不锁样式：视觉组件可以随便重画，
 * 但「一条反例不能被当成相似经历」「问题没变就不能假装变了」是产品事实。
 */

function fact(
  id: string,
  exactQuote: string,
  purposes: ExperienceFact['purposes'],
): ExperienceFact {
  return {
    id,
    sourceId: `s-${id}`,
    sourceUrl: `https://www.zhihu.com/answer/${id}`,
    author: '答主',
    exactQuote,
    type: 'action',
    relevance: 1,
    purposes,
  };
}

describe('fragmentTrackOf：三轨归类', () => {
  it('反例优先于相似（失败经历不能被轻描淡写成「与你相似」）', () => {
    expect(fragmentTrackOf(['similar-person', 'counterexample'])).toBe('counter');
    expect(fragmentTrackOf(['similar-person', 'failure'])).toBe('counter');
  });

  it('另一种走法优先于相似', () => {
    expect(fragmentTrackOf(['similar-person', 'alternative'])).toBe('alternative');
  });

  it('三类意图都没有时返回 null，不硬塞进任何轨道', () => {
    expect(fragmentTrackOf(['cost', 'outcome'])).toBeNull();
    expect(fragmentTrackOf([])).toBeNull();
  });
});

describe('archiveFragments：切片上墙', () => {
  it('按固定轨道顺序返回，每轨带自己的切片', () => {
    const groups = archiveFragments([
      fact('a', '我大二的时候也……', ['similar-person']),
      fact('b', '后来我换了一条路。', ['alternative']),
      fact('c', '最后我没能坚持下来。', ['counterexample']),
    ]);
    expect(groups.map((group) => group.track)).toEqual(['similar', 'alternative', 'counter']);
    expect(groups.map((group) => group.items.length)).toEqual([1, 1, 1]);
  });

  it('丢空引文、按 id 去重、每轨截断', () => {
    const groups = archiveFragments(
      [
        fact('dup', '同一段经历', ['similar-person']),
        fact('dup', '同一段经历', ['similar-person']),
        fact('blank', '   ', ['similar-person']),
        fact('e1', '一', ['similar-person']),
        fact('e2', '二', ['similar-person']),
      ],
      2,
    );
    const similar = groups.find((group) => group.track === 'similar')!;
    expect(similar.items.map((item) => item.id)).toEqual(['dup', 'e1']);
  });

  it('保留可回溯信息（作者 + 原文链接）', () => {
    const groups = archiveFragments([fact('a', '一段话', ['similar-person'])]);
    expect(groups[0].items[0].sourceUrl).toBe('https://www.zhihu.com/answer/a');
    expect(groups[0].items[0].author).toBe('答主');
  });

  it('离线数据没有 purposes 时，可用蓝图证据角色分轨（仍是真实标注）', () => {
    const facts = [
      fact('s1', '我就是这样走过来的', []),
      fact('c1', '最后我没能坚持下来', []),
      fact('x1', '代价是整整一年', []),
    ];
    const roleOf: Readonly<Record<string, 'support' | 'cost' | 'counterexample'>> = {
      s1: 'support',
      c1: 'counterexample',
      x1: 'cost',
    };
    const groups = archiveFragments(facts, 5, (f) => roleTrackOf(roleOf[f.id]));
    const similar = groups.find((group) => group.track === 'similar')!;
    const counter = groups.find((group) => group.track === 'counter')!;
    const alternative = groups.find((group) => group.track === 'alternative')!;
    expect(similar.items.map((item) => item.id)).toEqual(['s1']);
    expect(counter.items.map((item) => item.id)).toEqual(['c1']);
    // cost 属于主路径内部信息，不冒充「另一种走法」
    expect(alternative.items).toHaveLength(0);
  });
});

describe('roleTrackOf：证据角色 → 显示轨道', () => {
  it('support → 相似，counterexample → 相反', () => {
    expect(roleTrackOf('support')).toBe('similar');
    expect(roleTrackOf('counterexample')).toBe('counter');
  });

  it('cost / reflection / undefined 不冒充独立轨道', () => {
    expect(roleTrackOf('cost')).toBeNull();
    expect(roleTrackOf('reflection')).toBeNull();
    expect(roleTrackOf(undefined)).toBeNull();
  });
});

describe('compileHeadline：编译页只说真实阶段', () => {
  it('ready → WORLD READY', () => {
    expect(compileHeadline('ready', 3)).toBe('WORLD READY');
  });

  it('assembling 时把真实命中数说进去', () => {
    expect(compileHeadline('assembling', 4)).toContain('4');
  });

  it('searching 时只说在找人，不给假进度', () => {
    expect(compileHeadline('searching', 0)).not.toMatch(/%|进度/);
  });
});

describe('questionMorphOf：问题有没有真的变清楚', () => {
  it('改写后与原文不同才算 changed', () => {
    expect(questionMorphOf('我要不要参加比赛？', '我能不能连续两周稳定投入 8 小时？').changed).toBe(true);
  });

  it('没有新问题或与原文相同 → 不假装收敛', () => {
    expect(questionMorphOf('我要不要参加比赛？', null).changed).toBe(false);
    expect(questionMorphOf('我要不要参加比赛？', '   ').changed).toBe(false);
    expect(questionMorphOf('我要不要参加比赛？', '我要不要参加比赛？').changed).toBe(false);
  });
});

describe('actAtmosphereOf：三幕氛围由目标推导', () => {
  it('走进来冷蓝、代价更近、反例分叉、终局极静', () => {
    expect(actAtmosphereOf('enter-world')).toBe('cold');
    expect(actAtmosphereOf('experience-cost')).toBe('close');
    expect(actAtmosphereOf('meet-counterexample')).toBe('fork');
  });

  it('结束态永远是 still，与幕目标无关', () => {
    expect(actAtmosphereOf('meet-counterexample', true)).toBe('still');
  });
});
