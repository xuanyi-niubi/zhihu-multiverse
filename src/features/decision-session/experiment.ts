import { stopSignalFor, timeboxFor } from '@/features/decision-session/clarify';

import type { RealityExperiment, UserContext } from '@/features/decision-session/domain';
import type { ProblemFrame, UnknownVariable, UserDifference } from '@/features/experience/domain';

/**
 * 未知驱动的现实实验（P1-1）。
 *
 * ## 为什么换掉「问题类型 → 模板」
 *
 * 旧实现按 `ProblemType`（比赛 / 升学 / 第一份工作 / 转行）查表。
 * 它的问题不是内容差，而是**问题类型根本不决定该验证什么**：
 * 两个都在问「要不要转专业」的人，一个真正不知道的是「我能不能每周
 * 稳定拿出 10 小时」，另一个真正不知道的是「我到底喜欢它，还是只是
 * 喜欢想象中的它」。同一张表给不出两个不同的答案。
 *
 * 新实现从**本局世界蓝图的那个未知**出发（`WorldBlueprint.keyUnknown`），
 * 未知的类型决定实验的形态：
 *
 * ```text
 * time-capacity     → 七天真实时间记录（不是「你要更自律」）
 * ally-availability → 真去联系 3 个人，完成一次 30 分钟共同任务
 * interest-fit      → 做完一个 3 小时的最小任务，记录还想不想继续
 * skill-capability  → 做一次最小实战，把结果给一个真人看
 * cost-tolerance    → 按那条路的节奏过一天，记录实际付出了什么
 * reversibility     → 先把退出口查清（成本、时间窗、可撤回的部分）
 * information-gap   → 找 2 位走过这条路的人，各问 20 分钟
 * ```
 *
 * ## 六要素一个都不能少
 *
 * 假设、动作、时间盒、产物、成功信号、**停止信号**。
 * 停止信号沿用用户自己说的那种损失（`stopSignalFor`），
 * 不给一个通用的「注意风险」。
 *
 * ## 纪律：实验只回答那个未知
 *
 * `reducesUnknown` 必须等于未知本身。一个动作若答不了它，
 * 就不该出现在这里 —— 否则玩家做完七天，未知还在原地。
 */

/** 未知类型的关键词推断（`kind` 缺失时的兜底，确定性）。 */
export function inferUnknownKind(label: string): NonNullable<UnknownVariable['kind']> {
  /**
   * 「资源」类问题优先判成 information-gap：
   * 「你手上已有的资源（时间、技能、人脉）」里同时出现「时间」「技能」，
   * 若按先后顺序匹配会被误判成时间容量，而它真正缺的是信息。
   */
  if (/资源|人脉|手上已有|信息|不了解|不清楚/.test(label)) {
    return 'information-gap';
  }
  if (/时间|小时|精力|空闲|忙|周|月/.test(label)) {
    return 'time-capacity';
  }
  if (/队友|伙伴|组队|协作|一起做|人找|搭子/.test(label)) {
    return 'ally-availability';
  }
  if (/喜欢|兴趣|热爱|适合|愿意继续|坚持不下去/.test(label)) {
    return 'interest-fit';
  }
  if (/能力|基础|水平|会不会|能不能学会|够不够/.test(label)) {
    return 'skill-capability';
  }
  if (/代价|损失|承受|影响|熬|牺牲/.test(label)) {
    return 'cost-tolerance';
  }
  if (/退出|反悔|退不回来|退回来|回不去|能不能退|脱产|辞职|放弃|沉没/.test(label)) {
    return 'reversibility';
  }
  return 'information-gap';
}

/**
 * 与用户差异里最该被实验盯住的一条。
 *
 * `different` 优先（条件不可比，最容易让「别人的结论」在用户身上失效），
 * 其次 `unknown`（我们连他的那一项都不知道）。没有差异就返回 null。
 */
function sharpestDifference(
  differences: readonly UserDifference[],
): UserDifference | null {
  return (
    differences.find((item) => item.relation === 'different') ??
    differences.find((item) => item.relation === 'unknown') ??
    null
  );
}

/** 「他们和你哪里不同」的一句话，用于实验假设。 */
function differenceClause(difference: UserDifference | null): string {
  if (!difference) {
    return '';
  }
  const theirs = difference.experienceValue ?? '不清楚';
  const yours = difference.userValue ?? '你没说';
  return `样本里这一项是「${theirs}」，而你是「${yours}」—— 别人的结论不能直接搬到你身上。`;
}

export interface ExperimentFromUnknownInput {
  readonly unknown: UnknownVariable;
  readonly frame: ProblemFrame;
  readonly differences: readonly UserDifference[];
  readonly context: UserContext;
}

/**
 * 从未知推导现实实验。**纯函数**：同输入必得同输出。
 */
export function experimentFromUnknown(input: ExperimentFromUnknownInput): RealityExperiment {
  const kind = input.unknown.kind ?? inferUnknownKind(input.unknown.label);
  const box = timeboxFor(input.context);
  const stop = stopSignalFor(input.context);
  const tension = input.frame.centralTension || input.frame.rawQuestion;
  const diff = differenceClause(sharpestDifference(input.differences));
  const unknown = input.unknown.label;

  switch (kind) {
    case 'time-capacity':
      return {
        hypothesis: `「${unknown}」不能靠估计回答 —— 人对自己的时间余量普遍估计偏高。这一局的核心张力是「${tension}」，${diff}先用七天真实记录换一个数。`,
        action: '连续 7 天记录真实投入：每天结束时写一行「今天为这件事实际投入了 X 分钟」，不补齐、不美化，没做就写 0。',
        timebox: '7 天，每天约 2 分钟记录（不是让你每天投入两小时）',
        artifact: '一份七天的真实投入记录，以及一个中位数。',
        successSignal: `中位数达到你心里那条线（例如每周 8 小时）——这说明这条路的投入是可持续的，而不是靠某一天爆发。`,
        stopSignal: `${stop}若七天里有五天记的是 0，说明当前条件下容量不支持 —— 先去改条件，而不是先怪自己。`,
        reducesUnknown: unknown,
      };

    case 'ally-availability':
      return {
        hypothesis: `「${unknown}」只能在真实协作里验证，不能靠想象。${diff}`,
        action: '列出 5 个可能的合作人选，真的去联系其中 3 个，约一次 30 分钟的线上共同任务（一起看一个问题、一起写一版提纲都算）。',
        timebox: box,
        artifact: '三次联系记录（谁答应了、谁没回、那次 30 分钟实际产出了什么）。',
        successSignal: '至少有 1 个人愿意为同一件事再花第二次 30 分钟 —— 这比「他说很感兴趣」可信得多。',
        stopSignal: `${stop}若 3 个人全部无回应或全部爽约，先停下：这可能是你当前圈子的问题，换圈子比硬找队友更值得先做。`,
        reducesUnknown: unknown,
      };

    case 'interest-fit':
      return {
        hypothesis: `「${unknown}」的答案是「喜欢想象中的它」还是「喜欢真的做它」，只有做完一次真实任务才知道。${diff}`,
        action: '选一个能代表这条路的**最小真实任务**（不是看课、不是读攻略），连续投入 3 小时把它做完，中途记录两次「我现在想不想继续」。',
        timebox: '3 小时，一次做完',
        artifact: '一个做完的小成果 + 两条「想不想继续」的即时记录。',
        successSignal: '3 小时后你愿意主动安排下一次 —— 注意是「想再做」而不是「应该做」。',
        stopSignal: `${stop}若你全程在刷手机、靠意志力硬撑，那就是答案本身：你喜欢的可能是它的结果，不是它的过程。`,
        reducesUnknown: unknown,
      };

    case 'skill-capability':
      return {
        hypothesis: `「${unknown}」要用一次**有人看得到**的实战来测，而不是自我评估。${diff}`,
        action: '找一个真实的小需求（作业、比赛里的一个小模块、一次接单都行），独立做完，然后交给一个真人看 15 分钟并请他挑毛病。',
        timebox: box,
        artifact: '一个能给别人看的小东西，以及那位真人的具体意见。',
        successSignal: '他能说出「你缺的是哪一块」——说明你的水平已经能被具体讨论，而不是「还差得远」这种模糊判断。',
        stopSignal: `${stop}若连最小任务都要靠别人代做才能交付，先补基础，别急着用一个大项目证明自己。`,
        reducesUnknown: unknown,
      };

    case 'cost-tolerance':
      return {
        hypothesis: `「${unknown}」的答案不在别人的描述里 —— 同样一份代价，不同的人承受度完全不同。${diff}`,
        action: '把这条路上已知的代价逐条写下来（来自你看到的真实经历），然后挑一天**按那条路的节奏过一天**，记录哪一条你当场就想退出。',
        timebox: box,
        artifact: '一份代价清单 + 这一天里你真实的反应记录。',
        successSignal: '你能指出「哪一条我愿意长期承担、哪一条我不愿意」——这比笼统的「我能不能吃苦」有用得多。',
        stopSignal: `${stop}碰到那条你明确说不愿意接受的代价时，就该停下重新算账，而不是先扛过去再说。`,
        reducesUnknown: unknown,
      };

    case 'reversibility':
      return {
        hypothesis: `「${unknown}」的关键不是它值不值得，而是**走错了还能不能退回来**。${diff}`,
        action: '查清三件事并写下来：退出的直接成本、还有多久会错过退出的时间窗、以及哪些部分是可以撤回的（学到的技能、认识的人）。',
        timebox: box,
        artifact: '一页「退出条件」：什么时间点、什么信号出现，你就要重新决定。',
        successSignal: '你能写下一条具体的退出条件（时间点 + 信号），而不是「反正随时可以不干」。',
        stopSignal: `${stop}如果连退出条件都写不出来，说明这件事的可逆性可能比你以为的低，先别开始。`,
        reducesUnknown: unknown,
      };

    case 'information-gap':
    default:
      return {
        hypothesis: `「${unknown}」现在缺的是信息，不是决心。这一局的张力是「${tension}」，${diff}`,
        action: '找 2 位已经走在这条路上 1～3 年的人，各问 20 分钟：他们当时的信息是什么、现在怎么判断、如果重来会不会改。',
        timebox: box,
        artifact: '两份对话记录，以及「他们的条件和我哪里不同」的清单。',
        successSignal: '你能说出至少一处「他们的条件和我不同」——这说明你已经在用信息判断，而不是在借别人的结论给自己打气。',
        stopSignal: `${stop}若两场谈话后你仍然只拿到「加油，你可以的」这类话，说明这两个人选错了 —— 换人，而不是降低要求。`,
        reducesUnknown: unknown,
      };
  }
}
