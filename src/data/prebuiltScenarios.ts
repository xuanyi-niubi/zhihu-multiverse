import { toModifier, toRatio } from '@/core/brand';

import type { ActCard, CallbackLine, NarrativeBeat } from '@/types/narrative';
import type { TargetStat, ZhihuRelic } from '@/types/game';

/**
 * 离线保底剧本与遗物库。
 *
 * 数据格式刻意与 AI DM 的输出契约保持一致：AI 动态生成的关卡只要满足同样的
 * 结构，就能直接喂给推演舱，无需改 UI。
 */

export interface ScenarioCheck {
  readonly targetStat: TargetStat;
  /** 1..30 的 DC，交给 core/d20 的 toDifficulty 做最终钳制。 */
  readonly difficulty: number;
}

export interface ScenarioOutcome {
  readonly feedback: string;
  readonly statDeltas: Partial<Record<TargetStat, number>>;
  /** 命中 RELIC_LIBRARY 的遗物 id；槽位满时不会掉落。 */
  readonly relicId?: string;
}

export interface ScenarioChoice {
  readonly id: string;
  readonly text: string;
  readonly hint: string;
  /** 省略即稳妥选项（无检定）。 */
  readonly check?: ScenarioCheck;
  /**
   * 选项语义（AI 生成时由情节导演标注）。
   *
   * 引擎按它换算隐藏状态代价（见 `hiddenDeltaForTags`）——这是「AI 的创造力
   * 不破坏平衡性」的落点：语义可以自由创作，代价数值永远由规则表决定。
   * 旧数据不标就按中性处理。
   */
  readonly tags?: {
    readonly moral?: 'good' | 'neutral' | 'dark';
    readonly efficiency?: 'direct' | 'indirect' | 'risky';
    readonly social?: 'ally' | 'neutral' | 'antagonize';
  };
  readonly ghostEchoStat: string;
  /** 是否属于「同辈压力」类事件；出身「保研边缘游侠」的 SAN 易伤只对它生效。 */
  readonly peerPressure?: boolean;
  readonly onSuccess: ScenarioOutcome;
  readonly onFail?: ScenarioOutcome;
  /**
   * 经验解锁标记（P0-H）：这个选项由一条真实知乎经验解锁而来。
   * 预置剧本不带此字段 —— 所有旧数据零修改。
   */
  readonly experienceUnlockId?: string;
  /** 解锁该选项的真实经验片段 id（可回溯到原文）。 */
  readonly sourceFactIds?: readonly string[];
}

export interface ScenarioTurn {
  readonly turnIndex: number;
  readonly title: string;
  readonly storyText: string;
  readonly zhihuBullet: {
    readonly author: string;
    readonly quote: string;
    readonly sourceUrl: `https://${string}`;
    /**
     * 真实赞同数。**只有 `status === 'verified'` 时才会由
     * `npm run sync:zhihu`（官方 key）写入** —— 这个文件里不许出现手写的数字。
     */
    readonly upvotes?: number;
    /** 站内索引号；同样只允许来自官方检索结果。 */
    readonly answerId?: string;
    /**
     * 来源状态。
     *
     * 预置剧本的内容是**剧本文案**，未接入开放平台 key 前一律 `scripted`：
     * 界面只能说「剧本模拟引用」，不许显示赞同数冒充真实社区数据。
     */
    readonly status?: 'verified' | 'scripted';
  };
  readonly choices: readonly ScenarioChoice[];
  /** 幕标题卡。 */
  readonly act?: ActCard;
  /**
   * 叙事节拍。缺省时由上层用 `storyText` 合成单个旁白 beat，
   * 因此 AI DM 只返回一段文本时也能无缝走同一套演出。
   */
  readonly beats?: readonly NarrativeBeat[];
  /** 前一幕选择的回响，`text` 里的 `{choice}` 会被替换为玩家上一次的选择。 */
  readonly callback?: CallbackLine;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly goalKeywords: readonly string[];
  readonly turns: readonly ScenarioTurn[];
}

/* -------------------------------------------------------------------------- */
/* 遗物库                                                                      */
/* -------------------------------------------------------------------------- */

const ZHIHU_URL = 'https://www.zhihu.com/question/293352359' as const;

export const RELIC_LIBRARY: Record<string, ZhihuRelic> = {

  /* ---- P0-2 扩容（最终版 §6）：效果类型 × 叙事钩子组合，而不是纯手写数值 ---- */

  'relic-deadline-clock': {
    id: 'relic-deadline-clock',
    name: '倒计时台历',
    quote: '你以为是时间不够，其实是你把时间花在了不产生证据的事情上。',
    source: {
      id: 'src-deadline-clock',
      author: '某互联网校招官',
      title: '秋招只有 90 天，我建议先把"证据"排在"努力"前面',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '台历上每一格都被人用红笔划掉了，最后一格写着你的名字。',
    effects: [
      { effectId: 'effect-clock-runway', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'skill', modifier: toModifier(2) },
      { effectId: 'effect-clock-san', stackRule: 'additive-capped', type: 'san-damage-reduction', ratio: toRatio(0.15), aggregateCap: toRatio(0.8) },
    ],
  },

  'relic-reference-letter': {
    id: 'relic-reference-letter',
    name: '半封推荐信',
    quote: '一封写得克制的推荐信，比十句夸奖更能让人相信你。',
    source: {
      id: 'src-reference-letter',
      author: '某高校导师',
      title: '我给学生写推荐信时，只写我亲眼见过的事',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '信纸折痕很深，像是被反复打开又收起过。',
    effects: [
      { effectId: 'effect-letter-bond', stackRule: 'highest-only', type: 'check-modifier', targetStat: 'bond', modifier: toModifier(3) },
    ],
  },

  'relic-cost-ledger': {
    id: 'relic-cost-ledger',
    name: '代价账本',
    quote: '把每一次取舍写下来的人，才知道自己到底在拿什么换什么。',
    source: {
      id: 'src-cost-ledger',
      author: '记账的转行者',
      title: '转行两年，我记了 700 天的时间账',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '账本最后一页是空白的，像是在等你写下这一局。',
    effects: [
      { effectId: 'effect-ledger-skill', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'skill', modifier: toModifier(1) },
      { effectId: 'effect-ledger-bond', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'bond', modifier: toModifier(1) },
    ],
  },

  'relic-borrowed-laptop': {
    id: 'relic-borrowed-laptop',
    name: '借来的笔记本',
    quote: '设备有多旧不重要，重要的是你今晚到底跑通了什么。',
    source: {
      id: 'src-borrowed-laptop',
      author: '小县城出来的工程师',
      title: '用一台二手笔记本，我刷完了第一份实习',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '键盘上有一块被磨得发亮的区域，是别人留下的手型。',
    effects: [
      { effectId: 'effect-laptop-skill', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'skill', modifier: toModifier(3) },
      { effectId: 'effect-laptop-san', stackRule: 'additive-capped', type: 'san-damage-reduction', ratio: toRatio(-0.1), aggregateCap: toRatio(0.8) },
    ],
  },

  'relic-one-more-try': {
    id: 'relic-one-more-try',
    name: '再来一次的信封',
    quote: '被拒不是终点，是你终于拿到了一次真实的反馈。',
    source: {
      id: 'src-one-more-try',
      author: '面了 37 场的人',
      title: '第 38 场面试前，我把前 37 封拒信读了一遍',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'active',
    narrativeHook: '信封没有封口，说明写它的人本来也没打算真的寄出去。',
    effects: [
      { effectId: 'effect-retry-next', stackRule: 'once-per-check', type: 'next-check-modifier', modifier: toModifier(4), charges: 1 },
    ],
  },

  'relic-quiet-hour': {
    id: 'relic-quiet-hour',
    name: '安静的半小时',
    quote: '你以为需要更多时间，其实需要的是一段没人打扰的时间。',
    source: {
      id: 'src-quiet-hour',
      author: '研究注意力的博士生',
      title: '每天抢回半小时深度时间，我做了三件事',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '这半小时是你从别人的日程里偷来的。',
    effects: [
      { effectId: 'effect-quiet-san', stackRule: 'additive-capped', type: 'san-damage-reduction', ratio: toRatio(0.3), aggregateCap: toRatio(0.8) },
    ],
  },

  'relic-family-call': {
    id: 'relic-family-call',
    name: '没接的那通电话',
    quote: '家里的电话不是催你回去，是怕你撑不住还不说。',
    source: {
      id: 'src-family-call',
      author: '异地工作的独生女',
      title: '我妈从来不问我工资，只问我今天吃饭了没',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '通话记录里三个未接来电，时间都在你熬得最晚的那几晚。',
    effects: [
      { effectId: 'effect-family-bond', stackRule: 'highest-only', type: 'check-modifier', targetStat: 'bond', modifier: toModifier(4) },
      { effectId: 'effect-family-san', stackRule: 'additive-capped', type: 'san-damage-reduction', ratio: toRatio(0.1), aggregateCap: toRatio(0.8) },
    ],
  },

  'relic-said-no': {
    id: 'relic-said-no',
    name: '说出口的那句"不"',
    quote: '拒绝一次不属于你的机会，比硬接下来更省力气。',
    source: {
      id: 'src-said-no',
      author: '学会拒绝的人',
      title: '我推掉了那个"看起来很好"的 offer，然后睡得着了',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'active',
    narrativeHook: '这句话说出口的时候，你的声音比想象中抖。',
    effects: [
      { effectId: 'effect-no-san', stackRule: 'once-per-check', type: 'next-check-modifier', modifier: toModifier(3), charges: 1 },
    ],
  },

  'relic-small-win': {
    id: 'relic-small-win',
    name: '一枚小小的胜利',
    quote: '信心不是想出来的，是攒出来的——从一件真的做完的小事开始。',
    source: {
      id: 'src-small-win',
      author: '正在重建自信的人',
      title: '我靠"每天做成一件小事"把自己捞了回来',
      sourceUrl: ZHIHU_URL,
      status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '它很小，小到你不好意思跟别人提，但你自己知道它有多重。',
    effects: [
      { effectId: 'effect-win-skill', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'skill', modifier: toModifier(1) },
      { effectId: 'effect-win-bond', stackRule: 'additive-capped', type: 'check-modifier', targetStat: 'bond', modifier: toModifier(2) },
    ],
  },
  'relic-pr-fragment': {
    id: 'relic-pr-fragment',
    name: '开源 PR 碎片',
    quote: '真正让面试官记住你的，不是刷了多少题，而是你亲手改过哪一行生产代码。',
    source: {
      id: 'src-pr-fragment',
      author: '某大厂后端老兵',
      title: '非科班转码：我怎么用三个 PR 撬开大厂的门',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '那行被合并的代码旁边，还留着审查者的一句“这个边界处理得好”。',
    effects: [
      {
        effectId: 'effect-pr-skill',
        stackRule: 'additive-capped',
        type: 'check-modifier',
        targetStat: 'skill',
        modifier: toModifier(2),
      },
    ],
  },

  'relic-salt-digest': {
    id: 'relic-salt-digest',
    name: '盐选速记秘卷',
    quote: '八股不是背出来的，是把别人踩过的坑压缩成自己的直觉。',
    source: {
      id: 'src-salt-digest',
      author: '盐选专栏作者',
      title: '面试前 72 小时，我只复习这三件事',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'column',
    },
    kind: 'active',
    narrativeHook: '秘卷的边角被翻得起了毛，某一页夹着一根头发。',
    effects: [
      {
        effectId: 'effect-digest-next',
        stackRule: 'once-per-check',
        type: 'next-check-modifier',
        modifier: toModifier(5),
        charges: 1,
      },
    ],
  },

  'relic-anti-involution': {
    id: 'relic-anti-involution',
    name: '大 V 答主反卷箴言',
    quote: '你不是不够努力，你是把力气花在了别人定义的赛道上。',
    source: {
      id: 'src-anti-involution',
      author: '匿名用户',
      title: '内卷的本质是目标错位',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'answer',
    },
    kind: 'passive',
    narrativeHook: '这句话写在便利贴上，贴在你显示器边框，已经有点卷边。',
    effects: [
      {
        effectId: 'effect-anti-involution-san',
        stackRule: 'additive-capped',
        type: 'san-damage-reduction',
        ratio: toRatio(0.25),
        aggregateCap: toRatio(0.8),
      },
    ],
  },

  'relic-interview-map': {
    id: 'relic-interview-map',
    name: '面经地图残页',
    quote: '每一场面试都是一次信息交换，你问的问题，比你的回答更能证明你是谁。',
    source: {
      id: 'src-interview-map',
      author: '秋招上岸的学姐',
      title: '把 30 场面试画成一张图，我找到了自己的短板',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'article',
    },
    kind: 'passive',
    narrativeHook: '地图上标着你去过的每一间会议室，其中一间被你划了叉。',
    effects: [
      {
        effectId: 'effect-map-bond',
        stackRule: 'additive-capped',
        type: 'check-modifier',
        targetStat: 'bond',
        modifier: toModifier(3),
      },
    ],
  },

  'relic-all-nighter': {
    id: 'relic-all-nighter',
    name: '通宵手撕实录',
    quote: '把一晚上熬成一行能跑通的代码，这件事本身就会改变你。',
    source: {
      id: 'src-all-nighter',
      author: '工科在读研究生',
      title: '我在实验室连续通宵了七天',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'story',
    },
    kind: 'passive',
    narrativeHook: '凌晨四点的窗外，只有你和对面楼的一盏灯还亮着。',
    effects: [
      {
        effectId: 'effect-all-nighter-skill',
        stackRule: 'additive-capped',
        type: 'check-modifier',
        targetStat: 'skill',
        modifier: toModifier(3),
      },
    ],
  },

  'relic-legacy-note': {
    id: 'relic-legacy-note',
    name: '前世的避坑顿悟',
    quote: '千万不要盲目背八股文，一定要做项目。',
    source: {
      id: 'src-legacy-note',
      author: '上一局的你自己',
      title: '虚影刻印 · 前世遗念',
      sourceUrl: ZHIHU_URL,
        status: 'scripted',
      contentType: 'story',
    },
    kind: 'passive',
    narrativeHook: '字迹是上一局的你留下的，笔画用力得不像是写给自己的。',
    effects: [
      {
        effectId: 'effect-legacy-skill',
        stackRule: 'additive-capped',
        type: 'check-modifier',
        targetStat: 'skill',
        modifier: toModifier(3),
      },
      {
        effectId: 'effect-legacy-san',
        stackRule: 'additive-capped',
        type: 'san-damage-reduction',
        ratio: toRatio(0.1),
        aggregateCap: toRatio(0.8),
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* 剧本一：法学转码                                                             */
/* -------------------------------------------------------------------------- */

const lawToCs: Scenario = {
  id: 'law-to-cs',
  title: '大三法学，想转计算机',
  subtitle: '怕脱产找不到工作，又怕一辈子没试过',
  goalKeywords: ['法学', '转码', '秋招', '跨专业'],
  turns: [
    {
      turnIndex: 1,
      title: '秋招倒计时 30 天',
      act: {
        act: 1,
        title: '第一幕 · 秋招倒计时 30 天',
        subtitle: '你还有 30 天，和一个不肯认输的念头',
      },
      beats: [
        {
          id: 'a1-1',
          kind: 'scene',
          background: 'library',
          mood: 'calm',
          text: '10 月 20 日，23:40。图书馆三楼的自习区只剩四盏灯亮着，其中一盏在你头顶。',
        },
        {
          id: 'a1-2',
          kind: 'narration',
          text: '你的力扣还停在第 30 题。屏幕右下角的计时器跳到了 00:47:12——那是你今晚已经坐在这里的时间。',
        },
        {
          id: 'a1-3',
          kind: 'dialogue',
          speaker: 'roommate',
          reveal: 'roommate',
          mood: 'tense',
          text: '「律所那边的 offer 我签了。你那个……计算机，还搞吗？」他说得很轻，像怕碰碎什么。',
        },
        {
          id: 'a1-4',
          kind: 'monologue',
          speaker: 'player',
          mood: 'tense',
          text: '（我没抬头。键盘上的手指停了一下，又继续敲。）',
        },
        {
          id: 'a1-5',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'tense',
          text: '「你最近是不是没睡好？我看了你三天的推演曲线，它一直在往下掉。」',
        },
        {
          id: 'a1-6',
          kind: 'narration',
          mood: 'panic',
          text: '导师群里弹出一条消息：明早九点，项目组过一遍进度。你的名字在名单上，进度栏是空的。',
          effect: 'shake',
        },
        {
          id: 'a1-7',
          kind: 'monologue',
          speaker: 'player',
          mood: 'panic',
          sanThreshold: { max: 45 },
          text: '（我听见自己心跳的声音，比键盘还响。）',
        },
        {
          id: 'a1-8',
          kind: 'system',
          mood: 'tense',
          text: '今晚，你必须做一个决定。',
        },
      ],
      storyText:
        '10 月的图书馆，你的力扣还停在第 30 题。室友的律所 Offer 已经躺进邮箱，而你刚把《深入理解计算机系统》翻到第三章。深夜 1 点，屏幕蓝光把宿舍照成一片海。',
      zhihuBullet: {
        author: '某大厂后端老兵',
        quote: '转码最大的成本不是学不会，是你在能学会之前就先耗光了心气。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '按部就班刷题，先把八股背熟',
          hint: '稳妥：小幅提升专业力，但心智持续消耗',
          ghostEchoStat: '先稳住，是这一步最常见的走法',
          peerPressure: true,
          onSuccess: {
            feedback:
              '你按计划推进，进度慢得让人心慌，但至少没有崩盘。八股在脑子里慢慢连成了线。',
            statDeltas: { san: -8, skill: 8 },
          },
        },
        {
          id: 'b',
          text: '通宵手撕分布式开源项目',
          hint: '高危：需要专业力检定',
          check: { targetStat: 'skill', difficulty: 13 },
          ghostEchoStat: '硬刚的人不多，但有人走通过',
          peerPressure: true,
          onSuccess: {
            feedback:
              '凌晨 4 点，你提交了人生第一个 PR。三天后维护者回复了一句 “LGTM”，你截图存进了相册。',
            statDeltas: { san: 6, skill: 22, bond: 5 },
            relicId: 'relic-pr-fragment',
          },
          onFail: {
            feedback:
              '环境依赖报错到天亮，你盯着满屏红字，第一次认真怀疑自己是不是在浪费时间。',
            statDeltas: { san: -26, skill: 4 },
            relicId: 'relic-cost-ledger',
          },
        },
      ],
    },
    {
      turnIndex: 2,
      title: '简历投出去的第 47 天',
      act: {
        act: 2,
        title: '第二幕 · 简历投出去的第 47 天',
        subtitle: '46 封「感谢您的投递」，和一封没敢点开的',
      },
      callback: {
        fromTurn: 1,
        text: '你想起第一幕那个深夜——你选了「{choice}」。那一步的余波，现在开始回响。',
      },
      beats: [
        {
          id: 'a2-1',
          kind: 'scene',
          background: 'dorm',
          mood: 'tense',
          text: '11 月 12 日，傍晚。宿舍的窗帘拉着，台灯把桌面照出一小块暖色。',
        },
        {
          id: 'a2-2',
          kind: 'narration',
          text: '邮箱里躺着 46 封「感谢您的投递」。HR 说你的履历「专业跨度太大」，面试官问你「为什么法学要来做后端」。',
        },
        {
          id: 'a2-3',
          kind: 'dialogue',
          speaker: 'ghost',
          reveal: 'ghost',
          mood: 'calm',
          text: '「简历不是把你的经历写得好看，是让面试官一眼看到你能解决什么问题。」',
        },
        {
          id: 'a2-4',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'tense',
          text: '「你上次跟我说要做项目。做了吗？」',
        },
        {
          id: 'a2-5',
          kind: 'monologue',
          speaker: 'player',
          mood: 'tense',
          text: '（我把那份单薄的简历又打开了一遍。光标停在「编辑」按钮上，很久没有按下去。）',
        },
        {
          id: 'a2-6',
          kind: 'system',
          text: '第 47 天。你得决定下一封怎么投。',
        },
      ],
      storyText:
        '邮箱里躺着 46 封“感谢您的投递”。HR 说你的履历“专业跨度太大”，面试官问你“为什么法学要来做后端”。你盯着屏幕上那份单薄的简历，手指悬在“编辑”按钮上。',
      zhihuBullet: {
        author: '秋招上岸的学姐',
        quote: '简历不是把你的经历写得好看，是让面试官一眼看到你能解决什么问题。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '老老实实补一个完整项目，从零写起',
          hint: '稳妥：专业力稳步上升，时间成本高',
          ghostEchoStat: '先把项目补齐，再谈选择',
          peerPressure: true,
          onSuccess: {
            feedback:
              '你用两周写了一个带鉴权的短链服务，虽然朴素，但每一行你都能讲清楚。面试官的表情第一次松了下来。',
            statDeltas: { san: -6, skill: 12 },
          },
        },
        {
          id: 'b',
          text: '包装律所实习经历，硬刚大厂算法岗',
          hint: '高危：需要专业力检定',
          check: { targetStat: 'skill', difficulty: 15 },
          ghostEchoStat: '直接硬刚，是少数派的选择',
          onSuccess: {
            feedback:
              '你把“合规文本检索”讲成了信息检索问题，面试官眼睛亮了：“这个视角有意思。”',
            statDeltas: { san: 8, skill: 18, bond: 6 },
            relicId: 'relic-salt-digest',
          },
          onFail: {
            feedback:
              '面试官追问了三个底层问题，你答得越来越小声。挂断电话时，窗外天已经亮了。',
            statDeltas: { san: -22, skill: 5 },
            relicId: 'relic-all-nighter',
          },
        },
      ],
    },
    {
      turnIndex: 3,
      title: '三面现场：面试官突然问起 JVM',
      act: {
        act: 3,
        title: '第三幕 · 三面现场',
        subtitle: '空调很冷，你的手心在出汗',
      },
      callback: {
        fromTurn: 2,
        text: '面试官翻着简历停了一下——那是你第二幕「{choice}」留下的痕迹。',
      },
      beats: [
        {
          id: 'a3-1',
          kind: 'scene',
          background: 'interview-room',
          mood: 'tense',
          text: '11 月 28 日，14:05。玻璃隔间里只有一张长桌、两台笔记本，和一位推了推眼镜的面试官。',
          effect: 'flash-white',
        },
        {
          id: 'a3-2',
          kind: 'dialogue',
          speaker: 'interviewer',
          reveal: 'interviewer',
          mood: 'tense',
          text: '「你说说，为什么你们的服务要调这个 GC 参数？」',
        },
        {
          id: 'a3-3',
          kind: 'monologue',
          speaker: 'player',
          mood: 'panic',
          text: '（我听见自己心跳的声音。空调在头顶嗡嗡作响，手心已经出汗。）',
        },
        {
          id: 'a3-4',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'hope',
          sanThreshold: { max: 55 },
          text: '「稳住。你能走到这一轮，已经比 70% 的人强了。」',
        },
        {
          id: 'a3-5',
          kind: 'narration',
          mood: 'panic',
          text: '他停下来，等你的回答。这两秒长得像一整个冬天。',
        },
        {
          id: 'a3-6',
          kind: 'system',
          text: '这一题，决定你后面所有的话有没有人听。',
        },
      ],
      storyText:
        '前两轮技术面都过了。三面官推了推眼镜：“你说说，为什么你们的服务要调这个 GC 参数？”会议室空调很冷，你能听见自己心跳的声音。',
      zhihuBullet: {
        author: '匿名用户',
        quote: '面试官不是在考你会不会，是在看你在不会的时候怎么想。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '背熟八股，用标准答案顶住',
          hint: '稳妥：稳住局面，但拿不到高分',
          ghostEchoStat: '背标准答案，是最省力的那条路',
          onSuccess: {
            feedback:
              '你把 CMS 和 G1 的区别背得滚瓜烂熟，面试官点点头，没有追问。安全，但也就到此为止。',
            statDeltas: { san: -4, skill: 6 },
          },
        },
        {
          id: 'b',
          text: '现场推演，从内存模型讲到 GC 调优',
          hint: '高危：需要专业力检定',
          check: { targetStat: 'skill', difficulty: 17 },
          ghostEchoStat: '现场推演，风险高、敢试的人少',
          onSuccess: {
            feedback:
              '你从对象分配讲到晋升阈值，最后说“其实我们真正的瓶颈是序列化”。面试官笑了：“你比我预期懂得多。”',
            statDeltas: { san: 12, skill: 20, bond: 8 },
            relicId: 'relic-interview-map',
          },
          onFail: {
            feedback:
              '你讲到 Survivor 区就卡住了，越描越乱。面试官礼貌地打断：“我们换个问题吧。”',
            statDeltas: { san: -28, skill: 6 },
            relicId: 'relic-one-more-try',
          },
        },
      ],
    },
    {
      turnIndex: 4,
      title: '终面谈薪',
      act: {
        act: 4,
        title: '第四幕 · 终面谈薪',
        subtitle: '走出去的时候，秋天就结束了',
      },
      callback: {
        fromTurn: 3,
        text: '「{choice}」——第三幕的那一下，让这次谈薪的语气变了。',
      },
      beats: [
        {
          id: 'a4-1',
          kind: 'scene',
          background: 'interview-room',
          mood: 'calm',
          text: '12 月 6 日，上午。HR 把 offer 推到你面前，纸角压着一支笔。',
        },
        {
          id: 'a4-2',
          kind: 'dialogue',
          speaker: 'interviewer',
          reveal: 'interviewer',
          mood: 'calm',
          text: '「这是我们的标准包，希望你能尽快给答复。」',
        },
        {
          id: 'a4-3',
          kind: 'monologue',
          speaker: 'player',
          mood: 'tense',
          text: '（我算了算房租、学费和家里的期待，又想起这三周熬过的夜。）',
        },
        {
          id: 'a4-4',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'hope',
          text: '「不管你选哪个，这一局我都替你记着。」',
        },
        {
          id: 'a4-5',
          kind: 'system',
          mood: 'tense',
          text: '最后一次掷骰。',
        },
      ],
      storyText:
        'HR 把 offer 推到你面前：“这是我们的标准包，希望你能尽快给答复。”你算了算房租、学费和家里的期待，又想起这三周熬过的夜。',
      zhihuBullet: {
        author: '某大厂后端老兵',
        quote: '谈薪不是贪婪，是让公司知道你的价值需要被认真对待。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '接受 offer，落袋为安',
          hint: '稳妥：稳稳通关，收获中等',
          ghostEchoStat: '先上岸，再谈理想',
          onSuccess: {
            feedback:
              '你签了字。走出写字楼时，秋天的风第一次让你觉得，这三年没有白熬。',
            statDeltas: { san: 10, skill: 5, bond: 4 },
          },
        },
        {
          id: 'b',
          text: '争取更高职级，再赌一把',
          hint: '高危：需要羁绊检定',
          check: { targetStat: 'bond', difficulty: 14 },
          ghostEchoStat: '继续争取，代价更大',
          onSuccess: {
            feedback:
              '你把这些年的项目整理成一页纸，HR 沉默了几秒：“我去申请一下。” 三天后，职级上调了一级。',
            statDeltas: { san: 14, skill: 8, bond: 12 },
            relicId: 'relic-anti-involution',
          },
          onFail: {
            feedback:
              'HR 说“这是最终方案”，语气比刚才冷了三度。你拿着 offer 站在电梯里，有点后悔，也有点释然。',
            statDeltas: { san: -12, bond: -6 },
            relicId: 'relic-borrowed-laptop',
          },
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 剧本二：考研二战                                                             */
/* -------------------------------------------------------------------------- */

const kaoyanSecond: Scenario = {
  id: 'kaoyan-second',
  title: '考研复试线差 3 分',
  subtitle: '调剂去普通院校，还是再来一年',
  goalKeywords: ['考研', '二战', '调剂', '复试'],
  turns: [
    {
      turnIndex: 1,
      title: '复试线出来的那天',
      act: {
        act: 1,
        title: '第一幕 · 复试线出来的那天',
        subtitle: '差 3 分，和一顿没吃下去的晚饭',
      },
      beats: [
        {
          id: 'k1-1',
          kind: 'scene',
          background: 'home',
          mood: 'tense',
          text: '3 月 12 日，傍晚。客厅的灯没开，只有餐桌上一盏吊灯亮着。',
        },
        {
          id: 'k1-2',
          kind: 'narration',
          text: '成绩查询页面的数字你看了三遍：367。目标院校的复试线是 370。',
        },
        {
          id: 'k1-3',
          kind: 'dialogue',
          speaker: 'parent',
          reveal: 'parent',
          mood: 'calm',
          text: '「先吃饭吧。分数……明天再说。」妈妈把碗往你面前推了推。',
        },
        {
          id: 'k1-4',
          kind: 'monologue',
          speaker: 'player',
          mood: 'panic',
          text: '（我把手机扣在桌上，屏幕还亮着，映出一小块白。）',
        },
        {
          id: 'k1-5',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'tense',
          text: '「差 3 分不是失败，是让你重新想清楚为什么要考。」',
        },
        {
          id: 'k1-6',
          kind: 'system',
          text: '调剂还是二战，今晚得有个说法。',
        },
      ],
      storyText:
        '成绩查询页面的数字你看了三遍：367。目标院校的复试线是 370。妈妈在厨房喊你吃饭，你把手机扣在桌上，屏幕还亮着。',
      zhihuBullet: {
        author: '二战上岸的学长',
        quote: '差 3 分不是失败，是让你重新想清楚为什么要考。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '接受调剂，去一所普通院校',
          hint: '稳妥：迅速止损，但心有不甘',
          ghostEchoStat: '接受调剂，是更稳的那条',
          onSuccess: {
            feedback:
              '你联系了三所院校，其中一所愿意接收。虽然排名靠后，但至少这个秋天还有书可读。',
            statDeltas: { san: 4, skill: 4 },
          },
        },
        {
          id: 'b',
          text: '二战，继续冲击目标院校',
          hint: '高危：需要心智检定',
          check: { targetStat: 'san', difficulty: 14 },
          ghostEchoStat: '再来一年，是少数人的决定',
          onSuccess: {
            feedback:
              '你把成绩单贴在书桌前，给自己写了一张纸条：“这次不为别人，只为自己。”',
            statDeltas: { san: -6, skill: 14, bond: 6 },
            relicId: 'relic-legacy-note',
          },
          onFail: {
            feedback:
              '你跟家人说完决定，回到房间就哭了。那一刻你也不知道，这个决定到底对不对。',
            statDeltas: { san: -24, skill: 6 },
            relicId: 'relic-family-call',
          },
        },
      ],
    },
    {
      turnIndex: 2,
      title: '自习室的第 200 天',
      act: {
        act: 2,
        title: '第二幕 · 自习室的第 200 天',
        subtitle: '便利贴从桌沿贴到了窗台',
      },
      callback: {
        fromTurn: 1,
        text: '第一幕你说「{choice}」。这句话后来被写在了你的日历封面上。',
      },
      beats: [
        {
          id: 'k2-1',
          kind: 'scene',
          background: 'classroom',
          mood: 'calm',
          text: '9 月 8 日，19:20。空教室里只剩你一个人，日光灯管有一根在闪。',
        },
        {
          id: 'k2-2',
          kind: 'narration',
          text: '座位上的水杯换成了保温杯，便利贴从桌沿贴到了窗台。旁边的人陆续上岸、就业、恋爱，你的日历上只剩下倒计时。',
        },
        {
          id: 'k2-3',
          kind: 'dialogue',
          speaker: 'roommate',
          reveal: 'roommate',
          mood: 'calm',
          text: '「我下个月入职了。你……还撑得住吗？」',
        },
        {
          id: 'k2-4',
          kind: 'monologue',
          speaker: 'player',
          mood: 'tense',
          text: '（我点点头，没说话。桌上的真题集翻到了第 3 遍。）',
        },
        {
          id: 'k2-5',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'tense',
          text: '「二战的敌人从来不是题目，是每天醒来的那个念头：我还来得及吗。」',
        },
        {
          id: 'k2-6',
          kind: 'system',
          text: '今晚的进度，决定下周的底气。',
        },
      ],
      storyText:
        '座位上的水杯换成了保温杯，便利贴从桌沿贴到了窗台。旁边的人陆续上岸、就业、恋爱，你的日历上只剩下倒计时。',
      zhihuBullet: {
        author: '二战上岸的学长',
        quote: '二战的敌人从来不是题目，是每天醒来的那个念头：我还来得及吗。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '稳扎稳打，按计划推进',
          hint: '稳妥：效率一般，但不容易崩',
          ghostEchoStat: '按部就班，多数人会这么走',
          onSuccess: {
            feedback:
              '你按周复盘，进度表上的勾一天天变密。慢，但你知道自己在哪里。',
            statDeltas: { san: -5, skill: 10 },
          },
        },
        {
          id: 'b',
          text: '熬夜冲名校真题，逼自己一把',
          hint: '高危：需要专业力检定',
          check: { targetStat: 'skill', difficulty: 15 },
          ghostEchoStat: '极限冲刺，是少数人的打法',
          onSuccess: {
            feedback:
              '你连刷三套真题，正确率第一次突破 80%。走出自习室时，天正好亮。',
            statDeltas: { san: 8, skill: 20 },
            relicId: 'relic-salt-digest',
          },
          onFail: {
            feedback:
              '凌晨三点，你发现自己连错四道同类型题，笔摔在桌上，纸都划破了。',
            statDeltas: { san: -25, skill: 5 },
            relicId: 'relic-quiet-hour',
          },
        },
      ],
    },
    {
      turnIndex: 3,
      title: '父母的电话',
      act: {
        act: 3,
        title: '第三幕 · 父母的电话',
        subtitle: '「我们不是催你，就是问问」',
      },
      callback: {
        fromTurn: 2,
        text: '第二幕你「{choice}」——爸妈其实从亲戚那里听说了。',
      },
      beats: [
        {
          id: 'k3-1',
          kind: 'scene',
          background: 'phone',
          mood: 'tense',
          text: '11 月 2 日，21:30。手机在桌上震了三下，屏幕上写着「妈妈」。',
        },
        {
          id: 'k3-2',
          kind: 'dialogue',
          speaker: 'parent',
          reveal: 'parent',
          mood: 'calm',
          text: '「隔壁老王家孩子已经工作了……我们不是催你，就是问问。」',
        },
        {
          id: 'k3-3',
          kind: 'monologue',
          speaker: 'player',
          mood: 'panic',
          text: '（我握着手机，看着桌上摊开的专业课笔记，突然不知道该说什么。）',
        },
        {
          id: 'k3-4',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'tense',
          text: '「跟父母解释你的选择，比考上更难，但也更值得。」',
        },
        {
          id: 'k3-5',
          kind: 'system',
          text: '这通电话怎么回，会影响接下来两个月。',
        },
      ],
      storyText:
        '电话那头，爸爸欲言又止：“隔壁老王家孩子已经工作了……我们不是催你，就是问问。” 你握着手机，看着桌上摊开的专业课笔记。',
      zhihuBullet: {
        author: '匿名用户',
        quote: '跟父母解释你的选择，比考上更难，但也更值得。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '妥协，先去找一份实习',
          hint: '稳妥：缓解家庭压力，但打断复习',
          ghostEchoStat: '先工作，再看机会',
          onSuccess: {
            feedback:
              '你去了一家小公司实习，工资不高，但家里的电话少了。复习的时间被切成碎片。',
            statDeltas: { san: 6, bond: 8, skill: 4 },
          },
        },
        {
          id: 'b',
          text: '坚持备考，认真向家人解释',
          hint: '高危：需要羁绊检定',
          check: { targetStat: 'bond', difficulty: 13 },
          ghostEchoStat: '坦白沟通，需要勇气',
          onSuccess: {
            feedback:
              '你把计划表拍照发给爸妈，一条条讲清楚。妈妈最后说：“那你照顾好自己。”',
            statDeltas: { san: 10, bond: 14 },
            relicId: 'relic-interview-map',
          },
          onFail: {
            feedback:
              '话说到一半就变成了争吵。挂断电话后，你翻了两页书，一个字也没进脑子。',
            statDeltas: { san: -18, bond: -8 },
            relicId: 'relic-reference-letter',
          },
        },
      ],
    },
    {
      turnIndex: 4,
      title: '出分日',
      act: {
        act: 4,
        title: '第四幕 · 出分日',
        subtitle: '392，和一口气',
      },
      callback: {
        fromTurn: 3,
        text: '第三幕你「{choice}」。这一次查分，你比去年平静得多。',
      },
      beats: [
        {
          id: 'k4-1',
          kind: 'scene',
          background: 'dorm',
          mood: 'tense',
          text: '2 月 24 日，上午。查分页面刷新了四次，进度条卡在 99%。',
        },
        {
          id: 'k4-2',
          kind: 'narration',
          mood: 'hope',
          text: '这一次，数字停在了 392。你盯着屏幕，没有立刻欢呼，只是长长地呼出一口气。',
          effect: 'flash-white',
        },
        {
          id: 'k4-3',
          kind: 'dialogue',
          speaker: 'kanshan',
          reveal: 'kanshan',
          mood: 'hope',
          text: '「分数出来的那一刻你会发现，真正的成长发生在那些没人看见的日子里。」',
        },
        {
          id: 'k4-4',
          kind: 'monologue',
          speaker: 'player',
          mood: 'hope',
          text: '（我把成绩截图存进相册，命名是「第二年」。）',
        },
        {
          id: 'k4-5',
          kind: 'system',
          text: '接下来怎么走，还是你说了算。',
        },
      ],
      storyText:
        '查分页面刷新了四次。这一次，数字停在了 392。你盯着屏幕，没有立刻欢呼，只是长长地呼出一口气。',
      zhihuBullet: {
        author: '二战上岸的学长',
        quote: '分数出来的那一刻你会发现，真正的成长发生在那些没人看见的日子里。',
        sourceUrl: ZHIHU_URL,
        status: 'scripted',
      },
      choices: [
        {
          id: 'a',
          text: '接受结果，安心准备复试',
          hint: '稳妥：稳稳通关',
          ghostEchoStat: '直接准备复试，是最常见的做法',
          onSuccess: {
            feedback:
              '你把复试资料整理成三本笔记，按部就班地过。心里第一次有了踏实的感觉。',
            statDeltas: { san: 12, skill: 6, bond: 4 },
          },
        },
        {
          id: 'b',
          text: '争取调剂到更好的院校，再搏一次',
          hint: '高危：需要羁绊检定',
          check: { targetStat: 'bond', difficulty: 15 },
          ghostEchoStat: '继续争取，风险不小',
          onSuccess: {
            feedback:
              '你联系了三位导师，其中一位回信说：“把你的研究兴趣写详细一点。” 一周后，你收到了更好的机会。',
            statDeltas: { san: 16, skill: 10, bond: 12 },
            relicId: 'relic-anti-involution',
          },
          onFail: {
            feedback:
              '邮件发出去十几封，只收到两封模板回复。你重新坐回复习桌前，觉得这一年也不算白费。',
            statDeltas: { san: -10, bond: -4 },
            relicId: 'relic-deadline-clock',
          },
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 剧本三：自由推演（AI DM 动态生成）                                          */
/* -------------------------------------------------------------------------- */

export const AI_DM_SCENARIO_ID = 'ai-dm';

/**
 * 自由推演的骨架剧本。
 *
 * 推演舱在 `ai-dm` 模式下会用 `/api/dm` 动态替换每一回合，所以这些占位回合
 * 正常情况下玩家看不到。保留骨架有两个作用：
 * 1. 让回合数、类型契约在完全离线时依然成立；
 * 2. 当动态生成链路彻底不可用时，作为最后可玩的兜底内容。
 */
const aiDm: Scenario = {
  id: AI_DM_SCENARIO_ID,
  title: '自由推演',
  subtitle: '输入任意生僻方向，由 AI 地下城主实时检索知乎生成关卡',
  goalKeywords: ['自由推演', 'AI DM', '动态关卡'],
  turns: [1, 2, 3, 4].map((turnIndex) => ({
    turnIndex,
    title: `第 ${turnIndex} 回合`,
    storyText:
      'AI 地下城主正在检索知乎站内讨论，抽取矛盾点，构建这一回合的事件背景……如果长时间没有响应，会自动切换为离线剧本。',
    zhihuBullet: {
      author: '知乎匿名用户',
      quote: '别急着下结论，先把信息补齐，再决定要不要下注。',
      sourceUrl: 'https://www.zhihu.com' as const,
    },
    choices: [
      {
        id: 'a',
        text: '先按原计划推进，稳住节奏',
        hint: '稳妥：收益有限但风险低',
        ghostEchoStat: '很多人在这一步都会犹豫',
        onSuccess: {
          feedback: '你把手上该做的事继续做完，进度不快，但至少没有被情绪带走。',
          statDeltas: { san: -4, skill: 6 },
        },
      },
      {
        id: 'b',
        text: '推翻原计划，赌一次大的',
        hint: '高危：需要专业力检定',
        ghostEchoStat: '推倒重来，只有少数人敢',
        check: { targetStat: 'skill', difficulty: 12 + turnIndex },
        onSuccess: {
          feedback: '你把旧的方案全部推翻，从零搭了一个新东西，居然真的跑通了。',
          statDeltas: { san: 8, skill: 16 },
        },
        onFail: {
          feedback: '新方案在第三天就卡住了，你花了一整晚收拾残局，心气也掉了一截。',
          statDeltas: { san: -14, skill: 2 },
        },
      },
    ],
  })),
};

export const PREBUILT_SCENARIOS: readonly Scenario[] = [lawToCs, kaoyanSecond];

export const DEFAULT_SCENARIO_ID = lawToCs.id;

/** 按 id 取剧本；找不到时回落到默认剧本，保证演示永不白屏。 */
export function getScenario(id: string | null | undefined): Scenario {
  if (id === AI_DM_SCENARIO_ID) {
    return aiDm;
  }

  return PREBUILT_SCENARIOS.find((scenario) => scenario.id === id) ?? lawToCs;
}

/** 离线兜底回合：AI DM 链路不可用时按回合取预置关卡。 */
export function getFallbackTurn(turnIndex: number): ScenarioTurn {
  const index = Math.min(Math.max(turnIndex, 1), lawToCs.turns.length) - 1;
  return lawToCs.turns[index];
}
