/**
 * 知乎知识来源（V3 P3 证据链的契约层）。
 *
 * 一条铁律：**只有 verified 的来源才允许出现数字**（赞同数、索引号）。
 *
 * 真实数据只有两条合法来源：
 * ① 运行时用知乎开放平台 Access Secret 检索到的片段（`status: 'verified'`）；
 * ② `npm run sync:zhihu` 用同一个 key 预先拉取并落盘的快照（同样 verified，带 `retrievedAt`）。
 *
 * 拿不到真数据时，界面只能说「剧本模拟引用」，不许编一个数字凑数。
 */

export type SourceStatus = 'verified' | 'scripted';

export interface KnowledgeSource {
  readonly id: string;
  readonly author: string;
  readonly quote: string;
  /** 真实赞同数；`null` 表示接口没给。 */
  readonly upvotes: number | null;
  readonly url: string;
  /** 抓取时间（ISO）。UI 应展示它，让「这是什么时候的数据」可核查。 */
  readonly retrievedAt: string;
  readonly status: SourceStatus;
  /**
   * 内容的编辑时间（秒级 Unix）。用于证据新鲜度与「这是哪一年的经历」。
   *
   * 与 `retrievedAt` 刻意分开：抓取时间是**我们什么时候拿到的**，
   * 编辑时间是**作者什么时候写的**。用抓取时间做新鲜度会让所有样本永远「最新」。
   */
  readonly editTime: number | null;
  /** 权威等级原值（数字越大越权威；缺失为 null）。 */
  readonly authority: number | null;
}

export interface BadgeInput {
  readonly status?: SourceStatus;
  readonly upvotes?: number | null;
  readonly answerId?: string | null;
}

export interface BadgeLabel {
  readonly label: string;
  readonly tone: 'verified' | 'scripted';
}

const DIGITS = /[0-9]/;

/**
 * 徽标文案。**这是「不许编数字」的唯一执行点。**
 *
 * - verified + 有赞同数 → `知乎高赞 9,421`
 * - verified 但没给赞同数 → `知乎来源`
 * - 其余（含 scripted / 缺 status）→ `剧本模拟引用`，且**文案里不含任何数字**
 */
export function sourceBadgeLabel(input: BadgeInput): BadgeLabel {
  const verified = input.status === 'verified';
  const upvotes =
    typeof input.upvotes === 'number' && Number.isFinite(input.upvotes) && input.upvotes > 0
      ? Math.round(input.upvotes)
      : null;

  if (verified && upvotes !== null) {
    return { label: `知乎高赞 ${upvotes.toLocaleString('zh-CN')}`, tone: 'verified' };
  }
  if (verified) {
    return { label: '知乎来源', tone: 'verified' };
  }

  const label = '剧本模拟引用';
  // 防御性断言：scripted 分支永远不该产出数字
  if (DIGITS.test(label)) {
    return { label: '剧本模拟引用', tone: 'scripted' };
  }
  return { label, tone: 'scripted' };
}

/** 是否可作为真实来源展示（只有 verified 算）。 */
export function isVerifiedSource(source: { readonly status?: SourceStatus } | null | undefined): boolean {
  return source?.status === 'verified';
}

/**
 * 规范化一条知识来源（用于同步脚本与运行时检索两条入参路径）。
 * 关键校验：`verified` 必须带 `retrievedAt`，否则降级为 `scripted` ——
 * 没有抓取时间的「真实数据」无法核查，按未验证处理。
 */
export function normalizeKnowledgeSource(raw: unknown, fallbackId: string): KnowledgeSource | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === 'string' && /^https:\/\//.test(record.url) ? record.url : null;
  const author = typeof record.author === 'string' ? record.author.trim() : '';
  const quote = typeof record.quote === 'string' ? record.quote.trim() : '';
  if (!url || author.length === 0 || quote.length === 0) {
    return null;
  }

  const upvotes =
    typeof record.upvotes === 'number' && Number.isFinite(record.upvotes) ? Math.round(record.upvotes) : null;
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt : '';
  const claimedVerified = record.status === 'verified';
  const status: SourceStatus = claimedVerified && retrievedAt.length > 0 ? 'verified' : 'scripted';

  // 编辑时间与权威等级：缺失一律 null，不猜、不补默认值
  const editTime =
    typeof record.editTime === 'number' && Number.isFinite(record.editTime) && record.editTime > 0
      ? Math.round(record.editTime)
      : null;
  const authorityRaw = record.authority;
  const authority =
    typeof authorityRaw === 'number' && Number.isFinite(authorityRaw)
      ? authorityRaw
      : typeof authorityRaw === 'string' && authorityRaw.trim().length > 0 && Number.isFinite(Number(authorityRaw))
        ? Number(authorityRaw)
        : null;

  return {
    id: typeof record.id === 'string' && record.id.length > 0 ? record.id : fallbackId,
    author: author.slice(0, 64),
    quote: quote.slice(0, 200),
    upvotes,
    url,
    retrievedAt,
    status,
    editTime,
    authority,
  };
}
