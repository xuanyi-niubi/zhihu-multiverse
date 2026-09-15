import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 文档口径守卫（P0）。
 *
 * 起因：README 写「15 个文件 / 303 个用例」，产品说明计划书写「13 个文件 / 262 个用例」，
 * 两处同时自相矛盾 —— 手写的测试数字必然会漂。
 *
 * 现在唯一事实源是 `scripts/test-stats.json`（由 `npm run test:stats` 生成），
 * 文档只引用它，不再内嵌数字。
 *
 * ## 为什么不再比较「文档里的数字 == 统计里的数字」
 *
 * 那是**自指**断言，注定追不上：
 *
 *   1. `npm run test:stats` 先跑全量测试，本文件是在这一轮测试里被加载的；
 *   2. 此刻磁盘上的 `scripts/test-stats.json` 还是**上一版**（本轮结果要等跑完才写回），
 *      所以「文档 == 统计」在生成的那一刻永远差一步；
 *   3. 改一次测试就必然先红一次，而这次红又会被写进下一版的 `failed`，
 *      下一次要比较的数字又变了 —— 循环永远追不上。
 *
 * 所以本文件只守**口径与形状**（都读不出本轮结果，因此不会自指）：
 *
 *   - 两份文档都指向唯一事实源，且不再手写会漂的数字；
 *   - 统计文件必须是生成器真跑出来的（`wallClockMs > 0` 的有限数字）；
 *   - 统计文件自身自洽（`passed + failed === tests`、`passed <= tests`）；
 *   - 真有失败用例（`stats.failed > 0`）时，文档不许把测试说成「全部通过」。
 *
 * 这样它仍然拦得住「手写数字 / 口径漂移 / 谎报全绿」，而不是被削弱成空壳。
 */

const root = process.cwd();
const stats = JSON.parse(readFileSync(join(root, 'scripts', 'test-stats.json'), 'utf8')) as {
  files: number;
  filesPassed: number;
  tests: number;
  passed: number;
  failed: number;
  success: boolean;
  generator: string;
  wallClockMs: number;
};

const readme = readFileSync(join(root, 'README.md'), 'utf8');

/*
  ## 为什么产品说明计划书是「可能不存在」的

  `产品说明计划书.md` 是参赛材料，属于**本人自用**，不作为仓库资产对待
  （本意是交给 `.gitignore` 拦，本机这份目前已被 git 跟踪 —— 但「可能缺失」
  这件事依然成立：换台机器、或哪天把它移出索引，它就是没有的）。所以：

  - 有它 → 相关断言照跑，文档口径必须与统计一致；
  - 没有它 → 跳过这一组，而不是让整个测试文件在加载期抛错。

  之前这里是无条件 `readFileSync`：文件缺失会让**整个测试文件**在模块顶层
  崩掉（不是某条用例失败，是这个文件加载不了），报错信息还指向
  「找不到文件」而不是「这件文档不该入库」—— 排查成本很高。
*/
const planPath = join(root, '产品说明计划书.md');
const planAvailable = existsSync(planPath);
const plan = planAvailable ? readFileSync(planPath, 'utf8') : '';

/**
 * 「手写测试规模」的句式特征：数字直接粘在测试规模的量词上。
 *
 * 只盯这几个会随测试规模漂的词；文档里 `:8443`、`60 条真实来源`、`0~2 个澄清问题`
 * 这类与测试规模无关的数字不受影响。
 *
 * 注意正则是 `\d` 而不是 `\\d`：写成 `\\d` 只能匹配一个字面反斜杠，
 * 等于整条断言没守（原版就是这个笔误，本次一并修正）。
 */
const HANDWRITTEN_SCALE = [
  /\d+\s*个(?:测试)?文件/,
  /\d+\s*个用例/,
  /\d+\s*个自动化测试/,
];

/**
 * 「数字 + 通过」的句式：数字与「通过」写在一起，一旦有用例失败就是谎报。
 *
 * 只要求数量词后面紧跟测试相关名词，所以 README 里不带数字的 `CI 全部通过`
 * （说的是 CI 门禁，不是本轮用例数）不在拦截范围内 —— 那份文件的统计口径
 * 本身没有数字可漂。
 */
const COUNTED_PASS_CLAIM = /\d+\s*个(?:自动化测试|测试文件|用例|测试)[^。\n]{0,6}(?:全部)?通过/;

describe('scripts/test-stats.json 自身', () => {
  it('由生成器产出，且记录到真实的用例规模', () => {
    expect(stats.generator).toBe('npm run test:stats');
    expect(stats.files).toBeGreaterThan(0);
    expect(stats.tests).toBeGreaterThan(0);
    expect(stats.passed).toBeLessThanOrEqual(stats.tests);
  });

  it('统计里的通过数与用例总数关系自洽', () => {
    expect(stats.passed + stats.failed).toBe(stats.tests);
  });

  /*
    反手写守卫（这次事故的直接教训）。

    统计文件是「生成器真跑过一遍」的证据：生成器一定会写入
    `wallClockMs: Date.now() - started`（见 scripts/test-stats.mjs 第 48 行），
    而一次全量测试不可能耗时 0 毫秒 —— 手写提交的版本只能编出整点时间戳和
    `wallClockMs: 0`。

    没有这条，手写一份只有 files / tests / passed 的 JSON 就能让上面两条断言
    全绿，统计文件会退化成装饰品：手写的小数字反而掩盖了真实规模。
  */
  it('统计文件由 npm run test:stats 真跑产出（wallClockMs 是大于 0 的有限数字）', () => {
    const wallClockMs = stats.wallClockMs;
    expect(
      Number.isFinite(wallClockMs) && wallClockMs > 0,
      '统计文件不是由 npm run test:stats 生成的（wallClockMs 应为大于 0 的有限数字）：' +
        '手写数字会掩盖真实规模。请重跑 npm run test:stats 重新生成 scripts/test-stats.json。',
    ).toBe(true);
  });
});

describe('文档只引用唯一事实源，不内嵌易漂数字', () => {
  it('README 引用 scripts/test-stats.json，并标明以它为准', () => {
    expect(readme).toContain('scripts/test-stats.json');
    expect(readme).toContain('为准');
  });

  it('README 不再出现手写测试数字', () => {
    for (const pattern of HANDWRITTEN_SCALE) {
      expect(readme).not.toMatch(pattern);
    }
  });

  it('产品说明计划书同样以唯一事实源为准（文件不在时跳过）', () => {
    if (!planAvailable) {
      return; // 参赛材料，可能不在这台机器上：缺失时整组优雅跳过
    }
    expect(plan).toContain('scripts/test-stats.json');
    expect(plan).toContain('为准');
    for (const pattern of HANDWRITTEN_SCALE) {
      expect(plan).not.toMatch(pattern);
    }
  });

  it('两份文档都不再出现写死的旧口径', () => {
    const stale = [
      '13 个文件 262 个用例',
      '15 个文件 / 303 个用例',
      '15 passed (15)',
      '303 passed (303)',
      '303 个自动化测试',
    ];
    for (const literal of stale) {
      expect(readme).not.toContain(literal);
      if (planAvailable) {
        expect(plan).not.toContain(literal);
      }
    }
  });

  it('存在失败用例时，文档不得把测试说成「全部通过」', () => {
    // 任何时候都不许把「数字 + 通过」写进文档：那是会漂的谎。
    for (const pattern of [...HANDWRITTEN_SCALE, COUNTED_PASS_CLAIM]) {
      expect(readme).not.toMatch(pattern);
      if (planAvailable) {
        expect(plan).not.toMatch(pattern);
      }
    }

    if (stats.failed === 0) {
      return; // 全绿：文档可以在不写数字的前提下说明测试状态
    }

    // 有失败用例（`stats.failed > 0`）：任何「测试全部通过」的口径都是谎报。
    const allPassClaims = [/测试全部通过/, /用例全部通过/, /测试均通过/, /测试全绿/];
    for (const pattern of allPassClaims) {
      expect(readme).not.toMatch(pattern);
      if (planAvailable) {
        expect(plan).not.toMatch(pattern);
      }
    }
  });
});
