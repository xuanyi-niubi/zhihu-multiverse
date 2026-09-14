/**
 * 用 CDP 驱动本机 Edge/Chrome 无头实例，截取 README 四张截图位。
 *
 * 前置：
 *   1. `npm run dev` 已在 localhost:3000 运行
 *   2. 已用远程调试端口启动无头浏览器，例如：
 *      msedge.exe --headless=new --remote-debugging-port=9223 --user-data-dir=<临时目录> about:blank
 *
 * 用法：node scripts/capture-screenshots.mjs [端口] [输出目录]
 *
 * 为什么不用 --screenshot 命令行：它需要带 cookie 的会话（匿名身份），
 * 命令行截图每次都是全新上下文，内页一律 401。走 CDP 后，
 * 在页面上下文里 fetch /api/sessions，cookie 由浏览器自己维护。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEBUG_PORT = Number(process.argv[2] ?? 9223);
const OUT_DIR = process.argv[3] ?? path.join('public', 'screenshots');
const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000';
const QUESTION = '我大二，想参加黑客松比赛，但怕课程跟不上';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 120_000);
    });
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  const browser = new Cdp(version.webSocketDebuggerUrl);
  await browser.open();

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: cdpSession } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => browser.send(method, params, cdpSession);

  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const shots = [];
  async function shot(name) {
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    shots.push(file);
    console.log(`[shot] ${file}`);
  }

  async function goto(url, settleMs = 3200) {
    await page('Page.navigate', { url });
    await sleep(settleMs);
  }

  /** 在页面上下文里调 API：匿名身份 cookie 由浏览器自动维护。 */
  async function api(method, url, body) {
    const expression = `(async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ${body === undefined ? '' : `body: JSON.stringify(${JSON.stringify(body)}),`}
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    })()`;
    const { result } = await page('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.value;
  }

  // ---- 1. 首页（命运观象厅 + 看山引导条 + 唯一 CTA） -----------------------
  await goto(`${BASE}/`, 4200);
  await shot('home');

  // ---- 2. 建一局（浏览器上下文自带匿名身份 cookie） ------------------------
  const created = await api('POST', `${BASE}/api/sessions`, { question: QUESTION });
  const sessionId = created?.json?.data?.id;
  if (!sessionId) {
    console.error('[fail] 建局失败：', JSON.stringify(created).slice(0, 300));
    process.exit(1);
  }
  console.log(`[session] ${sessionId} provenance=${created.json.data.provenance}`);

  // ---- 3. 会话页：澄清阶段（sway 看山 + 动态问题） -------------------------
  await goto(`${BASE}/session/${sessionId}`, 3600);
  await shot('session-clarify');

  // 答完澄清（取每个问题的第一个选项；没有选项给一句通用回答）
  const view = await api('GET', `${BASE}/api/sessions/${sessionId}`);
  const questions = view?.json?.data?.questions ?? [];
  const answers = {};
  for (const q of questions) {
    answers[q.id] = (q.options && q.options[0]) || '目前还没有，主要看接下来这一学期的安排。';
  }
  if (questions.length > 0) {
    await api('PATCH', `${BASE}/api/sessions/${sessionId}`, { action: 'clarify', answers });
  }

  // ---- 4. World Forge：编译进行中（三轨道 + materialize） ------------------
  await goto(`${BASE}/session/${sessionId}`, 1600);
  await page('Runtime.evaluate', {
    expression: `fetch(${JSON.stringify(`/api/sessions/${sessionId}`)}, {
      method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare-world' }),
    })`,
  });
  await sleep(2600); // 编译中途：WorldForge 正在 materialize
  await shot('world-forge');

  // 等编译真正完成（轮询会话状态）
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    const current = await api('GET', `${BASE}/api/sessions/${sessionId}`);
    const status = current?.json?.data?.status;
    if (status && status !== 'clarified' && status !== 'compiling') {
      ready = true;
      break;
    }
    await sleep(2000);
  }
  console.log(`[prepare-world] ready=${ready}`);

  // ---- 5. 世界就绪（wave 看山「找到了。走吧。」） ---------------------------
  await goto(`${BASE}/session/${sessionId}`, 3000);
  await shot('session-ready');

  // ---- 6. 对局页：HUD + 第一幕抉择 -----------------------------------------
  await goto(`${BASE}/play?session=${sessionId}`, 5200);
  await shot('play-act1');

  // ---- 7. 终局：问题重写 + 现实支线（select-unknown → design-experiment） ----
  await api('PATCH', `${BASE}/api/sessions/${sessionId}`, {
    action: 'select-unknown',
    unknown: '课程与比赛冲突时，时间到底该怎么分配',
  });
  await api('PATCH', `${BASE}/api/sessions/${sessionId}`, { action: 'design-experiment' });
  await goto(`${BASE}/session/${sessionId}`, 3600);
  await shot('endgame');

  await browser.send('Target.closeTarget', { targetId });
  console.log(`[done] ${shots.length} 张截图已写入 ${OUT_DIR}`);
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
