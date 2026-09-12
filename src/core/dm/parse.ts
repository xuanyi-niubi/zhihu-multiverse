/**
 * AI DM 输出容错解析层。
 *
 * 硬性契约：本文件导出的函数**永不抛出异常**。
 * 所有 JSON.parse 都包在 try/catch 里，失败时返回结构化的失败结果而不是 throw，
 * 让调用方（generate.ts）可以继续走修复与兜底流程。
 *
 * 解析阶梯（逐级放宽）：
 *   strict          → 直接 JSON.parse
 *   fence-strip     → 剥掉 ```json 围栏与前后缀散文
 *   object-extract  → 扫描出第一个括号配平的 JSON 对象（字符串/转义感知）
 *   damage-repair   → 修全角引号、注释、尾随逗号、未加引号的键、非法字面量
 *   quote-normalize → 单引号 JSON 归一化后再试
 */

export type DmParseStrategy =
  | 'strict'
  | 'fence-strip'
  | 'object-extract'
  | 'damage-repair'
  | 'quote-normalize';

export type DmParseOutcome =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly strategy: DmParseStrategy;
      readonly tried: readonly DmParseStrategy[];
    }
  | { readonly ok: false; readonly reason: string; readonly tried: readonly DmParseStrategy[] };

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;

/** 剥掉 markdown 代码围栏，并去掉首尾的说明性散文。 */
export function stripCodeFence(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  let text = raw.replace(/^\uFEFF/, '').replace(ZERO_WIDTH, '').trim();

  if (text.length === 0) {
    return null;
  }

  // ```json ... ``` / ``` ... ```
  const fence = text.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    text = fence[1].trim();
  } else {
    // 只有开头围栏、结尾缺失（模型被截断）时，去掉起始围栏即可
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/```\s*$/, '').trim();
  }

  // 去掉开头的 "JSON:" / "以下是..." 之类的前缀散文
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const candidates = [firstBrace, firstBracket].filter((index) => index >= 0);
  if (candidates.length > 0) {
    const start = Math.min(...candidates);
    if (start > 0) {
      text = text.slice(start);
    }
  }

  return text.length > 0 ? text : null;
}

/**
 * 扫描出第一个括号配平的 JSON 对象。
 *
 * 字符串与转义感知：花括号出现在字符串字面量内部时不计入深度，
 * 因此 `{"a": "}{"}` 不会提前截断。
 */
export function extractFirstJsonObject(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const start = raw.indexOf('{');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  // 括号未闭合（输出被截断）：返回从 start 到末尾，交给下一级修复
  return raw.slice(start);
}

/** 字符串感知的注释剥离，避免误伤 `https://` 与字符串里的 `//`。 */
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    out += char;
  }

  return out;
}

/** 字符串感知的尾随逗号去除：`{"a":1,}` → `{"a":1}`。 */
function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }
      if (text[lookahead] === '}' || text[lookahead] === ']') {
        continue; // 丢弃这个逗号
      }
    }

    out += char;
  }

  return out;
}

/**
 * 补齐被截断的 JSON。
 *
 * 模型输出撞到 max_tokens 上限时会在半途断掉，典型形态是
 * `{"choices":[{"id":"a","text":"…` 。这里扫描未闭合的括号栈并补齐，
 * 若断在字符串内部则先补引号。
 */
export function closeUnbalancedJson(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if (char === '}' || char === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === char) {
        stack.pop();
      }
      continue;
    }
  }

  let out = input;

  if (inString) {
    out += '"';
  }

  // 如果最后一个有效字符是逗号，先去掉再补括号，避免产生 `,}`
  out = out.replace(/,\s*$/, '');

  while (stack.length > 0) {
    out += stack.pop();
  }

  return out;
}

/** 常见模型输出损坏的确定性修复。只在严格解析失败后调用。 */
export function repairJsonDamage(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  let out = input.replace(/^\uFEFF/, '').replace(ZERO_WIDTH, '');

  out = stripComments(out);

  // 全角标点 → 半角
  out = out
    .replace(/[\u201C\u201D\u201E\u201F\uFF02]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\uFF07]/g, "'")
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/\uFF5B/g, '{')
    .replace(/\uFF5D/g, '}')
    .replace(/\uFF3B/g, '[')
    .replace(/\uFF3D/g, ']');

  // 非法字面量。注意顺序：必须先吞掉正负号，
  // 否则 `-Infinity` 只会被替换成 `-null` 而留下非法 JSON。
  out = out
    .replace(/[+-]?Infinity\b/g, 'null')
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bundefined\b/g, 'null');

  // 未加引号的键名：{turnIndex: 1} → {"turnIndex": 1}
  out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');

  out = stripTrailingCommas(out);
  out = closeUnbalancedJson(out);

  return out;
}

/** 单引号 JSON 归一化：仅在文本里没有双引号时启用，避免破坏正常内容。 */
export function normalizeSingleQuotedJson(input: string): string | null {
  if (typeof input !== 'string' || input.includes('"')) {
    return null;
  }

  return input.replace(/'/g, '"');
}

/**
 * 分层解析。返回结构化结果，永不抛出。
 */
export function safeParseJson(raw: unknown): DmParseOutcome {
  const tried: DmParseStrategy[] = [];

  if (typeof raw !== 'string') {
    return { ok: false, reason: 'input-not-string', tried };
  }

  const text = raw.replace(/^\uFEFF/, '').replace(ZERO_WIDTH, '').trim();

  if (text.length === 0) {
    return { ok: false, reason: 'empty-output', tried };
  }

  const attempt = (candidate: string | null | undefined, strategy: DmParseStrategy): unknown => {
    tried.push(strategy);
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  let value = attempt(text, 'strict');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'strict', tried: [...tried] };
  }

  const fenced = stripCodeFence(text);
  value = attempt(fenced, 'fence-strip');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'fence-strip', tried: [...tried] };
  }

  const extracted = extractFirstJsonObject(fenced ?? text);
  value = attempt(extracted, 'object-extract');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'object-extract', tried: [...tried] };
  }

  const repaired = repairJsonDamage(extracted ?? fenced ?? text);
  value = attempt(repaired, 'damage-repair');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'damage-repair', tried: [...tried] };
  }

  const reExtracted = extractFirstJsonObject(repaired);
  value = attempt(reExtracted, 'object-extract');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'object-extract', tried: [...tried] };
  }

  const singleQuoted = normalizeSingleQuotedJson(repaired);
  value = attempt(singleQuoted, 'quote-normalize');
  if (value !== undefined) {
    return { ok: true, value, strategy: 'quote-normalize', tried: [...tried] };
  }

  return { ok: false, reason: 'no-parseable-json', tried };
}

export interface DmParsedPayload {
  readonly value: unknown;
  readonly strategy: DmParseStrategy;
}

export type DmPayloadResult =
  | { readonly ok: true; readonly payload: DmParsedPayload }
  | { readonly ok: false; readonly reason: string; readonly tried: readonly DmParseStrategy[] };

/**
 * 解析入口：允许顶层是对象或「只含一个对象的数组」。
 *
 * 模型偶尔会把结果包成 `[{...}]`；这里统一解包成对象，
 * 让下游校验器只处理一种形状。
 */
export function parseDmTurnPayload(raw: unknown): DmPayloadResult {
  const outcome = safeParseJson(raw);

  if (!outcome.ok) {
    return outcome;
  }

  const value = outcome.value;

  if (Array.isArray(value)) {
    const firstObject = value.find(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
    );

    if (firstObject === undefined) {
      return { ok: false, reason: 'array-without-object', tried: outcome.tried };
    }

    return { ok: true, payload: { value: firstObject, strategy: outcome.strategy } };
  }

  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'top-level-not-object', tried: outcome.tried };
  }

  return { ok: true, payload: { value, strategy: outcome.strategy } };
}
