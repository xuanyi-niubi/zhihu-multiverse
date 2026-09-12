import type { MemoryKind, StructuredMemory } from '@/agents/types';

/**
 * Memory Curator + MAG（规范 §4.4「Memory-Augmented Generation」/ 重构计划 §4.4）。
 *
 * 要解决的原始问题：**记忆系统存在，但不被叙事引擎消费**——所以"选择没有长期后果"。
 * 这里做三件事：
 * 1. **策展**：从一回合的结果里提炼值得记住的东西（事件 / 学到 / 关系 / 叙事节点）；
 * 2. **检索**：按「与当前处境的相关度」排序，只把最相关的少量记忆注入 prompt；
 * 3. **注入**：转成定性文字（不含数字），并明确标注"这是你记得的事"。
 *
 * 全部是确定性逻辑（同样的输入 → 同样的记忆与排序），因为记忆一旦不确定，
 * 「跨局连续性」就成了幻觉。
 */

export interface CurateInput {
  readonly act: number;
  readonly totalActs: number;
  readonly choiceText: string;
  readonly outcome: 'success' | 'failure' | 'none';
  /** 心智变化（可为负）。 */
  readonly sanDelta: number;
  /** 羁绊变化。 */
  readonly bondDelta: number;
  readonly droppedRelicName: string | null;
  readonly title: string;
}

const MAX_MEMORIES = 200;

/** 从一回合提炼结构化记忆。 */
export function curateTurn(input: CurateInput): readonly StructuredMemory[] {
  const out: StructuredMemory[] = [];
  const at = `a${input.act}`;

  // episodic：发生了什么
  const verdict =
    input.outcome === 'success' ? '走通了' : input.outcome === 'failure' ? '没走通' : '没有检定';
  out.push({
    id: `mem-${at}-episodic-${slug(input.choiceText)}`,
    kind: 'episodic',
    content: `第 ${input.act} 幕「${input.title}」：你选择「${input.choiceText}」，这一手${verdict}。`,
    act: input.act,
    weight: input.outcome === 'failure' ? 0.8 : 0.6,
  });

  // procedural：学到了什么策略
  if (input.outcome === 'success') {
    out.push({
      id: `mem-${at}-procedural-win`,
      kind: 'procedural',
      content: `你验证过一条可用的路子：${input.choiceText}。`,
      act: input.act,
      weight: 0.7,
    });
  } else if (input.outcome === 'failure') {
    out.push({
      id: `mem-${at}-procedural-loss`,
      kind: 'procedural',
      content: `你试过一条走不通的路：${input.choiceText}，下次要换法。`,
      act: input.act,
      weight: 0.85,
    });
  }

  // relationship：关系变化
  if (input.bondDelta !== 0) {
    out.push({
      id: `mem-${at}-relationship`,
      kind: 'relationship',
      content:
        input.bondDelta > 0
          ? `你与身边人的关系更近了一步（因为「${input.choiceText}」）。`
          : `你与身边人的关系裂了一道缝（因为「${input.choiceText}」）。`,
      act: input.act,
      weight: 0.75,
    });
  }

  // semantic：心智代价的体感
  if (input.sanDelta <= -10) {
    out.push({
      id: `mem-${at}-semantic-cost`,
      kind: 'semantic',
      content: `这一手代价很重，你记住了那种消耗感。`,
      act: input.act,
      weight: 0.9,
    });
  }

  // narrative：关键节点（终幕或拿到遗物）
  if (input.act >= input.totalActs) {
    out.push({
      id: `mem-${at}-narrative-final`,
      kind: 'narrative',
      content: `走到终幕时，你最后做的是「${input.choiceText}」。`,
      act: input.act,
      weight: 1,
    });
  }
  if (input.droppedRelicName) {
    out.push({
      id: `mem-${at}-narrative-relic`,
      kind: 'narrative',
      content: `你在这一局拿到了「${input.droppedRelicName}」。`,
      act: input.act,
      weight: 0.8,
    });
  }

  return out;
}

/** 记忆上限：超了就把权重最低、最旧的挤掉（遗忘是有意的）。 */
export function pruneMemories(memories: readonly StructuredMemory[], max = MAX_MEMORIES): readonly StructuredMemory[] {
  if (memories.length <= max) {
    return memories;
  }
  return [...memories]
    .sort((left, right) => right.weight - left.weight || right.act - left.act)
    .slice(0, max)
    .sort((left, right) => left.act - right.act);
}

export interface RecallInput {
  readonly act: number;
  readonly goalText: string;
  readonly limit?: number;
}

/**
 * MAG 检索：相关度 = 权重 + 目标关键词重合 + 近因。
 *
 * 刻意不用向量（离线可跑、可复现）；中文用 2 字滑窗做关键词重合已经够用。
 */
export function recallMemories(
  memories: readonly StructuredMemory[],
  input: RecallInput,
): readonly StructuredMemory[] {
  const limit = input.limit ?? 5;
  const goalShingles = shingles(input.goalText);

  const scored = memories.map((memory) => {
    const overlap = [...shingles(memory.content)].filter((shingle) => goalShingles.has(shingle)).length;
    const recency = memory.act === input.act ? 0.35 : memory.act === input.act - 1 ? 0.2 : 0;
    return { memory, score: memory.weight + Math.min(0.4, overlap * 0.08) + recency };
  });

  return scored
    .sort((left, right) => right.score - left.score || left.memory.id.localeCompare(right.memory.id))
    .slice(0, limit)
    .map((entry) => entry.memory);
}

const KIND_LABEL: Record<MemoryKind, string> = {
  episodic: '经历',
  semantic: '体感',
  procedural: '经验',
  relationship: '关系',
  narrative: '节点',
};

/** 注入 prompt 的行：定性、无数字、标明来源类别。 */
export function toMemoryPromptLines(memories: readonly StructuredMemory[]): readonly string[] {
  return memories.map((memory) => `- [${KIND_LABEL[memory.kind]}] ${memory.content}`);
}

function shingles(text: string, size = 2): Set<string> {
  const clean = text.replace(/[\s，。！？、；：「」『』（）()"'—…·]/g, '');
  const out = new Set<string>();
  for (let index = 0; index + size <= clean.length; index += 1) {
    out.add(clean.slice(index, index + size));
  }
  return out;
}

/** 稳定 id 片段：让同一条选择在任何时候都生成同一个记忆 id（幂等）。 */
function slug(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).slice(0, 8);
}
