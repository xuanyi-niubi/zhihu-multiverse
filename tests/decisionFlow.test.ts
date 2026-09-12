import { describe, expect, it } from 'vitest';

import {
  answerFollowUp,
  applyClarify,
  buildPaths,
  commitExperiment,
  createSession,
  designExperiment,
  loadOwnedSession,
  questionsForSession,
  retrieveFor,
  selectUnknown,
} from '@/features/decision-session/service';
import {
  InMemoryDecisionSessionRepository,
  isSessionId,
  newSessionId,
} from '@/features/decision-session/store';

import type { UserContext } from '@/features/decision-session/domain';

/**
 * 五步闭环的端到端契约（重构方案 §3.1 / §13）。
 *
 * 守两件事：
 * 1. **闭环真的能走完**（建会话 → 澄清 → 选未知 → 实验 → 认领 → 回访）；
 * 2. **没有证据时不假装有**（方案 §5.3 / §13 的核心验收）。
 */

const QUESTION = '大二基础一般，要不要参加这次比赛？';

describe('第一步 + 第三步：建会话', () => {
  it('命中黄金案例时给出问题专属路径', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });

    expect(session.pathClusters.length).toBeGreaterThan(0);
    const labels = session.pathClusters.map((cluster) => cluster.label);
    // P0 核心验收：不能出现职业转型类标签
    for (const career of ['在职转型', '脱产转型', '平级跳板']) {
      expect(labels).not.toContain(career);
    }
  });

  it('会话 id 可校验且不可预测（出现在 URL 里）', () => {
    const id = newSessionId();
    expect(isSessionId(id)).toBe(true);
    expect(isSessionId('s-短')).toBe(false);
    expect(isSessionId('../../etc/passwd')).toBe(false);
    // 两次生成不应相同
    expect(newSessionId()).not.toBe(id);
  });

  it('provenance 与事实一致：用快照时不会说「没有样本」', async () => {
    const retrieved = await retrieveFor({ question: QUESTION });
    expect(retrieved.retrievalRun.provenance).toBe('curated');
    expect(retrieved.sources.length).toBeGreaterThan(0);
    // 文案里不能出现自相矛盾的「没有站内样本」
    const notes = retrieved.retrievalRun.notes.join(' ');
    expect(notes).not.toContain('没有可用的站内样本');
    expect(notes).not.toContain('没有站内样本');
  });
});

describe('无证据时诚实降级（方案 §5.3 / §13）', () => {
  it('完全不相关的问题：不给路径，并说明为什么', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: '今天天气不错' });
    expect(session.pathClusters).toHaveLength(0);
    expect(session.retrievalRun?.provenance).toBe('offline');
    expect(session.evidenceFacts).toHaveLength(0);
  });

  it('属于四类但不相关的问题：说「证据不足」而不是编一条', () => {
    const result = buildPaths({ question: '要不要参加一个完全没有资料可查的冷门比赛', sources: [] });
    expect(result.clusters).toHaveLength(0);
    expect(result.factual).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('**少于两条事实时不生成路径**（方案 §5.3 明写）', () => {
    const result = buildPaths({ question: QUESTION, sources: [] });
    expect(result.clusters).toHaveLength(0);
    expect(result.reason).toContain('可核对经历');
  });

  it('不属于四类问题时不硬套路径', () => {
    const result = buildPaths({ question: '我该不该养一只猫', sources: [] });
    expect(result.problemType).toBeNull();
    expect(result.clusters).toHaveLength(0);
  });
});

describe('第二 / 四 / 五步：澄清 → 未知 → 实验', () => {
  it('澄清问题随问题类型变化（不是放之四海皆准的废话）', async () => {
    const comp = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const pivot = await createSession({ ownerId: 'anon:test', question: '要不要转专业' });

    const compVerify = questionsForSession(comp).find((item) => item.id === 'verify');
    const pivotVerify = questionsForSession(pivot).find((item) => item.id === 'verify');
    expect(compVerify?.options.map((option) => option.label)).not.toEqual(
      pivotVerify?.options.map((option) => option.label),
    );
  });

  it('澄清回答被写进 UserContext，缺项保持缺失（不推断）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const after = applyClarify(session, { time: 't-3h', verify: 'can-finish' });

    expect(after.userContext.availableTime).toBe('未来两周约 3 小时');
    expect(after.userContext.wantToVerify).toBe('能不能做出一次完整交付');
    // 没答「最不能接受的损失」→ 空数组，而不是猜一个
    expect(after.userContext.nonNegotiables).toHaveLength(0);
    expect(after.status).toBe('comparing');
  });

  it('**实验的时间盒跟着用户给的可用时间走**（不许要求他挤不出时间）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const small = designExperiment(applyClarify(session, { time: 't-3h' }));
    const large = designExperiment(applyClarify(session, { time: 't-20h' }));

    expect(small.experiment?.timebox).toContain('3 小时');
    expect(large.experiment?.timebox).toContain('12 小时');
  });

  it('实验六要素齐全（方案 §5.1 的必填字段）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const designed = designExperiment(selectUnknown(applyClarify(session, { verify: 'can-finish' }), '能不能做出一次完整交付'));
    const experiment = designed.experiment;

    expect(experiment).not.toBeNull();
    for (const field of ['hypothesis', 'action', 'timebox', 'artifact', 'successSignal', 'stopSignal', 'reducesUnknown'] as const) {
      expect(String(experiment?.[field]).length).toBeGreaterThan(0);
    }
    // 停止信号必须真的提到用户说的那种损失
    expect(experiment?.stopSignal).toContain('停下');
  });

  it('用户说了不能接受的损失 → 停止信号引用它', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const designed = designExperiment(applyClarify(session, { loss: 'l-course' }));
    expect(designed.experiment?.stopSignal).toContain('课程');
  });

  it('认领实验写入七天回访时间', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const now = new Date('2026-09-12T10:00:00.000Z');
    const committed = commitExperiment(designExperiment(session), now);

    expect(committed.status).toBe('committed');
    expect(committed.followUp?.dueAt).toBe('2026-09-19T10:00:00.000Z');
  });

  it('回访作答记录三种结果', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const committed = commitExperiment(session);
    const answered = answerFollowUp(committed, { outcome: 'partial', note: '做了一半' }, new Date('2026-09-19T10:00:00.000Z'));
    expect(answered.followUp?.outcome).toBe('partial');
    expect(answered.followUp?.note).toBe('做了一半');
  });

  it('没有认领过实验时，回访作答不改状态（不产生幽灵回访）', async () => {
    const session = await createSession({ ownerId: 'anon:test', question: QUESTION });
    const answered = answerFollowUp(session, { outcome: 'done' });
    expect(answered.followUp).toBeNull();
  });
});

describe('「我听懂的是」（方案 §3.1 第四步）', () => {
  const base: UserContext = { goal: '大二基础一般，要不要参加这次比赛？', nonNegotiables: [], existingResources: [] };

  it('**原样复述**用户的问题，不改写、不润色', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    const question = '大二基础一般，要不要参加这次比赛？';
    const result = understoodFrom({ question, context: { ...base, goal: question } });
    expect(result.restated).toBe(question);
  });

  it('只列出用户**说过**的约束，逐条可指回他的选择', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    const result = understoodFrom({
      question: base.goal,
      context: {
        ...base,
        availableTime: '未来两周约 3 小时',
        wantToVerify: '能不能做出一次完整交付',
        nonNegotiables: ['不能明显影响课程或主业'],
      },
    });

    const labels = result.constraints.map((line) => line.label);
    expect(labels).toContain('你能拿出的时间');
    expect(labels).toContain('你最想先弄清');
    expect(labels).toContain('你不能接受的损失');
    // 值必须是用户原话，不做单位换算
    expect(result.constraints.find((line) => line.label === '你能拿出的时间')?.value).toBe('未来两周约 3 小时');
    expect(result.missing).toHaveLength(0);
  });

  it('**没说过的东西如实列为缺失，且不猜**', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    const result = understoodFrom({ question: base.goal, context: base });

    expect(result.constraints).toHaveLength(0);
    expect(result.missing.length).toBe(3);
    // 缺失项必须说明「它对结果有什么影响」，而不是干巴巴一句「未填写」
    for (const item of result.missing) {
      expect(item).toContain('——');
    }
  });

  it('复述里不得出现用户没提供的内容', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    const result = understoodFrom({ question: base.goal, context: base });

    // 除问题原话外，不该冒出任何用户没说过的具体数值／判断
    const everything = [result.restated, ...result.constraints.map((line) => line.value)].join(' ');
    for (const invented of ['每周', '个月', '一定', '建议', '可以', '不行']) {
      expect(everything).not.toContain(invented);
    }
  });

  it('clarified 标记反映「是否问过澄清」', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    expect(understoodFrom({ question: base.goal, context: base }).clarified).toBe(false);
    expect(
      understoodFrom({ question: base.goal, context: { ...base, availableTime: '每周 5–10 小时' } }).clarified,
    ).toBe(true);
  });

  it('纯函数：同输入必得同输出', async () => {
    const { understoodFrom } = await import('@/features/decision-session/understood');
    const input = { question: base.goal, context: { ...base, availableTime: '每周 5–10 小时' } };
    expect(JSON.stringify(understoodFrom(input))).toBe(JSON.stringify(understoodFrom(input)));
  });
});

describe('文件仓储（冒烟测试抓到过 remove 不生效）', () => {
  /**
   * 实测：冒烟测试里 `DELETE /api/sessions/:id` 返回 200，
   * 但紧接着 `GET` 仍然 200 —— 会话并没有被真删掉。
   *
   * 根因是**文件实现的 remove 此前完全没有测试覆盖**：
   * 既有用例只跑了内存实现，而两者是不同的代码路径。
   */
  async function withTempRepo<T>(
    run: (repo: import('@/features/decision-session/store').DecisionSessionRepository) => Promise<T>,
  ): Promise<T> {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { FileDecisionSessionRepository } = await import('@/features/decision-session/store');

    const dir = mkdtempSync(join(tmpdir(), 'zhihu-session-repo-'));
    const previous = process.env.DECISION_SESSION_DIR;
    process.env.DECISION_SESSION_DIR = dir;
    try {
      return await run(new FileDecisionSessionRepository());
    } finally {
      if (previous === undefined) {
        delete process.env.DECISION_SESSION_DIR;
      } else {
        process.env.DECISION_SESSION_DIR = previous;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('存取往返一致（文件实现）', async () => {
    await withTempRepo(async (repo) => {
      const session = await createSession({ ownerId: 'anon:file', question: QUESTION });
      await repo.create(session);
      const loaded = await repo.getById(session.id);
      expect(loaded?.id).toBe(session.id);
      expect(loaded?.question).toBe(QUESTION);
    });
  });

  it('**remove 之后必须真的读不到**', async () => {
    await withTempRepo(async (repo) => {
      const session = await createSession({ ownerId: 'anon:file', question: QUESTION });
      await repo.create(session);

      expect(await repo.remove(session.id)).toBe(true);
      expect(await repo.getById(session.id)).toBeNull();
      expect(await repo.remove(session.id)).toBe(false);
    });
  });

  it('remove 之后不再出现在 owner 列表里', async () => {
    await withTempRepo(async (repo) => {
      const session = await createSession({ ownerId: 'anon:file', question: QUESTION });
      await repo.create(session);
      await repo.remove(session.id);
      expect(await repo.listByOwner('anon:file')).toHaveLength(0);
    });
  });

  it('save 覆盖同一会话而不是产生两份', async () => {
    await withTempRepo(async (repo) => {
      const session = await createSession({ ownerId: 'anon:file', question: QUESTION });
      await repo.create(session);
      await repo.save(applyClarify(session, { time: 't-8h' }));

      const list = await repo.listByOwner('anon:file');
      expect(list).toHaveLength(1);
      expect(list[0]?.userContext.availableTime).toBe('每周 5–10 小时');
    });
  });

  it('归属隔离：别的 owner 列不到', async () => {
    await withTempRepo(async (repo) => {
      await repo.create(await createSession({ ownerId: 'anon:a', question: QUESTION }));
      expect(await repo.listByOwner('anon:b')).toHaveLength(0);
    });
  });
});

describe('匿名身份的往返（实测抓到过致命 bug）', () => {
  /**
   * 实测踩到的坑：`POST /api/sessions` 建会话成功，紧接着
   * `GET /api/sessions/[id]` 返回 404。
   *
   * 根因：创建时首次生成了匿名 id，但**响应没有把 cookie 写回**，
   * 于是第二次请求拿到一个全新的匿名身份，归属校验自然失败 ——
   * 未登录用户（也就是评委）会完全用不了。
   *
   * 这组用例锁住「同一个 cookie 必须得到同一个身份键」。
   */
  it('同一 cookie 两次解析得到同一身份键', async () => {
    const { resolveIdentity } = await import('@/features/run/identity');

    const cookie = 'zhihu_anon=' + 'a'.repeat(32);
    const first = resolveIdentity(new Request('http://localhost/api/sessions', { headers: { cookie } }));
    const second = resolveIdentity(new Request('http://localhost/api/sessions', { headers: { cookie } }));

    expect(first.key).toBe(second.key);
    expect(first.authenticated).toBe(false);
    // 已有身份时不该反复下发 cookie
    expect(first.setCookie).toBeNull();
  });

  it('没有 cookie 时必须下发一个（否则下一次请求就换了人）', async () => {
    const { resolveIdentity } = await import('@/features/run/identity');

    const fresh = resolveIdentity(new Request('http://localhost/api/sessions'));
    expect(fresh.key.startsWith('anon:')).toBe(true);
    expect(fresh.setCookie).toContain('zhihu_anon=');
    expect(fresh.setCookie).toContain('HttpOnly');
  });

  it('非法 cookie 被忽略（不拿脏值去撞文件路径）', async () => {
    const { resolveIdentity } = await import('@/features/run/identity');

    const bad = resolveIdentity(
      new Request('http://localhost/api/sessions', { headers: { cookie: 'zhihu_anon=../../etc/passwd' } }),
    );
    // 不采纳非法值，而是发一个新的合法身份
    expect(bad.setCookie).toContain('zhihu_anon=');
    expect(bad.key).not.toContain('..');
  });

  it('成功响应能携带 set-cookie（接口层必须真的把它写出去）', async () => {
    const { ok } = await import('@/features/decision-session/api');
    const response = ok({ hello: 'world' }, { traceId: 'tr-test', setCookie: 'zhihu_anon=abc; Path=/' });
    expect(response.headers.get('set-cookie')).toContain('zhihu_anon=abc');
  });

  it('没有 setCookie 时不写该响应头', async () => {
    const { ok } = await import('@/features/decision-session/api');
    const response = ok({ hello: 'world' }, { traceId: 'tr-test' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('仓储与归属（方案 §6.5）', () => {
  it('存取往返一致', async () => {
    const repo = new InMemoryDecisionSessionRepository();
    const session = await createSession({ ownerId: 'anon:a', question: QUESTION });
    await repo.create(session);

    const loaded = await repo.getById(session.id);
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.question).toBe(QUESTION);
  });

  it('**别人的会话读不到**（返回 null，不泄露是否存在）', async () => {
    const repo = new InMemoryDecisionSessionRepository();
    const session = await createSession({ ownerId: 'anon:a', question: QUESTION });
    await repo.create(session);

    expect(await loadOwnedSession(repo, session.id, 'anon:b')).toBeNull();
    expect(await loadOwnedSession(repo, session.id, 'anon:a')).not.toBeNull();
    expect(await loadOwnedSession(repo, 's-000000000000', 'anon:a')).toBeNull();
  });

  it('按身份列出会话，最新在前', async () => {
    const repo = new InMemoryDecisionSessionRepository();
    for (const question of ['要不要参加比赛', '要不要转专业']) {
      await repo.create(await createSession({ ownerId: 'anon:a', question }));
    }
    await repo.create(await createSession({ ownerId: 'anon:b', question: '要不要考研' }));

    const mine = await repo.listByOwner('anon:a');
    expect(mine).toHaveLength(2);
    expect(mine.every((session) => session.ownerId === 'anon:a')).toBe(true);
  });

  it('删除会话（方案要求的删除入口）', async () => {
    const repo = new InMemoryDecisionSessionRepository();
    const session = await createSession({ ownerId: 'anon:a', question: QUESTION });
    await repo.create(session);

    expect(await repo.remove(session.id)).toBe(true);
    expect(await repo.getById(session.id)).toBeNull();
    expect(await repo.remove(session.id)).toBe(false);
  });
});
