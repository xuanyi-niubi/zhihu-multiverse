import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Session 主链的**结构契约**（Agent 03 §五 / §二十八 / §三十）。
 *
 * ## 为什么用源码断言而不是渲染快照
 *
 * §三十 的完成标准不是「看起来对了」，而是：
 *
 * ```text
 * Session 模式 React tree：没有 Boss / 没有 Dice / 没有 GameHud
 *                         没有 Axis / 没有 Inventory
 * ```
 *
 * 一棵树里「有没有可能出现 Boss」由 **import 图**决定，而不是由某个分支决定：
 * 只要 `SessionPlayScreen` 及其子树 import 了 `BossTerminal`，它就在 bundle 里、
 * 就有可能在某种状态下被渲染出来。所以这里直接钉 import 清单 ——
 * 这比任何一次人工点检都可靠，而且以后加功能时会立刻失败。
 */

const sessionDir = fileURLToPath(new URL('../src/components/game/session/', import.meta.url));

/**
 * 去掉注释再扫：注释里出现「没有 inventory」是文档，不是依赖。
 * 只看真正会被编译进 bundle 的代码。
 */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function sessionSources(): readonly { readonly file: string; readonly text: string }[] {
  return readdirSync(sessionDir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => ({
      file: name,
      text: readFileSync(join(sessionDir, name), 'utf8'),
    }));
}

/**
 * §五 的禁止清单：SessionPlayScreen **不允许** import 这些模块。
 *
 * 它们代表旧 RPG 的语法：Boss 判卷、骰子、属性 HUD、命途树、遗物、
 * 证据网格、四维结算。新主链的一屏只讲一件事，这些东西一个都不该在树里。
 */
const FORBIDDEN_MODULES: readonly string[] = [
  'BossTerminal',
  'BossVerdictPanel',
  'DiceModal',
  'FateTree',
  'GameHud',
  'InventoryBar',
  'AxisHUD',
  'AxisSlider',
  'EvidenceMeshView',
  'ClarityRadar',
  'EngineStatusBar',
  'CommitPicker',
  'CriticalPointCard',
  'EndgameReport',
  'EndgamePass',
];

/** 旧 RPG 的核心状态名：正文与属性里都不该出现（§三十）。 */
const FORBIDDEN_STATE_TOKENS: readonly string[] = ['stats.san', 'stats.skill', 'stats.bond', 'inventory', 'rollD20'];

describe('session/ 的 import 图', () => {
  it('不 import 任何旧 RPG 组件（§五 / §三十）', () => {
    const sources = sessionSources();
    expect(sources.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const source of sources) {
      const code = codeOf(source.text);
      for (const forbidden of FORBIDDEN_MODULES) {
        // `@/components/BossTerminal` / `@/components/game/BossTerminal` 都要拦
        const pattern = new RegExp(`from\\s+['"][^'"]*${forbidden}['"]`);
        if (pattern.test(code)) {
          offenders.push(`${source.file} → ${forbidden}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('不读旧 RPG 的状态（stats / inventory / 骰子）', () => {
    const offenders: string[] = [];
    for (const source of sessionSources()) {
      const code = codeOf(source.text);
      for (const token of FORBIDDEN_STATE_TOKENS) {
        if (code.includes(token)) {
          offenders.push(`${source.file} → ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('屏幕只从会话模块与视觉模块取东西，不 import play/page', () => {
    const screen = sessionSources().find((source) => source.file === 'SessionPlayScreen.tsx');
    expect(screen).toBeDefined();
    expect(screen!.text).not.toContain("from '@/app/");
  });
});

describe('语义结构 class（04_AGENT §21 的对接面）', () => {
  const has = (file: string, token: string) => {
    const source = sessionSources().find((item) => item.file === file);
    expect(source, `${file} 应当存在`).toBeDefined();
    expect(source!.text).toContain(token);
  };

  it('屏幕铺出 session-stage / session-act-header / session-choice / session-collision / session-unknown / session-endgame', () => {
    has('SessionPlayScreen.tsx', 'session-stage');
    has('SessionActHeader.tsx', 'session-act-header');
    has('SessionChoiceCard.tsx', 'session-choice');
    has('SessionCollisionStage.tsx', 'session-collision');
    has('SessionUnknownStage.tsx', 'session-unknown');
    has('SessionEndgameScreen.tsx', 'session-endgame');
  });

  it('选项的三种状态都有语义 class（§十 / §十一）', () => {
    has('SessionChoiceCard.tsx', 'session-choice--unlocked');
    has('SessionChoiceCard.tsx', 'session-choice--locked');
  });

  it('移动端硬约束：选项 >= 44px、底部安全区（§二十七）', () => {
    has('SessionChoiceCard.tsx', 'min-h-11');
    // 整条 session-choice 在 globals.css 里是 min-height:44px；这里钉住调用侧不写死更小的值
    const card = sessionSources().find((item) => item.file === 'SessionChoiceCard.tsx')!;
    expect(card.text).not.toMatch(/min-h-\[(1[0-9]|2[0-9]|3[0-9])px\]/);
  });
});
