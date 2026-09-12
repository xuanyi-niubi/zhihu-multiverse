import { stableHash } from '@/core/run/deterministic';

/**
 * 知识影响检定（规范 §5.2.4「知乎内容作为裁决依据」）。
 *
 * 规范原文：
 * > 核心创新：知乎内容不仅影响叙事，还影响 D20 检定。
 * > 如果玩家在剧情中引用了知乎上的某个观点，检定获得 +2 加成（"知识就是力量"）。
 *
 * 实现纪律：
 * - **只认"本局真实拿到的"素材 id**（白名单），引用不存在的来源不给加成；
 * - 加成有上限（+2），避免"多引几条就能过"；
 * - 判定是确定性的：同一段文字与同一批素材永远得到同一个加成。
 */

export interface KnowledgeItem {
  readonly id: string;
  readonly quote: string;
}

export interface KnowledgeInfluence {
  /** 加在检定上的修正（0 或正数）。 */
  readonly modifier: number;
  /** 真正被引用到的素材 id。 */
  readonly matchedIds: readonly string[];
  /** 给玩家看的一句话（不含数字）。 */
  readonly reason: string;
  /** 一句话说明为什么没有加成（便于 UI 如实解释）。 */
  readonly issue: string | null;
}

/** 加成上限：引用再多也只有这么多（规范示例为 +2）。 */
export const KNOWLEDGE_BONUS_CAP = 2;

/** 单条素材命中给 +1，两条及以上封顶 +2。 */
export function evaluateKnowledgeInfluence(input: {
  /** 玩家的答案 / 选项原文。 */
  readonly text: string;
  readonly knowledge: readonly KnowledgeItem[];
  /** 调用方声明的被引用 id（例如判卷模型的 citedSourceIds），会被白名单过滤。 */
  readonly citedIds?: readonly string[];
}): KnowledgeInfluence {
  const allowed = new Map(input.knowledge.map((item) => [item.id, item]));
  const text = input.text ?? '';

  const matched: string[] = [];

  // ① 显式声明的引用（先过白名单：模型不许凭空造来源）
  for (const id of input.citedIds ?? []) {
    if (allowed.has(id) && !matched.includes(id)) {
      matched.push(id);
    }
  }

  // ② 文字与素材的实际重合（4 字滑窗，避免"提了一句知乎"就加分）
  for (const item of input.knowledge) {
    if (matched.includes(item.id)) {
      continue;
    }
    if (sharesFourGram(text, item.quote)) {
      matched.push(item.id);
    }
  }

  if (matched.length === 0) {
    return {
      modifier: 0,
      matchedIds: [],
      reason: '这一步没接上你手上那份材料',
      issue: input.knowledge.length === 0 ? 'no-knowledge-this-run' : 'no-overlap',
    };
  }

  const modifier = Math.min(KNOWLEDGE_BONUS_CAP, matched.length);
  return {
    modifier,
    matchedIds: matched,
    reason: matched.length >= 2 ? '你把两份材料拼到了一起，这一步踩得实' : '你引上了那份材料，这一步有据可依',
    issue: null,
  };
}

/** 是否与素材有连续 4 字重合（保守匹配：宁可少给，不给错）。 */
export function sharesFourGram(text: string, quote: string, size = 4): boolean {
  const quoteShingles = shingles(quote, size);
  if (quoteShingles.size === 0) {
    return false;
  }
  for (const shingle of shingles(text, size)) {
    if (quoteShingles.has(shingle)) {
      return true;
    }
  }
  return false;
}

function shingles(text: string, size: number): Set<string> {
  const clean = (text ?? '').replace(/[\s，。！？、；：「」『』（）()"'—…·]/g, '');
  const out = new Set<string>();
  for (let index = 0; index + size <= clean.length; index += 1) {
    out.add(clean.slice(index, index + size));
  }
  return out;
}

/**
 * 给某个来源算一个稳定的短指纹，用于"引用记录"落盘与去重。
 * （同一段引文永远同一个指纹，便于跨局统计"哪些材料真的被用上了"。）
 */
export function knowledgeFingerprint(item: KnowledgeItem): string {
  return stableHash(`know:${item.id}:${item.quote.slice(0, 60)}`).slice(0, 8);
}
