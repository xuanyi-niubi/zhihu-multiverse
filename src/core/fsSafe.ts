import { unlinkSync } from 'node:fs';

/**
 * 删除单个文件（跨平台可靠版）。
 *
 * ## 为什么不用 `rmSync(path, { force: true })`
 *
 * 实测（Windows + 本项目 `data/` 目录）：
 *
 * ```text
 * rmSync(force)    before=true after=true err=none   ← 静默失败，文件还在，也不报错
 * unlinkSync       before=true after=false err=none  ← 正常
 * ```
 *
 * 后果很具体：所有「删除」类功能都会**假装成功** ——
 * 用户点「删除会话 / 清除密钥」，接口返回 200，但数据仍在磁盘上。
 * 这是最坏的一类 bug：不报错，却让用户以为已经删掉了。
 *
 * 主路径的冒烟测试就是被这个问题挡住的（删除后 GET 仍然 200）。
 *
 * ## 语义
 *
 * - 文件不存在 → 视为成功（幂等，调用方不必先判断存在性）；
 * - 其它错误 → 向上抛，让调用方如实返回失败，而不是假装删掉了。
 */
export function removeFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // 已经不在了 = 目标已达成，不算失败
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

/** 删除文件，返回是否成功（吞掉异常，供「尽力而为」的调用点使用）。 */
export function tryRemoveFile(path: string): boolean {
  try {
    removeFile(path);
    return true;
  } catch {
    return false;
  }
}
