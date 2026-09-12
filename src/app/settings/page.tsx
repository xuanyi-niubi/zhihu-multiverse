'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  secretStatusText,
  type SecretView,
} from '@/features/run/settingsView';

/**
 * 密钥配置页。
 *
 * 三个原则：
 * 1. **不回显明文**：接口只给「是否已配置 + 长度 + sha256 前 8 位」，
 *    所以这里永远显示指纹而不是 key 本身；改 key 就是整把替换。
 * 2. **可存可删**：每项都能单独保存、单独删除，并有「全部删除」。
 *    删除是真的从盘上删掉，不留"隐藏的旧值"。
 * 3. **按身份隔离**：已登录按知乎 `url_token`，未登录按匿名 cookie ——
 *    **未登录也能配置与使用**（v3 之后取消了这个登录门槛）。
 */

interface SettingsPayload {
  readonly authenticated: boolean;
  readonly settings: {
    readonly zhihuAccessSecret: SecretView;
    readonly model: {
      readonly apiKey: SecretView;
      readonly baseUrl: string | null;
      readonly model: string | null;
      readonly jsonMode: boolean;
    };
    readonly updatedAt: string | null;
    readonly envFallback: { readonly zhihu: boolean; readonly model: boolean };
  };
}

function StatusDot({ ok }: { readonly ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`}
    />
  );
}

/** 删除按钮：点一次变成「确认删除」，再点才真的删 —— 避免误触。 */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  readonly label: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) {
      return;
    }
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
          return;
        }
        setArmed(true);
      }}
      className={[
        'rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        armed
          ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
          : 'border-white/12 text-slate-400 hover:border-rose-400/40 hover:text-rose-200',
      ].join(' ')}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export default function SettingsPage() {
  const [data, setData] = React.useState<SettingsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [zhihuSecret, setZhihuSecret] = React.useState('');
  const [modelKey, setModelKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [modelName, setModelName] = React.useState('');
  const [jsonMode, setJsonMode] = React.useState(true);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' });
      const payload = (await response.json()) as SettingsPayload;
      setData(payload);
      setBaseUrl(payload.settings.model.baseUrl ?? DEFAULT_MODEL_BASE_URL);
      setModelName(payload.settings.model.model ?? DEFAULT_MODEL_NAME);
      setJsonMode(payload.settings.model.jsonMode);
    } catch {
      setMessage({ tone: 'warn', text: '读取配置失败，请刷新重试。' });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(
    async (label: string, patch: Record<string, string | boolean>) => {
      setBusy(label);
      setMessage(null);
      try {
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(patch),
        });
        const payload = (await response.json()) as SettingsPayload & { ok: boolean; reason?: string };

        if (payload.ok) {
          setZhihuSecret('');
          setModelKey('');
          setMessage({ tone: 'ok', text: `${label} 已保存（明文只留在服务器，本页不会回显）。` });
          await load();
        } else {
          setMessage({ tone: 'warn', text: `${label} 保存失败：${payload.reason ?? '未知原因'}` });
        }
      } catch {
        setMessage({ tone: 'warn', text: `${label} 保存失败：网络错误` });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const remove = React.useCallback(
    async (label: string, field: 'zhihu' | 'model' | 'all') => {
      setBusy(label);
      setMessage(null);
      try {
        const response = await fetch(`/api/settings?field=${field}`, { method: 'DELETE', cache: 'no-store' });
        const payload = (await response.json()) as { ok: boolean; reason?: string };

        setMessage(
          payload.ok
            ? { tone: 'ok', text: `${label} 已删除。` }
            : { tone: 'warn', text: `${label} 删除失败：${payload.reason ?? '未知原因'}` },
        );
        await load();
      } catch {
        setMessage({ tone: 'warn', text: `${label} 删除失败：网络错误` });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const settings = data?.settings;
  const authenticated = data?.authenticated ?? false;

  return (
    <main className="relative mx-auto w-full max-w-[760px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">密钥配置</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            配置你自己的知乎开放平台与模型 key。密钥按知乎账号隔离保存，随时可删。
          </p>
        </div>
        <Link
          href="/"
          className="rounded-xl border border-white/12 px-3 py-2 text-[11px] text-slate-300 transition-colors duration-150 hover:border-zhihu-500/50 hover:text-white"
        >
          返回首页
        </Link>
      </header>

      {message ? (
        <p
          role="status"
          className={[
            'mt-4 rounded-xl border px-3 py-2 text-[11px]',
            message.tone === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-200'
              : 'border-amber-400/40 bg-amber-400/[0.08] text-amber-200',
          ].join(' ')}
        >
          {message.text}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 font-mono text-[11px] text-slate-500">读取中…</p>
      ) : (
        <div className="mt-6 space-y-4">
          {/*
            v3 之后：**不再需要登录**。

            原本这里是「需要先连接知乎账号」的硬墙。它有两个问题：
            1. 对「配置我自己的 key」是过度约束 —— 玩家只想用自己的 key 玩一局；
            2. 更实际的：如果服务端 env 里留着部署者的共享 key，而访客没配时
               回退到它，那任何访客都能白用部署者的 key。

            现在配置按**匿名身份**（cookie）隔离保存：不登录也能填、也能用。
            登录知乎账号仍然有价值，但那是为了**记忆**（跨设备、前世遗念），
            与能否配置 key 无关。
          */}
          {!authenticated ? (
            <p className="rounded-2xl border border-zhihu-500/30 bg-zhihu-500/[0.08] px-4 py-2.5 text-[11px] leading-relaxed text-zhihu-100">
              当前是匿名配置：key 只保存在这台浏览器对应的匿名身份下，换设备需要重填。
              <Link href="/oauth" className="ml-1 font-semibold underline decoration-zhihu-300/60 hover:text-white">
                连接知乎账号
              </Link>
              可以让记忆跨设备保留（配置本身仍按匿名身份隔离）。
            </p>
          ) : null}

          {/* ---------- 知乎开放平台 ---------- */}
          <section className="rounded-2xl border border-white/12 bg-ink-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">知乎开放平台 Access Secret</h2>
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                <StatusDot ok={Boolean(settings?.zhihuAccessSecret.configured)} />
                {settings ? secretStatusText(settings.zhihuAccessSecret, settings.envFallback.zhihu) : ''}
              </span>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              用途：调用官方 <span className="font-mono">/content/zhihu_search</span> 与{' '}
              <span className="font-mono">/content/hot_list</span>，把真实站内回答注入剧本，
              并让终局《现实破壁清单》的每条建议都能点回真实来源。
              配额约 搜索 1000 次/天、热榜 100 次/天。
            </p>

            <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
              <li>
                1. 打开{' '}
                <a
                  href="https://developer.zhihu.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-zhihu-300 underline decoration-dotted"
                >
                  developer.zhihu.com ↗
                </a>{' '}
                注册开发者并创建应用；
              </li>
              <li>2. 在应用的「凭证」页复制 <span className="font-mono">Access Secret</span>；</li>
              <li>3. 粘贴到下面保存即可（本页不会回显明文）。</li>
            </ol>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={zhihuSecret}
                onChange={(event) => setZhihuSecret(event.target.value)}
                placeholder="粘贴 Access Secret"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-zhihu-500/60 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy !== null || zhihuSecret.trim().length === 0}
                onClick={() => void save('知乎 Access Secret', { zhihuAccessSecret: zhihuSecret.trim() })}
                className="arcade-btn bg-zhihu-500 text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                保存
              </button>
              <ConfirmButton
                label="删除"
                confirmLabel="确认删除"
                disabled={busy !== null || !settings?.zhihuAccessSecret.configured}
                onConfirm={() => void remove('知乎 Access Secret', 'zhihu')}
              />
            </div>
          </section>

          {/* ---------- 模型 ---------- */}
          <section className="rounded-2xl border border-white/12 bg-ink-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">模型 key（默认 DeepSeek）</h2>
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                <StatusDot ok={Boolean(settings?.model.apiKey.configured)} />
                {settings ? secretStatusText(settings.model.apiKey, settings.envFallback.model) : ''}
              </span>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              用于第四幕终端判卷与终局复盘。默认走 DeepSeek，也可以填任意{' '}
              <span className="font-mono">OpenAI 兼容</span> 端点（自建网关、其他厂商都行）。
              没配也能玩：判卷会自动降级到本地规则。
            </p>

            <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
              <li>
                1. 打开{' '}
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-zhihu-300 underline decoration-dotted"
                >
                  platform.deepseek.com/api_keys ↗
                </a>{' '}
                创建 API Key；
              </li>
              <li>2. 填入下方并保存；换别的服务商就把端点与模型名一起改掉。</li>
            </ol>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-[10px] text-slate-500">BASE URL</span>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={DEFAULT_MODEL_BASE_URL}
                  className="mt-1 w-full rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-zhihu-500/60 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[10px] text-slate-500">MODEL</span>
                <input
                  type="text"
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder={DEFAULT_MODEL_NAME}
                  className="mt-1 w-full rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-zhihu-500/60 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                placeholder="粘贴 API Key"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-ink-950/70 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-zhihu-500/60 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void save('模型配置', {
                    ...(modelKey.trim().length > 0 ? { modelApiKey: modelKey.trim() } : {}),
                    modelBaseUrl: baseUrl.trim(),
                    modelModel: modelName.trim(),
                    modelJsonMode: jsonMode,
                  })
                }
                className="arcade-btn bg-zhihu-500 text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                保存
              </button>
              <ConfirmButton
                label="删除"
                confirmLabel="确认删除"
                disabled={busy !== null || !settings?.model.apiKey.configured}
                onConfirm={() => void remove('模型配置', 'model')}
              />
            </div>

            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={jsonMode}
                onChange={(event) => setJsonMode(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-ink-950"
              />
              要求结构化输出（<span className="font-mono">json_object</span>）；自建端点不支持时可关掉
            </label>
          </section>

          {/* ---------- 安全与清空 ---------- */}
          <section className="rounded-2xl border border-white/12 bg-ink-900/60 p-4">
            <h2 className="text-sm font-semibold text-white">这些密钥怎么存的</h2>
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
              <li>· 明文只写在服务器磁盘（权限 0600），<strong className="text-slate-300">接口永不返回明文</strong> —— 本页只看得到指纹；</li>
              <li>· 按知乎账号隔离，退出账号后这些 key 仍属于该账号，不会被别人读到；</li>
              <li>· 不写日志：鉴权失败只会记录错误码，不会打印 key；</li>
              <li>· 「删除」是真的把字段从盘上删掉，不留隐藏副本。</li>
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ConfirmButton
                label="删除全部配置"
                confirmLabel="确认删除全部"
                disabled={busy !== null}
                onConfirm={() => void remove('全部配置', 'all')}
              />
              {settings?.updatedAt ? (
                <span className="font-mono text-[10px] text-slate-500">
                  最近更新：{settings.updatedAt.slice(0, 19).replace('T', ' ')} UTC
                </span>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
