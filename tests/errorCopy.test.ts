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

  it('本项目自己的 kebab-case 错误码也不算人话（2026-09 补的缺口）', () => {
    /*
      这是一个真实漏出去的 bug：原来的词表只认英文技术词与数字状态码，
      而本项目的内部错误码全是 `word-word` 形态，于是
      `提交失败：invalid-response` 会**整句原样**出现在页面上。
      玩家看到的是一句带着自己看不懂的英文短横线的中文 ——
      信息量为零，还暴露了实现细节。
    */
    for (const code of [
      'invalid-response',
      'missing-story',
      'empty-choices',
      'insufficient-valid-choices',
      'app-provider-unavailable',
    ]) {
      expect(looksTechnical(`提交失败：${code}`), code).toBe(true);
      const copy = playerFacingError({ message: `提交失败：${code}` });
      expect(copy.title, code).not.toContain(code);
      expect(copy).toEqual(AI_UNAVAILABLE);
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
 *
 * ## 契约迁移说明
 *
 * 这条纪律原来钉在 `components/BossTerminal.tsx` 上（它把原因码留在
 * `data-boss-error` 里、人话照常显示）。Boss 整屏随旧 RPG 一并删除后，
 * 本测试改钉**现在真正承担翻译职责的那一层**：`playerFacingError()`。
 *
 * 这比原来更强 —— 原来只保证一个组件写对了，现在保证
 * 「任何服务端原因码进来，出口都必须是给人看的话」。
 */
describe('界面不直接把原因码拼进文案', () => {
  it('原因码一律先经 playerFacingError 翻译，且译后文案不含原始码', () => {
    const raw = { code: 'invalid-response', message: '提交失败：invalid-response' };
    const faced = playerFacingError(raw);

    // 原文里那些「技术细节泄露」的形态，翻译后必须消失
    expect(faced.title).not.toContain('invalid-response');
    expect(faced.title).not.toContain('提交失败');
    expect(faced.title.length).toBeGreaterThan(0);

    // 空输入也不能漏出原始码
    const empty = playerFacingError({});
    expect(empty.title.length).toBeGreaterThan(0);
    expect(empty.title).not.toContain('undefined');
  });

  it('首页只能渲染翻译后的文案，不能渲染服务端原文', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    expect(page).toContain('playerFacingError');
    // 不许把 payload.error.message 直接铺到 JSX 里
    expect(page).not.toContain('{payload.error.message}');
    expect(page).not.toContain('{error.message}');
  });
});
