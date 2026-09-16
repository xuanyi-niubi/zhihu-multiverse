import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * README 截图契约。
 *
 * ## 为什么需要它
 *
 * 这份 README 曾经长期挂着一处「文件名与画面内容不符」的错位：
 * `endgame.jpg` 实际是 World Forge、`world-forge.jpg` 实际是第一幕推演，
 * 而 `play-act1.jpg`（真正的第一幕）根本没被引用。
 *
 * 更糟的是，仓库里用一条 HTML 注释**把这个错位写了下来**当作交付说明 ——
 * 等于公开承认「我们的宣传图与文件对不上」。而整套测试全绿：
 * 没有任何断言检查过 README 引用的图片与 `public/screenshots/` 里的文件是否一致。
 *
 * 所以这里补两道闸：
 *
 * 1. **引用必须存在** —— 否则 GitHub 上就是死图；
 * 2. **不许有孤儿图** —— 目录里的每一张都必须被引用。
 *    错位正是靠"多余的旧名文件留在目录里"存活的：
 *    只要你按内容重命名，孤儿检查就会立刻逼你更新引用。
 *
 * 图的内容对不对（是首页还是终局）机器判不了，那仍然要靠人眼；
 * 但"名字与引用对得上"必须由测试兜住。
 */
const root = join(process.cwd());
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const IMAGE_RE = /screenshots\/([\w.-]+\.(?:jpg|jpeg|png|webp))/gi;

describe('README 截图契约', () => {
  it('引用的每张截图都真实存在，且目录里没有未被引用的孤儿图', () => {
    const onDisk = readdirSync(join(root, 'public', 'screenshots'))
      .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))
      .sort();

    const referenced = [...readme.matchAll(IMAGE_RE)]
      .map((match) => match[1])
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort();

    const missing = referenced.filter((name) => !onDisk.includes(name));
    expect(missing, `README 引用了不存在的截图（GitHub 上会是死图）：${missing.join(', ')}`).toEqual([]);

    const orphan = onDisk.filter((name) => !referenced.includes(name));
    expect(
      orphan,
      `这些截图没被 README 引用 —— 要么在 README 里用上它，要么删掉：${orphan.join(', ')}`,
    ).toEqual([]);
  });

  it('不再保留「文件名与内容不符」这类自曝注释', () => {
    // 交付说明里不该出现"图片对不上"的自我承认：要么改好，要么不写。
    expect(readme).not.toMatch(/文件名与画面内容并不完全对应/);
    expect(readme).not.toMatch(/按内容改名/);
  });
});
