import type { RealityExperiment } from '@/features/decision-session/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';

/**
 * 终局「现实支线」的视图模型（P1-2）。
 *
 * ## 为什么值得单独一个纯函数
 *
 * 终局那一屏有两件事最容易做错，而它们都不该藏在 2900 行的页面里：
 *
 * 1. **「这一局你重新看见了什么」只能来自本局真实发生过的事**
 *    （别人真的走过的路、真的引用到的反例、玩家真的选过的经验解锁）。
 *    凑不满就少说几条，不写「你成长了」这种没有出处的话。
 * 2. **没有实验就不给承诺候选**。认下的必须是一条有成功信号与
 *    停止信号的真实实验；宁可不给按钮，也不给一个空洞的「我记住了」。
 *
 * 抽成纯函数之后这两条都可以直接被测试钉住。
 */

export interface RealityQuestCandidate {
  readonly id: string;
  readonly action: string;
  readonly timeBox: string;
  readonly signal: string;
  readonly verifyHint: string;
}

export interface RealityQuestView {
  /** 任何人的经验都替不了的那个问题。 */
  readonly keyUnknown: string | null;
  /** 这一局重新看见了什么（≤3 条，全部有出处）。 */
  readonly seen: readonly string[];
  /** 可以认下的现实支线；没有实验时为 null。 */
  readonly candidate: RealityQuestCandidate | null;
  /** 没有实验时，回会话页把它变成实验的地址。 */
  readonly designHref: string | null;
}

const MAX_SEEN = 3;

/**
 * 组装终局视图。**纯函数**。
 *
 * 没有世界蓝图（legacy `/play?goal=`）时返回 null —— 终局保持旧样子，
 * 不硬塞一个空壳面板。
 */
export function realityQuestViewOf(input: {
  readonly sessionId: string;
  readonly blueprint: WorldBlueprint | null | undefined;
  readonly experiment: RealityExperiment | null | undefined;
  readonly usedUnlockIds: readonly string[];
}): RealityQuestView | null {
  const blueprint = input.blueprint;
  if (!blueprint) {
    return null;
  }

  /**
   * 三条有出处的回顾，顺序固定：
   * 真实走法 → 真的撞见反例 → 真的选过经验解锁。
   */
  const seen: string[] = [];

  const labels = blueprint.paths.slice(0, 2).map((path) => path.label);
  if (labels.length > 0) {
    seen.push(`有人真的这样走过：${labels.join('；')}`);
  }

  const counterAct = blueprint.acts.find((act) => act.objective === 'meet-counterexample');
  if ((counterAct?.experienceFactIds.length ?? 0) > 0) {
    seen.push('走过相似的路、但结果不同的人也真的存在 —— 这一局你撞见了他们');
  }

  const usedUnlocks = new Set(input.usedUnlockIds);
  if (blueprint.unlocks.some((unlock) => usedUnlocks.has(unlock.id))) {
    seen.push('你选过一个原本不存在的做法 —— 它来自某个人真实做过的事');
  }

  const experiment = input.experiment ?? null;

  return {
    keyUnknown: blueprint.keyUnknown?.label ?? null,
    seen: seen.slice(0, MAX_SEEN),
    candidate: experiment
      ? {
          id: `reality-quest:${input.sessionId}`,
          action: experiment.action,
          timeBox: experiment.timebox,
          signal: experiment.successSignal,
          verifyHint: experiment.stopSignal,
        }
      : null,
    designHref: `/session/${input.sessionId}`,
  };
}
