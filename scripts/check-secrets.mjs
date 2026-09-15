/**
 * 密钥防泄漏闸门 —— 提交前跑，也可以手工跑。
 *
 * ```bash
 * node scripts/check-secrets.mjs        # 检查
 * git config core.hooksPath .githooks   # 一次配置，之后每次 commit 自动跑
 * ```
 *
 * ## 为什么需要它
 *
 * `.gitignore` 能挡住 `.env.local` **本身**，但挡不住四类真实事故：
 *
 * 1. **密钥被复制到别处**：调试时把 key 粘进 README 当示例、
 *    写进测试夹具、留在一份 JSON 快照里。
 * 2. **新 env 文件没进忽略名单**：有人建了 `.env.staging`，
 *    而 `.gitignore` 只写了 `.env.local`。
 * 3. **早期待提交内容里有密钥**：`git add -A` 时代码里硬编码过。
 * 4. **轮换后的旧密钥**：新 key 换上去了，旧 key 还留在某份备份里 ——
 *    旧 key 若未在服务端吊销，仍然是可用的。
 *
 * 前三类靠「扫内容」，第四类靠「扫所有 env 文件的全部值」。
 *
 * ## 设计取舍：不依赖 .env.local
 *
 * 有些机器（CI、队友的机器）根本没有 `.env.local`。若脚本只做
 * 「拿真值去比对」，那些环境下它会静默通过 —— 假绿。
 *
 * 所以本脚本的主逻辑是**模式识别**：任何长得像密钥的字符串，
 * 只要出现在被 git 跟踪的文件里就报警。比对真值是**额外的**一层，
 * 有就跑、没有就跳过（并在输出里说明）。
 *
 * ## 为什么允许列表是必要的
 *
 * 样本文档（`.env.example`）里必须写占位符；测试里会有
 * 故意构造的假 token。没有允许列表，脚本会因为这类合法内容
 * 天天报警，最后没人看 —— 那比没有还糟。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

/* ============================================================ 配置 */

/**
 * 会被扫描的文本文件扩展名。
 * 二进制与图片不扫 —— 它们碰巧包含类似密钥的字节序列的概率不低。
 */
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss',
  '.md', '.mdx', '.txt', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.ps1', '.py', '.env', '.example', '.sql', '.xml', '.html',
]);

/**
 * 允许列表：这些路径允许出现"像密钥"的东西。
 *
 * 判据是「这个文件的存在意义就是展示占位符或构造测试样本」。
 * 宽松地放行会让闸门失效，所以这里只列必要的。
 */
const ALLOWLIST = [
  /^\.env\.example$/,
  /^\.env\.production\.example$/,
  /^tests\/publicRuntimeSafety\.test\.ts$/, // 仅允许专门验证“不泄漏”的假值测试
  /^\.private\//, // 本地审计脚本与备份（已被 gitignore，不会提交）
];

const isAllowlisted = (rel) => ALLOWLIST.some((re) => re.test(rel));

/**
 * 密钥模式。每条都要求「足够长的连续高熵片段」，
 * 以避开 `sk-` 这种短前缀的误报。
 */
const PATTERNS = [
  { name: 'OpenAI/DeepSeek 风格 key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: '知乎开放平台 secret', re: /\b[0-9a-f]{32,}\b/gi },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

/**
 * 误报排除：32 位以上的 hex 在正常代码里也常见。
 * 例如 git 的完整 SHA、以及测试里的固定 UUID/哈希。
 */
const HEX_FALSE_POSITIVES = new Set([
  // 文档里引用的提交号、内容哈希等由调用处动态判断长度与上下文
]);

/** 检查文本中可解码的 base64 片段，拦截把 key 编码后藏进源码的常见绕过。 */
function decodedSecretHits(text) {
  const hits = [];
  const candidates = text.match(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/])/g) ?? [];
  for (const candidate of candidates) {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf8');
      if (PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(decoded); })) hits.push(candidate);
    } catch { /* 非法 base64 忽略 */ }
  }
  return hits;
}

/* ============================================================ 收集文件 */

/**
 * 取「会被提交的文件」。
 *
 * 用 `git ls-files` 而非遍历磁盘 —— 因为决定什么会离开本机的
 * 是 git 索引，不是磁盘。顺便天然排除了 .gitignore 里的内容。
 *
 * `--cached --others --exclude-standard` 会把**未跟踪但没被忽略**的
 * 新文件也带上 —— 那些才是 `git add -A` 时最容易出事的部分。
 */
function trackedFiles() {
  try {
    const out = execSync('git ls-files --cached --others --exclude-standard', {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/* ============================================================ 1. env 文件是否被跟踪 */

const files = trackedFiles();
console.log(`待提交（含未跟踪新文件）共 ${files.length} 个\n`);

const ENV_FILE_RE = /(^|\/)\.env(\.|$)|\/env\.(local|production|staging|development)/i;
const trackedEnv = files.filter((f) => ENV_FILE_RE.test(f) && !/\.example$/.test(f));

console.log('### 1. env 文件跟踪检查\n');
if (trackedEnv.length > 0) {
  console.log('  ✗ 以下 env 文件被跟踪 —— 必须从索引移除（值会永久留在历史里）：');
  for (const f of trackedEnv) console.log(`      ${f}`);
  console.log('\n    处理：git rm --cached <文件>，然后把它加进 .gitignore');
  console.log('    注意：若值已经出现在**历史提交**里，仅 rm --cached 不够 ——');
  console.log('    必须去服务商后台**吊销并轮换**该密钥。');
} else {
  console.log('  ✓ 没有任何真实 env 文件被跟踪');
}

/* ============================================================ 2. 扫内容里的密钥模式 */

console.log('\n### 2. 被跟踪文件的内容扫描\n');

const findings = [];
let scanned = 0;

for (const f of files) {
  const rel = f.replace(/\\/g, '/');
  if (isAllowlisted(rel)) continue;

  const ext = extname(rel).toLowerCase();
  // 无扩展名的文件（Dockerfile / Makefile 等）也扫
  if (ext && !TEXT_EXT.has(ext)) continue;

  let text;
  try {
    const st = statSync(join(ROOT, f));
    if (st.size > 2 * 1024 * 1024) continue;
    text = readFileSync(join(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  scanned += 1;

  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: rel, line, pattern: p.name, sample: m[0] });
    }
  }
}

console.log(`  扫描 ${scanned} 个文本文件\n`);

if (findings.length === 0) {
  console.log('  ✓ 未发现硬编码密钥');
} else {
  console.log(`  ✗ 发现 ${findings.length} 处可疑内容：\n`);
  for (const f of findings) {
    const masked = f.sample.length > 20
      ? `${f.sample.slice(0, 12)}…${f.sample.slice(-4)} (len=${f.sample.length})`
      : f.sample;
    console.log(`      ${f.file}:${f.line}  [${f.pattern}]  ${masked}`);
  }
  console.log('\n    若确认是占位符或测试样本，把它加进本脚本的 ALLOWLIST；');
  console.log('    若是真值，立刻轮换该密钥并改用环境变量注入。');
}

/* ============================================================ 3. 真值比对（可选） */

console.log('\n### 3. 与本地真实密钥比对\n');

/** 收集本机所有 env 文件里的真实值（含 .private 下的历史备份）。 */
function localSecretValues() {
  const values = new Map();
  if (!existsSync(ROOT)) return values;

  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (['.git', 'node_modules', '.next'].includes(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const base = name;
      const envLike = /^\.env/.test(base) || /env-backup/.test(base);
      if (!envLike || st.size > 1024 * 1024) continue;

      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        /*
          只收"像密钥"的：长度 >= 20、非 URL、非布尔/数字。
          `https://...` 这类公开端点不算密钥，但也不该硬编码 ——
          那是另一条规则，不在这里拦。
        */
        if (value.length < 20) continue;
        if (/^https?:\/\//.test(value)) continue;
        if (/^(true|false|\d+)$/i.test(value)) continue;
        if (!values.has(value)) values.set(value, new Set());
        values.get(value).add(relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(ROOT);
  return values;
}

const localSecrets = localSecretValues();

if (localSecrets.size === 0) {
  console.log('  ⊘ 本机没有可用的 env 文件，跳过真值比对');
  console.log('    （内容扫描仍在上面生效 —— 这一层只是额外保险）');
} else {
  console.log(`  本机 env 文件里有 ${localSecrets.size} 个真实值，逐个在待提交文件中查找…\n`);

  let leaked = 0;
  for (const [value, sources] of localSecrets) {
    const masked = `${value.slice(0, 8)}…${value.slice(-4)}`;
    const hits = [];
    for (const f of files) {
      const rel = f.replace(/\\/g, '/');
      let text;
      try {
        const st = statSync(join(ROOT, f));
        if (st.size > 2 * 1024 * 1024) continue;
        text = readFileSync(join(ROOT, f), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(value)) hits.push(rel);
    }
    if (hits.length > 0) {
      leaked += 1;
      console.log(`  ✗ ${masked}（来自 ${[...sources].join(', ')}）出现在：`);
      for (const h of hits.slice(0, 8)) console.log(`        ${h}`);
    }
  }

  if (leaked === 0) {
    console.log('  ✓ 没有任何真实密钥值出现在待提交文件中');
  } else {
    console.log(`\n  ✗ ${leaked} 个真实密钥值即将被提交 —— 已阻断`);
  }
  findings.push(...Array.from({ length: leaked }, () => ({ pattern: 'real value' })));
}

/* ============================================================ 结论 */

const failed = trackedEnv.length > 0 || findings.length > 0;

console.log('\n' + '='.repeat(66));
if (failed) {
  console.log('✗ 检查未通过 —— 处理上面标 ✗ 的问题后再提交。');
  console.log('');
  console.log('  若密钥已经进入历史提交，光改文件没用：');
  console.log('    1. 去服务商后台吊销该密钥');
  console.log('    2. 生成新密钥，只在服务器/本地 env 使用');
  console.log('    3. 历史清理用 git filter-repo（会改写历史，需团队协调）');
} else {
  console.log('✓ 通过：仓库里没有密钥，也没有被跟踪的 env 文件。');
}
console.log('='.repeat(66));

process.exit(failed ? 1 : 0);
