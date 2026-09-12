import type { ProblemType } from '@/features/decision-session/routes';
import type { RealityExperiment, UserContext } from '@/features/decision-session/domain';

/**
 * 澄清问题（重构方案 §3.1 第二步）。
 *
 * ## 原则（方案原文）
 *
 * > 每个问题都必须能改变后面的路径排序或现实实验；
 * > 不能为了「画像完整」而收集无用信息。
 *
 * 所以这里只问三件事，而且**每一件都直接喂给后面的实验生成**：
 *
 * | 问题 | 它改变什么 |
 * |---|---|
 * | 能拿出多少时间 | 决定实验的时间盒（3 小时 / 一周） |
 * | 最想先弄清什么 | 决定选中哪个 unknown，以及实验要检验的假设 |
 * | 最不能接受哪种损失 | 决定停止信号（防止用不可接受的代价去换一个验证） |
 *
 * ## 绝不问的东西
 *
 * 经济状况、家庭承受力、心理状态、性格标签 —— 方案 §4.2 明确禁止
 * 「在用户没有给出信息时推断其经济、心理或家庭承受力」。
 * 这里只问**与这个选择直接相关**的当下约束。
 */

export interface ClarifyOption {
  readonly id: string;
  readonly label: string;
  /** 选中后写进 `UserContext` 的原文表述（不做单位换算）。 */
  readonly value: string;
}

export interface ClarifyQuestion {
  readonly id: 'time' | 'verify' | 'loss';
  readonly question: string;
  readonly hint: string;
  readonly options: readonly ClarifyOption[];
  /** 是否允许不选（跳过）。三项都可以跳过，缺失就在展示层写「待验证」。 */
  readonly optional: boolean;
}

/**
 * 三个澄清问题。
 *
 * 选项按问题类型微调：问「比赛」和问「转行」时，「最想先弄清」的候选不同 ——
 * 否则第二问会退化成一句放之四海皆准的废话。
 */
export function clarifyQuestions(type: ProblemType | null): readonly ClarifyQuestion[] {
  const verifyOptions: readonly ClarifyOption[] = (() => {
    switch (type) {
      case 'competition':
        return [
          { id: 'can-finish', label: '我能不能真的做出一个能交付的东西', value: '能不能做出一次完整交付' },
          { id: 'worth-it', label: '这件事值不值得我投入这些时间', value: '投入产出是否值得' },
          { id: 'affects-main', label: '会不会拖累我的课程 / 主线', value: '会不会拖累课程或主线' },
        ];
      case 'postgrad-or-job':
        return [
          { id: 'better-option', label: '多读几年能不能真的换来更好的选择', value: '学历能否换来更好的选择' },
          { id: 'opportunity-cost', label: '现在就业的机会成本有多大', value: '现在就业的机会成本' },
          { id: 'stability', label: '我到底是想要成长还是想要稳定', value: '成长与稳定哪个对我更重要' },
        ];
      case 'first-job':
        return [
          { id: 'learn', label: '这个地方能不能让我快速学到东西', value: '能不能快速成长' },
          { id: 'survive', label: '这份收入能不能让我先稳住', value: '收入能否支撑当下' },
          { id: 'direction', label: '它会不会把我锁进一个不想要的方向', value: '会不会锁死方向' },
        ];
      case 'pivot':
        return [
          { id: 'feasible', label: '我现在的条件到底能不能转过去', value: '现有条件是否足以转向' },
          { id: 'cost', label: '转的过程要付出什么代价', value: '转向要付出的代价' },
          { id: 'regret', label: '万一不成，我还能不能回来', value: '失败后能否退回' },
        ];
      default:
        return [
          { id: 'feasible', label: '我能不能做到', value: '能不能做到' },
          { id: 'worth-it', label: '值不值得', value: '值不值得' },
          { id: 'side-effect', label: '会不会影响别的事', value: '会不会影响其它事' },
        ];
    }
  })();

  return [
    {
      id: 'time',
      question: '未来两周，你大概能稳定拿出多少时间？',
      hint: '这个答案决定后面那个实验做多大 —— 它不该要求你挤出没有的时间。',
      optional: true,
      options: [
        { id: 't-3h', label: '几小时，零散的', value: '未来两周约 3 小时' },
        { id: 't-8h', label: '每周 5～10 小时', value: '每周 5–10 小时' },
        { id: 't-20h', label: '每周 15 小时以上', value: '每周 15 小时以上' },
      ],
    },
    {
      id: 'verify',
      question: '这件事里，你最想先弄清哪一个？',
      hint: '系统只会针对你选中的这一个未知设计实验，不会一次给你一堆建议。',
      optional: true,
      options: verifyOptions,
    },
    {
      id: 'loss',
      question: '哪种损失是你不愿意接受的？',
      hint: '它会变成实验的「停止信号」—— 一旦碰到这条线就不该继续加注。',
      optional: true,
      options: [
        { id: 'l-course', label: '影响课程 / 主业', value: '不能明显影响课程或主业' },
        { id: 'l-money', label: '花钱或断了收入', value: '不能承受金钱损失' },
        { id: 'l-sleep', label: '长期熬夜、身体垮掉', value: '不能牺牲睡眠与身体' },
        { id: 'l-chance', label: '错过别的机会', value: '不能错过其它机会' },
      ],
    },
  ];
}

/** 把选择结果合成 `UserContext`。缺项保持缺失，不推断。 */
export function contextFrom(input: {
  readonly goal: string;
  readonly answers: Readonly<Record<string, string | undefined>>;
  readonly questions: readonly ClarifyQuestion[];
}): UserContext {
  const pick = (questionId: string, optionId: string | undefined): string | undefined => {
    if (!optionId) {
      return undefined;
    }
    const question = input.questions.find((item) => item.id === questionId);
    return question?.options.find((option) => option.id === optionId)?.value;
  };

  const time = pick('time', input.answers.time);
  const verify = pick('verify', input.answers.verify);
  const loss = pick('loss', input.answers.loss);

  return {
    goal: input.goal,
    ...(time ? { availableTime: time } : {}),
    ...(verify ? { wantToVerify: verify } : {}),
    // nonNegotiables 是数组：本版只有一问，因此最多一项；缺失就是空数组
    nonNegotiables: loss ? [loss] : [],
    existingResources: [],
  };
}

/* -------------------------------------------------------------------------- */
/* 7 天实验                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 生成现实实验（方案 §3.1 第五步 / §5.1）。
 *
 * ## 六件事缺一不可
 *
 * 假设、动作、时间盒、产物、成功信号、**停止信号**。
 * 没有停止信号的实验不是实验，是赌博 —— 用户会在沉没成本里越陷越深。
 *
 * ## 时间盒必须跟着用户给的可用时间走
 *
 * 用户说「未来两周约 3 小时」，实验就**不能**要求他每周 10 小时。
 * 那是最常见的一种「建议看起来很对、但根本做不了」。
 */
export function experimentFor(input: {
  readonly type: ProblemType | null;
  readonly context: UserContext;
}): RealityExperiment {
  const unknown = input.context.wantToVerify ?? '这件事到底适不适合我';
  const time = input.context.availableTime ?? '（你还没说能拿出多少时间）';
  const loss = input.context.nonNegotiables[0] ?? '影响你最重要的事';

  /** 时间盒按用户自述的可用量取最小可行档。 */
  const box = (() => {
    if (/3\s*小时|几小时/.test(time)) {
      return '3 小时，一次性做完';
    }
    if (/5–10|5-10/.test(time)) {
      return '一周内投入 6 小时';
    }
    if (/15\s*小时/.test(time)) {
      return '一周内投入 12 小时';
    }
    // 没给时间 → 取最小档，并让用户自己收紧
    return '3 小时（你还没说可用时间，先按最小档做）';
  })();

  const stop = `如果它开始${loss}，立刻停下，先解决这件事而不是继续加注。`;

  switch (input.type) {
    case 'competition':
      return {
        hypothesis: `你真正想验证的是：${unknown}。把它变成一个能做完的小东西，比继续收集别人的经验更能回答它。`,
        action: '用可用的时间做出一个最小可交付物（能跑 / 能看 / 能讲 3 分钟），然后找一个人给你 15 分钟的真实反馈。',
        timebox: box,
        artifact: '一个能给别人看的最小成果，以及一段 3 分钟讲清它的说明。',
        successSignal: '你能列出「还差哪些任务」并且每一项都估得出时间 —— 这说明你能判断后续投入，而不是只能靠猜。',
        stopSignal: stop,
        reducesUnknown: unknown,
      };
    case 'postgrad-or-job':
      return {
        hypothesis: `你想弄清「${unknown}」，而这件事只能用手上真实的信息去验证，不能靠再读一轮别人的经历。`,
        action: '找 2 位已经走在这条路上 1～3 年的人，各问 20 分钟：他们当时的信息、现在的判断、以及如果重来会不会改。',
        timebox: box,
        artifact: '两份对话记录，以及「他们和我的处境哪一点不一样」的清单。',
        successSignal: '你能说出至少一处「他们的条件和我不同」，并且知道自己缺的是哪条信息。',
        stopSignal: stop,
        reducesUnknown: unknown,
      };
    case 'first-job':
      return {
        hypothesis: `你想弄清「${unknown}」，而岗位描述和面试话术都不会告诉你答案。`,
        action: '找 1～2 位在这类岗位做过半年以上的人，问三件具体的事：每天实际在做什么、半年后能带走什么、最想吐槽什么。',
        timebox: box,
        artifact: '一份「这个岗位真实的一天」的记录，以及你愿意接受 / 不接受的部分。',
        successSignal: '你能具体说出这份工作半年后会给你什么（技能、作品或人脉），而不是「应该会有成长」。',
        stopSignal: stop,
        reducesUnknown: unknown,
      };
    case 'pivot':
      return {
        hypothesis: `你想验证「${unknown}」，那就先做一次最小规模的接触，而不是先做决定。`,
        action: '用可用时间完成一次新方向的最小任务（一个练习、一次接单、一节真实的课），并记录你在过程中是变投入还是变抗拒。',
        timebox: box,
        artifact: '一个小成果 + 一份「我在这件事上的真实体感」记录。',
        successSignal: '你能说出新方向里哪一部分你做得下去、哪一部分你其实很排斥 —— 这比「我喜不喜欢」具体得多。',
        stopSignal: stop,
        reducesUnknown: unknown,
      };
    default:
      return {
        hypothesis: `你想弄清「${unknown}」。与其继续想，不如先拿一个能回答它的小动作去换信息。`,
        action: '把这个问题拆成一个你能在可用时间里完成的最小动作，做完后找一个人讲一遍你的结论。',
        timebox: box,
        artifact: '一份写下来的结论，以及「我还缺哪条信息」。',
        successSignal: '你能说出自己缺的是哪一条具体信息，以及去哪里能拿到它。',
        stopSignal: stop,
        reducesUnknown: unknown,
      };
  }
}
