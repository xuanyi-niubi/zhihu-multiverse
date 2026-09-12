import type { WorldHidden } from '@/features/run/contracts';
import type { TargetStat } from '@/types/game';

/**
 * 场景模板库（P1 确定性因果内核的数据面）。
 *
 * 与旧的「手写四幕完整剧本」的区别：这里每个模板只声明**进入条件 + 权重 + 效果**，
 * 具体走哪 4 个模板由 `scenarioCompiler` 用种子在合法候选里稳定抽取。
 * 于是分支感来自组合，而不是手写 3^4 条完整剧情。
 *
 * 文案刻意保持最小：先把**规则**跑通（可复现、可验证），
 * 不是把 12 个模板写成小说。
 */

export type HiddenKey = keyof WorldHidden;

export interface TemplateEffect {
  readonly stats?: Partial<Record<TargetStat, number>>;
  readonly hidden?: Partial<Record<HiddenKey, number>>;
  readonly flags?: readonly string[];
}

export interface TemplateChoice {
  readonly id: 'a' | 'b';
  readonly text: string;
  readonly hint: string;
  /** 有 check 即风险选项（要过 D20）。 */
  readonly check?: { readonly targetStat: TargetStat; readonly difficulty: number };
  readonly feedback: { readonly onSuccess: string; readonly onFail?: string };
  readonly effects: { readonly onSuccess: TemplateEffect; readonly onFail?: TemplateEffect };
  /** 成功且槽位有空时掉落的遗物 id（由既有的 RELIC_LIBRARY 提供）。 */
  readonly relicId?: string;
}

/** 按隐藏状态切换旁白：只给定性台词，不暴露数值。 */
export interface BeatVariant {
  readonly when: { readonly hidden: HiddenKey; readonly atLeast: number };
  readonly line: string;
}

export interface SceneTemplate {
  readonly id: string;
  readonly act: 1 | 2 | 3 | 4;
  readonly title: string;
  /** 必须同时具备的 flag。 */
  readonly requires?: readonly string[];
  /** 任一存在即排除的 flag。 */
  readonly excludes?: readonly string[];
  readonly weight: number;
  /** 命中第一条 when 的旁白优先，否则用 defaultBeat。 */
  readonly beatsByState?: readonly BeatVariant[];
  readonly defaultBeat: string;
  readonly choices: readonly TemplateChoice[];
  /** 走完后写入的 flag（供后续幕筛选）。 */
  readonly unlocks?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 第一幕：建立动机，写入 1-2 个主导 flag                                      */
/* -------------------------------------------------------------------------- */

const ACT1: readonly SceneTemplate[] = [
  {
    id: 't1-name-the-goal',
    act: 1,
    title: '把模糊的焦虑写成一句话',
    weight: 3,
    defaultBeat: '你坐在自习室最后一排，手机屏幕上是一份还没填完的报名表。',
    beatsByState: [
      { when: { hidden: 'runway', atLeast: 50 }, line: '截止日期就在眼前，你却连第一步该点哪里都不知道。' },
    ],
    choices: [
      {
        id: 'a',
        text: '先把目标拆成三件今天能做完的事',
        hint: '稳妥：专业力小幅上升，焦虑下降',
        feedback: { onSuccess: '你写下了三条具体到可以立刻动手的事，呼吸慢了下来。' },
        effects: { onSuccess: { stats: { skill: 6, san: 4 }, hidden: { bodyAlarm: -8 }, flags: ['goal-clarified'] } },
      },
      {
        id: 'b',
        text: '不拆了，先冲一波最难的',
        hint: '高危：需要专业力检定',
        check: { targetStat: 'skill', difficulty: 13 },
        feedback: {
          onSuccess: '你把最难的那章硬啃了下来，进度一下推到了前面。',
          onFail: '难度压垮了你，一晚上只翻了三页。',
        },
        effects: {
          onSuccess: { stats: { skill: 14 }, hidden: { bodyAlarm: 14, peerPressure: 8 }, flags: ['goal-risky'] },
          onFail: { stats: { san: -14 }, hidden: { bodyAlarm: 10 }, flags: ['goal-risky'] },
        },
      },
    ],
    unlocks: ['act1-done'],
  },
  {
    id: 't1-ask-someone',
    act: 1,
    title: '找一个人问清楚',
    weight: 2,
    defaultBeat: '你翻到一条讲这件事的长文，评论区里全是「同问」。',
    choices: [
      {
        id: 'a',
        text: '私信一位走过这条路的人',
        hint: '稳妥：羁绊上升，但欠下人情',
        feedback: { onSuccess: '对方回了三段话，比你自己想一周都管用。' },
        effects: { onSuccess: { stats: { bond: 10, skill: 4 }, hidden: { socialDebt: 12 }, flags: ['goal-social'] } },
      },
      {
        id: 'b',
        text: '谁也不问，自己查资料',
        hint: '稳妥：羁绊不变，焦虑上升',
        feedback: { onSuccess: '你在图书馆耗掉一整个下午，结论是「还要再查」。' },
        effects: { onSuccess: { stats: { skill: 6, san: -4 }, hidden: { bodyAlarm: 6 }, flags: ['goal-solo'] } },
      },
    ],
    unlocks: ['act1-done'],
  },
  {
    id: 't1-chase-deadline',
    act: 1,
    title: '截止日期提前了',
    weight: 2,
    defaultBeat: '辅导员在群里发消息：材料今天下班前交。',
    beatsByState: [
      { when: { hidden: 'bodyAlarm', atLeast: 40 }, line: '你盯着那条通知，心跳快得让自己都听见了。' },
    ],
    choices: [
      {
        id: 'a',
        text: '先交能交的，剩下的明天补',
        hint: '稳妥：保住体力，留下尾巴',
        feedback: { onSuccess: '你交了七成材料，剩下三成记在了备忘录第一行。' },
        effects: { onSuccess: { stats: { san: 6 }, hidden: { bodyAlarm: -10, runway: -10 }, flags: ['goal-clarified'] } },
      },
      {
        id: 'b',
        text: '通宵赶完，一步不退',
        hint: '高危：需要 SAN 检定',
        check: { targetStat: 'san', difficulty: 12 },
        feedback: {
          onSuccess: '凌晨四点你按下了提交，那一刻的爽感压过了困意。',
          onFail: '你在三点半睡着了，醒来时文件还没保存。',
        },
        effects: {
          onSuccess: { stats: { skill: 10, san: -8 }, hidden: { bodyAlarm: 18 }, flags: ['goal-risky'] },
          onFail: { stats: { san: -18 }, hidden: { bodyAlarm: 20, runway: -14 }, flags: ['goal-risky'] },
        },
      },
    ],
    unlocks: ['act1-done'],
  },
];

/* -------------------------------------------------------------------------- */
/* 第二幕：按 flag 分流到「资源冲突」或「关系冲突」                             */
/* -------------------------------------------------------------------------- */

const ACT2: readonly SceneTemplate[] = [
  {
    id: 't2-resource-squeeze',
    act: 2,
    title: '钱和时间只够一样',
    weight: 3,
    defaultBeat: '课程、兼职、复习三件事挤在同一周里，你只能选两件。',
    choices: [
      {
        id: 'a',
        text: '推掉兼职，压缩生活费',
        hint: '稳妥：专业力上升，身体开始报警',
        feedback: { onSuccess: '你把外卖换成了食堂最便宜的那档，省下的时间全给了书桌。' },
        effects: { onSuccess: { stats: { skill: 10, san: -4 }, hidden: { bodyAlarm: 12, runway: -12 }, flags: ['act2-thrift'] } },
      },
      {
        id: 'b',
        text: '保住兼职，把复习押后',
        hint: '高危：需要羁绊检定',
        check: { targetStat: 'bond', difficulty: 14 },
        feedback: {
          onSuccess: '同事帮你顶了两次班，你腾出了一整个周末。',
          onFail: '班没少上，书也没读进去，两头都空了。',
        },
        effects: {
          onSuccess: { stats: { bond: 8, skill: 8 }, hidden: { socialDebt: 10, runway: -6 }, flags: ['act2-borrowed'] },
          onFail: { stats: { san: -12 }, hidden: { bodyAlarm: 14 }, flags: ['act2-borrowed'] },
        },
      },
    ],
  },
  {
    id: 't2-relation-pull',
    act: 2,
    title: '家里打来电话',
    weight: 3,
    requires: ['goal-social'],
    excludes: ['act2-thrift'],
    defaultBeat: '电话那头先是问你吃没吃饭，然后问起了那件你不想提的事。',
    beatsByState: [
      { when: { hidden: 'peerPressure', atLeast: 40 }, line: '你听见背景里还有别的亲戚在说话。' },
    ],
    choices: [
      {
        id: 'a',
        text: '如实说自己的打算',
        hint: '高危：需要羁绊检定',
        check: { targetStat: 'bond', difficulty: 13 },
        feedback: {
          onSuccess: '他们沉默了几秒，然后说「那你先试试」。',
          onFail: '话没说完就被打断，你握着手机在楼道里站了很久。',
        },
        effects: {
          onSuccess: { stats: { bond: 12, san: 8 }, hidden: { socialDebt: -12 }, flags: ['act2-honest'] },
          onFail: { stats: { san: -16 }, hidden: { peerPressure: 16 }, flags: ['act2-honest'] },
        },
      },
      {
        id: 'b',
        text: '报喜不报忧，先把这局撑过去',
        hint: '稳妥：暂时安稳，压力累积',
        feedback: { onSuccess: '你说「挺好的」，挂了电话之后坐了十分钟没动。' },
        effects: { onSuccess: { stats: { san: 4 }, hidden: { peerPressure: 14, socialDebt: 8 }, flags: ['act2-bottled'] } },
      },
    ],
  },
  {
    id: 't2-solo-grind',
    act: 2,
    title: '一个人扛着往前走',
    weight: 2,
    requires: ['goal-risky'],
    defaultBeat: '你已经连着几天没和人说过完整的一段话了。',
    beatsByState: [
      { when: { hidden: 'bodyAlarm', atLeast: 45 }, line: '上午的课你几乎没听进去，眼前发花。' },
    ],
    choices: [
      {
        id: 'a',
        text: '承认撑不住，停下来一天',
        hint: '稳妥：SAN 回升，进度落后',
        feedback: { onSuccess: '你睡了十二个小时，醒来时世界清楚了一点。' },
        effects: { onSuccess: { stats: { san: 16 }, hidden: { bodyAlarm: -20, runway: -12 }, flags: ['act2-rested'] } },
      },
      {
        id: 'b',
        text: '继续硬顶，靠咖啡续命',
        hint: '高危：需要 SAN 检定',
        check: { targetStat: 'san', difficulty: 15 },
        feedback: {
          onSuccess: '你在最困的时候反而想通了一个卡了很久的点。',
          onFail: '你在图书馆趴了两小时，醒来发现笔记被人合上了。',
        },
        effects: {
          onSuccess: { stats: { skill: 12 }, hidden: { bodyAlarm: 16 }, flags: ['act2-pushed'] },
          onFail: { stats: { san: -16, skill: -4 }, hidden: { bodyAlarm: 22 }, flags: ['act2-pushed'] },
        },
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* 第三幕：让前两幕的代价汇合，制造不可兼得                                     */
/* -------------------------------------------------------------------------- */

const ACT3: readonly SceneTemplate[] = [
  {
    id: 't3-both-wanted',
    act: 3,
    title: '两条路同时向你招手',
    weight: 3,
    defaultBeat: '一边是稳妥的 offer，一边是还想再试一次的方向。',
    choices: [
      {
        id: 'a',
        text: '先接下稳妥的那个',
        hint: '稳妥：SAN 回升，另一条路关上门',
        feedback: { onSuccess: '你在确认邮件上点了发送，然后把那本参考书收进了柜子。' },
        effects: { onSuccess: { stats: { san: 12, bond: 6 }, hidden: { runway: 14 }, flags: ['act3-settled'] } },
      },
      {
        id: 'b',
        text: '拒掉，all in 想去的方向',
        hint: '高危：需要专业力检定',
        check: { targetStat: 'skill', difficulty: 16 },
        feedback: {
          onSuccess: '你第一次觉得，前面那件事真的是自己的选择。',
          onFail: '拒信发出去的那天晚上，你反复点开又关掉邮箱。',
        },
        effects: {
          onSuccess: { stats: { skill: 16, san: -6 }, hidden: { runway: -16, peerPressure: 10 }, flags: ['act3-allin'] },
          onFail: { stats: { san: -18, skill: -6 }, hidden: { runway: -20, bodyAlarm: 14 }, flags: ['act3-allin'] },
        },
      },
    ],
  },
  {
    id: 't3-body-warning',
    act: 3,
    title: '身体先替你做了决定',
    weight: 3,
    defaultBeat: '你在早八的教室里突然眼前一黑，被同学扶到了医务室。',
    beatsByState: [
      { when: { hidden: 'bodyAlarm', atLeast: 60 }, line: '医生说：这不是第一次了。' },
    ],
    choices: [
      {
        id: 'a',
        text: '按医嘱停一周，进度往后挪',
        hint: '稳妥：SAN 与身体回升，runway 变紧',
        feedback: { onSuccess: '你把日历上的事一件件往后拖，第一次允许自己慢下来。' },
        effects: { onSuccess: { stats: { san: 16 }, hidden: { bodyAlarm: -30, runway: -14 }, flags: ['act3-rested'] } },
      },
      {
        id: 'b',
        text: '拿了药就回去继续',
        hint: '高危：需要 SAN 检定',
        check: { targetStat: 'san', difficulty: 15 },
        feedback: {
          onSuccess: '你把药揣进口袋，那一周的进度反而超了预期。',
          onFail: '第三天你又在同一个位置被扶出去。',
        },
        effects: {
          onSuccess: { stats: { skill: 12 }, hidden: { bodyAlarm: 14 } , flags: ['act3-pushed'] },
          onFail: { stats: { san: -20 }, hidden: { bodyAlarm: 26 }, flags: ['act3-pushed'] },
        },
      },
    ],
  },
  {
    id: 't3-mentor-doubt',
    act: 3,
    title: '导师开始怀疑你的投入',
    weight: 2,
    requires: ['goal-social'],
    defaultBeat: '导师在走廊里叫住你，问你最近是不是分心了。',
    choices: [
      {
        id: 'a',
        text: '把处境和盘托出',
        hint: '高危：需要羁绊检定',
        check: { targetStat: 'bond', difficulty: 14 },
        feedback: {
          onSuccess: '导师给你划掉了一项任务，说「先保住这个」。',
          onFail: '他听完只说了一句「你自己权衡」。',
        },
        effects: {
          onSuccess: { stats: { bond: 10, san: 10 }, hidden: { mentorTrust: 16, runway: 10 }, flags: ['act3-trusted'] },
          onFail: { stats: { san: -12 }, hidden: { mentorTrust: -20, socialDebt: 10 }, flags: ['act3-trusted'] },
        },
      },
      {
        id: 'b',
        text: '说没事，继续两头跑',
        hint: '稳妥：信任暗中流失',
        feedback: { onSuccess: '你笑着说没问题，转身把两边的活都接了下来。' },
        effects: { onSuccess: { stats: { skill: 8 }, hidden: { mentorTrust: -14, bodyAlarm: 12 }, flags: ['act3-overload'] } },
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* 第四幕：终端 Boss —— 题面与 DC 由完整状态决定                                 */
/* -------------------------------------------------------------------------- */

const ACT4: readonly SceneTemplate[] = [
  {
    id: 't4-terminal',
    act: 4,
    title: '终端亮起：写下你的破局方案',
    weight: 3,
    defaultBeat: '屏幕右下角的字数提示在闪。这一次没有选项，只有你的判断。',
    choices: [
      {
        id: 'a',
        text: '提交方案，交给判卷',
        hint: '终局检定：具体性、证据利用、可执行性、自我认知',
        check: { targetStat: 'skill', difficulty: 15 },
        feedback: { onSuccess: '方案落地的样子，在你脑子里已经很清楚了。' },
        effects: { onSuccess: { flags: ['boss-submitted'] } },
      },
      {
        id: 'b',
        text: '放弃提交，接受这一局的结局',
        hint: '稳妥：不再检定，直接结算',
        feedback: { onSuccess: '你关掉了终端。有些局，认输也是一种收束。' },
        effects: { onSuccess: { stats: { san: -4 }, flags: ['boss-skipped'] } },
      },
    ],
  },
  {
    id: 't4-terminal-calm',
    act: 4,
    title: '终端亮起：这次时间够用',
    weight: 2,
    excludes: ['act3-overload'],
    defaultBeat: '状态还算稳，屏幕上的光标耐心地等着你。',
    choices: [
      {
        id: 'a',
        text: '按部就班写完再交',
        hint: '终局检定（DC 较低）',
        check: { targetStat: 'skill', difficulty: 13 },
        feedback: { onSuccess: '你把方案写成了可执行的三步。' },
        effects: { onSuccess: { flags: ['boss-submitted', 'boss-steady'] } },
      },
      {
        id: 'b',
        text: '再拖一会儿，继续打磨',
        hint: '稳妥：多做准备，代价是 runway',
        feedback: { onSuccess: '你多花了一个小时推敲措辞，交上去的东西更结实了。' },
        effects: { onSuccess: { stats: { skill: 4 }, hidden: { runway: -12 }, flags: ['boss-steady'] } },
      },
    ],
  },
  {
    id: 't4-terminal-hard',
    act: 4,
    title: '终端亮起：题目比预想的难',
    weight: 3,
    requires: ['act3-allin'],
    defaultBeat: '题目要求你同时回答「怎么走」和「什么时候退出」。',
    choices: [
      {
        id: 'a',
        text: '正面回答，连退出条件一起写',
        hint: '终局检定（DC 较高）',
        check: { targetStat: 'skill', difficulty: 17 },
        feedback: { onSuccess: '你连「什么情况下止损」都写清楚了。' },
        effects: { onSuccess: { flags: ['boss-submitted', 'boss-hard'] } },
      },
      {
        id: 'b',
        text: '只写鼓励自己的话交上去',
        hint: '稳妥：不加分也不扣分过多',
        feedback: { onSuccess: '你写了一段话给自己，点下提交。' },
        effects: { onSuccess: { stats: { san: 6 }, flags: ['boss-soft'] } },
      },
    ],
  },
];

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [...ACT1, ...ACT2, ...ACT3, ...ACT4];

/** 剧本修订号：**改任何模板文案或数值都必须 +1**，否则老挑战链接会静默变味道。 */
export const SCENARIO_REVISION = '1';

/** 因果引擎版本。与 revision 分开：引擎改了、剧本没改时只动这里。 */
export const CAUSAL_ENGINE_VERSION = 'v3.0';
