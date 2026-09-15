'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  applyReduceMotionPreference,
  browserPreferenceStorage,
  readReduceMotionPreference,
  writeReduceMotionPreference,
  REDUCE_MOTION_EVENT,
  REDUCE_MOTION_OPTIONS,
  type ReduceMotionPreference,
} from '@/features/run/appearance';
import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  secretStatusText,
  type SecretView,
} from '@/features/run/settingsView';

/**
 * 设置页（05_AGENT §5 / §6 / §7）。
 *
 * ## 它现在是什么
 *
 * 不是「密钥配置页」，而是**设置**：
 *
 * ```text
 * 1. 当前使用（这一局用的是谁的配置 —— 只说结论，不说 Key / 端点 / 模型名）
 * 2. 体验（减少动画：真正生效的开关）
 * 3. 高级 · 自带模型（BYOK 覆盖项，默认折叠）
 * 4. 高级 · 自托管 / 开发设置（知乎 Access Secret，默认再折一层）
 * ```
 *
 * 普通玩家打开这一页，看到的第一件事是「不需要配置」，而不是一个必填表单。
 *
 * ## 三条仍在的安全承诺
 *
 * 1. **不回显明文**：接口只给「是否已配置 + 长度 + sha256 前 8 位」，
 *    所以这里永远显示指纹而不是 key 本身；改 key 就是整把替换；
 * 2. **可存可删**：每项都能单独保存、单独删除，并有「全部删除」；
 * 3. **按身份隔离**：已登录按知乎 `url_token`，未登录按匿名 cookie ——
 *    未登录也能配置与使用。
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

/**
 * `/api/health` 的最小视图。
 *
 * 只取「来源」与「就绪」，**不取 model 名与端点** —— 设置页没有理由把它们
 * 摊在普通用户面前（§6 明确禁止展示 Key / App baseUrl / Secret 细节）。
 */
interface HealthPayload {
  readonly secretOrigin?: {
    readonly model?: 'account' | 'app' | 'none';
    readonly zhihu?: 'account' | 'app' | 'none';
  };
  readonly readiness?: { readonly ai?: string; readonly zhihu?: string };
}

/** 这一局用的是谁的配置：只说结论，不说值。 */
function usageHeadline(origin: 'account' | 'app' | 'none' | null): {
  readonly title: string;
  readonly hint: string;
} {
  if (origin === 'account') {
    return {
      title: '当前使用：你自己的模型配置',
      hint: '你的配置优先于官方默认能力，用量不受公共体验额度限制。',
    };
  }
  if (origin === 'none') {
    return {
      title: '当前使用：离线体验',
      hint: '现在没有可用的模型配置，世界会用离线剧本与已落盘的真实来源编译，不需要你填任何 Key。',
    };
  }
  return {
    title: '当前使用：官方体验配置',
    hint: '服务器已经提供 AI 与真实来源能力，你不需要配置任何 Key。你也可以使用自己的兼容模型配置，这不会影响默认体验。',
  };
}

function StatusDot({ ok }: { readonly ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-[color:var(--sil-alternate)]' : 'bg-[color:var(--sil-ink-400)]'}`}
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
        'rounded-[3px] border px-3 py-2 text-label font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        armed
          ? 'border-[color:color-mix(in_srgb,var(--sil-counter)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-counter)_15%,transparent)] text-[color:var(--sil-counter-soft)]'
          : 'border-[color:var(--sil-rule)] text-[color:var(--sil-ink-300)] hover:border-[color:color-mix(in_srgb,var(--sil-counter)_40%,transparent)] hover:text-[color:var(--sil-counter-soft)]',
      ].join(' ')}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export default function SettingsPage() {
  const [data, setData] = React.useState<SettingsPayload | null>(null);
  const [health, setHealth] = React.useState<HealthPayload | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [zhihuSecret, setZhihuSecret] = React.useState('');
  const [modelKey, setModelKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [modelName, setModelName] = React.useState('');
  const [jsonMode, setJsonMode] = React.useState(true);

  /** 体验偏好：SSR 首帧用 `system`，挂载后再对齐 localStorage。 */
  const [reduceMotion, setReduceMotion] = React.useState<ReduceMotionPreference>('system');

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

  /**
   * 「当前使用」只读 `/api/health`：它回的是**来源结论**，不含任何值。
   * 取不到就不显示结论 —— 状态卡是如实告知，不是猜一个填满。
   */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const payload = (await response.json()) as HealthPayload;
        if (!cancelled) {
          setHealth(payload);
        }
      } catch {
        /* 读不到运行状态不影响配置功能，静默保持未知 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 体验偏好：读 → 写 → 立即应用到 `<html>` 并通知同页面的演出组件。 */
  React.useEffect(() => {
    setReduceMotion(readReduceMotionPreference(browserPreferenceStorage()));
  }, []);

  const changeReduceMotion = React.useCallback((next: ReduceMotionPreference) => {
    setReduceMotion(next);
    writeReduceMotionPreference(browserPreferenceStorage(), next);
    applyReduceMotionPreference(
      typeof document === 'undefined' ? null : document.documentElement,
      next,
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(REDUCE_MOTION_EVENT));
    }
  }, []);

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
  const configuredCount =
    Number(Boolean(settings?.zhihuAccessSecret.configured)) +
    Number(Boolean(settings?.model.apiKey.configured));

  const usage = health ? usageHeadline(health.secretOrigin?.model ?? null) : null;
  const zhihuOnline = (health?.secretOrigin?.zhihu ?? 'none') !== 'none';

  return (
    <main className="relative mx-auto w-full max-w-[760px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[color:var(--sil-ink-100)]">设置</h1>
          <p className="mt-1 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
            普通使用不需要配置任何 Key：AI 与知乎能力默认由服务器提供。
            想用自己的模型额度或凭据时，才需要打开下面的高级设置。
          </p>
        </div>
        <Link
          href="/"
          className="rounded-[3px] border border-[color:var(--sil-rule)] px-3 py-2 text-label text-[color:var(--sil-ink-200)] transition-colors duration-150 hover:border-[color:var(--sil-rule-strong)] hover:text-[color:var(--sil-ink-100)]"
        >
          返回首页
        </Link>
      </header>

      {message ? (
        <p
          role="status"
          className={[
            'mt-4 rounded-[3px] border px-3 py-2 text-label',
            message.tone === 'ok'
              ? 'border-[color:color-mix(in_srgb,var(--sil-alternate)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-alternate)_8%,transparent)] text-[color:var(--sil-alternate-soft)]'
              : 'border-[color:color-mix(in_srgb,var(--sil-counter)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-counter)_8%,transparent)] text-[color:var(--sil-counter-soft)]',
          ].join(' ')}
        >
          {message.text}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 font-mono text-label text-[color:var(--sil-ink-400)]">读取中…</p>
      ) : (
        <div className="mt-8 space-y-4">
          {/* ---------- 当前使用（§6：只说结论，不说 Key / baseUrl / Secret 细节） ---------- */}
          {usage ? (
            <section className="rounded-[3px] border border-[color:color-mix(in_srgb,var(--sil-zhihu)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-zhihu)_6%,transparent)] p-4">
              <div className="flex items-center gap-2">
                <StatusDot ok={(health?.secretOrigin?.model ?? 'none') !== 'none'} />
                <h2 className="text-sm font-semibold text-[color:var(--sil-ink-100)]">{usage.title}</h2>
              </div>
              <p className="mt-2 text-label leading-relaxed text-[color:var(--sil-ink-200)]">{usage.hint}</p>
              <p className="mt-2 font-mono text-micro text-[color:var(--sil-ink-300)]">
                真实来源：{zhihuOnline ? '在线（知乎站内检索）' : '已落盘快照'}
              </p>
            </section>
          ) : null}

          {/* ---------- 体验（§5：普通部分只放真正生效的开关） ---------- */}
          <section className="rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:rgb(6_7_11_/_0.62)] p-4">
            <h2 className="text-sm font-semibold text-[color:var(--sil-ink-100)]">体验</h2>
            <p className="mt-2 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
              只放真正生效的偏好。目前这一项：动画量。
            </p>

            <div role="radiogroup" aria-label="动画偏好" className="mt-3 space-y-1.5">
              {REDUCE_MOTION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-2.5 rounded-[3px] border border-[color:var(--sil-rule-faint)] px-3 py-2 transition-colors duration-150 hover:border-[color:var(--sil-rule-strong)]"
                >
                  <input
                    type="radio"
                    name="reduce-motion"
                    value={option.value}
                    checked={reduceMotion === option.value}
                    onChange={() => changeReduceMotion(option.value)}
                    className="mt-0.5 h-3.5 w-3.5 border-[color:var(--sil-rule-strong)] bg-[color:var(--sil-void-900)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-meta font-medium text-[color:var(--sil-ink-100)]">{option.label}</span>
                    <span className="mt-0.5 block text-label leading-relaxed text-[color:var(--sil-ink-400)]">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/*
            §5 / §53：BYOK 是**高级覆盖项**，不是使用前提。
            默认能力来自服务器（§5/§43/§44），所以两项 key 收进 <details>，
            普通用户第一眼看到的是「不需要配置」，而不是一个必填表单。
          */}
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:rgb(6_7_11_/_0.62)] px-4 py-3 text-sm font-semibold text-[color:var(--sil-ink-100)] transition-colors duration-150 hover:border-[color:var(--sil-rule-strong)]">
              <span>高级 · 自带模型</span>
              <span className="font-mono text-micro font-normal text-[color:var(--sil-ink-400)]">
                {configuredCount > 0 ? `已配置 ${configuredCount} 项` : '未配置 · 使用服务器默认'}
              </span>
            </summary>

            {/*
              v3 之后：**不再需要登录**。

              原本这里是「需要先登录知乎」的硬墙。它有两个问题：
              1. 对「配置我自己的 key」是过度约束 —— 玩家只想用自己的 key 玩一局；
              2. 更实际的：如果服务端 env 里留着部署者的共享 key，而访客没配时
                 回退到它，那任何访客都能白用部署者的 key。

              现在配置按**匿名身份**（cookie）隔离保存：不登录也能填、也能用。
              使用知乎登录仍然有价值，但那是为了**记忆**（跨设备、前世遗念），
              与能否配置 key 无关。
            */}
            <div className="mt-3 space-y-4">
              <p className="text-label leading-relaxed text-[color:var(--sil-ink-300)]">
                你也可以使用自己的兼容模型配置。<strong className="text-[color:var(--sil-ink-200)]">这不会影响默认体验</strong>：
                填了就优先用你自己的（花你自己的额度），不填时继续使用服务器默认能力。
              </p>

              {!authenticated ? (
                <p className="rounded-[3px] border border-[color:color-mix(in_srgb,var(--sil-zhihu)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--sil-zhihu)_8%,transparent)] px-4 py-2.5 text-label leading-relaxed text-zhihu-100">
                  你在这里填的凭据只保存在这台浏览器对应的匿名身份下，换设备需要重填。
                  <Link href="/oauth" className="ml-1 font-semibold underline decoration-zhihu-300/60 hover:text-[color:var(--sil-ink-100)]">
                    登录知乎
                  </Link>
                  可以让记忆跨设备保留（凭据本身仍按匿名身份隔离）。
                </p>
              ) : null}

              {/* ---------- 模型（§5 的 API Key / Base URL / Model / JSON mode） ---------- */}
              <section className="rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:rgb(6_7_11_/_0.62)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[color:var(--sil-ink-100)]">模型 key（默认 DeepSeek）</h2>
                  <span className="flex items-center gap-1.5 font-mono text-micro text-[color:var(--sil-ink-300)]">
                    <StatusDot ok={Boolean(settings?.model.apiKey.configured)} />
                    {settings ? secretStatusText(settings.model.apiKey, settings.envFallback.model) : ''}
                  </span>
                </div>

                <p className="mt-2 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
                  用于世界编译与逐幕叙事。默认走 DeepSeek，也可以填任意{' '}
                  <span className="font-mono">OpenAI 兼容</span> 端点（自建网关、其他厂商都行）。
                  不填也能玩：服务器默认能力会接住，额度用完时自动退回离线叙事。
                </p>

                <ol className="mt-2 space-y-1 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
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
                    <span className="font-mono text-micro text-[color:var(--sil-ink-400)]">BASE URL</span>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder={DEFAULT_MODEL_BASE_URL}
                      className="mt-1 w-full rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:var(--sil-void-900)]/70 px-3 py-2 font-mono text-label text-[color:var(--sil-ink-100)] placeholder:text-[color:var(--sil-ink-400)] focus:border-zhihu-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-micro text-[color:var(--sil-ink-400)]">MODEL</span>
                    <input
                      type="text"
                      value={modelName}
                      onChange={(event) => setModelName(event.target.value)}
                      placeholder={DEFAULT_MODEL_NAME}
                      className="mt-1 w-full rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:var(--sil-void-900)]/70 px-3 py-2 font-mono text-label text-[color:var(--sil-ink-100)] placeholder:text-[color:var(--sil-ink-400)] focus:border-zhihu-500/60 focus:outline-none"
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
                    className="min-w-0 flex-1 rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:var(--sil-void-900)]/70 px-3 py-2 font-mono text-label text-[color:var(--sil-ink-100)] placeholder:text-[color:var(--sil-ink-400)] focus:border-zhihu-500/60 focus:outline-none"
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
                    className="sil-btn"
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

                <label className="mt-2 flex items-center gap-2 text-label text-[color:var(--sil-ink-300)]">
                  <input
                    type="checkbox"
                    checked={jsonMode}
                    onChange={(event) => setJsonMode(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[color:var(--sil-rule-strong)] bg-[color:var(--sil-void-900)]"
                  />
                  要求结构化输出（<span className="font-mono">json_object</span>）；自建端点不支持时可关掉
                </label>
              </section>

              {/*
                §7：普通玩家不该看到「知乎 Access Secret」。
                自托管仍然需要它，所以保留 —— 但收进第二层折叠（默认完全隐藏），
                而不是和模型 key 并排放在第一屏。
              */}
              <details className="rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:rgb(6_7_11_/_0.42)]">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3 text-meta font-semibold text-[color:var(--sil-ink-200)] transition-colors duration-150 hover:text-[color:var(--sil-ink-100)]">
                  <span>自托管 / 开发设置 · 知乎开放平台凭据</span>
                  <span className="font-mono text-micro font-normal text-[color:var(--sil-ink-400)]">
                    {settings?.zhihuAccessSecret.configured ? '已配置' : '普通使用不需要'}
                  </span>
                </summary>

                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[color:var(--sil-ink-100)]">知乎开放平台 Access Secret</h2>
                    <span className="flex items-center gap-1.5 font-mono text-micro text-[color:var(--sil-ink-300)]">
                      <StatusDot ok={Boolean(settings?.zhihuAccessSecret.configured)} />
                      {settings ? secretStatusText(settings.zhihuAccessSecret, settings.envFallback.zhihu) : ''}
                    </span>
                  </div>

                  <p className="mt-2 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
                    只有自托管部署才需要：调用官方 <span className="font-mono">/content/zhihu_search</span> 与{' '}
                    <span className="font-mono">/content/hot_list</span>，把真实站内回答编译进世界，
                    并让每一幕引用的经历都能点回原回答。配额约 搜索 1000 次/天、热榜 100 次/天。
                    服务器已经提供默认能力时，这里留空即可。
                  </p>

                  <ol className="mt-2 space-y-1 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
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
                      className="min-w-0 flex-1 rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:var(--sil-void-900)]/70 px-3 py-2 font-mono text-label text-[color:var(--sil-ink-100)] placeholder:text-[color:var(--sil-ink-400)] focus:border-zhihu-500/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || zhihuSecret.trim().length === 0}
                      onClick={() => void save('知乎 Access Secret', { zhihuAccessSecret: zhihuSecret.trim() })}
                      className="sil-btn"
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
                </div>
              </details>

              {/* ---------- 安全与清空 ---------- */}
              <section className="rounded-[3px] border border-[color:var(--sil-rule)] bg-[color:rgb(6_7_11_/_0.62)] p-4">
                <h2 className="text-sm font-semibold text-[color:var(--sil-ink-100)]">这些密钥怎么存的</h2>
                <ul className="mt-2 space-y-1 text-label leading-relaxed text-[color:var(--sil-ink-300)]">
                  <li>· 明文只写在服务器磁盘（权限 0600），<strong className="text-[color:var(--sil-ink-200)]">接口永不返回明文</strong> —— 本页只看得到指纹；</li>
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
                    <span className="font-mono text-micro text-[color:var(--sil-ink-400)]">
                      最近更新：{settings.updatedAt.slice(0, 19).replace('T', ' ')} UTC
                    </span>
                  ) : null}
                </div>
              </section>
            </div>
          </details>
        </div>
      )}
    </main>
  );
}
