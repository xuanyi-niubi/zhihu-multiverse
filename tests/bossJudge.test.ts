import { describe, expect, it } from 'vitest';

import { GET, POST } from '@/app/api/boss/evaluate/route';
import {
  handleBossEvaluate,
  normalizeWorld,
  type BossDeps,
} from '@/features/run/bossRoute';
import {
  adjudicateBoss,
  bossDcFor,
  buildBossUserPrompt,
  createBossCache,
  evaluateBoss,
  inspectBossAnswer,
  localJudgeBoss,
  normalizeAnswerHash,
  summarizeVerdict,
  verdictHash,
} from '@/core/run/bossJudge';
import { BOSS_MODIFIER_MAX, BOSS_MODIFIER_MIN } from '@/features/run/contracts';
import { createInitialWorld } from '@/core/run/worldState';

import type { DmModelClient } from '@/core/dm/provider';
import type { WorldState } from '@/core/run/worldState';

/**
 * P2 终端 Boss 的三条退出门槛：
 * **在线判卷、模型超时、响应损坏** —— 三种条件下都要在截止时间内完成终局。
 *
 * 另一条红线：模型只能给 -3..+5 的修正，DC 与胜负由规则引擎决定。
 */

const BASE = { san: 60, skill: 55, bond: 40 };
const WORLD: WorldState = createInitialWorld('SEED-BOSS', BASE);
const GOOD_ANSWER =
  '本周内把简历里那段短链项目补齐压测数据，投递 10 家大厂后端实习；如果两周内没有面试机会，就改成投中小厂先积累面试手感。';

/** 假的模型客户端：可控地返回成功 / 超时 / 损坏 JSON。 */
function fakeClient(mode: 'ok' | 'timeout' | 'broken-json' | 'http-error', payload?: unknown): DmModelClient {
  return {
    id: 'fake',
    async complete(_messages, options) {
      if (mode === 'timeout') {
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (options?.signal?.aborted) {
          return { ok: false, code: 'aborted', message: 'aborted' };
        }
        return { ok: false, code: 'timeout', message: 'timed out' };
      }
      if (mode === 'broken-json') {
        return { ok: true, text: '{ "dimensions": { ' };
      }
      if (mode === 'http-error') {
        return { ok: false, code: 'http-500', message: 'boom' };
      }
      return {
        ok: true,
        text: JSON.stringify(
          payload ?? {
            dimensions: { specificity: 2, evidenceUse: 2, feasibility: 2, selfAwareness: 1 },
            modifier: 4,
            feedback: '方案具体，时间与退路都写了。',
            citedSourceIds: ['law-to-cs:t1', '不存在的来源'],
            issues: [],
          },
        ),
      };
    },
  };
}

describe('本地降级判卷（可解释信号）', () => {
  it('具体 + 有动作 + 有退路 → 高修正', () => {
    const { signals, evaluation } = localJudgeBoss(GOOD_ANSWER);

    expect(signals.hasTimeUnit).toBe(true);
    expect(signals.hasAction).toBe(true);
    expect(signals.hasRisk).toBe(true);
    expect(evaluation.modifier).toBeGreaterThanOrEqual(3);
  });

  it('喊口号 → 自我认知清零且修正为负', () => {
    const { evaluation } = localJudgeBoss('加油！相信自己，一定要坚持下去，冲冲冲！');

    expect(evaluation.dimensions.selfAwareness).toBe(0);
    expect(evaluation.modifier).toBeLessThan(0);
  });

  it('过短文本 → 判为「没有具体方案」', () => {
    const { evaluation, signals } = localJudgeBoss('努力就好');

    expect(signals.tooShort).toBe(true);
    expect(evaluation.dimensions.specificity).toBe(0);
    expect(evaluation.modifier).toBeLessThanOrEqual(0);
  });

  it('引用本局片段 → 证据利用满分', () => {
    const sources = [{ id: 's1', quote: '转码最大的成本不是学不会，是你在能学会之前就先耗光了心气' }];
    // 必须与引文有连续 4 字重叠才算「用上了本局证据」（保守匹配，避免误判）
    const { evaluation } = localJudgeBoss('先别耗光了心气，本周把项目补完再投递', { sources });

    expect(evaluation.dimensions.evidenceUse).toBe(2);
    expect(evaluation.citedSourceIds).toEqual(['s1']);
  });

  it('只在嘴上提「知乎」而没引用片段 → 证据利用只得 1', () => {
    const { evaluation } = localJudgeBoss('知乎上都说要早点准备，我也该动手了');

    expect(evaluation.dimensions.evidenceUse).toBe(1);
  });

  it('修正永远落在 -3..+5', () => {
    for (const answer of ['', '努力', GOOD_ANSWER, '本周投递简历，如果两周没有回音就换方向']) {
      const modifier = localJudgeBoss(answer).evaluation.modifier;
      expect(modifier).toBeGreaterThanOrEqual(BOSS_MODIFIER_MIN);
      expect(modifier).toBeLessThanOrEqual(BOSS_MODIFIER_MAX);
    }
  });

  it('inspectBossAnswer 对空串不抛异常', () => {
    expect(inspectBossAnswer('').length).toBe(0);
  });
});

describe('DC 只由世界状态生成（模型看不到）', () => {
  it('状态差更难、导师信任高更易，且钳制在 11..18', () => {
    const base = bossDcFor(WORLD);
    expect(base).toBeGreaterThanOrEqual(11);
    expect(base).toBeLessThanOrEqual(18);

    const rough: WorldState = {
      ...WORLD,
      stats: { ...WORLD.stats, san: 20 },
      hidden: { ...WORLD.hidden, bodyAlarm: 60, peerPressure: 60, mentorTrust: 30 },
    };
    expect(bossDcFor(rough)).toBeGreaterThan(base);
  });
});

describe('裁决：天然 1/20 优先，模型只是加法项', () => {
  const evaluation = {
    dimensions: { specificity: 2, evidenceUse: 2, feasibility: 2, selfAwareness: 2 } as const,
    modifier: 5,
    feedback: '',
    citedSourceIds: [],
    issues: [],
  };

  it('同一输入必得同一裁决（可复盘）', () => {
    const input = {
      world: WORLD,
      evaluation,
      answerHash: 'abc123',
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      runId: 'run-1',
    };

    expect(JSON.stringify(adjudicateBoss(input))).toBe(JSON.stringify(adjudicateBoss(input)));
  });

  it('模型给满修正也不能突破天然 1 必败', () => {
    // 扫一批 runId，找出骰面为 1 的那次并断言必败
    for (let index = 0; index < 200; index += 1) {
      const verdict = adjudicateBoss({
        world: WORLD,
        evaluation,
        answerHash: 'h',
        seed: 'SEED-BOSS',
        scenarioRevision: '1',
        runId: `run-${index}`,
      });

      if (verdict.dice === 1) {
        expect(verdict.outcome).toBe('failure');
        expect(verdict.critical).toBe('critical-failure');
        return;
      }
    }

    throw new Error('200 次里没抽到天然 1，随机源可疑');
  });

  it('修正被钳制：模型返回 99 也只能算 +5', () => {
    const verdict = adjudicateBoss({
      world: WORLD,
      evaluation: { ...evaluation, modifier: 99 },
      answerHash: 'h',
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      runId: 'run-clamp',
    });

    expect(verdict.bossModifier).toBe(BOSS_MODIFIER_MAX);
  });
});

describe('编排：在线 / 超时 / 损坏 三条链路都能出结果', () => {
  it('在线成功 → source=model，且越界来源被丢弃', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-online',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      sources: [{ id: 'law-to-cs:t1', quote: '转码要趁早' }],
      client: fakeClient('ok'),
    });

    expect(verdict.source).toBe('model');
    expect(verdict.evaluation.citedSourceIds).toEqual(['law-to-cs:t1']);
    expect(verdict.adjudication.dc).toBe(bossDcFor(WORLD));
  });

  it('模型超时 → source=fallback，终局照常完成', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-timeout',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      client: fakeClient('timeout'),
      timeoutMs: 5,
    });

    expect(verdict.source).toBe('fallback');
    expect(verdict.modelIssue).not.toBeNull();
    expect(verdict.adjudication.outcome).toMatch(/success|failure/);
  });

  it('模型返回损坏 JSON → 降级本地判卷', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-broken',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      client: fakeClient('broken-json'),
    });

    expect(verdict.source).toBe('fallback');
    expect(verdict.modelIssue).toBe('invalid-json');
  });

  it('模型 HTTP 失败 → 降级本地判卷', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-http',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      client: fakeClient('http-error'),
    });

    expect(verdict.source).toBe('fallback');
    expect(verdict.modelIssue).toBe('http-500');
  });

  it('没有客户端（未配 key）→ 直接本地判卷', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-noclient',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      client: null,
    });

    expect(verdict.source).toBe('fallback');
  });

  it('幂等：同一 runId + 同一答案返回同一结果', async () => {
    const cache = createBossCache();
    const call = () =>
      evaluateBoss({
        answer: GOOD_ANSWER,
        runId: 'run-idem',
        world: WORLD,
        seed: 'SEED-BOSS',
        scenarioRevision: '1',
        client: fakeClient('ok'),
        cache,
      });

    const first = await call();
    const second = await call();

    expect(second.source).toBe('cached');
    expect(verdictHash(second)).toBe(verdictHash(first));
    expect(JSON.stringify(second.adjudication)).toBe(JSON.stringify(first.adjudication));
  });

  it('答案归一化：空白差异不产生新结果', () => {
    expect(normalizeAnswerHash('本周  投递简历')).toBe(normalizeAnswerHash('本周 投递简历'));
    expect(normalizeAnswerHash('A')).not.toBe(normalizeAnswerHash('B'));
  });

  it('summarizeVerdict 不含隐藏数值以外的敏感内容', async () => {
    const verdict = await evaluateBoss({
      answer: GOOD_ANSWER,
      runId: 'run-sum',
      world: WORLD,
      seed: 'SEED-BOSS',
      scenarioRevision: '1',
      client: null,
    });

    const line = summarizeVerdict(verdict);
    expect(line).toContain('D20');
    expect(line).toContain('思路');
  });
});

describe('判卷提示词', () => {
  it('不把隐藏数值写给模型，只给定性状态', () => {
    const prompt = buildBossUserPrompt(GOOD_ANSWER, { dc: 15, allowedSourceIds: ['s1'], state: '身体报警' });

    expect(prompt).toContain('身体报警');
    expect(prompt).not.toMatch(/bodyAlarm|peerPressure|runway|mentorTrust/);
    // 玩家输入必须被当作不可信数据包裹
    expect(prompt).toContain('"""');
  });
});

describe('路由 /api/boss/evaluate', () => {
  const validBody = {
    answer: GOOD_ANSWER,
    runId: 'route-run',
    seed: 'SEED-BOSS',
    turnIndex: 4,
    world: WORLD,
    sources: [{ id: 's1', quote: '转码要趁早' }],
  };

  const post = (body: unknown, deps: BossDeps = { client: null }) =>
    handleBossEvaluate(
      new Request('http://localhost/api/boss/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      deps,
    );

  it('正常判卷返回结构化结果与来源标记', async () => {
    const response = await post(validBody);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.adjudication.dc).toBeGreaterThanOrEqual(11);
    expect(response.headers.get('x-boss-source')).toBe('fallback');
    expect(response.headers.get('x-trace-id')).toBeTruthy();
  });

  it('答案过短 / 缺 runId / 世界状态非法 → ok:false 且不抛异常', async () => {
    for (const [body, reason] of [
      [{ ...validBody, answer: '太短' }, 'answer-too-short'],
      [{ ...validBody, runId: '' }, 'missing-runId'],
      [{ ...validBody, seed: '' }, 'missing-seed'],
      [{ ...validBody, answer: 'x'.repeat(300) }, 'answer-too-long'],
      [{ ...validBody, world: { stats: { san: 1 } } }, 'invalid-world'],
    ] as const) {
      const response = await post(body);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(false);
      expect(payload.reason).toBe(reason);
    }
  });

  it('非 JSON 请求体 → invalid-body', async () => {
    const response = await handleBossEvaluate(
      new Request('http://localhost/api/boss/evaluate', { method: 'POST', body: 'not json' }),
      { client: null },
    );
    expect((await response.json()).reason).toBe('invalid-body');
  });

  it('重复提交命中缓存（x-boss-source: cached）', async () => {
    const cache = createBossCache();
    const first = await post({ ...validBody, runId: 'route-idem' }, { client: fakeClient('ok'), cache });
    const second = await post({ ...validBody, runId: 'route-idem' }, { client: fakeClient('ok'), cache });

    expect(first.headers.get('x-boss-source')).toBe('model');
    expect(second.headers.get('x-boss-source')).toBe('cached');
  });

  it('GET 探活不泄露凭证明文', async () => {
    // 探活现在按请求解析密钥（账号配置优先），但仍只回来源标记与端点，不回明文
    const response = await GET(new Request('http://localhost/api/boss/evaluate'));
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/sk-|Bearer [A-Za-z0-9]/);
    expect(payload.answerRange).toEqual({ min: 20, max: 240 });
  });

  it('POST 导出与 handleBossEvaluate 行为一致', async () => {
    const response = await POST(
      new Request('http://localhost/api/boss/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe('normalizeWorld', () => {
  it('缺失字段返回 null（不猜）', () => {
    expect(normalizeWorld(null)).toBeNull();
    expect(normalizeWorld({ stats: { san: 1, skill: 2 } })).toBeNull();
  });

  it('数值被钳制到 0..100，flags 保留但限量', () => {
    const world = normalizeWorld({
      stats: { san: 200, skill: -5, bond: 50 },
      hidden: { bodyAlarm: 999, peerPressure: 0, runway: 50, mentorTrust: 50, socialDebt: 0 },
      flags: Array.from({ length: 40 }, (_, index) => `f${index}`),
    });

    expect(world?.stats).toEqual({ san: 100, skill: 0, bond: 50 });
    expect(world?.hidden.bodyAlarm).toBe(100);
    expect(world?.flags.length).toBe(32);
  });
});
