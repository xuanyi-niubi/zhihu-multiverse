/**
 * 轻量可观测性：traceId、阶段耗时、降级原因码。
 *
 * 设计约束（和「不泄露密钥、不外传玩家原文」一致）：
 *
 * - **只记录可枚举的东西**：来源标记（model / repaired / cached / fallback）、
 *   阶段名、耗时、问题码。绝不写入 API key、Authorization、完整玩家输入或模型原文。
 * - **写不进去也不能影响主流程**：任何异常都被吞掉，日志永远不是正确性的一部分。
 * - **单行 JSON**：便于采集与 grep；前缀 `[obs]` 便于本地过滤。
 *
 * 用法：
 * ```ts
 * const trace = createTrace({ turnIndex: input.turnIndex });
 * const t0 = Date.now();
 * ... await 某阶段 ...
 * trace.stage('zhihu-search', Date.now() - t0);
 * trace.note('zhihu-search-failed');
 * trace.finish({ source: 'fallback', snippetCount: 0 });
 * ```
 */

export type StageSource = 'model' | 'repaired' | 'cached' | 'fallback';

export interface TraceEvent {
  readonly traceId: string;
  readonly runId: string | null;
  readonly turnIndex: number | null;
  /** 阶段名 → 累计毫秒。 */
  readonly stages: Record<string, number>;
  /** 降级/修复原因码（白名单式短串）。 */
  readonly codes: string[];
  readonly totalMs: number;
  readonly extra: Record<string, string | number | boolean | null>;
}

export interface Trace {
  readonly traceId: string;
  /** 记一个阶段的耗时（毫秒，负数按 0 计）；同名阶段累加。 */
  stage(name: string, ms: number): void;
  /** 记一个原因码。非法形态会被替换成 `invalid-code`。 */
  note(code: string): void;
  /** 生成事件但先不输出（便于测试断言）。 */
  snapshot(): TraceEvent;
  /** 输出一行 JSON；重复调用只生效一次。 */
  finish(extra?: Record<string, unknown>): TraceEvent;
}

/** 原因码白名单形态：小写字母/数字/连字符，最长 40。 */
const CODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * 规范化原因码：统一小写、把非法字符折成连字符。
 *
 * 上游的问题码形态并不统一（`zhihu-search-NETWORK`、`route_catch`…），
 * 与其整条丢掉，不如折成合法形态 —— 可检索比「干净」更重要。
 * 实在无法规范化（非字符串、全非法）时才退回 `invalid-code`。
 */
export function normalizeCode(code: unknown): string {
  if (typeof code !== 'string') {
    return 'invalid-code';
  }
  const cleaned = code
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return CODE_RE.test(cleaned) ? cleaned : 'invalid-code';
}

/** 敏感键名：命中就整条丢弃，不尝试脱敏——避免「以为洗过了」。 */
const FORBIDDEN_KEY_RE = /(key|token|secret|password|authorization|cookie|apikey)/i;

/**
 * 值是否是可安全落日志的「标记」而不是自由文本。
 *
 * 只放行枚举/标识形态（`fallback`、`zhihu-search-network`、`run-7`、`ai-dm`）。
 * 一旦出现空格或中文就判定为自由文本 —— **玩家原文与模型原文一个字都不写进日志**，
 * 截断也不行：64 字的前缀依然是玩家写的话。
 */
const SAFE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,31}$/;

export function isSafeLogValue(value: string): boolean {
  return SAFE_VALUE_RE.test(value);
}

function sanitizeExtra(extra: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!extra) {
    return out;
  }

  for (const [key, value] of Object.entries(extra)) {
    if (FORBIDDEN_KEY_RE.test(key)) {
      continue; // 敏感键直接丢，不做「脱敏后保留」
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else if (typeof value === 'string' && isSafeLogValue(value)) {
      out[key] = value;
    }
    // 自由文本、对象、数组、函数一律丢弃：日志里不该出现玩家或模型写的内容
  }

  return out;
}

/** 阶段与原因码的条目上限：日志不能成为内存泄漏源。 */
const MAX_STAGES = 24;
const MAX_CODES = 24;

export interface CreateTraceInput {
  readonly runId?: string | null;
  readonly turnIndex?: number | null;
  /** 注入时钟，便于测试。 */
  readonly now?: () => number;
  /** 注入输出，便于测试；默认 console.info。 */
  readonly sink?: (line: string) => void;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** 生成 traceId：`tr-<base36 时间>-<随机 6 位>`，便于按时间排序与人工识别。 */
export function createTraceId(now: () => number = Date.now): string {
  return `tr-${now().toString(36)}-${randomSuffix()}`;
}

/** 环境开关：`OBSERVABILITY=off` 时完全不输出（测试与压测用）。 */
function outputEnabled(): boolean {
  return (process.env.OBSERVABILITY ?? '').toLowerCase() !== 'off';
}

export function createTrace(input: CreateTraceInput = {}): Trace {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const traceId = createTraceId(now);

  /**
   * 输出通道。
   *
   * `OBSERVABILITY=off` **只关掉默认的 console 通道**（那是自动行为，压测/测试时该闭嘴）；
   * 调用方显式注入的 `sink` 永远照常调用 —— 它代表「我明确要这份事件」，
   * 被环境开关静音会让诊断与单测莫名其妙地拿不到数据。
   */
  const emit =
    input.sink ??
    ((line: string) => {
      if (outputEnabled()) {
        console.info(line);
      }
    });

  const stages: Record<string, number> = {};
  const codes: string[] = [];
  let finished = false;

  const snapshot = (): TraceEvent => ({
    traceId,
    runId: typeof input.runId === 'string' && input.runId.length > 0 ? input.runId : null,
    turnIndex:
      typeof input.turnIndex === 'number' && Number.isFinite(input.turnIndex) ? input.turnIndex : null,
    stages: { ...stages },
    codes: [...codes],
    totalMs: Math.max(0, now() - startedAt),
    extra: {},
  });

  return {
    traceId,

    stage(name, ms) {
      if (typeof name !== 'string' || name.length === 0 || name.length > 40) {
        return;
      }
      if (Object.keys(stages).length >= MAX_STAGES && !(name in stages)) {
        return;
      }
      const value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
      stages[name] = (stages[name] ?? 0) + value;
    },

    note(code) {
      if (codes.length >= MAX_CODES) {
        return;
      }
      codes.push(normalizeCode(code));
    },

    snapshot,

    finish(extra) {
      const event: TraceEvent = { ...snapshot(), extra: sanitizeExtra(extra) };

      if (!finished) {
        finished = true;
        try {
          emit(`[obs] ${JSON.stringify(event)}`);
        } catch {
          // 日志失败不影响主流程
        }
      }

      return event;
    },
  };
}
