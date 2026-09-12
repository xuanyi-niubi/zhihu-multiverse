import { describe, expect, it, vi } from 'vitest';

import { createTrace, createTraceId, normalizeCode } from '@/core/observability';

/**
 * 可观测性的两条硬约束（P0）：
 *
 * ① **日志里绝不出现密钥形态的键与玩家原文** —— 这一条由脱敏规则保证，
 *    并且用「把密钥塞进 extra」的用例正面验证；
 * ② **日志失败不能影响主流程** —— sink 抛异常时 finish 照常返回事件。
 */

describe('createTraceId', () => {
  it('形态可读：tr-<base36 时间>-<随机>', () => {
    const id = createTraceId(() => 1_700_000_000_000);

    expect(id.startsWith('tr-')).toBe(true);
    expect(id.split('-').length).toBe(3);
  });

  it('同一时刻也不会重复', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createTraceId(() => 1)));

    expect(ids.size).toBe(200);
  });
});

describe('normalizeCode', () => {
  it('大写与下划线折成连字符', () => {
    expect(normalizeCode('ZHIHU_SEARCH_NETWORK')).toBe('zhihu-search-network');
    expect(normalizeCode('route_catch')).toBe('route-catch');
  });

  it('非字符串或全非法退回 invalid-code', () => {
    expect(normalizeCode(undefined)).toBe('invalid-code');
    expect(normalizeCode('!!!')).toBe('invalid-code');
  });
});

describe('createTrace', () => {
  it('阶段耗时累计，totalMs 非负', () => {
    let clock = 1000;
    const trace = createTrace({ now: () => clock, sink: () => {} });

    trace.stage('zhihu-search', 120);
    trace.stage('zhihu-search', 30);
    trace.stage('dm-generate', 800);
    clock = 2500;

    const event = trace.finish();

    expect(event.stages['zhihu-search']).toBe(150);
    expect(event.stages['dm-generate']).toBe(800);
    expect(event.totalMs).toBe(1500);
  });

  it('非法耗时被归零，不写进负数', () => {
    const trace = createTrace({ sink: () => {} });
    trace.stage('x', Number.NaN);
    trace.stage('y', -50);

    expect(trace.snapshot().stages).toEqual({ x: 0, y: 0 });
  });

  it('carries runId 与 turnIndex', () => {
    const trace = createTrace({ runId: 'run-7', turnIndex: 3, sink: () => {} });
    const event = trace.finish();

    expect(event.runId).toBe('run-7');
    expect(event.turnIndex).toBe(3);
  });

  it('**不写入密钥形态的字段，也不写入长玩家文本**', () => {
    const lines: string[] = [];
    const trace = createTrace({ sink: (line) => lines.push(line) });

    // 夹具刻意用中性占位值：仓库里不出现任何密钥形态字符串，
    // 否则任何扫描器（含 GitHub secret scanning）都会把它当泄露。
    // 要验证的不变量是「敏感键名整条丢弃」与「自由文本整条丢弃」，与值的形态无关。
    const marker = 'placeholder-value-must-be-dropped';
    const playerText = '大三法学想转码'.repeat(50);

    const event = trace.finish({
      apiKey: marker,
      Authorization: marker,
      DM_API_KEY: marker,
      accessToken: marker,
      password: marker,
      source: 'fallback',
      snippetCount: 3,
      goal: playerText,
      nested: { token: marker },
    });

    const line = lines.join('\n');

    // 敏感键名：连键带值都不出现
    expect(line).not.toContain(marker);
    expect(Object.keys(event.extra)).not.toContain('apiKey');
    expect(Object.keys(event.extra)).not.toContain('Authorization');
    expect(Object.keys(event.extra)).not.toContain('DM_API_KEY');
    expect(Object.keys(event.extra)).not.toContain('accessToken');
    expect(Object.keys(event.extra)).not.toContain('password');

    // 自由文本整条丢弃（截断也不留：前缀依然是玩家写的话）
    expect(line).not.toContain('大三法学');
    expect(Object.keys(event.extra)).not.toContain('goal');
    expect(Object.keys(event.extra)).not.toContain('nested');

    // 只有可枚举标记留下
    expect(event.extra.source).toBe('fallback');
    expect(event.extra.snippetCount).toBe(3);
  });

  it('只输出一次：重复 finish 不会重复落日志', () => {
    const lines: string[] = [];
    const trace = createTrace({ sink: (line) => lines.push(line) });

    trace.finish({ source: 'model' });
    trace.finish({ source: 'fallback' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[obs]');
  });

  it('sink 抛异常不影响主流程', () => {
    const trace = createTrace({
      sink: () => {
        throw new Error('日志后端挂了');
      },
    });

    expect(() => trace.finish()).not.toThrow();
  });

  it('OBSERVABILITY=off 时完全不输出', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    process.env.OBSERVABILITY = 'off';

    try {
      createTrace().finish({ source: 'fallback' });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      delete process.env.OBSERVABILITY;
      spy.mockRestore();
    }
  });

  it('默认 sink 走 console.info 单行 JSON', () => {
    // vitest 配置里默认 OBSERVABILITY=off（免得路由日志混进测试报告），
    // 这条用例专门验默认路径，所以自己把它打开，并在结束时还原。
    const previous = process.env.OBSERVABILITY;
    delete process.env.OBSERVABILITY;

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      createTrace().finish({ source: 'model' });

      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0][0]);
      expect(line.startsWith('[obs] ')).toBe(true);
      const parsed = JSON.parse(line.slice('[obs] '.length));
      expect(parsed.extra.source).toBe('model');
      expect(typeof parsed.traceId).toBe('string');
    } finally {
      spy.mockRestore();
      if (previous === undefined) {
        delete process.env.OBSERVABILITY;
      } else {
        process.env.OBSERVABILITY = previous;
      }
    }
  });
});
