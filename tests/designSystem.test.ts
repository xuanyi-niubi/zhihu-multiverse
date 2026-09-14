import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 银盐观象台 · 设计系统的落地契约（`src/app/silver.css`）。
 *
 * ## 为什么它必须被测试
 *
 * 这一代的四条硬纪律，每一条都是「顺手就会破坏」的：
 *
 * ```text
 * 1. 单一 token 体系   —— 只有 --sil-*，旧前缀不许回流（本次重构的核心）
 * 2. 未知永不补全      —— 未显影只有一种状态，没有 hover / 没有估算值
 * 3. 暖色只在现实层    —— 纸层 token 只能被终局那张纸消费
 * 4. 材质不是装饰      —— 不许网格、霓虹外发光、扫描线动画
 * ```
 *
 * ## 与上一版的差别
 *
 * 上一版锁的是 `--ds-*` 那一套，并要求「新增不改旧」——
 * 于是五代 token 前缀（gmv / arc / obs / ds / gd）在同一份 CSS 里并存，
 * 同一屏混用两代材质。那是「AI 味」的结构性来源：没有单一事实源。
 *
 * 现在纪律反过来了：**只允许一套**。数值仍逐字锁在这里，
 * 但锁的是新体系；旧前缀以「禁令」形式被测试，防止回流。
 *
 * 样式细节（间距、字重）不锁。
 */

const root = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

/** 去掉注释后再扫描：注释里会引用 token 名与禁令词。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SILVER_CSS = read('src/app/silver.css');
const GLOBALS_CSS = read('src/app/globals.css');
const SIL = stripComments(SILVER_CSS);

describe('§2 Color Palette：--sil-* 全套且数值逐字一致', () => {
  it('基底 / 三种证据意图 / 现实层 / 未显影 / 文本层级', () => {
    const expected: Readonly<Record<string, string>> = {
      // 暗房基底：刻意不是纯黑（纯黑是 AI 生成页面的第一指纹）
      '--sil-void-900': '#06070b',
      '--sil-void-800': '#090b11',
      '--sil-void-700': '#0d1017',
      '--sil-void-600': '#12161f',
      '--sil-void-500': '#191e29',
      // 文本四档
      '--sil-ink-100': '#f2f4f8',
      '--sil-ink-200': '#c3cad6',
      '--sil-ink-300': '#8d95a5',
      '--sil-ink-400': '#747d8d',
      // 三种证据意图（全站唯一的三种强调色）
      '--sil-zhihu': '#2f6fd0',
      '--sil-zhihu-soft': '#6a9ee0',
      '--sil-zhihu-deep': '#143b73',
      '--sil-alternate': '#4fb8ae',
      '--sil-alternate-soft': '#86d6cd',
      '--sil-alternate-deep': '#1d5b56',
      '--sil-counter': '#b3854a',
      '--sil-counter-soft': '#d8b47e',
      '--sil-counter-deep': '#5e4526',
      // 现实层（相纸）
      '--sil-paper': '#efe9dd',
      '--sil-paper-shade': '#ded5c4',
      '--sil-paper-ink': '#1f1b16',
      '--sil-paper-rule': '#b9ab92',
      // 未显影
      '--sil-undev': '#1b2029',
      '--sil-undev-line': '#2c333f',
      '--sil-undev-text': '#818a99',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(SILVER_CSS, token).toContain(`${token}: ${value};`);
    }
  });

  it('三种证据意图各有独立的 rgb 语义，不是互相的别名', () => {
    // 三个值必须互不相等 —— 否则「三种意图」只是换了个名字
    const zhihu = /--sil-zhihu: (#[0-9a-f]{6});/.exec(SILVER_CSS)?.[1];
    const alternate = /--sil-alternate: (#[0-9a-f]{6});/.exec(SILVER_CSS)?.[1];
    const counter = /--sil-counter: (#[0-9a-f]{6});/.exec(SILVER_CSS)?.[1];
    expect(zhihu).toBeTruthy();
    expect(alternate).toBeTruthy();
    expect(counter).toBeTruthy();
    expect(new Set([zhihu, alternate, counter]).size).toBe(3);
  });

  it('§1 内核：暗房基底不是纯黑，且没有第二套 accent 家族', () => {
    // 纯黑 / 近纯黑是 AI 页面的典型指纹
    expect(SILVER_CSS).not.toMatch(/--sil-void-900:\s*#000000/);
    expect(SILVER_CSS).not.toMatch(/--sil-void-900:\s*#000;/);
    // 旧代的紫罗兰终局色不许回流（终局现在是安全灯琥珀）
    expect(SIL).not.toContain('#c9c0ff');
    expect(SIL).not.toContain('#8b7fd4');
  });
});

describe('§0 单一事实源：旧 token 前缀不许回流', () => {
  it('silver.css 里没有 gmv-* / arc-* / ds-* / gd-* / obs-* 任何一族的**定义**', () => {
    // 「只允许一套」是本次重构的核心纪律；回流即退化回「堆补丁」。
    // 只查 stripComments 之后的内容 —— 文件头的注释会**解释**旧前缀
    // 为什么被合并（那是文档，不是定义）。
    for (const family of ['--gmv-', '--arc-', '--ds-', '--gd-', '--obs-']) {
      expect(SIL, family).not.toContain(family);
    }
  });

  it('新组件只消费 --sil-*，不引用旧 token', () => {
    const migrated = [
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/app/session/[id]/page.tsx',
      'src/components/visual/FateProjectionConsole.tsx',
      'src/components/visual/AuroraBand.tsx',
      'src/components/visual/SignalPulse.tsx',
    ];
    for (const file of migrated) {
      const source = stripComments(read(file));
      for (const stale of ['obs-shell', 'obs-kicker', 'obs-glass', 'ds-input', 'ds-btn-primary', 'gd-guide', 'gmv-']) {
        expect(source, `${file} 仍在用 ${stale}`).not.toContain(stale);
      }
    }
  });
});

describe('§0 三个原创机制（银盐版）', () => {
  it('机制 1 显影：620ms，只做亮度 + 饱和度 + 微缩（不含 blur）', () => {
    const develop = /@keyframes sil-develop \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(develop).toContain('brightness(0.5) saturate(0.4)');
    expect(develop).toContain('translateY(5px)');
    expect(develop).not.toContain('blur');
    expect(SILVER_CSS).toContain('animation: sil-develop 620ms var(--sil-ease) both');
  });

  it('机制 2 极光带：2px、三态、只做透明度呼吸（不位移）', () => {
    const sweep = /@keyframes sil-pulse-soft \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(sweep).toContain('opacity');
    expect(sweep).not.toContain('translate');
    expect(sweep).not.toContain('transform');
    for (const tone of ['--counter', '--end']) {
      expect(SILVER_CSS).toContain(`.sil-aurora${tone}`);
    }
    expect(SILVER_CSS).toContain('animation: sil-pulse-soft 2.4s var(--sil-ease-in-out) infinite');
  });

  it('机制 3 三层世界：Evidence 面板 / Void 未显影 / Reality 纸，三种材质齐备', () => {
    expect(SILVER_CSS).toContain('.sil-panel');
    expect(SILVER_CSS).toContain('.sil-undev');
    expect(SILVER_CSS).toContain('.sil-paper');
  });

  it('§15 一点信号有宽高过渡（修掉「点击瞬间弹大」的跳变）', () => {
    const signal = /\.sil-signal \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(signal).toContain('transition');
    expect(signal).toContain('width 320ms');
    expect(signal).toContain('height 320ms');
  });
});

describe('§4.3 未显影：未知是一等公民，而且永不补全', () => {
  it('45° 斜纹 + 虚线边框，且禁止 hover 高亮', () => {
    const block = /\.sil-undev \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(block).toContain('repeating-linear-gradient');
    expect(block).toContain('-45deg');
    expect(block).toContain('border: 1px dashed var(--sil-undev-line)');
    // 禁止 hover 高亮
    expect(SILVER_CSS).not.toContain('.sil-undev:hover');
  });

  it('标注文案由 data 属性给出（默认「还不知道」）', () => {
    expect(SIL).toContain('content: attr(data-unknown-label)');
    const component = read('src/components/visual/Undeveloped.tsx');
    expect(component).toContain("label = '还不知道'");
    expect(component).toContain('data-unknown-label');
  });

  it('真的用在了「未知」的位置：Unknown Stage 与编译页的「暂时没找到」', () => {
    expect(read('src/components/game/session/SessionUnknownStage.tsx')).toContain(
      "from '@/components/visual/Undeveloped'",
    );
    expect(read('src/components/visual/WorldForge.tsx')).toContain('<Undeveloped');
    // 未知不得出现数字/百分比/进度条
    const unknownStage = read('src/components/game/session/SessionUnknownStage.tsx');
    expect(stripComments(unknownStage)).not.toMatch(/\d+\s*%/);
  });
});

describe('§2 色彩角色：暖色只在现实层', () => {
  it('纸层 token 只被 RealityPass 消费，冷色组件不许碰', () => {
    for (const file of ['src/components/visual/RealityPass.tsx']) {
      expect(read(file), file).toMatch(/--sil-paper/);
    }
    // 首页 / 编译页 / 推演屏 / 极光带 / 未显影 都不许出现暖纸
    for (const file of [
      'src/app/page.tsx',
      'src/app/session/[id]/page.tsx',
      'src/components/game/session/SessionPlayScreen.tsx',
      'src/components/visual/AuroraBand.tsx',
      'src/components/visual/Undeveloped.tsx',
    ]) {
      expect(read(file), file).not.toContain('--sil-paper');
    }
  });
});

describe('§4.1 / §4.5 组件规范', () => {
  it('§4.5 困惑输入框：衬线 18px / 行高 1.8 / 最小 132px（大到像一页纸）', () => {
    const input = /\.sil-input \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(input).toContain('min-height: 132px');
    expect(input).toContain('font-size: 18px');
    expect(input).toContain('line-height: 1.8');
    expect(input).toContain('var(--sil-font-serif)');
    expect(read('src/components/visual/FateProjectionConsole.tsx')).toContain('sil-input');
  });

  it('§4.1 移动端可点性：交互元素至少 44px', () => {
    expect(SILVER_CSS).toContain('min-height: 44px');
    // 触摸设备上全局兜底
    expect(SILVER_CSS).toContain('@media (pointer: coarse)');
  });

  it('§1 圆角一律 2–4px（脱离 SaaS 感）', () => {
    const values = [...SIL.matchAll(/border-radius: (\d+)px/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value < 100);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(4);
    }
    // 圆点是几何，不是圆角
    expect(SILVER_CSS).toContain('border-radius: 50%');
  });
});

describe('§3 Type Scale', () => {
  it('Display 用 clamp 且首屏标题用到它', () => {
    expect(SILVER_CSS).toContain('font-size: clamp(28px, 7.2vw, 56px)');
    expect(SILVER_CSS).toContain('.sil-label');
    expect(SILVER_CSS).toContain('letter-spacing: 0.18em');
    expect(read('src/app/page.tsx')).toContain('sil-title--display');
  });

  it('仪器铭牌不小于 11px（mono 疏排标签的可读下限）', () => {
    /*
      这一条是**实测驱动的**：原来 `.sil-label` 是 10px、`--sm` 是 9px，
      双端测量（.private/audit/measure.mjs）都报"过小文字"。
      10px 的等宽字在小屏上会被系统和浏览器缩放打碎，
      读不清的仪器铭牌就只剩噪音了。
    */
    const label = /\.sil-label \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(label).toContain('font-size: 11px');
    const small = /\.sil-label--sm \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(small).toContain('font-size: 10px');
  });

  it('§3 中文正文硬约束：≥15px、行高 ≥1.7', () => {
    const prose = /\.sil-prose \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(prose).toContain('font-size: 15px');
    expect(prose).toContain('line-height: 1.85');
    // 行长必须被限制（不然宽屏上会拉成一行读不完的长句）
    expect(prose).toContain('max-width: var(--sil-measure)');
  });

  it('§3 数字与坐标一律等宽 + 表格数字', () => {
    const num = /\.sil-num \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(num).toContain('var(--sil-font-mono)');
    expect(num).toContain('tabular-nums');
  });
});

describe('§7 / §8 禁令与降级', () => {
  it("§7 Don't #6：按钮文案后面不追加 →", () => {
    const card = stripComments(read('src/components/game/session/SessionChoiceCard.tsx'));
    expect(card).not.toContain('→');
    expect(card).toContain('<svg');
    // 箭头是内联 SVG，stroke-width <= 1.25
    expect(card).toContain('strokeWidth="1.2"');
  });

  it('§6 性能：同屏 blur 元素 <= 3', () => {
    const backdrop = [...SIL.matchAll(/backdrop-filter:/g)].length;
    expect(backdrop).toBeLessThanOrEqual(3);
  });

  it('§8 移动端降级：星尘只在宽屏出现，且 reduced motion 有兜底', () => {
    expect(read('src/app/page.tsx')).toContain('sil-dust hidden lg:block');
    expect(SILVER_CSS).toContain('.sil-dust');
    /*
      ## 为什么要找「所有」降级块，而不是最后/第一个

      样式表里有**多个** `@media (prefers-reduced-motion: reduce)` 块：
      一个是主降级（关掉入场动画），另一个只处理 Gate 变暗的过渡。

      旧写法用 `lastIndexOf` 取最后一个 —— 在只有一块时碰巧正确，
      新增第二块后就指向了那块只含 `.session-choice-list:has(...)` 的，
      于是「找不到 .sil-dust」而失败。这是**测试对文件结构的隐式假设**
      被打破，不是降级本身没了。

      正确做法：把所有降级块拼起来一起断言。
    */
    const blocks = [
      ...SILVER_CSS.matchAll(
        /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g,
      ),
    ].map((m) => m[0]);
    expect(blocks.length, '至少要有一个 reduced-motion 降级块').toBeGreaterThan(0);
    const reduced = blocks.join('\n');
    expect(reduced).toContain('.sil-develop');
    expect(reduced).toContain('.sil-aurora');
    expect(reduced).toContain('.sil-dust');
  });
});

describe('§9 去 AI 化：三个最强指纹不许出现', () => {
  it('没有网格背景、没有霓虹外发光、没有扫描线动画层', () => {
    // 只查真实代码：layout 的注释会解释这些旧装饰为什么被撤掉（那是文档）
    const layout = stripComments(read('src/app/layout.tsx'));
    // 1. 细网格背景（"科技感"套话）
    expect(layout).not.toContain('bg-grid-fate');
    // 2. 霓虹外发光：不允许「无偏移 + 大模糊」的纯发光阴影
    expect(SIL).not.toMatch(/box-shadow:\s*0 0 (1[0-9]|[2-9][0-9])px/);
    // 3. 扫描线装饰层 + 常驻光晕动画
    expect(layout).not.toContain('bg-scanline');
    expect(layout).not.toContain('animate-halo-pulse');
  });

  it('暗房材质是静态的：颗粒与晕影不做动画', () => {
    const grain = /\.sil-darkroom::before \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(grain).toContain('position: fixed');
    expect(grain).not.toContain('animation');
    const vignette = /\.sil-darkroom::after \{[\s\S]*?\n\}/.exec(SILVER_CSS)?.[0] ?? '';
    expect(vignette).toContain('radial-gradient');
    expect(vignette).not.toContain('animation');
  });

  it('字体不外链 Google（国内网络会阻塞首屏）', () => {
    // 注释里会解释「为什么不再外链」，那是文档；只查真实代码
    const layout = stripComments(read('src/app/layout.tsx'));
    expect(layout).not.toContain('fonts.googleapis.com');
    expect(layout).not.toContain('fonts.gstatic.com');
    // 自托管
    expect(layout).toContain('/fonts/jetbrains-mono.css');
  });
});

describe('§4.7 极光带真的上了页面', () => {
  it('首页 / 编译页各一条，且推演屏按幕换色', () => {
    expect(read('src/app/page.tsx')).toContain('<AuroraBand tone="seek" />');
    expect(read('src/app/session/[id]/page.tsx')).toContain('<AuroraBand tone="seek" />');
    const play = read('src/components/game/session/SessionPlayScreen.tsx');
    expect(play).toContain("actKey === 'end' ? 'end' : actKey === '3' ? 'counter' : 'seek'");
  });
});
