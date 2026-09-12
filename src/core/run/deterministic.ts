import { createSeededRng, hashSeed } from '@/core/d20';

/**
 * 确定性基元（P1）。
 *
 * 三条约定，全篇共用：
 *
 * 1. **只有一处随机源**：复用 `core/d20.ts` 的 FNV-1a + mulberry32。
 *    另造一套 PRNG 会让「骰面可复现」和「事件计划可复现」在最底层就分家。
 * 2. **随机因子必须写进 key**：`seed + revision + stableId` 三者一起决定结果；
 *    少任何一个，改剧本或换顺序都会静默改变老挑战的走向。
 * 3. **哈希用稳定字符串**：`stableHash` 只吃结构化内容，不吃对象字面量顺序；
 *    否则同一份计划因为字段顺序不同会算出两个哈希。
 */

/** 十六进制稳定哈希（16 字符）。同输入必得同输出，跨进程/跨平台一致。 */
export function stableHash(input: string): string {
  // 两段独立 FNV（不同 salt）拼成 16 位十六进制，避免短哈希碰撞
  const a = hashSeed(`zhihu-v3:a:${input}`).toString(16).padStart(8, '0');
  const b = hashSeed(`zhihu-v3:b:${input}`).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

/** 把任意 JSON 值规范化成稳定字符串：键按字典序排列，数组保序。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return 'null';
}

/** 稳定哈希一个结构化值。 */
export function hashValue(value: unknown): string {
  return stableHash(canonicalJson(value));
}

/**
 * 构造确定性随机源。
 *
 * @param parts 参与随机的因子，按 `seed → revision → stableId` 顺序传；
 *              顺序不同会得到不同序列，所以调用点必须显式写清楚。
 */
export function rngFor(...parts: readonly (string | number)[]): () => number {
  return createSeededRng(parts.map((part) => String(part)).join('::'));
}

export interface WeightedCandidate<T> {
  readonly value: T;
  readonly weight: number;
}

/**
 * 稳定加权抽取。
 *
 * `weight <= 0` 的候选直接出局（权重 0 表示「这一局不该出现」而不是「很少出现」）；
 * 其余按累计权重落点。同一 rng 与同一候选序列必得同一结果。
 */
export function pickWeighted<T>(candidates: readonly WeightedCandidate<T>[], rng: () => number): T | null {
  const usable = candidates.filter((candidate) => candidate.weight > 0);
  if (usable.length === 0) {
    return null;
  }

  const total = usable.reduce((sum, candidate) => sum + candidate.weight, 0);
  let point = rng() * total;

  for (const candidate of usable) {
    point -= candidate.weight;
    if (point <= 0) {
      return candidate.value;
    }
  }

  // 浮点误差兜底：返回最后一个合法候选
  return usable[usable.length - 1].value;
}

/** 稳定排序（同权重按 stableId 字典序），用于让结果与输入顺序无关。 */
export function sortByStableId<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = idOf(left);
    const b = idOf(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
