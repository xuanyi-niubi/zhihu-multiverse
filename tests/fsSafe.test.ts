import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { removeFile, tryRemoveFile } from '@/core/fsSafe';

/**
 * 跨平台文件删除（主路径冒烟测试挡出来的问题）。
 *
 * 实测：`rmSync(path, { force: true })` 在本机**静默失败** ——
 * 文件还在，也不抛错。后果是所有「删除」类功能都假装成功：
 * 用户点删除、接口返回 200，数据却仍留在磁盘上。
 *
 * 这组用例把 `removeFile` 的语义钉住，防止有人再改回 `rmSync(force)`。
 */
describe('removeFile', () => {
  function withTempFile(run: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'zhihu-fs-safe-'));
    const path = join(dir, 'target.json');
    writeFileSync(path, '{"a":1}', 'utf8');
    try {
      run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('**真的把文件删掉**（不是「不报错但文件还在」）', () => {
    withTempFile((path) => {
      expect(existsSync(path)).toBe(true);
      removeFile(path);
      expect(existsSync(path)).toBe(false);
    });
  });

  it('文件不存在时视为成功（幂等，调用方不必先判断）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhihu-fs-safe-'));
    try {
      const missing = join(dir, 'never-existed.json');
      expect(() => removeFile(missing)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('连续删除两次不抛错', () => {
    withTempFile((path) => {
      removeFile(path);
      expect(() => removeFile(path)).not.toThrow();
    });
  });

  it('tryRemoveFile 返回布尔而不是抛错', () => {
    withTempFile((path) => {
      expect(tryRemoveFile(path)).toBe(true);
      expect(existsSync(path)).toBe(false);
      // 第二次：目标已达成，仍算成功（幂等）
      expect(tryRemoveFile(path)).toBe(true);
    });
  });
});
