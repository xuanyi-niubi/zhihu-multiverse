/**
 * 种子挑战链接的拼装（纯函数，便于单测）。
 *
 * 挑战的卖点是「同一颗种子 = 同一组骰面、同一场推演」。**只带 seed 是不够的**：
 * 少带 `scenario` 会让被挑战者静默回落到默认剧本 ——
 * 表面上在比同一局，实际是两场不同的推演。这个模块把两处拼装都收进来，
 * 让「剧本必须随链接传递」这条不变量有一个可断言的落点。
 */

/** 推演舱 → 挑战落地页。 */
export interface ChallengeLinkInput {
  /** 当前页面完整地址（用于取 origin 与 goal / origin / scenario 参数）。 */
  readonly currentHref: string;
  readonly seed: string;
  readonly survivedTurns: number;
  readonly success: boolean;
  /** 本局剧本 id；缺省时回退到当前地址里的 scenario 参数。 */
  readonly scenarioId?: string | null;
}

/**
 * 生成 `/challenge?...` 分享链接。
 *
 * @returns 完整 URL；`currentHref` 为空（服务端渲染）时返回空串。
 */
export function buildChallengeUrl(input: ChallengeLinkInput): string {
  if (!input.currentHref) {
    return '';
  }

  const current = new URL(input.currentHref);
  const url = new URL('/challenge', current.origin);

  url.searchParams.set('seed', input.seed);
  url.searchParams.set('acts', String(input.survivedTurns));
  url.searchParams.set('result', input.success ? 'success' : 'failed');

  // 剧本 id 必带：这是「同一场推演」成立的前提
  const scenario = (input.scenarioId ?? current.searchParams.get('scenario') ?? '').trim();
  if (scenario.length > 0) {
    url.searchParams.set('scenario', scenario);
  }

  const goal = current.searchParams.get('goal');
  if (goal) {
    url.searchParams.set('goal', goal);
  }

  const originId = current.searchParams.get('origin');
  if (originId) {
    url.searchParams.set('origin', originId);
  }

  return url.toString();
}

/** 挑战落地页 → 推演舱。 */
export interface ChallengeToPlayInput {
  readonly seed: string;
  readonly originId: string;
  readonly goal?: string | null;
  readonly scenarioId?: string | null;
}

/** 生成 `/play?...` 链接。同样必须把剧本 id 透传下去。 */
export function buildPlayUrlFromChallenge(input: ChallengeToPlayInput): string {
  const search = new URLSearchParams({ seed: input.seed, origin: input.originId });

  const scenario = (input.scenarioId ?? '').trim();
  if (scenario.length > 0) {
    search.set('scenario', scenario);
  }

  const goal = (input.goal ?? '').trim();
  if (goal.length > 0) {
    search.set('goal', goal);
  }

  return `/play?${search.toString()}`;
}
