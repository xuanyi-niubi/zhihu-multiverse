import { describe, expect, it } from 'vitest';

import {
  closeUnbalancedJson,
  extractFirstJsonObject,
  parseDmTurnPayload,
  repairJsonDamage,
  safeParseJson,
  stripCodeFence,
} from '@/core/dm/parse';

/**
 * 容错解析层的核心测试。
 *
 * 最重要的断言不是「能解析出什么」，而是**任何畸形输入都不能抛异常**。
 * 这里用一组真实的模型翻车样本作为语料库，逐个验证：
 * 要么拿到合法对象，要么拿到明确的失败原因。
 */

interface CorpusCase {
  readonly name: string;
  readonly raw: string;
  readonly expect: 'ok' | 'fail';
}

const CORPUS: readonly CorpusCase[] = [
  { name: '标准 JSON', raw: '{"a":1}', expect: 'ok' },
  { name: 'markdown json 围栏', raw: '```json\n{"a":1}\n```', expect: 'ok' },
  { name: 'markdown 无语言围栏', raw: '```\n{"a":1}\n```', expect: 'ok' },
  { name: '前置说明文字', raw: '好的，这是生成结果：\n{"a":1}', expect: 'ok' },
  { name: '后置说明文字', raw: '{"a":1}\n希望这个关卡合适！', expect: 'ok' },
  { name: '尾随逗号', raw: '{"a":1,"b":[1,2,],}', expect: 'ok' },
  { name: '全角标点', raw: '｛“a”：1，\"b\"：2｝', expect: 'ok' },
  { name: '行注释', raw: '{"a":1 // 注释\n}', expect: 'ok' },
  { name: '块注释', raw: '{"a":1 /* 注释 */}', expect: 'ok' },
  { name: '未加引号的键', raw: '{a: 1, b: "x"}', expect: 'ok' },
  { name: 'NaN 字面量', raw: '{"a":NaN}', expect: 'ok' },
  { name: 'undefined 字面量', raw: '{"a":undefined}', expect: 'ok' },
  { name: 'Infinity 字面量', raw: '{"a":-Infinity}', expect: 'ok' },
  { name: '单引号 JSON', raw: "{'a':1,'b':'x'}", expect: 'ok' },
  { name: '数组包裹', raw: '[{"a":1}]', expect: 'ok' },
  { name: '被 max_tokens 截断', raw: '{"a":1,"b":[1,2', expect: 'ok' },
  { name: '截断在字符串中间', raw: '{"a":"未完成的句', expect: 'ok' },
  { name: '字符串内含花括号', raw: '{"a":"}{"}', expect: 'ok' },
  { name: '超长噪声前缀', raw: `${'x'.repeat(8000)}{"a":1}`, expect: 'ok' },
  { name: '零宽字符污染', raw: '\uFEFF\u200B{"a":1}\u200D', expect: 'ok' },
  { name: '顶层 null', raw: 'null', expect: 'fail' },
  { name: '顶层数字', raw: '42', expect: 'fail' },
  { name: '空字符串', raw: '', expect: 'fail' },
  { name: '纯空白', raw: '   \n\t  ', expect: 'fail' },
  { name: '纯散文', raw: '抱歉，我无法完成这个请求。', expect: 'fail' },
  { name: '只有围栏没有内容', raw: '```json\n```', expect: 'fail' },
  { name: '空对象', raw: '{}', expect: 'ok' },
];

describe('safeParseJson 永不抛异常', () => {
  it.each(CORPUS)('$name', ({ raw }) => {
    // 直接调用：若内部抛异常，测试即失败，等价于 not.toThrow 断言
    const parsed = safeParseJson(raw);

    expect(typeof parsed.ok).toBe('boolean');

    if (!parsed.ok) {
      expect(parsed.reason.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数字', 42],
    ['对象', { a: 1 }],
    ['数组', [1, 2]],
  ])('非字符串输入 %s 也不抛', (_label, value) => {
    expect(() => safeParseJson(value)).not.toThrow();
    expect(safeParseJson(value).ok).toBe(false);
  });
});

describe('parseDmTurnPayload', () => {
  it.each(CORPUS)('$name', ({ raw, expect: expected }) => {
    const parsed = parseDmTurnPayload(raw);

    // 顶层必须是对象；数组包裹会被解包，所以除非对象与空结果外都应成功
    if (expected === 'ok') {
      expect(parsed.ok).toBe(true);
    } else {
      expect(parsed.ok).toBe(false);

      if (!parsed.ok) {
        expect(typeof parsed.reason).toBe('string');
        expect(parsed.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('数组包裹时解出第一个对象', () => {
    const result = parseDmTurnPayload('[{"title":"x","storyText":"y","choices":[1,2]}]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.value).toMatchObject({ title: 'x' });
    }
  });
});

describe('底层工具函数', () => {
  it('stripCodeFence 剥离围栏与前缀散文', () => {
    expect(stripCodeFence('说明：```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extractFirstJsonObject 不把字符串里的花括号当成结构', () => {
    expect(extractFirstJsonObject('前言 {"a":"}{","b":1} 后记')).toBe('{"a":"}{","b":1}');
  });

  it('extractFirstJsonObject 对截断输出返回剩余部分', () => {
    expect(extractFirstJsonObject('{"a":1')).toBe('{"a":1');
  });

  it('closeUnbalancedJson 补齐括号与未闭合字符串', () => {
    expect(closeUnbalancedJson('{"a":[1,2')).toBe('{"a":[1,2]}');
    expect(closeUnbalancedJson('{"a":"未完')).toBe('{"a":"未完"}');
  });

  it('repairJsonDamage 组合修复多种损坏', () => {
    const repaired = repairJsonDamage('{a: 1, /*x*/ b: "y",}');
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: 'y' });
  });
});
