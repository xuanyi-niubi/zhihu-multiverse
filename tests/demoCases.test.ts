import { describe, expect, it } from 'vitest';

import { DEMO_CASES, availableDemoCases, caseSources, demoCaseStats, demoMeshFor, hasCase, matchDemoCase } from '@/data/demoCases';
import { allVerifiedSources } from '@/data/knowledgeSources';
import { strengthOf } from '@/core/evidence/strength';

/**
 * 黄金 Demo Case 的契约测试（v2 §21 / §15.2）。
 *
 * 这里最重要的不是「有数据」，而是**数据不可伪造**：
 * 每个 Case 的每一张路径卡都必须能在落盘快照里找到对应来源。
 * 换句话说，如果将来有人往网格里塞手写经历，这个测试会立刻红。
 */

const verifiedIds = new Set(allVerifiedSources().map((source) => source.id));

/**
 * 快照可能为空（未跑过 `sync:zhihu`）。
 *
 * 刻意不用 `it.skip`：那样会让「快照为空」与「Case 坏了」都无法区分。
 * 这里如实分支：没有快照时断言「Case 正确地为空」，有快照时断言内容。
 */
const hasSnapshot = verifiedIds.size > 0;

describe('DEMO_CASES 定义', () => {
  it('三个黄金 Case 的元数据完整（标题 / 玩家口吻的目标 / 抉择分野）', () => {
    expect(DEMO_CASES).toHaveLength(3);
    for (const meta of DEMO_CASES) {
      expect(meta.caseId).toMatch(/^demo-/);
      expect(meta.title.length).toBeGreaterThan(0);
      // 目标是玩家会亲手输入的一句话，不能是产品术语文案
      expect(meta.goal.length).toBeGreaterThan(8);
      expect(meta.goal).not.toMatch(/路径|网格|证据|裁决/);
      expect(meta.fork).toContain(' vs ');
    }
  });

  it('三个 Case 覆盖 v2 §15.2 要求的三类场景', () => {
    const ids = DEMO_CASES.map((meta) => meta.caseId);
    expect(ids).toContain('demo-sophomore'); // 大二学生：比赛 vs 打基础
    expect(ids).toContain('demo-graduate'); // 毕业生：大城市 vs 回家
    expect(ids).toContain('demo-pivot'); // 职场人：裸辞转 AI vs 边工作边转型
  });
});

describe('证据不可伪造', () => {
  it('每个 Case 的每一条来源都来自落盘快照（不存在手写数据）', () => {
    for (const meta of DEMO_CASES) {
      for (const source of caseSources(meta.caseId)) {
        expect(verifiedIds.has(source.id)).toBe(true);
      }
    }
  });

  it('每个 Case 的每一张路径卡都能在快照里找到出处', () => {
    for (const meta of DEMO_CASES) {
      const mesh = demoMeshFor(meta.caseId, Date.parse('2026-09-12T00:00:00.000Z'));
      if (!mesh) {
        continue;
      }
      for (const path of mesh.paths) {
        for (const card of path.cards) {
          // cardId 由 sourceId 派生，且 sourceId 必须真的存在于快照里
          expect(verifiedIds.has(card.sourceId)).toBe(true);
          expect(card.status).toBe('verified');
          expect(card.sourceUrl).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it('没有任何一张卡来自 scripted 来源', () => {
    for (const meta of DEMO_CASES) {
      const mesh = demoMeshFor(meta.caseId, Date.parse('2026-09-12T00:00:00.000Z'));
      if (!mesh) {
        continue;
      }
      for (const path of mesh.paths) {
        for (const card of path.cards) {
          // scripted 数据在 allVerifiedSources / snapshotToPathCards 两层就被拦下
          expect(card.status).not.toBe('scripted');
        }
      }
    }
  });
});

describe('Case 网格产出', () => {
  it('快照为空时：hasCase 为 false、demoMeshFor 返回 null（而不是编一份）', () => {
    if (hasSnapshot) {
      return;
    }
    for (const meta of DEMO_CASES) {
      expect(hasCase(meta.caseId)).toBe(false);
      expect(demoMeshFor(meta.caseId)).toBeNull();
      expect(availableDemoCases()).toHaveLength(0);
    }
  });

  it('有快照时：每个 Case 都能构建网格，且有路线拿到多个样本', () => {
    if (!hasSnapshot) {
      return;
    }

    const available = availableDemoCases();
    expect(available.length).toBeGreaterThan(0);

    for (const meta of available) {
      const mesh = demoMeshFor(meta.caseId, Date.parse('2026-09-12T00:00:00.000Z'));
      expect(mesh).not.toBeNull();
      if (!mesh) continue;

      expect(mesh.provenance).toBe('snapshot');
      const evidenced = mesh.paths.filter((path) => path.sampleSize > 0);
      expect(evidenced.length).toBeGreaterThan(0);

      // 证据网格的意义在于「多条同向」——至少要有一条路线不止一个样本
      const multi = evidenced.filter((path) => path.sampleSize > 1);
      expect(multi.length).toBeGreaterThan(0);
    }
  });

  it('确定性：同一快照 + 同一时间戳 → 同一 meshHash（可复盘、可进挑战链接）', () => {
    if (!hasSnapshot) {
      return;
    }
    const meta = availableDemoCases()[0];
    const at = Date.parse('2026-09-12T00:00:00.000Z');
    const first = demoMeshFor(meta.caseId, at);
    const second = demoMeshFor(meta.caseId, at);
    expect(second?.meshHash).toBe(first?.meshHash);
  });

  it('分母可见：stats 如实报出锚点数与来源数', () => {
    if (!hasSnapshot) {
      return;
    }
    for (const meta of availableDemoCases()) {
      const stats = demoCaseStats(meta.caseId);
      expect(stats.anchors).toBeGreaterThan(0);
      expect(stats.sources).toBeGreaterThanOrEqual(stats.anchors);
      expect(meta.sources).toBe(stats.sources);
    }
  });

  it('证据强度可计算，且不是靠单条高权威撑起来的强档', () => {
    if (!hasSnapshot) {
      return;
    }
    const meta = availableDemoCases()[0];
    const mesh = demoMeshFor(meta.caseId, Date.parse('2026-09-12T00:00:00.000Z'));
    if (!mesh) return;

    const breakdown = strengthOf(mesh.paths.flatMap((path) => path.cards), Date.parse('2026-09-12T00:00:00.000Z'));
    expect(breakdown.strength).toBeGreaterThan(0);
    expect(breakdown.strength).toBeLessThanOrEqual(1);
  });

  it('不存在的 caseId 返回 null，不返回空壳', () => {
    expect(demoMeshFor('demo-not-exist')).toBeNull();
    expect(hasCase('demo-not-exist')).toBe(false);
    expect(caseSources('demo-not-exist')).toHaveLength(0);
  });
});

/**
 * 按目标反查黄金 Case（v3 §20 的延伸）。
 *
 * 这个函数决定「给访客看哪份证据」，因此判定必须**保守**：
 * 宁可偶尔不命中（退回实时检索），也不要错误地把玩家的目标
 * 归到不相关的 Case 上 —— 那等于给他看别人的证据。
 */
describe('matchDemoCase', () => {
  const hasSnapshot = allVerifiedSources().length > 0;

  it('空输入或过短输入不匹配（避免误归）', () => {
    expect(matchDemoCase('')).toBeNull();
    expect(matchDemoCase('   ')).toBeNull();
    expect(matchDemoCase('a')).toBeNull();
  });

  it('与决策无关的输入不匹配', () => {
    for (const goal of ['今天天气不错', '中午吃什么', '随便聊聊']) {
      expect(matchDemoCase(goal)).toBeNull();
    }
  });

  it('目标的完整表述被包含时命中（玩家点了裂缝卡再进来）', () => {
    if (!hasSnapshot) {
      return;
    }
    const meta = availableDemoCases()[0];
    expect(matchDemoCase(meta.goal)?.caseId).toBe(meta.caseId);
    // 前后带些噪声也应命中（包含关系）
    expect(matchDemoCase(`我现在的处境：${meta.goal}，怎么办`)).not.toBeNull();
  });

  it('关键词命中两个及以上才归入（单个词太容易误判）', () => {
    if (!hasSnapshot) {
      return;
    }
    // 只提一个泛词不应命中
    expect(matchDemoCase('比赛')).toBeNull();
  });

  it('没有样本的 Case 永不被匹配（不能给访客一个空网格）', () => {
    if (hasSnapshot) {
      return;
    }
    // 快照为空时，任何输入都不该匹配到 Case
    for (const goal of ['大二，基础一般，想直接参加比赛，但怕耽误课程', '应届毕业，纠结留在大城市还是回老家']) {
      expect(matchDemoCase(goal)).toBeNull();
    }
  });

  it('命中的 Case 一定带真实样本数（界面据此展示分母）', () => {
    if (!hasSnapshot) {
      return;
    }
    const matched = matchDemoCase(availableDemoCases()[0].goal);
    expect(matched).not.toBeNull();
    expect((matched?.sources ?? 0)).toBeGreaterThan(0);
  });
});

/**
 * 推演舱证据网格的路径标签（实测确认过的错位）。
 *
 * 旧行为：`demoMeshFor` 用产品级的七条职业路径 + 快照里的 `anchorPaths`
 * 给卡片分组，于是「大二基础要不要参加比赛」在推演舱里显示
 * 「先缓一缓 / 平级跳板 / 在职转型」—— 与问题完全无关。
 *
 * 新行为：按**问题类型**取问题专属走法，归类由来源原文的关键词命中决定。
 */
describe('推演舱路径标签属于当前问题', () => {
  const CAREER_LABELS = ['脱产转型', '在职转型', '跨行换赛道', '原地深耕', '平级跳板', '求稳路线', '先缓一缓'];

  it('《大二的夏天》给出比赛类走法，不出现职业转型标签', () => {
    if (!hasSnapshot) {
      return;
    }
    const mesh = demoMeshFor('demo-sophomore', Date.now());
    expect(mesh).not.toBeNull();
    if (!mesh) return;

    const labels = mesh.paths.map((path) => path.label);
    for (const career of CAREER_LABELS) {
      expect(labels).not.toContain(career);
    }
    expect(mesh.paths.filter((path) => path.sampleSize > 0).length).toBeGreaterThan(0);
  });

  it('《毕业前夜》是「城市与去留」问题，不该套用求职类走法', () => {
    if (!hasSnapshot) {
      return;
    }
    const mesh = demoMeshFor('demo-graduate', Date.now());
    if (!mesh) return;
    const labels = mesh.paths.map((path) => path.label);

    expect(
      labels.some((label) => label.includes('大城市') || label.includes('老家') || label.includes('中间城市')),
    ).toBe(true);
    expect(labels.some((label) => label.includes('平台与成长'))).toBe(false);
  });

  it('三类黄金案例都至少得到两条有样本的路径', () => {
    if (!hasSnapshot) {
      return;
    }
    for (const caseId of ['demo-sophomore', 'demo-graduate', 'demo-pivot']) {
      const mesh = demoMeshFor(caseId, Date.now());
      if (!mesh) continue;
      expect(mesh.paths.filter((path) => path.sampleSize > 0).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('确定性：同一时间戳两次造出的网格标签一致', () => {
    if (!hasSnapshot) {
      return;
    }
    const a = demoMeshFor('demo-sophomore', 1_700_000_000_000);
    const b = demoMeshFor('demo-sophomore', 1_700_000_000_000);
    expect(a?.paths.map((p) => p.label)).toEqual(b?.paths.map((p) => p.label));
  });
});
