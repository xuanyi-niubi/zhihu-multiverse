#!/usr/bin/env node
/**
 * 生成唯一的测试统计源（`scripts/test-stats.json`）。
 *
 * 为什么需要它：README 与产品说明计划书里曾同时存在「13 个文件 262 个用例」
 * 和「303 个测试全部通过」两种口径 —— 手写数字必然会漂。现在文档只引用
 * 本脚本产出的结果，`tests/docsStats.test.ts` 会断言两者一致。
 *
 * 用法：npm run test:stats
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawPath = join(root, '.test-stats-raw.json');
const outPath = join(root, 'scripts', 'test-stats.json');

const started = Date.now();
try {
  // 用命令串而不是参数数组：Windows 下 .cmd 需要 shell，
  // 传数组会触发 DEP0190 警告。
  execSync(`npx vitest run --reporter=json --outputFile="${rawPath}"`, {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  // 有用例失败时不终止：仍然产出统计，让文档能引用真实的「通过/失败」数字
  console.warn('[test-stats] vitest 退出码非 0（有用例失败），继续生成统计');
}

const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const results = raw.testResults ?? [];
const filesPassed = results.filter((file) =>
  (file.assertionResults ?? []).every((assertion) => assertion.status !== 'failed'),
).length;

const stats = {
  generatedAt: new Date().toISOString(),
  generator: 'npm run test:stats',
  files: results.length,
  filesPassed,
  tests: raw.numTotalTests ?? 0,
  passed: raw.numPassedTests ?? 0,
  failed: raw.numFailedTests ?? 0,
  success: Boolean(raw.success),
  wallClockMs: Date.now() - started,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
rmSync(rawPath, { force: true });

console.log(
  `[test-stats] ${stats.files} 个测试文件 / ${stats.tests} 个用例 ` +
    `(通过 ${stats.passed}，失败 ${stats.failed}) -> scripts/test-stats.json`,
);

if (stats.failed > 0) {
  process.exitCode = 1;
}
