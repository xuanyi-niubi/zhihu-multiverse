import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 显影厅 · 第三代设计系统的落地契约（DESIGN-SYSTEM.md）。
 *
 * ## 为什么它必须被测试
 *
 * 这一代的三条硬纪律，每一条都是「顺手就会破坏」的：
 *
 * ```text
 * 1. 新增不改旧      —— 新组件用 --ds-*，旧组件继续用 --obs-*（附录 B）
 * 2. 未知永不补全    —— 未显影只有一种状态，没有 hover / 没有估算值（§4.3）
 * 3. 暖色只在现实层  —— #F2EDE4 只能出现在终局的那张纸上（§2 色彩角色）
 * ```
 *
 * 颜色数值、机制命名、动效时长都逐字锁在这里。样式细节（间距、字重）不锁。
 */

const root = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

/** 去掉注释后再扫描：注释里会引用 token 名与禁令词。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const GLOBALS_CSS = read('src/app/globals.css');
const MARKER = 'PASS 4 · 显影厅';
const DS = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf(MARKER));

describe('§2 Color Palette：--ds-* 全套且数值逐字一致', () => {
  it('基底 / 结构蓝 / 三种证据意图 / 终局 / 未显影 / 纸层', () => {
    const expected: Readonly<Record<string, string>> = {
      '--ds-void-950': '#03040a',
      '--ds-void-900': '#06080f',
      '--ds-void-800': '#0a0e18',
      '--ds-void-700': '#101725',
      '--ds-blue-900': '#04122e',
      '--ds-blue-700': '#0052d9',
      '--ds-blue-600': '#1c6bea',
      '--ds-blue-500': '#0084ff',
      '--ds-blue-300': '#4ea5ff',
      '--ds-blue-100': '#cfe8ff',
      '--ds-evidence': '#0084ff',
      '--ds-alternative': '#66f2ff',
      '--ds-alternative-soft': '#8af5d1',
      '--ds-counter': '#d8a85d',
      '--ds-counter-soft': '#e4c28d',
      '--ds-ending': '#c9c0ff',
      '--ds-ending-deep': '#8b7fd4',
      '--ds-paper-100': '#f2ede4',
      '--ds-paper-300': '#dcd3c4',
      '--ds-paper-ink': '#241f1a',
      '--ds-paper-accent': '#c9a87c',
      '--ds-undev-ink': '#2a3242',
      '--ds-undev-text': '#5c6879',
      '--ds-undev-line': '#3a4455',
      '--ds-text-0': '#f5f7fb',
      '--ds-text-1': '#c5d0de',
      '--ds-text-2': '#8b9bb1',
      '--ds-text-3': '#5c6879',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(DS, token).toContain(`${token}: ${value};`);
    }
  });

  it('附录 B 的纪律：新增不改旧 —— --obs-* 仍然在，且映射关系没被改写', () => {
    for (const legacy of ['--obs-bg-0', '--obs-text-0', '--obs-zhihu', '--obs-path', '--obs-counter', '--obs-end']) {
      expect(GLOBALS_CSS).toContain(`${legacy}:`);
    }
    // 同义 token 的值必须继续相等（否则「映射」就是假的）
    expect(GLOBALS_CSS).toContain('--obs-zhihu: #0084ff');
    expect(DS).toContain('--ds-blue-500: #0084ff');
    expect(GLOBALS_CSS).toContain('--obs-path: #66f2ff');
    expect(DS).toContain('--ds-alternative: #66f2ff');
  });

  it('§1 内核：结构蓝 #0052D9 与知乎蓝 #0084FF 分工不混', () => {
    expect(DS).toContain('--ds-blue-700: #0052d9');
    // 知乎来源信号仍然只认 #0084FF
    expect(DS).toContain('.ds-badge--similar');
    expect(DS).toContain('background: rgb(var(--ds-rgb-blue-500) / 0.12)');
  });
});

describe('§0 三个原创机制', () => {
  it('机制 1 显影：620ms，只做亮度 + 饱和度 + 微缩（不含 blur）', () => {
    const develop = /@keyframes ds-develop \{[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(develop).toContain('brightness(0.42) saturate(0.32)');
    expect(develop).toContain('scale(0.985)');
    expect(develop).not.toContain('blur');
    expect(DS).toContain('animation: ds-develop 620ms var(--ds-ease) both');
  });

  it('机制 2 极光带：2px、三态、只做透明度呼吸', () => {
    const aurora = /@keyframes ds-aurora-sweep \{[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(aurora).toContain('opacity');
    expect(aurora).not.toContain('translate');
    expect(aurora).not.toContain('transform');
    for (const tone of ['--ds-aurora-seek', '--ds-aurora-counter', '--ds-aurora-end']) {
      expect(DS).toContain(tone);
    }
    expect(DS).toContain('animation: ds-aurora-sweep 2.4s var(--ds-ease) infinite');
  });

  it('机制 3 三层世界：Evidence 玻璃 / Void 未显影 / Reality 纸，三种材质齐备', () => {
    expect(DS).toContain('.ds-glass');
    expect(DS).toContain('.ds-undeveloped');
    expect(DS).toContain('.ds-paper');
  });
});

describe('§4.3 未显影：未知是一等公民，而且永不补全', () => {
  it('45° 斜线 + 0.5px 虚线 + 不可点，且只有一个状态', () => {
    const block = /\.ds-undeveloped \{[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(block).toContain('repeating-linear-gradient');
    expect(block).toContain('45deg');
    expect(block).toContain('border: 1px dashed var(--ds-undev-line)');
    expect(block).toContain('cursor: default');
    // 禁止 hover 高亮
    expect(DS).not.toContain('.ds-undeveloped:hover');
  });

  it('标注文案由 data 属性给出（默认「还不知道」）', () => {
    expect(DS).toContain('content: attr(data-unknown-label)');
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
    const consumers = ['src/components/visual/RealityPass.tsx'];
    for (const file of consumers) {
      expect(read(file)).toMatch(/--ds-paper-/);
    }
    // 首页 / 编译页 / 推演屏 / 极光带 / 碎片 / 未显影 都不许出现暖纸
    for (const file of [
      'src/app/page.tsx',
      'src/app/session/[id]/page.tsx',
      'src/components/game/session/SessionPlayScreen.tsx',
      'src/components/visual/AuroraBand.tsx',
      'src/components/visual/FragmentShard.tsx',
      'src/components/visual/Undeveloped.tsx',
    ]) {
      expect(read(file), file).not.toContain('--ds-paper-');
    }
  });
});

describe('§4.1 / §4.5 / §4.8 组件规范', () => {
  it('主 CTA 是一张被光扫过的票：蓝 700 渐变 + 极光内衬 + 上浮 2px', () => {
    const button = /\.ds-btn-primary \{\n  position: relative;[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(button).toContain('rgb(var(--ds-rgb-blue-700) / 0.55)');
    // 圆角由本代的半径收口组统一给（2–4px）
    expect(DS).toContain('.ds-btn-primary,');
    expect(DS).toContain('transform: translateY(-2px)');
    expect(DS).toContain('.ds-btn-primary::after');
    expect(DS).toContain('mix-blend-mode: overlay');
  });

  it('§4.5 困惑输入框：衬线 18px / 行高 1.8 / 最小 132px（大到像一页纸）', () => {
    const input = /\.ds-input \{\n  width: 100%;[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(input).toContain('min-height: 132px');
    expect(input).toContain('font-size: 18px');
    expect(input).toContain('line-height: 1.8');
    expect(input).toContain("'Noto Serif SC'");
    expect(read('src/components/visual/FateProjectionConsole.tsx')).toContain('ds-input');
  });

  it('§4.8 解锁轨道：1px 青蓝虚线 + 620ms 画出来', () => {
    expect(DS).toContain('.ds-unlock-rail__line');
    expect(DS).toContain('repeating-linear-gradient');
    expect(DS).toContain('animation: ds-rail-draw 620ms var(--ds-ease) both');
    expect(read('src/components/visual/HiddenPathReveal.tsx')).toContain('ds-unlock-rail');
  });

  it('§4.6 三意图徽标 + unlock + unknown 五种齐备', () => {
    for (const variant of ['similar', 'alternative', 'counter', 'unlock', 'unknown']) {
      expect(DS).toContain(`.ds-badge--${variant}`);
    }
    expect(read('src/components/visual/WorldForge.tsx')).toContain('ds-badge--alternative');
    expect(read('src/components/game/session/SessionChoiceCard.tsx')).toContain('ds-badge--unlock');
  });
});

describe('§1 / §5 圆角与焦点', () => {
  it('圆角一律 2–4px（脱离 SaaS 感）', () => {
    // 只查矩形面板 / 按钮 / 卡片；圆点与胶囊的 9999px 是几何，不是圆角
    const values = [...DS.matchAll(/border-radius: (\d+)px/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value < 100);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(4);
    }
    // 观象厅旧组件在新语法下也被统一收口
    expect(DS).toContain('.obs-glass,');
    expect(DS).toContain('.ds-shard,');
  });

  it('§7 Do#6：可交互元素有 3px 蓝色外环', () => {
    expect(DS).toContain('outline: none');
    expect(DS).toContain('0 0 0 3px rgb(var(--ds-rgb-blue-500) / 0.1)');
  });
});

describe('§3 Type Scale', () => {
  it('Display 用 clamp(34px, 4.2vw, 56px)，Kicker 承担刻度定位', () => {
    expect(DS).toContain('font-size: clamp(34px, 4.2vw, 56px)');
    expect(DS).toContain('.ds-kicker');
    expect(DS).toContain('letter-spacing: 0.34em');
    expect(DS).toContain('.ds-quote');
    expect(DS).toContain("'Noto Serif SC'");
    // 中文正文硬约束：≥15px、行高 ≥1.7
    const body = /\.ds-body \{[\s\S]*?\n\}/.exec(DS)?.[0] ?? '';
    expect(body).toContain('font-size: 15px');
    expect(body).toContain('line-height: 1.75');
    // 首页标题用了 Display
    expect(read('src/app/page.tsx')).toContain('ds-display');
  });
});

describe('§7 / §8 禁令与降级', () => {
  it('§7 Don\'t #6：按钮文案后面不追加 →', () => {
    const card = stripComments(read('src/components/game/session/SessionChoiceCard.tsx'));
    expect(card).not.toContain('→');
    expect(card).toContain('<svg');
    // 箭头是内联 SVG，stroke-width <= 1.25
    expect(card).toContain('strokeWidth="1.2"');
  });

  it('§6 性能：同屏 blur 元素 <= 3（观象厅 + 显影厅只声明一处 backdrop-filter）', () => {
    const backdrop = [...DS.matchAll(/backdrop-filter:/g)].length;
    expect(backdrop).toBeLessThanOrEqual(3);
  });

  it('§8 移动端降级：<640px 隐藏星尘、缩小观象仪、Kicker 收窄字距', () => {
    const mobile = DS.slice(DS.lastIndexOf('@media (max-width: 640px)'));
    expect(mobile).toContain('.obs-dust');
    expect(mobile).toContain('display: none');
    expect(mobile).toContain('.obs-dial__svg');
    expect(DS).toContain('.ds-kicker');
    expect(DS).toContain('letter-spacing: 0.24em');
  });

  it('§8 reduced motion：显影直接到位、极光带转静态、玻璃不 blur', () => {
    const reduced = DS.slice(DS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.ds-develop');
    expect(reduced).toContain('.ds-aurora');
    expect(reduced).toContain('.ds-unlock-rail__line');
    expect(reduced).toContain('backdrop-filter: none !important');
  });
});

describe('§4.7 极光带真的上了页面', () => {
  it('首页 / 编译页 / 推演屏各一条，且推演屏按幕换色', () => {
    expect(read('src/app/page.tsx')).toContain('<AuroraBand tone="seek" />');
    expect(read('src/app/session/[id]/page.tsx')).toContain('<AuroraBand tone="seek" />');
    const play = read('src/components/game/session/SessionPlayScreen.tsx');
    expect(play).toContain("actKey === 'end' ? 'end' : actKey === '3' ? 'counter' : 'seek'");
  });
});
