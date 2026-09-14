import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AI_UNAVAILABLE,
  CONTENT_UNAVAILABLE,
  looksTechnical,
  NETWORK_UNAVAILABLE,
  NO_RELIABLE_EXPERIENCE,
  playerFacingError,
  PUBLIC_BUDGET_EXHAUSTED,
} from '@/features/run/errorCopy';

/**
 * 错误态文案的契约（05_AGENT §9）。
 *
 * 三条不许退让的事：
 *
 * 1. 三句固定文案一字不改（它们是产品语气的一部分）；
 * 2. **技术细节永不出现在页面上**：429 / quota / provider exception / 堆栈；
 * 3. 服务端本来写给玩家的中文消息要如实透出 —— 不能一律换成通用文案，
 *    否则「先写下一句你现在卡住的选择」这种有用提示就丢了。
 */

describe('§9 三句固定文案', () => {
  it('没找到可靠经历', () => {
    expect(NO_RELIABLE_EXPERIENCE.title).toBe('这次没找到足够可靠的真实经历。');
    expect(NO_RELIABLE_EXPERIENCE.hint).toBe('换一种更具体的说法再试一次。');
    expect(NO_RELIABLE_EXPERIENCE.actions).toEqual(['修改问题', '重新尝试']);
  });

  it('AI 暂时不可用', () => {
    expect(AI_UNAVAILABLE).toEqual({
      title: '这次世界没能继续生成。',
      hint: '你可以稍后重试。',
    });
  });

  it('公共体验额度用满', () => {
    expect(PUBLIC_BUDGET_EXHAUSTED).toEqual({
      title: '今天的公共体验额度暂时用完了。',
      hint: '你可以稍后再来，或在高级设置中使用自己的模型。',
    });
  });
});

describe('错误码 → 玩家文案', () => {
  it('两类配额拒绝都归到公共额度那句话', () => {
    for (const code of ['quota-exceeded', 'budget-exhausted']) {
      expect(playerFacingError({ code, message: '429 quota exceeded' })).toEqual(PUBLIC_BUDGET_EXHAUSTED);
    }
  });

  it('上游 / provider 失败归到「世界没能继续生成」', () => {
    for (const code of ['app-provider-unavailable', 'upstream-failed', 'upstream-unavailable']) {
      expect(
        playerFacingError({ code, message: 'provider exception: upstream returned 502' }),
      ).toEqual(AI_UNAVAILABLE);
    }
  });

  it('会话不存在 → 明确的找回路径，而不是通用报错', () => {
    expect(playerFacingError({ code: 'not-found', message: '没有找到这个会话。' })).toEqual(
      CONTENT_UNAVAILABLE,
    );
  });

  it('本来就写给玩家的中文消息原样透出', () => {
    expect(playerFacingError({ code: 'bad-request', message: '先写下一句你现在卡住的选择。' })).toEqual({
      title: '先写下一句你现在卡住的选择。',
      hint: null,
    });
  });

  it('没有错误体 / 空消息 → 通用生成失败文案', () => {
    expect(playerFacingError({})).toEqual(AI_UNAVAILABLE);
    expect(playerFacingError({ code: 'unknown', message: '   ' })).toEqual(AI_UNAVAILABLE);
    expect(playerFacingError({ code: 'unknown', message: null })).toEqual(AI_UNAVAILABLE);
  });
});

describe('技术细节永不出现在页面上', () => {
  it('识别常见技术报错', () => {
    for (const raw of [
      '429 quota exceed',
      'HTTP 503 from provider',
      'Error: connect ECONNREFUSED 127.0.0.1:443',
      'request timeout after 30000ms',
      'TypeError: Cannot read properties of undefined',
      'at Object.<anonymous> (/app/.next/server/chunks/1.js:1:1)',
      '{"error":{"code":"quota"}}',
    ]) {
      expect(looksTechnical(raw), raw).toBe(true);
      const copy = playerFacingError({ message: raw });
      expect(copy).toEqual(AI_UNAVAILABLE);
      expect(copy.title).not.toContain('429');
      expect(copy.title).not.toContain('provider');
    }
  });

  it('正常中文消息不会被误判成技术报错', () => {
    for (const raw of [
      '先写下一句你现在卡住的选择。',
      '还有澄清问题没有回答，先回答它们再生成世界。',
      '请选择一个你想先弄清的未知。',
    ]) {
      expect(looksTechnical(raw), raw).toBe(false);
    }
  });
});

describe('网络层文案', () => {
  it('是独立的一句，不假装是服务端错误', () => {
    expect(NETWORK_UNAVAILABLE.title).toBe('网络好像没有连上。');
    expect(NETWORK_UNAVAILABLE).not.toEqual(AI_UNAVAILABLE);
  });
});

/**
 * 界面层不许把原因码直接插进句子。
 *
 * `提交失败：invalid-response` 这种写法对玩家毫无信息量，
 * 却正好是「技术细节泄露到页面」的典型形态。
 */
describe('界面不直接把原因码拼进文案', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/BossTerminal.tsx'), 'utf8');

  it('BossTerminal 只给人话，原因码留在 data-boss-error', () => {
    expect(source).toContain('这次提交没能完成');
    expect(source).not.toContain('提交失败：{error}');
    expect(source).toContain('data-boss-error={error}');
  });
});
