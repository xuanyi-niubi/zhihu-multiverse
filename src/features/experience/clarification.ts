import type { ClarificationNeed, ProblemFrame } from '@/features/experience/domain';

/**
 * 动态澄清（Phase 3 / P0-B）。
 *
 * ## 它替换什么
 *
 * 旧实现固定问三件事（`time` / `verify` / `loss`），选项由问题类型决定。
 * 问题是它**不看用户已经说过什么** —— 用户写了「怕影响课程」，
 * 系统还是会把「哪种损失你不愿意接受」问一遍。
 *
 * ## 与 `decision-session/clarify.ts` 的分工
 *
 * 那边的 `clarifyQuestions()` 仍然保留，作为**兜底**（没有 frame 时使用）。
 * 本模块只**增加**一层：按 frame 里「确实缺什么」生成 0～2 个问题。
 *
 * ## 最重要的一条验收
 *
 * > **用户已经说过 → 绝对不能重复问。**
 *
 * 这条靠复用 `frame.unknowns` 实现：`frame.ts` 已经在生成未知时
 * 判定过「这一项用户提没提」。如果这里再写一套判定，
 * 两处迟早会漂移，然后系统就会开始重复问已经回答过的问题。
 *
 * ## 为什么先不接模型
 *
 * 「让模型自由决定问什么」听起来更好，但它会引入一个不可复核的环节：
 * 模型可能问出与结论无关的问题（为画像完整而收集无用信息）。
 * 先用确定性规则把**上限**（最多 2 个）和**去重**（说过不问）做对，
 * 模型接入放到后面阶段。
 */

/* -------------------------------------------------------------------------- */
/* 触发词                                                                      */
/* -------------------------------------------------------------------------- */

/** 这些目标会吃掉大量时间 → 时间余量会改变结论。 */
const TIME_TRIGGERS: readonly string[] = [
  '比赛', '竞赛', '项目', '考研', '考公', '考编', '备考', '实习', '转行', '转专业',
  '自学', '学习', '创业', '副业', '兼职', '读研', '留学', '二战',
];

/** 这些目标天然涉及「有没有人一起」→ 同伴会改变结论。 */
const ALLY_TRIGGERS: readonly string[] = ['比赛', '竞赛', '项目', '创业', '合作', '组队', '团队', '合伙'];

/** 这些是明显高成本的尝试 → 才值得问「什么情况你会觉得不值得继续」。 */
const HIGH_COST_TRIGGERS: readonly string[] = ['裸辞', '辞职', '脱产', '全职', '创业', '二战', '留学', '读博'];

/** 最多问几个。**上限是刻意的**：问得越多，用户越可能放弃。 */
export const MAX_CLARIFICATION_NEEDS = 2;

function mentions(haystack: string, triggers: readonly string[]): boolean {
  return triggers.some((trigger) => haystack.includes(trigger));
}

/* -------------------------------------------------------------------------- */
/* 问题构造                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 由问题框定生成**该问的**问题（0～2 个）。
 *
 * 候选完全来自 `frame.unknowns`（那里已经排除了用户说过的），
 * 再用触发词判断「这一项对这个问题是否真的会改变结论」。
 * 两道过滤缺一不可：
 *
 * - 只靠 unknowns → 会问与结论无关的问题；
 * - 只靠触发词 → 会重复问用户已经说过的。
 */
export function clarificationNeedsFor(frame: ProblemFrame): readonly ClarificationNeed[] {
  const haystack = `${frame.rawQuestion} ${frame.desiredChange} ${frame.currentSituation}`;
  const byId = new Map(frame.unknowns.map((item) => [item.id, item]));
  const needs: ClarificationNeed[] = [];

  /* ---- ① 时间：只有「这件事确实吃时间」时才值得问 ---- */
  const timeUnknown = byId.get('unknown-time');
  if (timeUnknown && mentions(haystack, TIME_TRIGGERS)) {
    needs.push({
      id: 'need-time',
      question: '未来两周，你现实里能稳定拿出多少时间？',
      reason: 'changes-experiment',
      missingVariable: 'availableTime',
      answerType: 'choice',
      options: [
        { id: 't-3h', label: '几小时，零散的', value: '未来两周约 3 小时' },
        { id: 't-8h', label: '每周 5～10 小时', value: '每周 5–10 小时' },
        { id: 't-20h', label: '每周 15 小时以上', value: '每周 15 小时以上' },
      ],
      priority: 1,
      hint: '它决定后面那个实验做多大 —— 不该要求你挤出没有的时间。',
      optional: true,
    });
  }

  /* ---- ② 同伴：只有「这件事天然要人一起」时才值得问 ---- */
  const allyUnknown = byId.get('unknown-resources');
  if (allyUnknown && mentions(haystack, ALLY_TRIGGERS)) {
    needs.push({
      id: 'need-ally',
      question: '这件事现在是你一个人推进，还是已经有人能一起做？',
      reason: 'changes-world',
      missingVariable: 'existingResources',
      answerType: 'choice',
      options: [
        { id: 'a-alone', label: '目前只有我自己', value: '目前一个人推进' },
        { id: 'a-one', label: '有一个能一起做的人', value: '有一个能一起做的人' },
        { id: 'a-team', label: '已经有一小队人', value: '已经有一小队人' },
      ],
      priority: 2,
      hint: '有人并肩时，中途退出的概率会低很多 —— 这会影响推演里的一幕。',
      optional: true,
    });
  }

  /* ---- ③ 不可接受代价：说过就不问，没说过且成本明显才问 ---- */
  const lossUnknown = byId.get('unknown-loss');
  if (lossUnknown && mentions(haystack, HIGH_COST_TRIGGERS)) {
    needs.push({
      id: 'need-stop',
      question: '什么情况一旦发生，你就会觉得这次尝试不值得继续？',
      reason: 'changes-world',
      missingVariable: 'nonNegotiables',
      answerType: 'choice',
      options: [
        { id: 'l-course', label: '影响课程 / 主业', value: '不能明显影响课程或主业' },
        { id: 'l-money', label: '花钱或断了收入', value: '不能承受金钱损失' },
        { id: 'l-sleep', label: '长期熬夜、身体垮掉', value: '不能牺牲睡眠与身体' },
        { id: 'l-chance', label: '错过别的机会', value: '不能错过其它机会' },
      ],
      priority: 3,
      hint: '它会变成推演里的停止信号 —— 一旦碰到这条线就不该继续加注。',
      optional: true,
    });
  }

  /**
   * 按优先级取前 N 个。
   *
   * 排序是必要的：候选可能有 3 个，而用户只会看到 2 个 ——
   * 必须让**最能改变结论**的那两个先出现。
   */
  return [...needs].sort((left, right) => left.priority - right.priority).slice(0, MAX_CLARIFICATION_NEEDS);
}

/* -------------------------------------------------------------------------- */
/* 答复落地                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 把用户的选择翻译成可读的取值。
 *
 * 与旧 `contextFrom` 的差别：这里**不假设问题集合是固定的**，
 * 而是按 `missingVariable` 分派 —— 以后加新问题时不需要改这里。
 */
export function answerValuesFor(
  needs: readonly ClarificationNeed[],
  answers: Readonly<Record<string, string | undefined>>,
): readonly { readonly variable: string; readonly value: string; readonly text: string }[] {
  const out: { variable: string; value: string; text: string }[] = [];

  for (const need of needs) {
    const picked = answers[need.id];
    if (!picked) {
      continue;
    }
    // 自由文本题（short-text / number）直接把答案当值
    const option = need.options?.find((item) => item.id === picked);
    out.push({
      variable: need.missingVariable,
      value: option?.value ?? picked,
      text: option?.label ?? picked,
    });
  }

  return out;
}
