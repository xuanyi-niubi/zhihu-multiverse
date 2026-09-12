import { stableHash } from '@/core/run/deterministic';

/**
 * 《现实破壁清单》（V3 P3 的收口件）。
 *
 * 终局给玩家的不该只是「你失败了」，而是**几条今天就能做的动作**。
 * 三条硬约束：
 *
 * 1. **可执行**：每条都是祈使句 + 时间盒 + 可验证信号，不写「要努力」这种话；
 * 2. **可溯源**：绑定到真实来源的条目标 `verified` 并带上原回答链接；
 *    绑不上的一律标 `fallback`，界面必须说清「这条来自剧本，不是站内检索」——
 *    **不许把剧本建议包装成知乎某答主的建议**；
 * 3. **确定性**：同一局输入必得同一份清单（含顺序与 id），否则「同一挑战可复盘」在终局这一环断掉。
 */

export type ChecklistSourceStatus = 'verified' | 'fallback';

export interface ChecklistSource {
  readonly id: string;
  readonly quote: string;
  readonly status: 'verified' | 'scripted';
  readonly url?: string;
  readonly author?: string;
  readonly upvotes?: number | null;
  readonly retrievedAt?: string;
}

export interface ChecklistItem {
  /** 稳定 id：`cl-<hash>`，用于去重与报告引用。 */
  readonly id: string;
  /** 做什么（祈使句）。 */
  readonly action: string;
  /** 什么时候做完（时间盒）。 */
  readonly timeBox: string;
  /** 怎么算做到了（可验证信号）。 */
  readonly verifySignal: string;
  readonly sourceId: string | null;
  readonly sourceStatus: ChecklistSourceStatus;
  /** 绑到真实来源时的原话摘录；fallback 时为 null。 */
  readonly evidence: string | null;
  readonly sourceUrl?: string;
  readonly sourceAuthor?: string;
  readonly sourceUpvotes?: number | null;
  readonly sourceRetrievedAt?: string;
}

export interface ChecklistInput {
  readonly goal: string;
  /** 本局走过的选择文案（按顺序）。 */
  readonly choices: readonly string[];
  readonly outcome: 'success' | 'failure';
  /** 终局判卷里点出的缺口，直接变成待补条目。 */
  readonly bossIssues?: readonly string[];
  readonly sources?: readonly ChecklistSource[];
}

/** 清单最多给几条：太多等于没重点。 */
export const CHECKLIST_MAX = 4;

interface ActionRule {
  /** 触发关键词（作用在「本局走过的选择」全文上）。 */
  readonly match: RegExp;
  readonly action: string;
  readonly timeBox: string;
  readonly verifySignal: string;
}

/**
 * 行动规则表：把「走过的选择」翻译成可执行动作。
 *
 * 规则是显式的、可读的、确定性的 —— 不依赖模型，也不依赖随机。
 * 顺序即优先级（先命中的先入清单）。
 */
const ACTION_RULES: readonly ActionRule[] = [
  {
    match: /项目|作品|刷题|八股|算法/,
    action: '挑一个能讲清的项目补完，并写成可复述的三段说明',
    timeBox: '本周内',
    verifySignal: '能在三分钟内讲清「解决什么问题 / 怎么做的 / 结果如何」',
  },
  {
    match: /投递|简历|面试|实习/,
    action: '把简历改成"问题—动作—结果"三行式，按周批量投递并记录回音',
    timeBox: '本周内',
    verifySignal: '投递记录表里至少出现三家回音（面试或明确拒绝）',
  },
  {
    match: /调剂|上岸|offer|保研|复试/,
    action: '把稳妥选项的截止时间写进日历，并列出它的真实代价',
    timeBox: '今天',
    verifySignal: '日历上有明确截止日，且能说出放弃它换来的东西',
  },
  {
    match: /家里|父母|室友|同学|导师|沟通|坦白/,
    action: '找一位关键的人做一次十五分钟的坦白沟通',
    timeBox: '三天内',
    verifySignal: '对方能复述出你的计划与需要的支持',
  },
  {
    match: /钱|兼职|生活费|成本|开销/,
    action: '算一次三个月的现金流，定出可承受的月支出上限',
    timeBox: '本周内',
    verifySignal: '有一张写着月上限与来源的表，且连续两周没有超支',
  },
  {
    match: /身体|通宵|熬夜|睡|健康|报警/,
    action: '把入睡时间钉死在一个固定点，并留一个白天的补觉窗口',
    timeBox: '两周内',
    verifySignal: '连续七天在固定点前入睡，且白天不再需要咖啡续命',
  },
];

/** 结局兜底规则：本局没触发任何关键词时，至少给两条有用的。 */
const OUTCOME_RULES: Record<'success' | 'failure', readonly ActionRule[]> = {
  success: [
    {
      match: /.^/,
      action: '把这一局走通的路径写成一份复盘，标出哪一步最关键',
      timeBox: '本周内',
      verifySignal: '复盘里能指出一个「如果重来还会这么做」的决定',
    },
  ],
  failure: [
    {
      match: /.^/,
      action: '写下这一局最贵的那个取舍，以及它的替代方案',
      timeBox: '今天',
      verifySignal: '纸上有一句话，说明下次在哪个信号出现时就该收手',
    },
  ],
};

/** 用 4 字滑窗判断「这条建议有没有真的引到该来源」。 */
function shingles(text: string, size = 4): Set<string> {
  const clean = text.replace(/[\s，。！？、；：「」『』（）()"'—…·]/g, '');
  const out = new Set<string>();
  for (let index = 0; index + size <= clean.length; index += 1) {
    out.add(clean.slice(index, index + size));
  }
  return out;
}

function overlaps(left: string, right: string): boolean {
  const a = shingles(left);
  const b = shingles(right);
  for (const shingle of a) {
    if (b.has(shingle)) {
      return true;
    }
  }
  return false;
}

export interface RealityChecklist {
  readonly items: readonly ChecklistItem[];
  /** 清单指纹：同一局必得同一个值，便于挑战复盘对账。 */
  readonly hash: string;
  /** 绑到真实来源的条数（未 sync 时为 0）。 */
  readonly verifiedCount: number;
  readonly fallbackCount: number;
}

/**
 * 构建清单。
 *
 * 关键点：**`verified` 只可能来自 `status === 'verified'` 的来源**。
 * 剧本来源（`scripted`）进不了这一档 —— 它没有作者、没有赞同数、没有抓取时间，
 * 拿它冒充站内建议就是伪造证据链。
 */
export function buildRealityChecklist(input: ChecklistInput): RealityChecklist {
  const choiceText = input.choices.join(' ｜ ');
  const matched = ACTION_RULES.filter((rule) => rule.match.test(choiceText));

  const candidates: ActionRule[] = [...matched, ...OUTCOME_RULES[input.outcome]];

  // 判卷点出的缺口直接变成待补条目（把评价变成下一步）
  for (const issue of input.bossIssues ?? []) {
    candidates.push({
      match: /.^/,
      action: `补上判卷点出的缺口：${issue}`,
      timeBox: '本周内',
      verifySignal: '能说清下一次遇到同样处境时具体改哪一步',
    });
  }

  const verifiedSources = (input.sources ?? []).filter(
    (source) => source.status === 'verified' && source.quote.trim().length > 0,
  );

  const seen = new Set<string>();
  const items: ChecklistItem[] = [];

  for (const rule of candidates) {
    if (items.length >= CHECKLIST_MAX) {
      break;
    }

    const key = rule.action.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);

    // 只与"真来源"做匹配；匹配上才算 verified
    const bound = verifiedSources.find((source) =>
      overlaps(`${rule.action}${rule.verifySignal}`, source.quote),
    );

    items.push({
      id: `cl-${stableHash(key).slice(0, 6)}`,
      action: rule.action,
      timeBox: rule.timeBox,
      verifySignal: rule.verifySignal,
      sourceId: bound?.id ?? null,
      sourceStatus: bound ? 'verified' : 'fallback',
      evidence: bound ? bound.quote.slice(0, 120) : null,
      ...(bound?.url ? { sourceUrl: bound.url } : {}),
      ...(bound?.author ? { sourceAuthor: bound.author } : {}),
      ...(bound ? { sourceUpvotes: bound.upvotes ?? null } : {}),
      ...(bound?.retrievedAt ? { sourceRetrievedAt: bound.retrievedAt } : {}),
    });
  }

  const verifiedCount = items.filter((item) => item.sourceStatus === 'verified').length;

  return {
    items,
    hash: stableHash(
      items
        .map((item) => `${item.action}@${item.timeBox}@${item.sourceStatus}@${item.sourceId ?? '-'}`)
        .join('|'),
    ),
    verifiedCount,
    fallbackCount: items.length - verifiedCount,
  };
}
