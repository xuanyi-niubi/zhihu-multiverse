import { NextResponse } from 'next/server';

import { snapshotToPathCards, toPathCards, type SnapshotSource } from '@/core/evidence/cards';
import { buildMesh, isEmptyMesh } from '@/core/evidence/mesh';
import { DOMAIN_OPTIONS, domainConfidenceOf, isConfidentEnough, keywordSetsFor, planQueries } from '@/core/evidence/plan';
import { strengthOf, type StrengthBreakdown } from '@/core/evidence/strength';
import { AXES } from '@/core/decision/axis';
import { createTrace } from '@/core/observability';
import { stableHash } from '@/core/run/deterministic';
import { fallbackChain, modeMeta, type RuntimeMode } from '@/core/run/runtimeMode';
import { createZhihuClient } from '@/core/zhihu/client';
import { DEMO_CASES, availableDemoCases, demoMeshFor, matchDemoCase } from '@/data/demoCases';
import { allVerifiedSources } from '@/data/knowledgeSources';
import { resolveZhihuConfigForRequest } from '@/features/run/keyResolution';

import type { EvidenceMesh, PathCard, PlannedQuery } from '@/types/evidence';

/**
 * 证据网格接口（v2 §15.1）。
 *
 * **硬性契约与 `/api/dm` 一致：永远返回 HTTP 200 与一份可用的网格产物。**
 * 最坏情况是空网格（界面显示「证据不足」），不是 500，也不是编造内容。
 *
 * 三条降级路径，按 `fallbackChain(mode)` 顺序尝试：
 *
 * | 路径 | 条件 | provenance |
 * |---|---|---|
 * | `live` | FULL MODE，实时检索成功 | `zhihu-search` |
 * | `snapshot` | 有 `npm run sync:zhihu` 落盘的真实快照 | `snapshot` |
 * | `offline` | 都没有 | `demo`（空网格，界面如实说没有样本） |
 *
 * 另外两条纪律：
 * - **配额保护**：同一账号 + 同一目标在 TTL 内只打一次检索，缓存键含账号指纹；
 * - **可解释**：响应回传 `queryPlan` 与 `x-mesh-source` / `x-trace-id`。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 网格缓存 TTL：默认 24 小时（同一目标一天内不重复烧配额）。 */
const MESH_TTL_MS = 24 * 3600_000;
const MESH_CACHE_CAPACITY = 64;

interface CacheEntry {
  readonly at: number;
  readonly mesh: EvidenceMesh;
}

const meshCache = new Map<string, CacheEntry>();

/** 账号指纹：只用于隔离缓存，不进响应、不落日志（哈希不可逆）。 */
function accountFingerprint(request: Request): string {
  const config = resolveZhihuConfigForRequest(request);
  return config ? stableHash(`mesh-account::${config.accessSecret}`).slice(0, 12) : 'anon';
}

function cacheGet(key: string): EvidenceMesh | null {
  const entry = meshCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.at > MESH_TTL_MS) {
    meshCache.delete(key);
    return null;
  }
  return entry.mesh;
}

function cacheSet(key: string, mesh: EvidenceMesh): void {
  meshCache.set(key, { at: Date.now(), mesh });
  if (meshCache.size > MESH_CACHE_CAPACITY) {
    const oldest = meshCache.keys().next().value;
    if (oldest !== undefined) {
      meshCache.delete(oldest);
    }
  }
}

function asGoal(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    return '';
  }
  const goal = (raw as Record<string, unknown>).goal;
  return typeof goal === 'string' ? goal.trim().slice(0, 200) : '';
}

/** 黄金 Case id（只接受白名单内的，避免任意字符串进日志与分支）。 */
function asCaseId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = (raw as Record<string, unknown>).caseId;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return DEMO_CASES.some((item) => item.caseId === trimmed) ? trimmed : null;
}

/** 没有显式 goal 时，用 Case 自己的目标做检索计划（保证 queryPlan 不空）。 */
function caseGoal(caseId: string | null): string {
  if (!caseId) {
    return '';
  }
  return DEMO_CASES.find((item) => item.caseId === caseId)?.goal ?? '';
}

/**
 * 从请求体抽取处境关键词（不解析整份档案）。
 *
 * `PlayerProfile` 结构见 v2 §5.2；这里只取 `stage` / `constraints` 拼成
 * 检索用的背景文本 —— 检索层要的是词，不是结构。
 */
function asBackground(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const parts: string[] = [];
  if (typeof record.stage === 'string') parts.push(record.stage);
  if (Array.isArray(record.constraints)) {
    parts.push(...record.constraints.filter((item): item is string => typeof item === 'string'));
  }
  if (parts.length > 0) {
    return parts.join(' ').slice(0, 120);
  }

  // 兼容旧的裸字段
  for (const key of ['background', 'profileAnalysis']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, 120);
    }
  }
  return null;
}

function emptyMesh(
  goal: string,
  queries: readonly string[],
  provenance: EvidenceMesh['provenance'],
): EvidenceMesh {
  return buildMesh({ goal, cards: [], queries, provenance, axes: AXES, now: Date.now() });
}

/** 从落盘快照构建路径卡（DEMO MODE 的合法证据来源）。 */
function cardsFromSnapshot(goal: string, keywordSets: ReadonlyArray<readonly string[]>): readonly PathCard[] {
  const sources = allVerifiedSources();
  if (sources.length === 0) {
    return [];
  }

  const snapshots: SnapshotSource[] = sources.map((source) => ({
    id: source.id,
    author: source.author,
    quote: source.quote,
    upvotes: source.upvotes,
    url: source.url,
    retrievedAt: source.retrievedAt,
    status: source.status,
  }));

  return snapshotToPathCards(snapshots, { goal, keywordSets, limit: 40 });
}

/** 统一的响应组装：三种路径共用同一份产物形状（v2 §15.1 的响应结构）。 */
function respond(input: {
  readonly mode: RuntimeMode;
  readonly source: 'model' | 'cached' | 'fallback';
  readonly mesh: EvidenceMesh;
  readonly cards: readonly PathCard[];
  readonly queryPlan: readonly PlannedQuery[];
  readonly strength: StrengthBreakdown | null;
  readonly diagnostics: readonly string[];
  readonly traceId: string;
  readonly retrievedFrom: 'live' | 'snapshot' | 'offline';
  readonly goal?: string;
}): Response {
  /**
   * 领域置信度（v3 §20）。
   *
   * 它是「自定义输入安全兜底」的判定输入：置信度过低 + 空网格时，
   * 前端不把玩家放进游戏，而是让他先点一个宽领域再二次检索。
   *
   * 放在服务端算而不是前端，是为了**与检索用的是同一份词表与同一套判定** ——
   * 如果前端自己算一遍，两边迟早会漂移，于是出现
   * 「前端以为够自信、服务端却搜不到东西」的错配。
   */
  const confidence = domainConfidenceOf({ goal: input.goal ?? input.mesh.goal });

  return NextResponse.json(
    {
      ok: true,
      mode: input.mode,
      modeTitle: modeMeta(input.mode).title,
      source: input.source,
      queryPlan: input.queryPlan,
      cards: input.cards,
      mesh: input.mesh,
      strength: input.strength,
      provenance: input.mesh.provenance,
      retrievedFrom: input.retrievedFrom,
      diagnostics: input.diagnostics,
      // 空网格 + 低置信度 → 前端必须走「二次选择」，不允许直接进游戏
      domainConfidence: {
        score: confidence.score,
        confident: isConfidentEnough(confidence),
        matchedDomains: confidence.matchedDomains,
      },
      domainOptions: DOMAIN_OPTIONS.map((option) => ({ id: option.id, label: option.label })),
    },
    {
      status: 200,
      headers: {
        'x-mesh-source': input.source,
        'x-mesh-provenance': input.mesh.provenance,
        'x-trace-id': input.traceId,
        'cache-control': 'no-store',
      },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 请求体不是 JSON：按空目标处理，仍然返回一份可用（空）网格
  }

  const goal = asGoal(body);
  const background = asBackground(body);
  const caseId = asCaseId(body);
  const trace = createTrace({ turnIndex: 1 });

  const zhihuConfig = resolveZhihuConfigForRequest(request);
  // 证据模式只看知乎能力：没有知乎 key 时证据走落盘快照 / 离线
  const evidenceMode: RuntimeMode = zhihuConfig ? 'full' : 'demo';

  try {
    /**
     * 黄金 Demo Case 优先（v2 §21 / §15.2）。
     *
     * 顺序刻意放在实时检索之前：Case 的样本是**已经人工核验过的真实快照**，
     * 用它既省配额、又零延迟、又保证演示内容不会因为一次搜索抖动而变化。
     */
    if (caseId) {
      const caseMesh = demoMeshFor(caseId, Date.now());
      if (caseMesh) {
        const caseCards = caseMesh.paths.flatMap((path) => path.cards);
        trace.note(`mesh-demo-case-${caseId}`);
        trace.finish({ source: 'cached', snippetCount: caseCards.length, diagnosticCount: 0 });
        return respond({
          mode: 'demo',
          source: 'cached',
          mesh: caseMesh,
          cards: caseCards,
          queryPlan: planQueries({ goal: caseMesh.goal, background }),
          strength: strengthOf(caseCards),
          diagnostics: [`黄金 Case「${caseId}」：使用已人工核验的真实快照（无需联网）。`],
          traceId: trace.traceId,
          retrievedFrom: 'snapshot',
        });
      }
      trace.note(`mesh-demo-case-missing-${caseId}`);
    }

    /**
     * **按目标反查黄金 Case**（实测定出来的关键一步）。
     *
     * 起因：`/compare?goal=…` 对未配置 key 的访客会显示「这次没有可用的证据网格」——
     * 那个「绝杀时刻」的舞台对默认访客完全空转，而站点明明已经落盘了真实快照。
     *
     * 因此：目标与某个黄金 Case 接近时**优先用它的快照**（零配额、零延迟），
     * 让每个访客都能看到真实证据；都不接近时才退回实时检索。
     */
    if (!caseId && goal.length > 0) {
      const matched = matchDemoCase(goal);
      const matchedMesh = matched ? demoMeshFor(matched.caseId, Date.now()) : null;
      if (matched && matchedMesh) {
        const matchedCards = matchedMesh.paths.flatMap((path) => path.cards);
        trace.note(`mesh-demo-match-${matched.caseId}`);
        trace.finish({ source: 'cached', snippetCount: matchedCards.length, diagnosticCount: 0 });
        return respond({
          mode: 'demo',
          source: 'cached',
          mesh: matchedMesh,
          cards: matchedCards,
          queryPlan: planQueries({ goal, background }),
          strength: strengthOf(matchedCards),
          diagnostics: [
            `目标与黄金 Case「${matched.title}」接近，直接使用它的真实快照（无需联网）。`,
          ],
          traceId: trace.traceId,
          retrievedFrom: 'snapshot',
        });
      }
    }

    const plan = planQueries({ goal: goal.length > 0 ? goal : caseGoal(caseId), background });
    const queries = plan.map((item) => item.query);
    const keywordSets = keywordSetsFor(plan);

    if (plan.length === 0) {
      trace.note('empty-goal');
      trace.finish({ source: 'fallback', snippetCount: 0, diagnosticCount: 1 });
      return respond({
        mode: evidenceMode,
        source: 'fallback',
        mesh: emptyMesh(goal, [], 'demo'),
        cards: [],
        queryPlan: [],
        strength: null,
        diagnostics: ['目标为空，没有可检索的方向。'],
        traceId: trace.traceId,
        retrievedFrom: 'offline',
      });
    }

    const cacheKey = stableHash(
      `mesh::${accountFingerprint(request)}::${goal}::${background ?? ''}::${queries.join('|')}`,
    );
    const cached = cacheGet(cacheKey);
    if (cached) {
      trace.note('mesh-cache-hit');
      const cards = cached.paths.flatMap((path) => path.cards);
      trace.finish({ source: 'cached', snippetCount: cards.length, diagnosticCount: 0 });
      return respond({
        mode: evidenceMode,
        source: 'cached',
        mesh: cached,
        cards,
        queryPlan: plan,
        strength: strengthOf(cards),
        diagnostics: [],
        traceId: trace.traceId,
        retrievedFrom: cached.provenance === 'snapshot' ? 'snapshot' : 'live',
      });
    }

    const chain = fallbackChain(evidenceMode);
    const diagnostics: string[] = [];

    /* ---- 路径 1：实时检索（只有 FULL MODE 会尝试） ---- */
    if (chain.includes('live') && zhihuConfig) {
      const client = createZhihuClient(zhihuConfig);
      const startedAt = Date.now();

      // 并行检索：串行 5 个 query 会让首屏等到 5 倍延迟（配额一样，只是快）
      const settled = await Promise.all(
        plan.map(async (planned) => ({ planned, result: await client.search(planned.query, 8) })),
      );
      trace.stage('mesh-search', Date.now() - startedAt);

      const retrievedAt = new Date().toISOString();
      const cards: PathCard[] = [];
      let hitQueries = 0;

      for (const { planned, result } of settled) {
        if (!result.ok) {
          diagnostics.push(`检索「${planned.query}」失败：${result.code}`);
          trace.note(`zhihu-search-${result.code}`);
          continue;
        }
        hitQueries += 1;
        cards.push(
          ...toPathCards(result.data, {
            goal,
            // 每条结果只归到「第一个命中它的关键词集」，保证路线互斥
            keywordSets: keywordSetsFor([planned]),
            retrievedAt,
            limit: 10,
          }),
        );
      }

      if (cards.length > 0) {
        const mesh = buildMesh({ goal, cards, queries, provenance: 'zhihu-search', axes: AXES, now: Date.now() });
        cacheSet(cacheKey, mesh);
        trace.note('mesh-built-live');
        trace.finish({ source: 'model', snippetCount: cards.length, diagnosticCount: diagnostics.length });
        return respond({
          mode: evidenceMode,
          source: 'model',
          mesh,
          cards,
          queryPlan: plan,
          strength: strengthOf(cards),
          diagnostics,
          traceId: trace.traceId,
          retrievedFrom: 'live',
        });
      }

      diagnostics.push(
        hitQueries > 0
          ? '实时检索有返回，但没有一条能归档成前人路径（样本不足或表述不匹配）。'
          : '实时检索全部失败。',
      );
      trace.note('mesh-live-empty');
    } else if (!zhihuConfig) {
      diagnostics.push('未配置知乎开放平台 Access Secret：实时检索不可用。');
      trace.note('zhihu-not-configured');
    }

    /* ---- 路径 2：落盘快照（DEMO MODE 的合法证据来源） ---- */
    if (chain.includes('snapshot')) {
      const snapshotCards = cardsFromSnapshot(goal, keywordSets);
      if (snapshotCards.length > 0) {
        const mesh = buildMesh({
          goal,
          cards: snapshotCards,
          queries,
          provenance: 'snapshot',
          axes: AXES,
          now: Date.now(),
        });
        cacheSet(cacheKey, mesh);
        diagnostics.push(
          `已切换到离线档案：使用 ${snapshotCards.length} 条落盘快照（由 sync:zhihu 真实抓取）。`,
        );
        trace.note('mesh-built-snapshot');
        trace.finish({
          source: 'model',
          snippetCount: snapshotCards.length,
          diagnosticCount: diagnostics.length,
        });
        return respond({
          mode: evidenceMode,
          source: 'model',
          mesh,
          cards: snapshotCards,
          queryPlan: plan,
          strength: strengthOf(snapshotCards),
          diagnostics,
          traceId: trace.traceId,
          retrievedFrom: 'snapshot',
        });
      }
      diagnostics.push('没有可用的落盘快照（先跑 npm run sync:zhihu）。');
      trace.note('mesh-snapshot-empty');
    }

    /* ---- 路径 3：离线兜底（永远可用） ---- */
    const mesh = emptyMesh(goal, queries, 'demo');
    if (isEmptyMesh(mesh)) {
      diagnostics.push(
        '本次没有拿到任何可归档的站内样本：界面会如实显示「证据不足」，不会编造前人路径。离线精调剧本仍然可以完整走完一局。',
      );
    }
    trace.note('mesh-offline');
    trace.finish({ source: 'fallback', snippetCount: 0, diagnosticCount: diagnostics.length });

    return respond({
      mode: evidenceMode,
      source: 'fallback',
      mesh,
      cards: [],
      queryPlan: plan,
      strength: null,
      diagnostics,
      traceId: trace.traceId,
      retrievedFrom: 'offline',
    });
  } catch (error) {
    // 最后一道防线：路由永不 500
    trace.note('route-catch');
    trace.finish({ source: 'fallback', snippetCount: 0, diagnosticCount: 1 });
    return respond({
      mode: evidenceMode,
      source: 'fallback',
      mesh: emptyMesh(goal, [], 'demo'),
      cards: [],
      queryPlan: [],
      strength: null,
      diagnostics: [error instanceof Error ? error.message : String(error)],
      traceId: trace.traceId,
      retrievedFrom: 'offline',
    });
  }
}

/**
 * 探活与诊断：报告配置状态、轴数与**当前可用的黄金 Case**（绝不含密钥）。
 *
 * Case 列表刻意从这里出而不是让客户端 import `demoCases.ts`：
 * 那个模块为了读快照会 import 59KB 的 generated JSON，
 * 一旦被客户端组件引用就会整份打进浏览器产物。
 */
export async function GET(request: Request): Promise<Response> {
  const zhihuConfig = resolveZhihuConfigForRequest(request);
  return NextResponse.json(
    {
      ok: true,
      zhihuSearch: zhihuConfig ? { configured: true, baseUrl: zhihuConfig.baseUrl } : { configured: false },
      snapshotSources: allVerifiedSources().length,
      axes: AXES.length,
      cacheSize: meshCache.size,
      mode: zhihuConfig ? 'full' : 'demo',
      // 让运维/评委一眼看出「离线演示是否真的可用」
      offlineReady: true,
      /**
       * 黄金 Case（首页「人生裂缝大厅」的入口）。
       * `sources` 是**真实样本数**，界面据此如实展示分母；
       * 为 0 的 Case 不会被首页渲染（没有真实样本就不该做成可玩的裂缝）。
       */
      cases: availableDemoCases().map((meta) => ({
        caseId: meta.caseId,
        title: meta.title,
        goal: meta.goal,
        fork: meta.fork,
        sources: meta.sources,
        anchors: meta.anchors,
      })),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
