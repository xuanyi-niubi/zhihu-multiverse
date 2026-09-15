import type { ProviderRouter } from '@/agents/providerRouter';
import { safeParseJson } from '@/core/dm/parse';
import type {
  ConceptTerms,
  ProblemFrame,
  TransitionIntent,
} from '@/features/experience/domain';

export interface TransitionExpansion {
  readonly familyOrigins: readonly string[];
  readonly domainOrigins: readonly string[];
  readonly adjacentTargets: readonly string[];
  readonly counterTerms: readonly string[];
}

export interface ExpandTransitionIntentDeps {
  readonly router: ProviderRouter;
  readonly now?: () => number;
}

const EMPTY_TERMS: ConceptTerms = { exact: [], family: [], domain: [], adjacent: [] };
const EMPTY_EXPANSION: TransitionExpansion = {
  familyOrigins: [], domainOrigins: [], adjacentTargets: [], counterTerms: [],
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_CAP = 256;
const expansionCache = new Map<string, { readonly expiresAt: number; readonly value: TransitionIntent }>();
const GENERIC = new Set([
  '人生', '选择', '问题', '事情', '情况', '经历', '经验', '建议', '工作', '专业',
  '方向', '改变', '其他', '相似', '相关', '行业', '职业',
]);

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanEndpoint(text: string, side: 'origin' | 'target'): string | null {
  let value = text.replace(/[“”"'‘’]/g, '').replace(/[，。！？；、,.!?;:：]/g, ' ').trim();
  value = side === 'origin'
    ? value
        .replace(/^(?:我是|我现在是|目前是|现在是|原来是|之前是|我学(?:的)?是|我的专业是|从事)/, '')
        .replace(/(?:专业|学生|毕业生|从业者)$/, '')
    : value
        .replace(/^(?:我想|想要|想|准备|打算|希望|考虑|要不要|是否)/, '')
        .replace(/^(?:转行做|转行|转专业到|转专业|改行做|改行|转|成为|去做|做)/, '')
        .replace(/(?:工作|职业|行业)$/, '');
  value = value.trim();
  if (value.length < 2 || value.length > 16 || /背景未明确|尚未明确|改变现状/.test(value)) return null;
  return value;
}

function termsOf(text: string, side: 'origin' | 'target'): ConceptTerms {
  const exact = cleanEndpoint(text, side);
  return exact ? { ...EMPTY_TERMS, exact: [exact] } : EMPTY_TERMS;
}

function transitionOf(frame: ProblemFrame): TransitionIntent['transition'] {
  const text = `${frame.rawQuestion} ${frame.desiredChange}`;
  if (/转专业|跨专业/.test(text)) return 'major-change';
  if (/转行|改行|跳槽|转[^，。！？\s]{2,}/.test(text)) return 'career-change';
  if (/成为|入行|进入|去做|搬|结束|参加|申请/.test(text)) return 'entry';
  if (/还是|选择|要不要|是否/.test(text)) return 'choice';
  return 'other';
}

function validTerms(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/[，。！？；、,.!?;:：]/g, '').trim())
      .filter((item) => item.length >= 2 && item.length <= 12 && !GENERIC.has(item)),
  ).slice(0, 4);
}

function normalizeExpansion(value: unknown): TransitionExpansion {
  if (typeof value !== 'object' || value === null) return EMPTY_EXPANSION;
  const record = value as Record<string, unknown>;
  return {
    familyOrigins: validTerms(record.familyOrigins),
    domainOrigins: validTerms(record.domainOrigins),
    adjacentTargets: validTerms(record.adjacentTargets),
    counterTerms: validTerms(record.counterTerms),
  };
}

export function buildTransitionIntent(
  frame: ProblemFrame,
  expansion: TransitionExpansion = EMPTY_EXPANSION,
): TransitionIntent {
  const origin = termsOf(frame.currentSituation.trim() || frame.rawQuestion, 'origin');
  const target = termsOf(frame.desiredChange.trim() || frame.rawQuestion, 'target');
  return {
    origin: {
      ...origin,
      family: validTerms(expansion.familyOrigins),
      domain: validTerms(expansion.domainOrigins),
    },
    target: { ...target, adjacent: validTerms(expansion.adjacentTargets) },
    transition: transitionOf(frame),
    counterTerms: validTerms(expansion.counterTerms),
  };
}

function cacheKey(frame: ProblemFrame): string {
  return frame.rawQuestion.toLowerCase().replace(/\s+/g, '').replace(/[，。！？；、,.!?;:：]/g, '');
}

function putCache(key: string, value: TransitionIntent, expiresAt: number): void {
  if (expansionCache.size >= CACHE_CAP) {
    const oldest = expansionCache.keys().next().value;
    if (typeof oldest === 'string') expansionCache.delete(oldest);
  }
  expansionCache.set(key, { expiresAt, value });
}

export async function expandTransitionIntent(
  frame: ProblemFrame,
  deps: ExpandTransitionIntentDeps,
): Promise<TransitionIntent> {
  const now = deps.now?.() ?? Date.now();
  const key = cacheKey(frame);
  const cached = expansionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) expansionCache.delete(key);

  const exact = buildTransitionIntent(frame);
  const result = await deps.router.complete(
    'orchestrator',
    [
      {
        role: 'system',
        content: `你只负责扩展检索语义，不回答用户问题。输出一个 JSON 对象：
{"familyOrigins":[],"domainOrigins":[],"adjacentTargets":[],"counterTerms":[]}
每组 0-4 个、每个 2-12 字。familyOrigins 是与起点最接近的处境；domainOrigins 是再放宽一层但仍可比较的起点；adjacentTargets 是紧邻目标；counterTerms 是失败、退出或代价线索。适用于任何人生问题，不限职业、学业或关系。不要输出“人生、选择、工作、专业、建议”等泛词，不要写句子，不要解释。`,
      },
      {
        role: 'user',
        content: `用户原话：${frame.rawQuestion}\n明确起点：${exact.origin.exact.join('、') || '未明确'}\n明确目标：${exact.target.exact.join('、') || '未明确'}`,
      },
    ],
    { jsonMode: true, signal: AbortSignal.timeout(4_000) },
  );

  let expansion = EMPTY_EXPANSION;
  if (result.ok) {
    const parsed = safeParseJson(result.text);
    if (parsed.ok) expansion = normalizeExpansion(parsed.value);
  }
  const value = buildTransitionIntent(frame, expansion);
  putCache(key, value, now + CACHE_TTL_MS);
  return value;
}

/** 仅供单测隔离缓存状态。 */
export function clearTransitionIntentCacheForTests(): void {
  expansionCache.clear();
}
