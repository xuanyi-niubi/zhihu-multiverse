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
 * 本用例断言文档引用的是同一组数字。改了测试就重跑一次生成器，文档不跟着改就会红。
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
};

const readme = readFileSync(join(root, 'README.md'), 'utf8');

/*
  ## 为什么产品说明计划书是「可能不存在」的

  `产品说明计划书.md` 是参赛材料，属于**本人自用**，已在 `.gitignore` 里
  （见 `.gitignore` 的「参赛材料与个人底稿」段）。所以：

  - 本机有它 → 相关断言照跑，文档数字必须与统计一致；
  - 新克隆的仓库没有它 → 跳过这一组，而不是让整个测试文件在加载期抛错。

  之前这里是无条件 `readFileSync`：文件缺失会让**整个测试文件**在模块顶层
  崩掉（不是某条用例失败，是这个文件加载不了），报错信息还指向
  「找不到文件」而不是「这件文档不该入库」—— 排查成本很高。
*/
const planPath = join(root, '产品说明计划书.md');
const planAvailable = existsSync(planPath);
const plan = planAvailable ? readFileSync(planPath, 'utf8') : '';

describe('scripts/test-stats.json 自身', () => {
  it('由生成器产出，且记录到真实的用例规模', () => {
    expect(stats.generator).toBe('npm run test:stats');
    expect(stats.files).toBeGreaterThan(0);
    expect(stats.tests).toBeGreaterThan(0);
    expect(stats.passed).toBeLessThanOrEqual(stats.tests);
  });

  /**
   * 刻意**不**断言 `stats.failed === 0`。
   *
   * 那是自指断言：统计文件由「跑测试」生成，而跑测试时会执行本文件的断言；
   * 只要文档与统计不一致，这次运行就必然有失败，于是 `failed === 0` 永远不成立，
   * 形成「改了测试 → 守卫变红 → 统计记下红 → 守卫更红」的死循环。
   *
   * 真正该守的是「文档引用的数字等于统计数字」，下面那一组就是干这个的。
   */
  it('统计里的通过数与用例总数关系自洽', () => {
    expect(stats.passed + stats.failed).toBe(stats.tests);
  });
});

describe('文档引用的数字与统计源一致', () => {
  it('README 引用当前的「N 个测试文件 · M 个用例」', () => {
    expect(readme).toContain(`${stats.files} 个测试文件 · ${stats.tests} 个用例`);
  });

  it('产品说明计划书引用同一组数字（文件不在时跳过）', () => {
    if (!planAvailable) {
      return; // 参赛材料不入库，新克隆里没有这份文件
    }
    expect(plan).toContain(`${stats.files} 个文件 ${stats.tests} 个用例`);
    /*
      这一条原来写死「${stats.tests} 个自动化测试全部通过」。

      那是**只有全绿时才成立**的断言：一旦有用例失败（迁移期是常态），
      它就要求文档撒一句「全部通过」的谎 —— 而这份守卫存在的意义
      恰恰是「文档不许漂」。

      改成断言「文档如实写出通过数」：全绿时通过数就是总数，
      有失败时文档必须写出较小的那个数。
    */
    expect(plan).toContain(`${stats.passed} 个自动化测试`);
  });

  it('文档不许把通过数说成总数（除非真的全绿）', () => {
    if (!planAvailable) {
      return;
    }
    if (stats.failed === 0) {
      expect(plan).toContain(`${stats.tests} 个自动化测试`);
    } else {
      // 有失败时，文档不得出现「总数个…全部通过」这种话
      expect(plan).not.toContain(`${stats.tests} 个自动化测试全部通过`);
      expect(readme).not.toContain(`通过 ${stats.tests} · 失败 0`);
    }
  });

  it('两份文档都不再出现写死的旧口径', () => {
    for (const stale of ['13 个文件 262 个用例', '15 passed (15)', '303 passed (303)', '303 个自动化测试']) {
      expect(readme).not.toContain(stale);
      if (planAvailable) {
        expect(plan).not.toContain(stale);
      }
    }
  });
});
