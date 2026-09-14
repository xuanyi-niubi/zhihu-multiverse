import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { worldContextForTurn, unlockForTurn } from '@/features/game-world/dmContext';
import { NO_RELIABLE_EXPERIENCE } from '@/features/run/errorCopy';

import type { WorldBlueprint } from '@/features/game-world/domain';

/** 去掉注释后再扫描：源码注释里会**解释** legacy 为什么被删，那不是残留。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Play 幕次索引与蓝图幕次对齐（P0-1）。
 *
 * ## 这个 bug 的真实表现
 *
 * Play 的 `state.turnIndex` 是 **1 基**（1 = 第一幕），
 * 而 `worldContextForTurn` / `unlockForTurn` 的契约是 **0 基**。
 * 直接传 1 基值会让**每一幕都错开一位**：
 *
 * ```text
 * 游戏第一幕 → 蓝图「体会代价」幕     （本该是「进入世界」）
 * 游戏第二幕 → 蓝图「遇到反例」幕
 * 游戏第三幕 → 蓝图「终局反思」幕
 * 游戏第四幕 → 读不到任何东西
 * ```
 *
 * 这组测试把四个映射逐个钉死。
 */

/** 一个四幕蓝图（与 compileWorld 的固定结构一致）。 */
function blueprint(): WorldBlueprint {
  return {
    version: 'world-blueprint-v1',
    sessionId: 's-test',
    problemFrame: {
      rawQuestion: '大二想参加比赛',
      currentSituation: '大二',
      desiredChange: '参加比赛',
      constraints: [],
      resources: [],
      concerns: [],
      centralTension: '想积累 vs 时间少',
      unknowns: [],
      parseConfidence: 0.4,
    },
    centralTension: '想积累 vs 时间少',
    paths: [],
    keyUnknown: null,
    acts: [
      { act: 1, objective: 'enter-world', titleHint: '进入', conflict: 'c1', primaryPathIds: [], experienceFactIds: ['f1'], unlockIds: [] },
      { act: 2, objective: 'experience-cost', titleHint: '代价', conflict: 'c2', primaryPathIds: [], experienceFactIds: ['f2'], unlockIds: [] },
      { act: 3, objective: 'meet-counterexample', titleHint: '反例', conflict: 'c3', primaryPathIds: [], experienceFactIds: ['f3'], unlockIds: [] },
    ],
    experienceFacts: [],
    unlocks: [],
    forbiddenClaims: ['不得声称成功率高'],
  };
}

/** 复现 Play 层做的 1 基 → 0 基换算。 */
function blueprintIndexForPlayTurn(turnIndex: number): number {
  return Math.max(0, turnIndex - 1);
}

describe('Play 1 基 → 蓝图 0 基 的三个映射', () => {
  const cases: readonly { readonly turnIndex: number; readonly objective: string }[] = [
    { turnIndex: 1, objective: 'enter-world' },
    { turnIndex: 2, objective: 'experience-cost' },
    { turnIndex: 3, objective: 'meet-counterexample' },
  ];

  for (const item of cases) {
    it(`Play turnIndex=${item.turnIndex} → ${item.objective}`, () => {
      const context = worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(item.turnIndex));
      expect(context?.actObjective).toBe(item.objective);
    });
  }

  it('**不换算会错位一位**（反例：证明这层转换是必要的）', () => {
    // 直接把 1 基值当 0 基传 → 第一幕读到第二幕
    const wrong = worldContextForTurn(blueprint(), 1);
    expect(wrong?.actObjective).toBe('experience-cost');
    expect(wrong?.actObjective).not.toBe('enter-world');
  });

  it('turnIndex 越界时不崩（钳到第 0 幕）', () => {
    expect(() => worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(0))).not.toThrow();
    expect(worldContextForTurn(blueprint(), blueprintIndexForPlayTurn(0))?.actObjective).toBe('enter-world');
  });

  it('换算后 unlockForTurn 与同一幕对齐', () => {
    const base = blueprint();
    // 给第三幕（index 2）挂一个解锁（不可变方式）
    const b: WorldBlueprint = {
      ...base,
      unlocks: [
        {
          id: 'u1',
          label: '先做小样',
          description: '有人用一个小交付替代了空想。',
          sourceFactIds: ['f3'],
          choice: { text: '先做 48 小时小样', hint: '把决定推迟到有东西可看之后' },
          availableFromAct: 3,
        },
      ],
      acts: base.acts.map((act, index) =>
        index === 2 ? { ...act, unlockIds: ['u1'] } : act,
      ),
    };

    // Play 第三幕（turnIndex=3）→ 蓝图 index 2 → 应拿到 u1
    const unlock = unlockForTurn(b, blueprintIndexForPlayTurn(3), []);
    expect(unlock?.unlockId).toBe('u1');

    // Play 第二幕不该拿到它（availableFromAct=3）
    expect(unlockForTurn(b, blueprintIndexForPlayTurn(2), [])).toBeNull();
  });
});

describe('源码层的契约（防止有人把换算删掉）', () => {
  it('play/page.tsx 里对两个蓝图函数都传了换算后的索引', () => {
    const source = readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');

    // 换算必须存在
    expect(source).toContain('turnIndex - 1');
    // 且不能出现「把 1 基 turnIndex 直接传给蓝图函数」的写法
    expect(source).not.toMatch(/worldContextForTurn\(\s*blueprint\s*,\s*turnIndex\s*\)/);
    expect(source).not.toMatch(/unlockForTurn\(\s*blueprint\s*,\s*turnIndex\s*,/);
  });

  it('/api/dm 的 act 是 1 基，不能重复 +1', () => {
    const source = readFileSync(new URL('../src/app/api/dm/route.ts', import.meta.url), 'utf8');
    // 旧的错误写法：act: input.turnIndex + 1
    expect(source).not.toMatch(/act:\s*input\.turnIndex\s*\+\s*1/);
    expect(source).toMatch(/act:\s*input\.turnIndex\b/);
  });
});

/**
 * P0-2：Session 模式必须严格跑蓝图幕数（固定 4），而不是 AI 预算的 7～8 幕。
 *
 * 症状：蓝图只有三幕，而 `runBudgetFor` 给出 7～8 幕，
 * 于是最后一幕之后一直重复同一段反思 —— 拖沓且重复。
 */
describe('Session 幕数绑定蓝图（P0-2）', () => {
  it('reducer 装载蓝图时同时写入 totalActs', () => {
    const source = readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');
    // LOAD_WORLD_BLUEPRINT 的分支里必须有 totalActs: action.blueprint.acts.length
    expect(source).toMatch(/totalActs:\s*action\.blueprint\.acts\.length/);
  });

  it('幕数计算优先读蓝图长度，且排在 legacy 预算之前', () => {
    const source = readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');
    const blueprintRead = source.indexOf('sessionView?.worldBlueprint?.acts.length');
    const legacyBudget = source.indexOf('runBudgetFor({', blueprintRead >= 0 ? blueprintRead : 0);
    expect(blueprintRead).toBeGreaterThan(-1);
    expect(legacyBudget).toBeGreaterThan(blueprintRead);
  });

  it('蓝图固定三幕（编译契约，smoke 也断言了同一件事）', () => {
    // 幕数绑定只有在蓝图确实是三幕时才有意义
    expect(blueprint().acts).toHaveLength(3);
  });

  it('第四幕及以后在蓝图里不存在（所以不能再跑下去）', () => {
    const acts = blueprint().acts;
    expect(acts.find((act) => act.act === 4)).toBeUndefined();
    // 第三幕就是反例幕，且只有一次（终局不再靠「再演一幕」）
    expect(acts.filter((act) => act.objective === 'meet-counterexample')).toHaveLength(1);
  });
});

/**
 * 新主链不能有死路（§3/§17）：属性被撤出前台，就不该由属性判死。
 *
 * 旧机制下 SAN 归零会进入 critical 阶段，界面上只有一个「消耗羁绊救场」
 * 按钮 —— 新主链把这个面板藏了，若不处理状态，玩家会停在没有任何按钮的
 * 界面上。这里用源码级契约钉住「新主链会自动收束到终局」。
 */
describe('新主链的死路防护', () => {
  it('play 页在会话模式下把 critical 收束到终局，而不是停在空界面', () => {
    const source = readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');
    /*
      旧契约钉的是 `dispatch({ type: 'GIVE_UP' })` —— 那时「救场」还是
      reducer 里的一等动作。救场面板删除后，`GIVE_UP` 的语义也不再准确：
      它不是「认输」，而是「这一局到此为止」。

      所以现在派发 `END_SESSION`，契约随之更新为**当前真实发生的收束**。
      纪律本身没变：SAN 归零绝不能把玩家留在一个没有出口的界面。
    */
    expect(source).toContain("if (isSessionMode && state.phase === 'critical')");
    expect(source).toContain("dispatch({ type: 'END_SESSION' })");
  });

  it('整屏只剩新主链：legacy 的救场 / Boss / 骰子面板已彻底删除', () => {
    /*
      这条纪律原来是「救场与临界面板只在 legacy 路径渲染」——
      即 legacy 整屏还在，只是新主链不渲染它。

      现在 legacy 整屏已被物理删除（用户要求弃用代码直接删，不留注释/开关），
      所以契约升级为更强的一条：**这些面板连代码都不存在了**。
      这比原来的断言更难被破坏 —— 想复活它们必须先重新写一遍。
    */
    const source = stripComments(
      readFileSync(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8'),
    );
    for (const gone of [
      'BossTerminal',
      'DiceModal',
      'FateTree',
      'GameHud',
      'InventoryBar',
      'EvidenceMeshView',
      'ClarityRadar',
      'AxisSlider',
      'RESOLVE_BOSS',
      'USE_RELIC',
      'RESCUE',
    ]) {
      expect(source, `legacy 残留：${gone}`).not.toContain(gone);
    }
    // 而这些组件文件本身也不该还在磁盘上
    for (const file of [
      'src/components/GameHud.tsx',
      'src/components/BossTerminal.tsx',
      'src/components/DiceModal.tsx',
      'src/components/FateTree.tsx',
      'src/components/InventoryBar.tsx',
    ]) {
      expect(existsSync(new URL(`../${file}`, import.meta.url)), file).toBe(false);
    }
  });
});

/**
 * 编译体验（方案 §15 / §16 / §46）：一题一屏、真实状态、失败可退。
 *
 * 这三条最容易在实现里被"顺手"破坏：把问题又堆回一屏、给没找到的类别
 * 打勾、或者卡在一个没有出口的转圈页上。
 */
describe('Session 编译体验', () => {
  const page = () => readFileSync(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  const step = () => readFileSync(new URL('../src/components/session/ClarificationStep.tsx', import.meta.url), 'utf8');

  it('澄清是一题一屏（有 index 状态，而不是把 questions 全渲染）', () => {
    const source = step();
    expect(source).toContain('useState(0)');
    expect(source).toContain('questions[index]');
    // 不允许出现 map 全部问题的渲染（那就会一屏多题）
    expect(source).not.toContain('questions.map(');
  });

  it('✓ 只给真的找到的那一类（找不到就如实写没找到）', () => {
    /*
      这层纪律原由 `components/session/WorldCompiling.tsx` 承担；
      该组件后来被 `components/visual/WorldForge.tsx` 取代（同一份 §18 契约，
      且 WorldForge 是当前 session 页真正渲染的那一个），旧文件已随死代码清理删除。
      断言因此迁移到存活实现，纪律本身不变。
    */
    const source = readFileSync(
      new URL('../src/components/visual/WorldForge.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('这一类暂时没找到');
    expect(source).toContain("hit ? '◆' : '—'");
  });

  it('编译阶段只有真实档：没有百分比，也没有假的中间检索态', () => {
    const source = page();
    // §18（04_AGENT）：阶段文案由 WorldForge 统一负责，页面自身不得编进度
    expect(source).not.toMatch(/\d+\s*%/);
    expect(source).not.toContain("'compiling'");
    // §20：收束 + WORLD READY 是两拍真实渲染，且有明确时间预算；
    // 但**收束完就停住**：走向 Play 只能由用户点击触发（见下一个用例）
    expect(source).toContain('const ASSEMBLE_MS');
    expect(source).toContain('const READY_MS');
    // 「正在编译你的世界」只能在世界**真的**编译完成（ready_to_play）之后出现
    expect(source).toContain("const worldReady = status === 'ready_to_play'");
    const forge = readFileSync(
      new URL('../src/components/visual/WorldForge.tsx', import.meta.url),
      'utf8',
    );
    expect(forge).toContain("assembling: '正在编译你的世界'");
    // 编译页只露碎片，不摊开整张 Experience Card（§19）
    expect(source).toContain('SHARDS_PER_TRACK');
  });

  it('失败可重试、可换问题，不把用户困在转圈页（05_AGENT §9）', () => {
    const source = page();
    // 编译失败：可以重试一次
    expect(source).toContain('重试一次');
    // 一条都没找到：文案与按钮固定为 §9 那一套（文案在 errorCopy.ts 里是单一事实源）
    expect(source).toContain('NO_RELIABLE_EXPERIENCE.title');
    expect(source).toContain('NO_RELIABLE_EXPERIENCE.hint');
    expect(source).toContain('NO_RELIABLE_EXPERIENCE.actions[0]');
    expect(source).toContain('NO_RELIABLE_EXPERIENCE.actions[1]');
    expect(NO_RELIABLE_EXPERIENCE.actions).toEqual(['修改问题', '重新尝试']);
    // 仍然留着一条明确出路：先进入这一局（世界照常走完）
    expect(source).toContain('这一局没有别人的经验，世界仍然会走完');
    // 错误态只出人话：服务端消息先经 playerFacingError 翻译
    expect(source).toContain('playerFacingError');
    expect(source).not.toContain('这一步没有成功');
  });

  it('编译页收束完就停住：进入剧情只能由用户点击触发（没有自动跳转）', () => {
    const source = stripComments(page());
    /*
      回归哨兵。原先这里有一发定时跳转 —— 世界就绪且至少找到一条真实经历时，
      `ASSEMBLE_MS + READY_MS`（1120ms）后 `router.replace` 把玩家带走。
      结果是：编译结果读不完（三轨各找到几条只闪一眼）、那一屏的 CTA 形同虚设、
      且与剧情页的「回到问题」构成弹回循环。
    */
    expect(source).not.toContain('router.replace');
    expect(source).not.toContain('ASSEMBLE_MS + READY_MS');
    // 收束动画仍在：assembling → ready 这一拍没被一起删掉
    expect(source).toContain("window.setTimeout(() => setForgeBeat('ready'), ASSEMBLE_MS)");
    // 世界就绪后先进入真实人生显影；唯一的穿越动作仍由用户按钮触发。
    expect(source).toContain('<ExperienceReveal');
    expect(source).toContain('onEnterWorld={enterWorld}');
    expect(source).toContain("router.push(`/play?session=${encodeURIComponent(view.id)}`)");

    const reveal = readFileSync(
      new URL('../src/components/visual/ExperienceReveal.tsx', import.meta.url),
      'utf8',
    );
    expect(reveal).toContain('穿越我的平行宇宙');
    expect(reveal).toContain('onClick={onEnterWorld}');
  });

  it('编译页的碎片能点开详情、且真的能点回知乎原文', () => {
    /*
      回归哨兵。编译页去掉自动跳转之前，碎片只是「已找到」的证据 ——
      页面把 `ArchiveFragment` 转成 `ForgeShard` 时把 `sourceUrl` 丢掉了，
      碎片本身也是无交互的 <article>：玩家停在这一屏，哪儿都点不了。
    */
    const session = stripComments(page());
    // 1) 页面把 author / sourceUrl 一并交给上墙层，而不是只给两行引文
    expect(session).toContain('sourceUrl: item.sourceUrl');
    expect(session).toContain('const shards: readonly ForgeShard[] = fragments.map');
    // 2) 点击 → 选中 → 弹层，三段都在同一条链上
    expect(session).toContain('onSelectFragment={(fragmentId) => setSelectedFragmentId(fragmentId)}');
    expect(session).toContain('<SessionSourceDialog data={selectedFragment}');
    // 3) 弹层与上墙层各自把这条纪律写进实现
    const shard = readFileSync(
      new URL('../src/components/visual/FragmentShard.tsx', import.meta.url),
      'utf8',
    );
    expect(shard).toContain("interactive ? 'sil-fragment--tappable' : ''");
    expect(shard).toContain('看详情 ↗');
    expect(shard).toContain('aria-haspopup="dialog"');
    const forge = readFileSync(
      new URL('../src/components/visual/WorldForge.tsx', import.meta.url),
      'utf8',
    );
    expect(forge).toContain('onSelect: () => onSelectFragment(fragment.id)');
    expect(forge).toContain('readonly sourceUrl?: string | null;');
    // 4) 详情弹层的两条硬要求：完整逐字原文 + 原文外链（新开标签）
    const dialog = readFileSync(
      new URL('../src/components/session/SessionSourceDialog.tsx', import.meta.url),
      'utf8',
    );
    expect(dialog).toContain('{data.quote}');
    expect(dialog).toContain('去知乎看原回答 ↗');
    expect(dialog).toContain('rel="noreferrer noopener"');
    // 没有原链接时如实说明，不伪造一个入口
    expect(dialog).toContain('我们不会伪造一个');
  });

  it('刘看山第一次出现仍在会话页（§35）', () => {
    expect(page()).toContain('我去找找，有没有人活过你正在纠结的这几种人生。');
  });
});
