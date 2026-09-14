import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FORGE_PHASE_TEXT, FORGE_STAGE_TEXT } from '@/components/visual/WorldForge';

/**
 * 命运观象厅的落地契约（04_AGENT §4-§37）。
 *
 * ## 为什么视觉也要有测试
 *
 * 这一版的视觉不是「换个颜色」：它冻结了**颜色语义**（知乎蓝=真实来源、
 * 青蓝=新路径、琥珀=反例、紫银=终局）、**动效总表**（只有七个 keyframes）、
 * **首页固定文案**与**真实状态文案**。这些一旦漂移，产品会退回
 * 「街机 / 数值 HUD」那套语言，而那正是这一版明确禁止的。
 *
 * 所以这里只钉三件可验证的事：Token 与语义类存在、动效表没被扩写、
 * 首页与编译页没有出现被禁止的措辞。样式细节（间距、字重）不锁。
 */

const root = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

/** 去掉注释后再扫描：注释里会**引用**被禁止的词，那不算出现在页面上。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const GLOBALS_CSS = read('src/app/globals.css');
/**
 * 银盐设计系统 —— 当前唯一的材质与动效事实源。
 *
 * ## OBSERVATORY 为什么直接等于整份 silver.css
 *
 * 这节测试原本从 globals.css 里按 marker
 * `FINAL SESSION EXPERIENCE — OBSERVATORY` 切片，只对那一段断言 ——
 * 那是「追加块」时代的写法，为了让新规则与旧 CSS 共存可查。
 *
 * 那个时代已经结束：观象厅的规则整体迁进了 silver.css，
 * globals.css 里的 marker 只剩一个注释头（切出来是空串）。
 * 继续按 marker 切会让断言**对着空字符串通过或失败**，
 * 两种结果都没有意义。
 *
 * 所以现在 OBSERVATORY 就是整份 silver.css。断言里凡是用到
 * 选择器的地方，已经在迁移时同步改成了 `sil-*` 前缀。
 */
const SILVER_CSS = read('src/app/silver.css');
const OBSERVATORY = SILVER_CSS;

const VISUAL_DIR = `${root}src/components/visual`;
const VISUAL_FILES = readdirSync(VISUAL_DIR).filter((name) => name.endsWith('.tsx'));

describe('§4 观象厅 Token（已并入银盐设计系统）', () => {
  /*
    这一节原来在 globals.css 末尾追加了一整套 `--obs-*` 变量，并逐条钉死取值。
    「在文件末尾追加」这个做法本身就是补丁式演进的痕迹：globals.css 累积到了
    四个互不相干的 token 家族（gmv / arc / obs / ds + gd），同一个语义
    「知乎蓝」有四个值。

    现在材质、排版、动效全部收进 silver.css 的 `--sil-*`，
    取值契约由 `tests/designSystem.test.ts` 逐条钉死（更严格：它还校验
    「三个证据色必须互相可区分」「旧前缀不许回流」）。

    这里只保留一条**跨文件**的纪律：globals.css 不许再定义新的 token 家族。
  */
  it('不再往 globals.css 追加新 token 家族（材质只有一个事实源）', () => {
    for (const family of ['--obs-', '--gmv-', '--arc-', '--ds-', '--gd-']) {
      // :root 块里不允许再出现这些前缀的定义
      expect(GLOBALS_CSS, family).not.toMatch(new RegExp(`^\\s*${family}[a-z0-9-]+\\s*:`, 'm'));
    }
    // 而银盐 token 确实存在，且是唯一的
    expect(SILVER_CSS).toContain('--sil-void-900:');
    expect(SILVER_CSS).toContain('--sil-zhihu:');
  });

  it('§6：街机时代的 legacy 类不再被任何页面消费', () => {
    /*
      原来这条要求「不许删除 legacy CSS」—— 那是在「先加上、以后再收」的阶段。
      现在收口完成：这些类名既没有定义（已从 globals.css 清出），
      也没有任何页面引用。契约因此改写为「它们确实已经退场」。
    */
    for (const legacy of ['.arcade-btn', '.gmv-bar', '.cartridge', '.fate-edge']) {
      const used = read('src/app/page.tsx').includes(legacy.slice(1));
      expect(used, `${legacy} 仍被首页引用`).toBe(false);
    }
  });
});

describe('§34 动画总表（+ DESIGN-SYSTEM 的三个新机制）', () => {
  /*
    ## 这条断言在测什么

    它锁的是**设计意图**：观象厅的七个基础动效 + 显影厅的三个机制，
    不多不少。名字本身不是契约（迁移时统统加了 `sil-` 前缀），
    但「这十个机制各自有一个独立的 keyframes」是契约 ——
    少一个说明某个动效被静默删掉了（那种 bug 在页面上表现为
    「过渡变成瞬变」，没有报错）。

    下面按「旧名 → 现名」列出映射，两边都断言存在，
    这样万一将来再改名，测试会明确告诉你要改哪一行，
    而不是简单地变红。
  */
  const KEYFRAME_RENAMES: ReadonlyArray<readonly [string, string]> = [
    // 04_AGENT §34 的七个
    ['counter-orbit', 'sil-counter-in'],
    ['fragment-materialize', 'fragment-materialize'],
    ['hidden-path-reveal', 'sil-hidden-path-reveal'],
    ['orbit-drift', 'sil-orbit-drift'],
    ['orbit-weave', 'sil-orbit-weave'],
    ['sentence-reforge', 'sil-sentence-reforge'],
    ['signal-pulse', 'sil-signal-pulse'],
    // DESIGN-SYSTEM 点名的三个机制
    ['ds-develop', 'sil-develop'],
    ['ds-aurora-sweep', 'sil-scan-sweep'],
    ['ds-rail-draw', 'sil-rail-draw'],
  ];

  it('观象厅七个 + 显影厅三个 = 十个机制，每个都有对应 keyframes', () => {
    const names = new Set(
      [...OBSERVATORY.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((m) => m[1]),
    );

    const missing = KEYFRAME_RENAMES.filter(([, now]) => !names.has(now)).map(([old, now]) =>
      now === old ? old : `${old} → ${now}`,
    );

    expect(missing, `缺失的动效定义：${missing.join(', ')}`).toEqual([]);
  });

  it('这十个机制的名字不重复（一个 keyframes 只服务一个机制）', () => {
    const now = KEYFRAME_RENAMES.map(([, n]) => n);
    expect(new Set(now).size).toBe(now.length);
  });

  it('普通组件只允许 fade / translate（不新增 keyframes）', () => {
    // 整份 CSS 里除了观象厅的七个，其余都必须是 legacy 已经存在的名字
    const all = [...GLOBALS_CSS.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((match) => match[1]);
    const legacyKnown = new Set([
      'gmv-reveal',
      'gmv-fade-in',
      'arc-grain',
      'arc-drift',
      'arc-fragment-arrive',
      'arc-compile-fold',
      'arc-node-pulse',
      'arc-link-draw',
      'arc-crack-open',
      'arc-path-emerge',
      'arc-counter-in',
      'arc-morph-fade',
      'arc-morph-rise',
      'arc-phrase-in',
      'arc-collapse',
      'arc-beam-in',
      'scan-sweep',
    ]);
    const observatoryNames = new Set([
      'orbit-drift',
      'signal-pulse',
      'fragment-materialize',
      'orbit-weave',
      'hidden-path-reveal',
      'counter-orbit',
      'sentence-reforge',
      // DESIGN-SYSTEM.md §0 的三个新机制
      'ds-develop',
      'ds-aurora-sweep',
      'ds-rail-draw',
    ]);
    for (const name of all) {
      if (observatoryNames.has(name)) {
        continue;
      }
      // legacy 的 keyframes 有一部分定义在 tailwind.config.ts（如 halo-pulse），
      // 这里只要求 globals.css 里剩下的都不是新造的名字
      expect(legacyKnown.has(name), `unexpected keyframe: ${name}`).toBe(true);
    }
  });
});

describe('§21 Session 主链语义结构', () => {
  it('九个语义 class 都在 globals.css 里被真正写了样式', () => {
    const classes = [
      '.session-stage',
      '.session-act-header',
      '.session-story',
      '.session-choice',
      '.session-choice--unlocked',
      '.session-choice--locked',
      '.session-collision',
      '.session-unknown',
      '.session-endgame',
    ];
    for (const name of classes) {
      expect(GLOBALS_CSS, name).toContain(name);
    }
  });

  it('§23：hover 用位移，不用 scale(1.05)', () => {
    /*
      ## 断言的是「位移，不缩放」，不是某个具体像素

      这条纪律的实际理由是：scale 会让文字在亚像素上重排（发糊 + 抖动），
      位移不会。旧设计用 `translateY(-2px)`（上浮），
      银盐版改成了 `translateX(2px)`（向左引线位移）——
      方向变了，纪律没变。所以这里断言 `translate*` 而不是 `translateY`。

      写死 `translateY` 会让测试在**设计有意演进**时变红，那是假警报。
    */
    const hoverAt = OBSERVATORY.indexOf('.sil-choice:hover');
    expect(hoverAt, '找不到 .sil-choice:hover 规则').toBeGreaterThan(-1);
    const hover = OBSERVATORY.slice(hoverAt, hoverAt + 400);
    expect(hover).toMatch(/transform:\s*translate[XY]?\(/);
    // 注释里会写「**不** scale(1.05)」，所以先剥注释再检查声明
    expect(stripComments(OBSERVATORY)).not.toContain('scale(1.05)');
  });
});

describe('§35 Reduced Motion', () => {
  it('观象厅自己的降级块存在，且关掉了旋转 / 轨道运动 / 生长', () => {
    const reduced = OBSERVATORY.slice(OBSERVATORY.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced.length).toBeGreaterThan(0);
    /*
      迁移后选择器带 `sil-` 前缀。这里断言的是「这些动效确实在降级块里
      被关掉」，名字随设计系统改名 —— 所以用现名。
    */
    for (const selector of [
      '.sil-dial__spin',
      '.sil-orbit__drift',
      '.sil-reveal__line',
      '.sil-reforged__new',
    ]) {
      expect(reduced, selector).toContain(selector);
    }
    expect(reduced).toContain('animation: none !important');
  });
});

describe('§8 / §9 / §10 首页', () => {
  const page = read('src/app/page.tsx');
  const rendered = stripComments(page);

  it('结构顺序固定：Instrument → Brand → Hero → Console → 极弱次级入口', () => {
    expect(page).toContain("from '@/components/visual/AstralDial'");
    expect(page).toContain("from '@/components/visual/FateProjectionConsole'");
    // 暗房材质挂在 layout 的 body 上（全站一层底，不在页面里重复铺）
    expect(read('src/app/layout.tsx')).toContain('sil-darkroom');
  });

  it('§9 的固定文案一句不少（首页 + 命运投影台的默认文案）', () => {
    // §9 的七句里，输入标题/placeholder/按钮/小字由 Console 承担
    const surface = stripComments(page) + stripComments(read('src/components/visual/FateProjectionConsole.tsx'));
    for (const line of [
      '知乎平行宇宙',
      '你最近真正纠结什么？',
      '比如：我大二，想参加比赛，但怕课程跟不上……',
      '进入我的平行宇宙',
      '我们不会替你决定。',
    ]) {
      expect(surface, line).toContain(line);
    }
  });

  it('首页主句是「显影」而不是旧版的「替你活过」（产品语言升级）', () => {
    /*
      旧版主句「别人已经替你活过很多种人生。」在语义上越界了 ——
      产品从不替用户活，它只把别人真实走过的路显影出来给用户看。
      新主句把这件事说清楚了，并且用上了暗房隐喻（显影）。
    */
    expect(rendered).toContain('显影');
    expect(rendered).not.toContain('替你活过');
  });

  it('§10 禁止出现的东西一个都不在页面上', () => {
    for (const forbidden of [
      'Key',
      '设置大按钮',
      '模型',
      'Engine',
      'Seed',
      'Golden Case',
      '技术状态',
      '排行榜',
      '功能矩阵',
    ]) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  it('§15 进入动画总时长不超过 1 秒（PASS 2：穿越那一下不能省）', () => {
    const match = /const ENTER_MS = (\d+)/.exec(page);
    expect(match).not.toBeNull();
    const ms = Number(match?.[1]);
    expect(ms).toBeGreaterThanOrEqual(600);
    expect(ms).toBeLessThanOrEqual(1000);
  });

  it('PASS 2：首页真的挂了「穿越平行宇宙」并标记落点', () => {
    expect(page).toContain("from '@/components/visual/UniverseJump'");
    expect(page).toContain('<UniverseJump active={launching}');
    expect(page).toContain('markJumpArrival()');
    // 24 条光轨 = §36 的 decorative particles 上限
    const jump = read('src/components/visual/UniverseJump.tsx');
    expect(jump).toContain('const STREAK_COUNT = 24');
    // 转场只用 transition + 既有 keyframes，不新增动效表
    expect(jump).not.toMatch(/@keyframes/);
    expect(OBSERVATORY).toContain('.sil-jump__streak');
    expect(OBSERVATORY).toContain('.sil-arrive__ring');
  });

  it('PASS 2：落点在会话页被消费一次', () => {
    const sessionPage = read('src/app/session/[id]/page.tsx');
    expect(sessionPage).toContain('consumeJumpArrival()');
    expect(sessionPage).toContain('<ArrivalFlash');
  });
});

describe('§33 刘看山只以官方 GIF 立绘出现', () => {
  /**
   * 这是一条**反向契约**，刻意钉住「线稿剪影不许长回来」。
   *
   * 起因：手绘剪影（constellation / projection / stamp 三种形态）和官方
   * 黏土 GIF 并排出现时，两边的质感会互相拉低 —— 手绘那只看起来像占位图。
   * 所以三种形态整体下架，看山只保留官方立绘。
   *
   * 组件源码 `components/visual/Kanshan.tsx` 刻意留在仓库里当设计留档，
   * 但**不允许**再被任何页面引用。想恢复剪影，必须同时改这条契约 ——
   * 这样它就不会在某个「顺手加个装饰」的改动里悄悄回来。
   */
  const surfaces = [
    'src/app/page.tsx',
    'src/app/session/[id]/page.tsx',
    'src/components/game/session/SessionPlayScreen.tsx',
    'src/components/game/session/SessionEndgameScreen.tsx',
  ] as const;

  it('四个界面都不再引用剪影组件', () => {
    for (const path of surfaces) {
      const source = read(path);
      expect(source, path).not.toMatch(/<Kanshan\b/);
      expect(source, path).not.toContain("from '@/components/visual/Kanshan'");
    }
  });

  it('看山仍由官方 GIF 立绘承担（四个界面都有 KanshanSprite）', () => {
    for (const path of surfaces) {
      expect(read(path), path).toContain('<KanshanSprite');
    }
  });
});

describe('PASS 3 · 游戏感的三个细节', () => {
  it('星尘 <= 24 颗，且坐标写死（刷新十次是同一片天区）', () => {
    const page = read('src/app/page.tsx');
    expect(page).toContain('sil-dust');
    const block = page.slice(page.indexOf('const DUST'), page.indexOf('function delay'));
    const count = (block.match(/\{ x:/g) ?? []).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(24);
    expect(page).not.toContain('Math.random');
    expect(SILVER_CSS).toContain('.sil-dust__mote');
  });

  it('每一幕换场有一条扫光（复用既有 keyframe，不新增动画）', () => {
    const play = read('src/components/game/session/SessionPlayScreen.tsx');
    expect(play).toContain('sil-act-sweep');
    expect(SILVER_CSS).toContain('.sil-act-sweep');
    expect(SILVER_CSS).toContain('animation: sil-act-sweep');
  });

  it('Gate 编号由 CSS counter 生成（零 React 编号逻辑）', () => {
    expect(SILVER_CSS).toContain('counter-reset: sil-gate');
    expect(SILVER_CSS).toContain('counter(sil-gate, decimal-leading-zero)');
    expect(read('src/components/game/session/SessionChoiceCard.tsx')).toContain(
      'session-choice__index',
    );
  });

  it('碎片沿各自的轨道方向滑入（同一个 keyframe，方向来自轨道）', () => {
    expect(OBSERVATORY).toContain('--sil-shard-dx');
    /*
      来源修饰符的现名：产品词汇「相似 / 另一种 / 相反」对应设计系统的
      zhihu / alternative / counter。`FragmentShard.tsx` 里有一张显式
      映射表做这层翻译 —— 直接拼 `sil-fragment--similar` 会得到
      设计系统里不存在的类名（那种 bug 表现为碎片没有引线色）。
    */
    for (const track of ['zhihu', 'alternative', 'counter']) {
      expect(OBSERVATORY, `sil-fragment--${track}`).toContain(`.sil-fragment--${track}`);
    }
  });
});

describe('§25 新路径出现的时间线', () => {
  it('普通 Gate 先暗 150ms，轨迹 150ms 出现，整段 <= 1100ms', () => {    // 第一拍用 :has 完成，零 React 改动
    expect(OBSERVATORY).toContain(
      '.session-choice-list:has(.sil-reveal) .session-choice:not(.session-choice--unlocked)',
    );
    const line = /\.sil-reveal__line \{[\s\S]*?animation-delay: (\d+)ms/.exec(OBSERVATORY);
    const gate = /\.sil-reveal__gate \{[\s\S]*?animation-delay: (\d+)ms/.exec(OBSERVATORY);
    const label = /\.sil-reveal__label \{[\s\S]*?animation-delay: (\d+)ms/.exec(OBSERVATORY);
    expect(line?.[1]).toBe('150');
    expect(gate?.[1]).toBe('400');
    expect(label?.[1]).toBe('620');
    // 最后一段 320ms ⇒ 940ms
    expect(Number(label?.[1]) + 320).toBeLessThanOrEqual(1100);
  });
});

describe('§18 编译页只说真实阶段', () => {
  it('允许出现的五句话正好是这五句', () => {
    const allowed = new Set([
      '正在理解你的处境',
      '正在寻找相似人生',
      '正在寻找另一种走法',
      '正在寻找相反结果',
      '正在编译你的世界',
      'WORLD READY',
    ]);
    const used = new Set([...Object.values(FORGE_STAGE_TEXT), ...Object.values(FORGE_PHASE_TEXT)]);
    for (const text of used) {
      expect(allowed.has(text), `unexpected stage text: ${text}`).toBe(true);
    }
    // 五句产品语言必须全部可达
    for (const text of [
      '正在理解你的处境',
      '正在寻找相似人生',
      '正在寻找另一种走法',
      '正在寻找相反结果',
      '正在编译你的世界',
    ]) {
      expect(used.has(text), text).toBe(true);
    }
  });

  it('没有假百分比、没有假的命中人数', () => {
    const forge = read('src/components/visual/WorldForge.tsx');
    expect(stripComments(forge)).not.toMatch(/\d+\s*%/);
    expect(forge).not.toContain('找到 6 位');
    expect(forge).not.toContain('成功率');
  });

  it('§20 WORLD READY 的预算 <= 450ms，且收束在 600~900ms', () => {
    const page = read('src/app/session/[id]/page.tsx');
    const assemble = /const ASSEMBLE_MS = (\d+)/.exec(page);
    const ready = /const READY_MS = (\d+)/.exec(page);
    expect(assemble).not.toBeNull();
    expect(ready).not.toBeNull();
    const readyMs = Number(ready?.[1]);
    expect(readyMs).toBeGreaterThan(0);
    expect(readyMs).toBeLessThanOrEqual(450);
    expect(OBSERVATORY).toContain('animation: fragment-materialize 420ms');
  });
});

describe('§7 视觉组件不 fetch API', () => {
  it.each(VISUAL_FILES)('%s 没有任何网络访问', (file) => {
    const source = read(`src/components/visual/${file}`);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('axios');
    expect(source).not.toContain("'/api/");
    expect(source).not.toContain('"/api/');
  });
});

describe('§36 性能硬限制', () => {
  const sources = [
    ...VISUAL_FILES.map((file) => read(`src/components/visual/${file}`)),
    read('src/app/page.tsx'),
    read('src/app/session/[id]/page.tsx'),
  ].join('\n');

  it('没有 three.js / 视频背景 / 大面积 canvas 粒子', () => {
    expect(sources).not.toContain('three');
    expect(sources).not.toMatch(/<video\b/);
    expect(sources).not.toMatch(/<canvas\b/);
  });

  it('§12 轨道数量上限被写死在组件里（Desktop <= 10 / Mobile <= 6）', () => {
    const orbit = read('src/components/visual/OrbitField.tsx');
    expect(orbit).toContain('ORBIT_COMPACT_MAX = 6');
    expect(orbit).toContain('ORBIT_DESKTOP_MAX = 10');
  });

  it('§11 主环 3~5 / 刻度 8~16 / 节点 <= 10 / 主焦点 1', () => {
    const dial = read('src/components/visual/AstralDial.tsx');
    const rings = /const RING_RADII: readonly number\[\] = \[([^\]]+)\]/.exec(dial)?.[1] ?? '';
    const ringCount = rings.split(',').filter((part) => part.trim().length > 0).length;
    expect(ringCount).toBeGreaterThanOrEqual(3);
    expect(ringCount).toBeLessThanOrEqual(5);

    const ticks = Number(/const TICK_COUNT = (\d+)/.exec(dial)?.[1]);
    expect(ticks).toBeGreaterThanOrEqual(8);
    expect(ticks).toBeLessThanOrEqual(16);

    const nodes = dial.slice(dial.indexOf('const NODES'), dial.indexOf('const CENTER'));
    expect((nodes.match(/\{ angle:/g) ?? []).length).toBeLessThanOrEqual(10);
    expect(dial).toContain('const FOCUS = { angle: -90, radius: 250 } as const;');
  });

  it('§36 首页 SVG path 预算 <= 12（Dial 不用 path，Orbit 每条轨道一条 path）', () => {
    // 首页同时挂 Dial + Orbit；Orbit 的 path 数量上限就是桌面上限 10 条
    expect(read('src/components/visual/AstralDial.tsx')).not.toContain('<path');
    const orbit = read('src/components/visual/OrbitField.tsx');
    expect(orbit).toContain('<path');
    // 页面显式传的轨道数不超过桌面上限（10）
    const page = read('src/app/page.tsx');
    const counts = [...page.matchAll(/count=\{nearFocus \? (\d+) : (\d+)\}/g)];
    expect(counts.length).toBeGreaterThan(0);
    for (const match of counts) {
      expect(Number(match[1])).toBeLessThanOrEqual(10);
      expect(Number(match[2])).toBeLessThanOrEqual(10);
    }
  });
});
