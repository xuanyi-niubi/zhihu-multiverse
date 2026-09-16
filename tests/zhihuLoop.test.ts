import { describe, expect, it } from 'vitest';

import {
  LOOP_STATEMENT,
  worldlineCardOf,
  worldlineCode,
  zhihuHrefFor,
  type WorldlineCardInput,
} from '@/features/zhihu-loop/worldlineCard';

/**
 * 知乎内容飞回路的契约。
 *
 * ## 这一层为什么必须有测试
 *
 * 它是产品的**出口**：之前所有版本到终局就断了 —— 从知乎取，不回知乎给。
 * 而"回到知乎写回答"这条链路最容易犯的错，恰好会毁掉这个产品最硬的招牌：
 *
 * 1. **替玩家写他自己的经历** —— 草稿里出现一句"我脱产备考了三个月"，
 *    他会真的把它粘到知乎上。那不是编一条来源，那是让他去发一条假经历。
 * 2. **把未经核验的自述当成经验来源** —— 一旦如此，`exactQuote` 逐字可溯源
 *    就不再成立。
 *
 * 所以这里锁死：**个人四栏留白、只预填有出处的真实数据、闭环靠知乎自身闭合**。
 */

const BASE: WorldlineCardInput = {
  sessionId: 's-7f3a91c2ab',
  originalQuestion: '大三法学，想转计算机，但怕脱产以后找不到工作',
  rewrittenQuestion: '你未来两周能稳定拿出多少时间',
  walked: ['法学背景转计算机结合方向', '自学技术做项目积累经验', '以法学背景求职技术岗'],
  taken: [{ quote: '我打算先系统学一遍', author: '某答主', sourceUrl: 'https://www.zhihu.com/a/1' }],
  borrowed: [{ quote: '带团三年全靠自己发内容', author: '另一位', sourceUrl: 'https://www.zhihu.com/a/2' }],
  costs: [{ quote: '脱产那半年几乎没有收入', author: '某答主', sourceUrl: 'https://www.zhihu.com/a/3' }],
  counter: { quote: '后来我放弃了这条路', author: '第三个', sourceUrl: 'https://www.zhihu.com/a/4' },
  unknown: '你未来两周能稳定拿出多少时间',
  realityPass: {
    timebox: '未来 7 天',
    action: '找一位已转行的前辈聊 20 分钟',
    successSignal: '对方说出了具体的第一次行动',
    stopSignal: '对方只给泛泛建议',
  },
  highlights: ['有人真的这样走过：法学背景转计算机结合方向'],
};

describe('世界线存档卡', () => {
  it('卡号稳定：同 sessionId 必得同卡号', () => {
    expect(worldlineCode('s-7f3a91c2ab')).toBe(worldlineCode('s-7f3a91c2ab'));
    expect(worldlineCode('s-7f3a91c2ab')).toMatch(/^WL-[a-z0-9]{8}$/);
    expect(worldlineCode('')).toBe('WL-00000000');
  });

  it('存档卡里的一切都有出处：走过的路、逐字引用、答主、原文链接', () => {
    const card = worldlineCardOf(BASE);
    expect(card.archiveText).toContain('大三法学，想转计算机');
    for (const path of BASE.walked) {
      expect(card.archiveText).toContain(path);
    }
    expect(card.archiveText).toContain('我打算先系统学一遍');
    expect(card.archiveText).toContain('某答主');
    expect(card.archiveText).toContain('https://www.zhihu.com/a/1');
    expect(card.archiveText).toContain('后来我放弃了这条路');
    expect(card.archiveText).toContain('未来 7 天');
  });

  it('没有数据就不写那一项 —— 不为了填满卡片编内容', () => {
    const empty = worldlineCardOf({
      ...BASE,
      walked: [],
      taken: [],
      borrowed: [],
      costs: [],
      counter: null,
      realityPass: null,
      highlights: [],
      rewrittenQuestion: null,
      unknown: null,
    });
    expect(empty.archiveText).toContain('没有引用到真实经历');
    expect(empty.archiveText).toContain('没有收敛出新的未知');
    expect(empty.archiveText).not.toContain('撞见的反例');
    expect(empty.archiveText).not.toContain('带回现实的支线');
    expect(empty.counter).toBeNull();
    expect(empty.unknown).toBeNull();
  });

  it('写作草稿的个人四栏必须留白 —— 不许替玩家写他自己的经历', () => {
    const card = worldlineCardOf(BASE);
    // 四栏标签在，且后面紧跟的是提示语而不是内容
    expect(card.draftText).toContain('我的处境：（');
    expect(card.draftText).toContain('我做了什么：（');
    expect(card.draftText).toContain('我付出的代价：（');
    expect(card.draftText).toContain('后来怎么样：（');
    // 关键：别人的逐字经历绝不能被写进"我的"那几栏
    const personal = card.draftText.split('我还没有弄清')[0];
    for (const cited of ['我打算先系统学一遍', '带团三年全靠自己发内容', '脱产那半年几乎没有收入']) {
      expect(personal, `个人栏里混进了别人的经历：${cited}`).not.toContain(cited);
    }
  });

  it('草稿只预填系统真的知道的：他的问题 + 本局收敛的未知', () => {
    const card = worldlineCardOf(BASE);
    expect(card.draftText).toContain('大三法学，想转计算机');
    expect(card.draftText).toContain('你未来两周能稳定拿出多少时间');
  });

  it('带出处引导：知乎入口是按问题检索，不是伪造的 deep link', () => {
    const card = worldlineCardOf(BASE);
    expect(card.zhihuHref.startsWith('https://www.zhihu.com/search?')).toBe(true);
    expect(card.zhihuHref).toContain(encodeURIComponent(BASE.originalQuestion));
    expect(zhihuHrefFor('  空白  ')).toContain(encodeURIComponent('空白'));
  });

  it('闭环说明必须出现 —— 这一句就是「为知乎生态创造价值」的可读版本', () => {
    const card = worldlineCardOf(BASE);
    expect(card.loopStatement).toBe(LOOP_STATEMENT);
    expect(card.draftText).toContain(LOOP_STATEMENT);
    // 明确写出"经核验后" —— 不能暗示未经核验的自述会直接变成来源
    expect(LOOP_STATEMENT).toContain('核验');
  });
});
