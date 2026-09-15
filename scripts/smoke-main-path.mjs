#!/usr/bin/env node
/**
 * 主路径冒烟测试（重构方案 §8 P2-2）。
 *
 * ## 它是什么、不是什么（请如实理解）
 *
 * 这是 **HTTP 级**冒烟测试，不是浏览器级。它会启动生产构建、
 * 真发请求、真断言状态码与响应契约，但**不渲染 DOM**。
 *
 * 之所以不用 Playwright：本项目刻意保持「零运行时依赖」，
 * 而 Playwright 会带来数百 MB 的浏览器二进制。HTTP 级已经能覆盖
 * 我们实际踩到的那一类 bug —— 例如「建了会话却打不开」（匿名身份
 * 没有随响应写回，第二次请求变成了另一个人），那正是本脚本第 4 步断言的东西。
 *
 * ## 用法
 *
 * ```bash
 * npm run build            # 需要先有生产构建
 * node scripts/smoke-main-path.mjs
 * ```
 *
 * 可用 `SMOKE_PORT` 换端口，`SMOKE_BASE_URL` 直接指向一个already-running 的实例。
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const EXTERNAL = process.env.SMOKE_BASE_URL ?? null;
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '  OK  ' : ' FAIL ';
  console.log(`${mark}${name}${detail ? `  — ${detail}` : ''}`);
}

/** 极简 cookie jar：只关心 set-cookie 里的键值对。 */
function cookieJar() {
  const store = new Map();
  return {
    /** 从响应吸收 set-cookie。 */
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
          store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    size() {
      return store.size;
    },
  };
}

async function request(path, init = {}, jar = null) {
  const headers = { ...(init.headers ?? {}) };
  if (jar) {
    const cookie = jar.header();
    if (cookie) {
      headers.cookie = cookie;
    }
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  if (jar) {
    jar.absorb(response);
  }
  return response;
}

async function waitForServer(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.status === 200) {
        return true;
      }
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

let server = null;

async function main() {
  if (!EXTERNAL) {
    console.log(`[smoke] 启动生产服务器 :${PORT} …`);
    /**
     * Windows 上 `npx` 实际是 `npx.cmd`，Node 直接 spawn 会抛 `EINVAL` ——
     * 必须走 shell（实测踩到过）。`stdio: 'ignore'` 是刻意的：
     * 不接管子进程输出，避免管道相关的平台限制。
     */
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
      stdio: 'ignore',
      shell: true,
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }

  if (!(await waitForServer())) {
    check('服务器就绪', false, `等待 ${BASE}/api/health 超时`);
    return;
  }
  check('服务器就绪', true, BASE);

  // ── 1. 游戏主线路由必须都活着 ──────────────────────────────
  // 旧的 compare/archive/commitment 页面已并入会话主链；这里只检查当前公开路由。
  for (const path of ['/', '/play', '/oauth', '/about', '/settings', '/journal']) {
    const response = await request(path);
    check(`GET ${path} → 200`, response.status === 200, `实际 ${response.status}`);
  }

  // ── 2. 建会话（第一步） ────────────────────────────────────
  const jar = cookieJar();
  const created = await request(
    '/api/sessions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '大二基础一般，要不要参加这次比赛？' }),
    },
    jar,
  );
  const createdBody = await created.json();
  check('POST /api/sessions → 200', created.status === 200, `实际 ${created.status}`);
  check('建会话返回 id', typeof createdBody?.data?.id === 'string', String(createdBody?.data?.id));
  check(
    '建会话时检索被推迟（P0-5：等澄清答完再检索，不烧配额）',
    createdBody?.data?.provenance === 'deferred' && Number(createdBody?.data?.pathCount) === 0,
    `pathCount=${createdBody?.data?.pathCount} provenance=${createdBody?.data?.provenance}`,
  );
  check('匿名身份已下发 cookie', jar.size() > 0, `cookie 数 ${jar.size()}`);

  const sessionId = createdBody?.data?.id;

  // ── 3. 空问题必须 400（不是 200 里藏错误） ─────────────────
  const bad = await request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '   ' }),
  });
  check('空问题 → 400', bad.status === 400, `实际 ${bad.status}`);

  // ── 4. **带着 cookie 必须能读回自己的会话** ────────────────
  // 这是实测踩过的致命 bug：创建时生成的匿名 id 没写回响应，
  // 于是第二个请求变成另一个人 → 404 → 未登录用户完全用不了。
  const readBack = await request(`/api/sessions/${sessionId}`, {}, jar);
  const readBody = await readBack.json();
  check(
    '带 cookie 能读回自己的会话（匿名身份往返）',
    readBack.status === 200 && readBody?.data?.id === sessionId,
    `实际 ${readBack.status}`,
  );
  check('会话带出证据事实', Array.isArray(readBody?.data?.evidenceFacts), `facts=${readBody?.data?.evidenceFacts?.length}`);
  /**
   * 澄清问题改成**动态**生成（Phase 3）：0～2 条。
   *
   * 旧断言是 `=== 3`（固定三问）。动态化之后数量取决于
   * 「用户已经说清了什么」，所以断言上限而不是定值。
   */
  const questions = Array.isArray(readBody?.data?.questions) ? readBody.data.questions : [];
  check('澄清问题不超过 2 条', questions.length <= 2, `实际 ${questions.length} 条`);
  check(
    '每个澄清问题都说清了它改变什么',
    questions.every((item) => typeof item?.missingVariable === 'string' && typeof item?.reason === 'string'),
  );
  /**
   * **不说用户已经说过的**。
   *
   * 演示话术里写了「基础一般」，所以系统不该再问「你的基础怎么样」——
   * 这是 Phase 3 最重要的一条验收。
   */
  check(
    '不重复问用户已经说过的（基础）',
    !questions.some((item) => /基础/.test(String(item?.question ?? ''))),
    questions.map((item) => item.question).join(' | ') || '（无问题）',
  );
  check('「我听懂的是」所需字段齐全', Boolean(readBody?.data?.userContext), 'userContext');
  check('会话带出问题框定（Phase 2）', Boolean(readBody?.data?.problemFrame), 'problemFrame');

  // ── 5. 别的浏览器读不到（归属隔离） ────────────────────────
  const strangerJar = cookieJar();
  await request('/api/sessions', { method: 'GET' }, strangerJar);
  const stranger = await request(`/api/sessions/${sessionId}`, {}, strangerJar);
  check('陌生匿名身份读不到他人会话 → 404', stranger.status === 404, `实际 ${stranger.status}`);

  // ── 6. 推进完整闭环 ───────────────────────────────────────
  /**
   * 澄清答复按**动态问题的 id** 提交（Phase 3）：问题集合不再是固定的
   * time/verify/loss，而是服务端给出的 0～2 条 ClarificationNeed。
   * 演示话术（比赛 + 基础一般）稳定问出「时间」一条，选项取第一个。
   */
  const answers = {};
  for (const question of questions) {
    if (question?.id && question?.options?.length > 0) {
      answers[question.id] = question.options[0].id;
    }
  }
  const clarify = await request(
    `/api/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clarify', answers }),
    },
    jar,
  );
  const clarifyBody = await clarify.json();
  check('澄清 → status=comparing', clarifyBody?.data?.status === 'comparing', String(clarifyBody?.data?.status));
  if (questions.length > 0) {
    const firstNeed = questions[0];
    const expectedValue = firstNeed.options?.[0]?.value;
    check(
      '澄清答案按缺失变量落地 userContext',
      expectedValue
        ? Object.values(clarifyBody?.data?.userContext ?? {}).includes(expectedValue)
        : true,
      `变量=${firstNeed.missingVariable} 期望值=${expectedValue}`,
    );
  }

  // ── 6.5 UI 入口契约：主链不能只在 API 层可达 ───────────────
  const sessionPageSource = await readFile(new URL('../src/app/session/[id]/page.tsx', import.meta.url), 'utf8');
  check(
    '会话页暴露 prepare-world 触发点',
    sessionPageSource.includes('data-action="prepare-world"') && sessionPageSource.includes("action: 'prepare-world'"),
    'data-action=prepare-world',
  );
  check(
    '会话页暴露 /play?session= 入口',
    sessionPageSource.includes('data-destination="play-session"') && sessionPageSource.includes('/play?session=${'),
    'data-destination=play-session',
  );

  /**
   * ── 6.55 P0-9：Experience Unlock 的来源必须可感知 ──────────
   *
   * 「经验解锁」是这次迭代的 WOW Point，但如果选项底部仍统一写
   * 「剧本模拟」，玩家就不会意识到这个选项是**从真实经历长出来的**。
   * 契约是源码级的：角标文案 + 来源弹层 + 从蓝图取片段（不新增 API）。
   */
  const playPageSource = await readFile(new URL('../src/app/play/page.tsx', import.meta.url), 'utf8');
  const choiceCardSource = await readFile(new URL('../src/components/game/session/SessionChoiceCard.tsx', import.meta.url), 'utf8');
  const sourceModalSource = await readFile(new URL('../src/components/game/ExperienceSourceModal.tsx', import.meta.url), 'utf8');
  check(
    '解锁选项标注真实经历来源',
    choiceCardSource.includes('来自真实经历') && choiceCardSource.includes("const isUnlock = choice.state === 'unlocked'"),
    '解锁卡片带来源角标与原文入口',
  );
  check(
    '普通选项不会伪装成真实来源',
    choiceCardSource.includes('const isUnlock = choice.state === \'unlocked\'') &&
      choiceCardSource.includes('{isUnlock ? (') &&
      sourceModalSource.includes('来源'),
    '来源入口仅在 unlocked 分支出现',
  );
  check(
    '接入了来源弹层（P0-9）',
    sourceModalSource.includes('ExperienceSourceModal') &&
      (playPageSource.includes('ExperienceSourceModal') ||
        (await readFile(new URL('../src/components/game/session/SessionPlayScreen.tsx', import.meta.url), 'utf8')).includes('ExperienceSourceModal')),
    '来源弹层 + 片段解析',
  );
  check(
    '来源片段从蓝图现取（不新增 API）',
    playPageSource.includes('blueprint.experienceFacts.filter'),
    'worldBlueprint.experienceFacts',
  );

  /**
   * ── 6.56 P0-11：Session 模式蓝图证据优先 ────────────────────
   *
   * 新主链的权威证据是蓝图；旧证据网格是 legacy 资产。
   * 两套同时喂给模型，它会把「演算出来的走法」和「真人原文」混着引用。
   */
  check(
    'Session 模式蓝图片段优先喂给 DM',
    playPageSource.includes('blueprintSnippets.length > 0'),
    'blueprintSnippets 优先',
  );
  check(
    'Session 模式隐藏旧证据网格入口',
    !playPageSource.includes('EvidenceMeshView') && playPageSource.includes('blueprintSnippets'),
    'Session 屏只消费蓝图片段',
  );

  /**
   * ── 6.57 P1-2：终局是现实交接，不是报告 ─────────────────────
   *
   * 终局第一屏必须把「任何人替不了的那个问题」交还给玩家，
   * 并给一条有停止信号的现实支线；旧的报告折叠保留。
   */
  check(
    '终局换成「问题重写 + 现实支线」（§21/§30）',
    playPageSource.includes('SessionEndgame') && playPageSource.includes('realityQuestViewOf('),
    '终局交接面板已接线',
  );
  check(
    '新主链把旧机制撤出主路径（§3/§12/§19/§20）',
    playPageSource.includes('const isSessionMode') &&
      playPageSource.includes('SessionEndgame') &&
      !playPageSource.includes('usesTerminalEnding'),
    'isSessionMode + SessionEndgame 主链',
  );
  check(
    '经验卡取代遗物面板（§13）',
    playPageSource.includes('ExperienceCardPanel') && playPageSource.includes('sessionExperienceCards'),
    '借来的经验抽屉已接线',
  );
  check(
    '终局回顾内容折叠在后段',
    (await readFile(new URL('../src/components/game/session/SessionEndgameScreen.tsx', import.meta.url), 'utf8')).includes('<details') &&
      (await readFile(new URL('../src/components/game/session/SessionEndgameScreen.tsx', import.meta.url), 'utf8')).includes('回看这一次推演'),
    '回顾内容折叠在终局后段',
  );

  // ── 6.6 prepare-world（P0-F）：把已澄清的会话编译成世界蓝图 ──
  const prepared = await request(
    `/api/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare-world' }),
    },
    jar,
  );
  const preparedBody = await prepared.json();
  const blueprint = preparedBody?.data?.worldBlueprint;
  check('prepare-world → status=ready_to_play', preparedBody?.data?.status === 'ready_to_play', String(preparedBody?.data?.status));
  /**
   * P0-5 的另一半：检索虽然推迟了，但**没有被丢掉**。
   * 黄金案例必须在 prepare-world 这一步补齐问题专属路径，
   * 否则「推迟」就变成了「静默失效」。
   */
  const preparedPathCount = (preparedBody?.data?.pathClusters ?? []).length;
  check(
    'prepare-world 补齐问题专属路径（推迟不等于丢掉）',
    preparedPathCount > 0 && preparedBody?.data?.retrievalRun?.provenance !== 'deferred',
    `pathClusters=${preparedPathCount} provenance=${preparedBody?.data?.retrievalRun?.provenance}`,
  );
  check('世界蓝图版本 world-blueprint-v1', blueprint?.version === 'world-blueprint-v1', String(blueprint?.version));
  check('蓝图固定三幕', Array.isArray(blueprint?.acts) && blueprint.acts.length === 3, `acts=${blueprint?.acts?.length}`);
  check(
    '三幕目标顺序固定',
    ['enter-world', 'experience-cost', 'meet-counterexample'].every(
      (objective, index) => blueprint?.acts?.[index]?.objective === objective,
    ),
    (blueprint?.acts ?? []).map((act) => act?.objective).join(' → ') || '（无）',
  );
  const retrievalProvenance = String(preparedBody?.data?.retrievalRun?.provenance ?? '');
  check(
    '蓝图保留经验解锁结构（P0-H 的弹药）',
    Array.isArray(blueprint?.unlocks),
    `unlocks=${blueprint?.unlocks?.length ?? 0} provenance=${retrievalProvenance}`,
  );
  check('蓝图经验片段可回溯', (blueprint?.experienceFacts ?? []).every((fact) => String(fact?.exactQuote ?? '').length > 0));

  // ── 6.7 /play?session= 可进入（P0-G 的入口） ────────────────
  const playWithSession = await request(`/play?session=${sessionId}`, {}, jar);
  check('GET /play?session= → 200', playWithSession.status === 200, `实际 ${playWithSession.status}`);

  const designed = await request(
    `/api/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'design-experiment' }),
    },
    jar,
  );
  const designedBody = await designed.json();
  const experiment = designedBody?.data?.experiment;
  const REQUIRED = ['hypothesis', 'action', 'timebox', 'artifact', 'successSignal', 'stopSignal'];
  check(
    '实验六要素齐全',
    Boolean(experiment) && REQUIRED.every((field) => String(experiment[field] ?? '').length > 0),
    REQUIRED.filter((field) => !String(experiment?.[field] ?? '').length).join(',') || 'ok',
  );
  /**
   * P1-1：实验的时间盒不能要求用户挤出他没说的时间。
   * 示例问题里用户自述「未来两周约 3 小时」，实验必须看得见这个约束。
   */
  check(
    '实验的时间盒看得见用户自述的可用时间',
    String(experiment?.timebox ?? '').includes('3 小时'),
    String(experiment?.timebox),
  );

  const committed = await request(
    `/api/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'commit' }),
    },
    jar,
  );
  const committedBody = await committed.json();
  const dueAt = committedBody?.data?.followUp?.dueAt;
  const days = dueAt ? (Date.parse(dueAt) - Date.now()) / 86_400_000 : NaN;
  check('认领后写入约 7 天后的回访', days > 6.9 && days < 7.1, `dueAt=${dueAt}`);

  /**
   * ── 6.9 P1-3：回访结果变成跨会话的现实记忆 ─────────────────
   *
   * 产品此前会问用户结果，但不因此变聪明。带结构化 result 的回访
   * 必须留下**观测到的**事实（实际投入 / 产出），且置信度是
   * observed-once —— 不是用户随口的自我估计。
   */
  const followedUp = await request(
    `/api/sessions/${sessionId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'follow-up',
        outcome: 'done',
        note: '比预想的难，但确实做完了。',
        result: {
          status: 'completed',
          observations: ['前三天没记录，后面补上了'],
          actualTime: '一周实际投入 3 小时',
          producedArtifact: '一个能跑的小样',
          hitSuccessSignal: true,
          hitStopSignal: false,
          whatChanged: '我以为每周能挤出 8 小时，实际只有 3 小时。',
          newUnknowns: ['早上还是晚上更容易投入'],
        },
      }),
    },
    jar,
  );
  check('回访带结构化结果 → 200', followedUp.status === 200, `实际 ${followedUp.status}`);

  // ── 7. 选择日志能看到它 ───────────────────────────────────
  const journal = await request('/api/sessions', {}, jar);
  const journalBody = await journal.json();
  const listedEntry = (journalBody?.data?.sessions ?? []).find((item) => item.id === sessionId);
  check(
    '选择日志列出该会话',
    Boolean(listedEntry),
    `共 ${journalBody?.data?.sessions?.length ?? 0} 条`,
  );

  const memory = journalBody?.data?.realityMemory ?? [];
  const observed = memory.find((item) => item.claim?.includes('实际投入'));
  check(
    '回访观测被记成跨会话记忆（P1-3）',
    Boolean(observed),
    `记忆 ${memory.length} 条`,
  );
  check(
    '记忆置信度是「观测到一次」而不是「用户说的」',
    observed?.confidence === 'observed-once' && observed?.source === 'experiment-observed',
    `confidence=${observed?.confidence} source=${observed?.source}`,
  );
  check(
    '记忆里没有推断出来的人格评价',
    memory.every((item) => !/执行力|自律|风险偏好|意志力|性格/.test(String(item?.claim ?? ''))),
    '未出现人格推断',
  );

  /**
   * ── 7.1 P1-4：日志回答的是「成长」，不是「战绩」 ─────────────
   *
   * 六问里最容易丢的是中间两步：我看见了哪些真实经历、我真正不知道什么。
   * 只留「我问了什么 + 我做了什么」，日志就退化成任务列表。
   */
  check(
    '日志条目带「我真正不知道什么」',
    typeof listedEntry?.keyUnknown === 'string' && listedEntry.keyUnknown.length > 0,
    String(listedEntry?.keyUnknown),
  );
  check(
    '日志条目带真实走法与要验证的实验',
    Array.isArray(listedEntry?.pathLabels) && typeof listedEntry?.experiment?.action === 'string',
    `paths=${(listedEntry?.pathLabels ?? []).length} experiment=${listedEntry?.experiment ? 'yes' : 'no'}`,
  );

  const journalSource = await readFile(new URL('../src/app/journal/page.tsx', import.meta.url), 'utf8');
  check(
    '日志按成长六问组织',
    ['我看见了真实经历', '我真正不知道', '我决定验证', '现实发生了什么', '我现在怎么看'].every((label) =>
      journalSource.includes(label),
    ),
    '成长叙事已接线',
  );
  check(
    '日志不展示战斗数值（成长 ≠ 战绩）',
    !journalSource.includes('state.stats') && !journalSource.includes('statDeltas'),
    '未引入战斗数值展示',
  );

  // ── 8. 删除入口真的能删 ───────────────────────────────────
  const removed = await request(`/api/sessions/${sessionId}`, { method: 'DELETE' }, jar);
  const afterDelete = await request(`/api/sessions/${sessionId}`, {}, jar);
  check('删除会话 → 之后 404', removed.status === 200 && afterDelete.status === 404, `delete=${removed.status} get=${afterDelete.status}`);
}

main()
  .catch((error) => {
    check('未捕获异常', false, String(error?.message ?? error));
  })
  .finally(() => {
    if (server) {
      server.kill();
    }
    const failed = results.filter((item) => !item.passed);
    console.log(`\n[smoke] ${results.length - failed.length}/${results.length} 通过`);
    if (failed.length > 0) {
      console.log('[smoke] 失败项：');
      for (const item of failed) {
        console.log(`  - ${item.name}${item.detail ? `（${item.detail}）` : ''}`);
      }
      process.exitCode = 1;
    }
  });
