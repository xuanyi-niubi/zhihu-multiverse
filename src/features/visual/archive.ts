import type { ExperienceFact, SearchPurpose } from '@/features/experience/domain';

/**
 * 平行人生档案馆的**纯函数层**（报告 §26 / §30 / §31）。
 *
 * ## 为什么逻辑必须留在这里，而不是写进组件
 *
 * 报告 §30 给视觉组件定了一条硬边界：
 *
 * > 这些视觉组件不要直接调用 API，只接收 state / text / items / active。
 *
 * 但「哪些片段属于哪条轨道」「问题到底有没有被改写」「这一刻该冷还是该暗」
 * 都是**判断**，不是渲染。把它们塞进 JSX 之后就无法测试，也会随动画改写而漂移。
 *
 * 所以这里只做三件纯事，输入输出都是数据：
 *
 * ```text
 * fragmentTrackOf / archiveFragments  → 把真实片段分进三条轨道（§8）
 * compileHeadline                     → 编译页此刻该说什么（§7 / §9）
 * questionMorphOf / actAtmosphereOf   → 问题有没有变清楚 / 这一幕什么氛围（§10 / §24）
 * ```
 *
 * **纪律**：函数里没有随机、没有网络、没有「补一条」——找不到就是 null / 空数组。
 */

export type FragmentTrack = 'similar' | 'alternative' | 'counter';

/** 编译页的生命周期（报告 §7 / §9）。`idle` 只用于无会话的兜底渲染。 */
export type ArchivePhase = 'idle' | 'searching' | 'assembling' | 'ready';

/** 三幕氛围（报告 §10）：冷蓝 / 更暗更近 / 灰蓝琥珀分叉 / 接近纯黑。 */
export type ActAtmosphere = 'cold' | 'close' | 'fork' | 'still';

export const FRAGMENT_TRACK_ORDER: readonly FragmentTrack[] = ['similar', 'alternative', 'counter'];

/** 三条轨道的名字固定 —— 它们是产品语言，不是随便起的 UI 文案（报告 §8）。 */
export const FRAGMENT_TRACK_LABEL: Readonly<Record<FragmentTrack, string>> = {
  similar: '与你相似',
  alternative: '另一种走法',
  counter: '相反结果',
};

export interface ArchiveFragment {
  readonly id: string;
  readonly sourceId: string;
  readonly quote: string;
  readonly author: string;
  readonly title: string | null;
  readonly sourceEditTime: number | null;
  readonly relevance: number;
  readonly qualification?: ExperienceFact['qualification'];
  readonly sourceUrl: string | null;
  readonly track: FragmentTrack;
}

/**
 * 一条真实片段属于哪条轨道。
 *
 * 优先级 **反例 > 另一种走法 > 与你相似**，与 `compileWorld` 的四轮优先级
 * 和会话页命中口径保持一致：一条同时带相似与反例标签的片段，
 * 应该被当成反例展示，而不是被轻描淡写地归进相似。
 *
 * 没有这三类意图时返回 `null`：**不硬塞进任何一条轨道**，
 * 因为「不属于这里」本身是真实信息。
 */
export function fragmentTrackOf(purposes: readonly SearchPurpose[]): FragmentTrack | null {
  if (purposes.includes('counterexample') || purposes.includes('failure')) {
    return 'counter';
  }
  if (purposes.includes('alternative')) {
    return 'alternative';
  }
  if (purposes.includes('similar-person')) {
    return 'similar';
  }
  return null;
}

/**
 * 蓝图给一条片段标注的**证据角色**（`WorldActSpec.evidenceRole`）。
 *
 * 它与 `SearchPurpose` 是两个轴：`purposes` 来自检索意图，`evidenceRole`
 * 来自世界编译「这一幕引用它是为了什么」。离线兜底数据常常没有 purposes，
 * 但有角色 —— 所以轨道推导必须两条都认。
 */
export type EvidenceRole = 'support' | 'cost' | 'counterexample' | 'reflection';

/**
 * 由证据角色推出显示轨道。
 *
 * `support → 与你相似`、`counterexample → 相反结果`；
 * `cost` / `reflection` 都属于**主路径内部**的信息（会在对应幕里出现），
 * 不冒充某条独立轨道，因此返回 null。
 */
export function roleTrackOf(role: EvidenceRole | undefined): FragmentTrack | null {
  if (role === 'support') {
    return 'similar';
  }
  if (role === 'counterexample') {
    return 'counter';
  }
  return null;
}

/**
 * 把真实片段整理成三条轨道上的切片，并按轨道返回（报告 §8）。
 *
 * - 丢掉空引文：没有逐字内容的片段上不了墙；
 * - 按 id 去重：同一片段带多个 purpose 时只出现一次；
 * - 每条轨道默认最多 5 条：这是**排版容量**，不是证据强度，所以不额外声明；
 * - `resolveTrack` 默认按检索意图分轨；离线数据没有 purposes 时，
 *   调用方可以传入一个基于蓝图 `evidenceRole` 的解析器（**仍是真实标注**，
 *   不是补造出来的分类）。
 */
export function archiveFragments(
  facts: readonly ExperienceFact[],
  maxPerTrack = 5,
  resolveTrack: (fact: ExperienceFact) => FragmentTrack | null = (fact) =>
    fragmentTrackOf(fact.purposes),
): readonly { readonly track: FragmentTrack; readonly items: readonly ArchiveFragment[] }[] {
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  const buckets: Record<FragmentTrack, ArchiveFragment[]> = {
    similar: [],
    alternative: [],
    counter: [],
  };

  for (const fact of facts) {
    const quote = typeof fact.exactQuote === 'string' ? fact.exactQuote.trim() : '';
    if (quote.length === 0 || seen.has(fact.id) || seenSources.has(fact.sourceId)) {
      continue;
    }
    const track = resolveTrack(fact);
    if (!track || buckets[track].length >= maxPerTrack) {
      continue;
    }
    seen.add(fact.id);
    seenSources.add(fact.sourceId);
    buckets[track].push({
      id: fact.id,
      sourceId: fact.sourceId,
      quote,
      author: fact.author,
      title: fact.sourceTitle ?? null,
      sourceEditTime: fact.sourceEditTime ?? null,
      relevance: fact.relevance,
      ...(fact.qualification ? { qualification: fact.qualification } : {}),
      sourceUrl: fact.sourceUrl ?? null,
      track,
    });
  }

  return FRAGMENT_TRACK_ORDER.map((track) => ({ track, items: buckets[track] }));
}

/** 编译页标题：说「正在做什么」，不说进度百分比（报告 §7）。 */
export function compileHeadline(phase: ArchivePhase, foundTotal: number): string {
  if (phase === 'ready') {
    return 'WORLD READY';
  }
  if (phase === 'assembling') {
    return foundTotal > 0
      ? `正在把 ${foundTotal} 段真实人生编译成你的世界。`
      : '正在把这些人生编译进你的世界。';
  }
  return '正在寻找真正走过这些路的人。';
}

/** 编译页副标题（报告 §7 的固定一句）。 */
export const COMPILE_SUBTITLE = '正在寻找真正走过这些路的人。';

/**
 * 问题形变（报告 §24）：区分「原问题」与「重写后的问题」。
 *
 * `changed` 为 false 时，界面必须**如实保留原问题**而不是假装收敛出了新问题 ——
 * 这与终局「这一局没有收敛出一个未知」的既有纪律同源。
 */
export interface QuestionMorphView {
  readonly original: string;
  readonly rewritten: string | null;
  readonly changed: boolean;
}

export function questionMorphOf(
  original: string,
  rewritten: string | null | undefined,
): QuestionMorphView {
  const next = typeof rewritten === 'string' ? rewritten.trim() : '';
  return {
    original: original.trim(),
    rewritten: next.length > 0 ? next : null,
    changed: next.length > 0 && next !== original.trim(),
  };
}

/** 幕次氛围：由蓝图目标推导，不由幕序号猜（报告 §10）。 */
export function actAtmosphereOf(
  objective: 'enter-world' | 'experience-cost' | 'meet-counterexample',
  ended = false,
): ActAtmosphere {
  if (ended) {
    return 'still';
  }
  if (objective === 'experience-cost') {
    return 'close';
  }
  if (objective === 'meet-counterexample') {
    return 'fork';
  }
  return 'cold';
}
