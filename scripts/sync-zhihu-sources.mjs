#!/usr/bin/env node
/**
 * 用**知乎开放平台官方 key** 拉取真实来源，落盘成 `src/data/zhihuSources.generated.json`。
 *
 * 为什么需要它：预置剧本的「知乎高赞」曾经是手写占位值（9421 / 6733 …），
 * 对外宣称了并不存在的社区数据。真实数据只有一条合法路径 —— 官方接口：
 *
 *   GET https://developer.zhihu.com/api/v1/content/zhihu_search?Query=&Count=
 *   Authorization: Bearer <ZHIHU_ACCESS_SECRET>
 *   X-Request-Timestamp: <秒级 Unix>
 *
 * 配额是 1000 次/天，所以这里对每个待补来源只发一次请求，并把结果落盘复用。
 *
 * 用法：
 *   ZHIHU_ACCESS_SECRET=xxx npm run sync:zhihu
 *
 * 没有 key 时**直接失败**，绝不生成编造数据 —— 缺数据就得让界面显示
 * 「剧本模拟引用」，而不是编一个数字。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'data', 'zhihuSources.generated.json');

const BASE_URL = (process.env.ZHIHU_API_BASE_URL ?? 'https://developer.zhihu.com').replace(/\/+$/, '');
const SECRET = (process.env.ZHIHU_ACCESS_SECRET ?? '').trim();
const TIMEOUT_MS = Number(process.env.ZHIHU_TIMEOUT_MS ?? 20000);

/**
 * 检索间隔（毫秒）。
 *
 * 实测教训：连续快速调用会撞 `Code=30001 rate limit exceeded`
 * —— 一次 40 锚点的同步会丢掉中间若干个。加节流 + 退避重试后一次跑完。
 * 默认 1200ms，可用 `ZHIHU_SYNC_DELAY_MS` 覆盖。
 */
const DELAY_MS = Number(process.env.ZHIHU_SYNC_DELAY_MS ?? 1200);

/** 命中限流时的重试次数与退避基数。 */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 是否是可重试的限流错误。 */
function isRateLimited(error) {
  return /30001|rate limit/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * 需要真实来源的锚点：`<scenarioId>:t<turnIndex>` 与检索词。
 *
 * 检索词按「这一幕到底在讲什么」写，而不是把剧本原句丢进去 ——
 * 官方搜索是关键词检索，整句提问只会召回不相关的长文。
 *
 * `case` 字段用于**黄金 Demo Case**（v2 §21）：同一 Case 下的多个锚点
 * 从不同角度检索同一个抉择，因此能聚出多条同向样本 ——
 * 这是证据网格（`demoMeshes`）能成立的前提：一条来源只是个人经历，
 * 多条同向才是一条「前人路径」。
 */
const TARGETS = [
  // ── 预置剧本锚点 ──────────────────────────────────────────────
  { id: 'law-to-cs:t1', case: 'law-to-cs', query: '法学 转计算机 考研 需要付出什么代价' },
  { id: 'law-to-cs:t2', case: 'law-to-cs', query: '转码 刷题 项目 时间不够 怎么安排' },
  { id: 'law-to-cs:t3', case: 'law-to-cs', query: '跨专业 求职 大厂实习 简历 没有项目经历' },
  { id: 'law-to-cs:t4', case: 'law-to-cs', query: '非科班 转行 程序员 第一份工作 怎么选' },
  { id: 'kaoyan-second:t1', case: 'kaoyan-second', query: '考研 二战 还是 调剂 怎么决定' },
  { id: 'kaoyan-second:t2', case: 'kaoyan-second', query: '考研 复试线差三分 调剂 普通院校 值不值' },
  { id: 'kaoyan-second:t3', case: 'kaoyan-second', query: '二战 考研 心态 崩了 怎么调整' },
  { id: 'kaoyan-second:t4', case: 'kaoyan-second', query: '考研 上岸 经验 复盘 时间安排' },

  // ── 黄金 Case：《大二的夏天》（v2 §21 主推）──────────────────
  // 抉择：先补基础再参赛 vs 直接参赛边做边学
  {
    id: 'demo-sophomore:c1',
    case: 'demo-sophomore',
    query: '大二 基础不好 直接参加比赛 还是 先打基础',
    path: 'path-slow-down',
  },
  {
    id: 'demo-sophomore:c2',
    case: 'demo-sophomore',
    query: '大二 参加比赛 边做边学 项目经历 收获',
    path: 'path-lateral-move',
  },
  {
    id: 'demo-sophomore:c3',
    case: 'demo-sophomore',
    query: '大学生 参加比赛 耽误课程 时间怎么平衡',
    path: 'path-part-time-pivot',
  },
  {
    id: 'demo-sophomore:c4',
    case: 'demo-sophomore',
    query: '组队 参加比赛 队友 一起做项目 经验',
    path: 'path-lateral-move',
  },

  // ── Case：毕业生（大城市 vs 回家）────────────────────────────
  {
    id: 'demo-graduate:c1',
    case: 'demo-graduate',
    query: '应届生 留在大城市 还是 回老家 真实经历',
    path: 'path-stable-track',
  },
  {
    id: 'demo-graduate:c2',
    case: 'demo-graduate',
    query: '毕业 回老家 考编 生活 后悔吗',
    path: 'path-stable-track',
  },
  {
    id: 'demo-graduate:c3',
    case: 'demo-graduate',
    query: '留在一线城市 租房 压力 工资 攒不下钱',
    path: 'path-stay-and-deepen',
  },
  {
    id: 'demo-graduate:c4',
    case: 'demo-graduate',
    query: '先在大城市工作几年 再回家 过渡 经验',
    path: 'path-lateral-move',
  },

  // ── Case：职场人（裸辞转 AI vs 边工作边转型）─────────────────
  {
    id: 'demo-pivot:c1',
    case: 'demo-pivot',
    query: '裸辞 转行 AI 没有收入 撑几个月 现实',
    path: 'path-full-time-pivot',
  },
  {
    id: 'demo-pivot:c2',
    case: 'demo-pivot',
    query: '边工作边转行 AI 下班学习 时间不够',
    path: 'path-part-time-pivot',
  },
  {
    id: 'demo-pivot:c3',
    case: 'demo-pivot',
    query: '转行人工智能 学习路线 花费 多久 上岸',
    path: 'path-cross-field',
  },
  {
    id: 'demo-pivot:c4',
    case: 'demo-pivot',
    query: '转行 AI 后悔 年龄大 来得及吗',
    path: 'path-cross-field',
  },
];

function fail(message) {
  console.error(`[sync:zhihu] ${message}`);
  process.exit(1);
}

if (!SECRET) {
  fail(
    '缺少 ZHIHU_ACCESS_SECRET。\n' +
      '  · 在 https://developer.zhihu.com 的凭证页获取 Access Secret；\n' +
      '  · 然后运行：ZHIHU_ACCESS_SECRET=<你的 secret> npm run sync:zhihu\n' +
      '  · 没有 key 时界面保持「剧本模拟引用」，不会编造赞同数。',
  );
}

/** 调用官方搜索接口。返回结构化结果，失败抛错（不静默降级成假数据）。 */
async function search(query, count = 10) {
  const url = `${BASE_URL}/api/v1/content/zhihu_search?Query=${encodeURIComponent(query)}&Count=${count}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }

  /**
   * 响应形状（2026-09 实测）：
   *   { Code: 0, Message: 'success', Data: { HasMore, SearchHashId, Items: [...] } }
   *
   * ⚠️ 这里曾经写成 `payload.Data ?? payload.Items ?? payload` ——
   * 而 `Data` 是**对象**不是数组，于是回退链把整个 `Data` 当成了条目数组，
   * 报出「响应里没有条目数组（顶层键：Code,Message,Data）」这个误导性错误。
   * 修法：逐层显式下钻，取第一个真正的数组。
   */
  const candidates = [
    payload?.Data?.Items,
    payload?.Data?.items,
    payload?.Data?.List,
    payload?.Data?.Results,
    payload?.Items,
    payload?.items,
    Array.isArray(payload?.Data) ? payload.Data : null,
    Array.isArray(payload) ? payload : null,
  ];
  const items = candidates.find((candidate) => Array.isArray(candidate));

  // 官方响应是 { Code, Message, Data }：Code 非 0 时把 Message 原样抛出来，
  // 这样鉴权失败/配额用尽的诊断信息不会被「没有条目数组」这种模糊话盖掉。
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'Code' in payload) {
    const code = Number(payload.Code);
    if (Number.isFinite(code) && code !== 0) {
      throw new Error(`接口返回 Code=${payload.Code} Message=${String(payload.Message ?? '').slice(0, 120)}`);
    }
  }

  if (!Array.isArray(items)) {
    throw new Error(
      `响应里没有条目数组（顶层键：${Object.keys(payload ?? {}).join(',')}；` +
        `Data 键：${Object.keys(payload?.Data ?? {}).join(',')}）`,
    );
  }

  return items;
}

/** 把官方条目映射成落盘来源；没有 https 链接或作者就丢弃。 */
function truncateAtSentence(text, maxLength = 200) {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const boundary = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('；'));
  return boundary >= Math.floor(maxLength * 0.55) ? slice.slice(0, boundary + 1) : `${slice.slice(0, maxLength - 1)}…`;
}

function toSource(id, item, retrievedAt) {
  const author = String(item?.AuthorName ?? item?.author ?? '').trim();
  const title = String(item?.Title ?? item?.title ?? '').trim();
  const authorBadge = String(item?.AuthorBadgeText ?? item?.authorBadgeText ?? '').trim();
  const contentType = String(item?.ContentType ?? item?.contentType ?? '').trim();
  const url = String(item?.Url ?? item?.url ?? '').trim();
  const quote = String(item?.ContentText ?? item?.Content ?? item?.Excerpt ?? item?.Summary ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const upvotesRaw = item?.VoteUpCount ?? item?.VoteupCount ?? item?.voteup_count ?? null;
  const upvotes = Number.isFinite(Number(upvotesRaw)) ? Number(upvotesRaw) : null;

  // 内容编辑时间（秒级 Unix）：落盘后用于证据新鲜度与「这是哪一年的经历」展示
  const editTimeRaw = item?.EditTime ?? item?.editTime ?? null;
  const editTime = Number.isFinite(Number(editTimeRaw)) && Number(editTimeRaw) > 0
    ? Number(editTimeRaw)
    : null;

  const authorityRaw = item?.AuthorityLevel ?? item?.authorityLevel ?? null;
  const authority = authorityRaw === null || authorityRaw === undefined ? null : String(authorityRaw);

  const firsthand = /(我当时|我曾经|我自己|后来我|最后我|我的经历|亲身经历|本人经历)/.test(quote)
    || (/(^|[，。！？；\s])我(?:们)?/.test(quote)
      && /(参加|报名|开始|决定|选择|准备|学习|复习|做了|转行|投递|联系|组队|退出|辞职)/.test(quote));
  const promoHits = quote.match(/私信|加微|微信|咨询|付费|课程|训练营|辅导|保过|报名链接|闭眼复制/g)?.length ?? 0;

  if (!/^https:\/\//.test(url) || author.length === 0 || quote.length === 0 || !firsthand || promoHits >= 2) {
    return null;
  }

  return {
    id,
    author: author.slice(0, 64),
    title: title ? title.slice(0, 160) : null,
    authorBadge: authorBadge ? authorBadge.slice(0, 120) : null,
    contentType: contentType ? contentType.slice(0, 32) : null,
    quote: truncateAtSentence(quote),
    upvotes,
    url,
    retrievedAt,
    status: 'verified',
    // 以下两项让证据层能算新鲜度、能在浮层显示「哪一年的经历」
    ...(editTime !== null ? { editTime } : {}),
    ...(authority !== null ? { authority } : {}),
  };
}

/**
 * 每个锚点存几条。
 *
 * 从 1 提到 3 的理由：单条来源只是「一个人的经历」，聚不出路线；
 * 证据网格要求**多条同向样本**才能判定一条前人路径（见 `core/evidence/strength.ts`
 * 的样本量因子）。黄金 Case 需要的就是这个密度。
 *
 * 配额：`TARGETS.length × PICK_PER_TARGET` 次检索，一天一次完全在 1000 次/天以内。
 */
const PICK_PER_TARGET = 3;

/** 跨锚点去重：同一篇回答不应因为检索词相近而被算成两条样本。 */
const seenUrls = new Set();

const retrievedAt = new Date().toISOString();
const sources = {};
const cases = {};
/** 锚点 → 声明的路线 id（精确到锚点，不靠数组对齐推断）。 */
const anchorPaths = {};
const failures = [];

for (const target of TARGETS) {
  const bucket = cases[target.case] ?? { label: target.case, anchors: [], paths: [] };
  cases[target.case] = bucket;
  bucket.anchors.push(target.id);
  if (target.path) {
    if (!bucket.paths.includes(target.path)) {
      bucket.paths.push(target.path);
    }
    anchorPaths[target.id] = target.path;
  }

  try {
    let items = null;
    let lastError = null;

    // 限流退避重试：实测连续调用会撞 Code=30001
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        items = await search(target.query);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!isRateLimited(error) || attempt === RATE_LIMIT_RETRIES) {
          throw error;
        }
        const wait = RATE_LIMIT_BACKOFF_MS * (attempt + 1);
        console.warn(`  … ${target.id} 命中限流，${wait}ms 后重试（第 ${attempt + 1} 次）`);
        await sleep(wait);
      }
    }

    if (!items) {
      throw lastError ?? new Error('未知失败');
    }

    const ranked = [...items].sort((left, right) => {
      const firsthand = (item) => /(我当时|我曾经|我自己|后来我|最后我|我的经历|亲身经历|本人经历)/
        .test(String(item?.ContentText ?? ''));
      const firsthandGap = Number(firsthand(right)) - Number(firsthand(left));
      return firsthandGap !== 0
        ? firsthandGap
        : Number(right?.VoteUpCount ?? 0) - Number(left?.VoteUpCount ?? 0);
    });

    let pickedCount = 0;
    for (const item of ranked) {
      if (pickedCount >= PICK_PER_TARGET) break;

      const url = String(item?.Url ?? item?.url ?? '').trim();
      if (url.length > 0 && seenUrls.has(url)) continue;

      // 同锚点的多条用 `#n` 后缀区分 id，保持 id 唯一且可追溯
      const id = pickedCount === 0 ? target.id : `${target.id}#${pickedCount + 1}`;
      const picked = toSource(id, item, retrievedAt);
      if (!picked) continue;

      if (url.length > 0) seenUrls.add(url);
      sources[id] = picked;
      pickedCount += 1;
      console.log(`  ✓ ${id}  @${picked.author}  赞同 ${picked.upvotes ?? '—'}`);
    }

    if (pickedCount === 0) {
      failures.push(`${target.id}: 召回 ${items.length} 条但没有可用字段（author/url/quote）`);
    }
  } catch (error) {
    failures.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 节流：给接口留出配额窗口，避免下一锚点直接被限流
  await sleep(DELAY_MS);
}

/**
 * **合并上一次的快照，而不是覆盖。**
 *
 * 两个理由：
 * 1. 一次部分失败（限流）不该让已成功锚点的好数据消失；
 * 2. 补跑缺失锚点时，不该把上一次成功抓到的 42 条清成 6 条。
 *
 * 合并规则：同一 id 以本次为准（数据更新），未抓到的 id 保留旧值。
 */
let previous = { sources: {}, cases: {} };
try {
  if (existsSync(OUT)) {
    previous = JSON.parse(readFileSync(OUT, 'utf8'));
  }
} catch {
  // 旧快照损坏：当作没有，不影响本次落盘
}

const mergedSources = { ...(previous.sources ?? {}), ...sources };
const mergedCases = { ...(previous.cases ?? {}) };
for (const [key, value] of Object.entries(cases)) {
  const existing = mergedCases[key] ?? { label: key, anchors: [], paths: [] };
  mergedCases[key] = {
    label: existing.label ?? key,
    anchors: [...new Set([...(existing.anchors ?? []), ...value.anchors])],
    paths: [...new Set([...(existing.paths ?? []), ...value.paths])],
  };
}

const payload = {
  _generated: '由 `npm run sync:zhihu` 生成：用知乎开放平台 Access Secret 调用 /api/v1/content/zhihu_search，把真实答主/赞同数/链接落盘。不要手工编辑。',
  generatedAt: retrievedAt,
  sources: mergedSources,
  cases: mergedCases,
  anchorPaths: { ...(previous.anchorPaths ?? {}), ...anchorPaths },
};

const succeeded = Object.keys(sources).length;

/**
 * **只有真的拿到数据才落盘。**
 *
 * 一次失败的同步（key 过期、配额用尽、网络抖动）不该把上一次的好快照清空 ——
 * 否则界面会从「知乎高赞 9,421」直接掉回「剧本模拟引用」，而原因只是一个瞬时错误。
 */
if (succeeded > 0) {
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const caseCount = Object.keys(cases).length;
  console.log(
    `\n[sync:zhihu] 落盘 ${succeeded} 条真实来源（覆盖 ${TARGETS.length} 个检索锚点 / ${caseCount} 个 Case） -> src/data/zhihuSources.generated.json`,
  );
} else {
  console.error(
    `\n[sync:zhihu] 0 条成功，**保留原有快照不覆盖**（避免用空数据清掉好数据）。`,
  );
}

if (failures.length > 0) {
  console.warn('[sync:zhihu] 失败明细（这些锚点保持「剧本模拟引用」）：');
  for (const line of failures) console.warn(`  · ${line}`);
  process.exitCode = 1;
}
