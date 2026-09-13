import type {
  ExperienceFact,
  ExperiencePath,
  ProblemFrame,
  UnknownVariable,
} from '@/features/experience/domain';

/**
 * 世界蓝图的领域契约（迁移期新增，**不改变现有行为**）。
 *
 * ## 它是什么
 *
 * 把「一批真实经历」**编译成一场可以玩的推演**，而不是一份报告。
 *
 * 旧做法的分工是：证据网格给人看，AI DM 另起一套生成剧本 ——
 * 两者之间只有松耦合。结果是「你看到的现实」与「你玩的游戏」
 * 说不上是同一件事。
 *
 * WorldBlueprint 把两者钉在一起：
 *
 * ```text
 * ProblemFrame（你的处境）
 *   + ExperiencePath（真实走法）
 *   + ExperienceFact（逐字片段）
 *   → WorldActSpec × N（三幕 + 终局）
 *   → ExperienceChoiceUnlock（被真实经历解锁的新选择）
 *   → forbiddenClaims（DM 不允许越过的现实边界）
 * ```
 *
 * ## 两条纪律
 *
 * 1. `forbiddenClaims` 是**给 DM 的负向约束**：模型可以编叙事，
 *    但不能越过这些现实边界（例如「不能说这条路成功率高」）。
 * 2. `ExperienceChoiceUnlock` 是**游戏行动模板，不是现实建议** ——
 *    类型注释里写死这句话，避免后续把它渲染成「你应该做 X」。
 */

/**
 * 一条**被真实经历解锁**的新选择项。
 *
 * 这是整个方案里最像「游戏」的一环：玩家读到某段真实经历后，
 * 在下一幕里**多出一个原本没有的选项**。
 *
 * 注意最后那句注释：它是游戏行动，不是对玩家的人生建议。
 */
export interface ExperienceChoiceUnlock {
  readonly id: string;

  readonly label: string;
  readonly description: string;

  /** 解开它的原始片段（可点回原文，因此玩家能看出「这个选项从哪来」）。 */
  readonly sourceFactIds: readonly string[];

  /**
   * 这是一个游戏行动模板，**不是现实建议**。
   */
  readonly choice: {
    readonly text: string;
    readonly hint: string;

    readonly tags?: {
      readonly moral?: 'good' | 'neutral' | 'dark';
      readonly efficiency?: 'direct' | 'indirect' | 'risky';
      readonly social?: 'ally' | 'neutral' | 'antagonize';
    };
  };

  /** 从第几幕开始可用。 */
  readonly availableFromAct: number;
}

/**
 * 一幕的规格。
 *
 * 三类目标对应「让人亲身体会」的三种方式：
 * 走进去 / 代价出现 / 反例出现。
 * 注意第三类是**反例**而不是「成功案例」——
 * 只给成功样本的推演是在替玩家打气，不是帮他判断。
 *
 * 没有第四幕「终局反思」：终局不是再演一幕，而是把玩家原来的问题
 * 重写成一个他必须自己回到现实去验证的问题。
 */
export interface WorldActSpec {
  readonly act: number;

  readonly objective:
    | 'enter-world'
    | 'experience-cost'
    | 'meet-counterexample';

  readonly titleHint: string;

  /**
   * 本幕引用的事实**扮演什么角色**（P0-7，可选）。
   *
   * 它存在的理由只有一个：让「第三幕是反例幕」这件事**可断言**。
   * 有它之后，下游可以检查「这一幕引用的事实到底是支持、代价、
   * 反例还是反思」，而不是靠幕序号猜。没有反例时不标 ——
   * 留空本身就是「本幕没有反例证据」的诚实信号。
   */
  readonly evidenceRole?: 'support' | 'cost' | 'counterexample' | 'reflection';

  readonly conflict: string;

  readonly primaryPathIds: readonly string[];
  readonly experienceFactIds: readonly string[];

  /** 这一幕可以解锁哪些新选择。 */
  readonly unlockIds: readonly string[];
}

/**
 * 世界蓝图：一场推演的完整规格。
 *
 * `version` 是必要的：蓝图会被存进会话并在后续请求里复用，
 * 没有版本号就无法安全演进这个结构。
 */
export interface WorldBlueprint {
  readonly version: 'world-blueprint-v1';

  readonly sessionId: string;

  readonly problemFrame: ProblemFrame;
  readonly centralTension: string;

  readonly paths: readonly ExperiencePath[];

  /** 当前最该先弄清的那一个未知（没有就是 null，不编一个）。 */
  readonly keyUnknown: UnknownVariable | null;

  readonly acts: readonly WorldActSpec[];

  readonly experienceFacts: readonly ExperienceFact[];

  readonly unlocks: readonly ExperienceChoiceUnlock[];

  /**
   * DM 不允许越过的现实边界。
   *
   * 这些是**自然语言禁令**，会被注入 DM 提示词。例如
   * 「不得声称某条路成功率高」「不得把样本上沿说成玩家的门槛」。
   */
  readonly forbiddenClaims: readonly string[];
}
