import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { removeFile } from '@/core/fsSafe';
import { join } from 'node:path';

/**
 * 账号级密钥配置（应用内可填、可删）。
 *
 * 安全纪律（每一条都有对应的测试）：
 *
 * 1. **明文只在服务端落盘，永不出接口**：GET 只回「是否已配置 + 长度 + sha256 前缀」，
 *    这条沿用 `/api/oauth/status` 的既有做法，前端拿不到密钥本身。
 * 2. **文件权限 0600**：同机其他用户读不到；目录落在挂载卷里（见 docker-compose 的 /app/data）。
 * 3. **绝不写日志**：本模块不做任何 console 输出，调用方也不得把明文带进日志。
 * 4. **删除是真删**：删掉字段后文件里就没有它了，回退到环境变量（如果配了），
 *    不会留一份「隐藏的旧值」让用户以为已经删干净。
 * 5. **按账号隔离**：key 用 url_token 的 sha256 命名（与记忆存储同一套防路径穿越做法）。
 */

export interface StoredSettings {
  readonly version: 1;
  readonly zhihuAccessSecret?: string;
  readonly modelApiKey?: string;
  readonly modelBaseUrl?: string;
  readonly modelModel?: string;
  readonly modelJsonMode?: boolean;
  readonly updatedAt: string;
}

/** 可以单独删除/替换的字段。 */
export const SETTINGS_FIELDS = ['zhihuAccessSecret', 'modelApiKey', 'modelBaseUrl', 'modelModel', 'modelJsonMode'] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

/** 接口能对外暴露的形状：**没有任何明文**。 */
export interface PublicSecretView {
  readonly configured: boolean;
  readonly length: number;
  /** sha256 前 8 位，用于人工核对"改的是不是同一把 key"。 */
  readonly digest: string | null;
}

export interface PublicSettings {
  readonly authenticated: boolean;
  readonly zhihuAccessSecret: PublicSecretView;
  readonly model: {
    readonly apiKey: PublicSecretView;
    readonly baseUrl: string | null;
    readonly model: string | null;
    readonly jsonMode: boolean;
  };
  readonly updatedAt: string | null;
  /** 环境变量里是否也配了（用于界面区分「账号配置」与「环境变量兜底」）。 */
  readonly envFallback: { readonly zhihu: boolean; readonly model: boolean };
}

function dataDir(): string {
  return process.env.SETTINGS_DIR ?? join(process.cwd(), 'data', 'settings');
}

/** 与记忆存储同一套防路径穿越做法：token 只用来哈希，不进路径。 */
export function settingsFileFor(urlToken: string): string {
  const hash = createHash('sha256').update(`zhihu-settings:${urlToken}`).digest('hex').slice(0, 32);
  return join(dataDir(), `${hash}.json`);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 读配置：文件缺失/损坏一律当没配，永不抛异常。 */
export function readSettings(urlToken: string): StoredSettings | null {
  try {
    const file = settingsFileFor(urlToken);
    if (!existsSync(file)) {
      return null;
    }
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      version: 1,
      ...(asString(record.zhihuAccessSecret) ? { zhihuAccessSecret: asString(record.zhihuAccessSecret) as string } : {}),
      ...(asString(record.modelApiKey) ? { modelApiKey: asString(record.modelApiKey) as string } : {}),
      ...(asString(record.modelBaseUrl) ? { modelBaseUrl: asString(record.modelBaseUrl) as string } : {}),
      ...(asString(record.modelModel) ? { modelModel: asString(record.modelModel) as string } : {}),
      ...(typeof record.modelJsonMode === 'boolean' ? { modelJsonMode: record.modelJsonMode } : {}),
      updatedAt: asString(record.updatedAt) ?? '',
    };
  } catch {
    // 损坏或不可读：当没配，不影响游戏
    return null;
  }
}

export type SettingsReason =
  | 'ok'
  | 'storage-write-failed'
  | 'invalid-field'
  | 'invalid-secret'
  | 'invalid-base-url'
  | 'invalid-model';

export interface SettingsWriteResult {
  readonly settings: StoredSettings | null;
  readonly persisted: boolean;
  readonly reason: SettingsReason;
}

/** 密钥长度与字符约束：够长、且不含换行/引号/反斜杠（避免注入与截断）。 */
export function validateSecret(value: string): boolean {
  return value.length >= 8 && value.length <= 256 && !/[\r\n"'\\]/.test(value);
}

/** 端点地址：只接受 https（本地调试放行 http://127.0.0.1）。 */
export function validateBaseUrl(value: string): boolean {
  if (value.length === 0 || value.length > 200) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') {
      return true;
    }
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function persist(urlToken: string, settings: StoredSettings): SettingsWriteResult {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const file = settingsFileFor(urlToken);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
    try {
      chmodSync(file, 0o600);
    } catch {
      // 某些文件系统不支持 chmod（如 Windows 上的测试环境）：不因此判定失败
    }
    return { settings, persisted: true, reason: 'ok' };
  } catch {
    return { settings: null, persisted: false, reason: 'storage-write-failed' };
  }
}

/**
 * 写入配置（合并式 patch）。
 *
 * `undefined` = 不动该字段；`''` 在新值校验里会被判非法 —— 删除请走 `clearSettings`，
 * 这样「保存空值」不会静默变成「删除」，两个动作的语义不会混。
 */
export function writeSettings(
  urlToken: string,
  patch: Partial<Record<SettingsField, string | boolean>>,
): SettingsWriteResult {
  const current = readSettings(urlToken) ?? { version: 1 as const, updatedAt: '' };
  const next: Record<string, unknown> = { ...current, version: 1, updatedAt: new Date().toISOString() };

  for (const field of SETTINGS_FIELDS) {
    const value = patch[field];
    if (value === undefined) {
      continue;
    }

    if (field === 'modelJsonMode') {
      if (typeof value !== 'boolean') {
        return { settings: null, persisted: false, reason: 'invalid-field' };
      }
      next[field] = value;
      continue;
    }

    if (typeof value !== 'string') {
      return { settings: null, persisted: false, reason: 'invalid-field' };
    }

    if (field === 'modelBaseUrl') {
      if (!validateBaseUrl(value)) {
        return { settings: null, persisted: false, reason: 'invalid-base-url' };
      }
      next[field] = value;
      continue;
    }

    if (field === 'modelModel') {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > 64) {
        return { settings: null, persisted: false, reason: 'invalid-model' };
      }
      next[field] = trimmed;
      continue;
    }

    if (!validateSecret(value)) {
      return { settings: null, persisted: false, reason: 'invalid-secret' };
    }
    next[field] = value;
  }

  return persist(urlToken, next as unknown as StoredSettings);
}

/**
 * 删除配置。
 *
 * @param field 指定字段只删那一项；`'all'` 删掉整份配置（连文件一起删）。
 * @returns 删除后的配置（可能为 null）与是否落盘成功。
 */
export function clearSettings(
  urlToken: string,
  field: SettingsField | 'all' = 'all',
): { readonly settings: StoredSettings | null; readonly persisted: boolean } {
  if (field === 'all') {
    try {
      removeFile(settingsFileFor(urlToken));
      return { settings: null, persisted: true };
    } catch {
      return { settings: readSettings(urlToken), persisted: false };
    }
  }

  const current = readSettings(urlToken);
  if (!current) {
    return { settings: null, persisted: true };
  }

  const next: Record<string, unknown> = { ...current };
  delete next[field];

  // 三项模型配置都空了，就把整个文件删掉，不留下一个「什么都空」的壳
  const modelEmpty = next.modelApiKey === undefined && next.modelBaseUrl === undefined && next.modelModel === undefined && next.modelJsonMode === undefined;
  const zhihuEmpty = next.zhihuAccessSecret === undefined;
  if (modelEmpty && zhihuEmpty) {
    try {
      removeFile(settingsFileFor(urlToken));
      return { settings: null, persisted: true };
    } catch {
      return { settings: readSettings(urlToken), persisted: false };
    }
  }

  const result = persist(urlToken, { ...(next as unknown as StoredSettings), updatedAt: new Date().toISOString() });
  return { settings: result.settings, persisted: result.persisted };
}

/** 单个密钥的对外视图：只有配置态、长度与指纹。 */
export function maskSecret(value: string | undefined | null): PublicSecretView {
  if (typeof value !== 'string' || value.length === 0) {
    return { configured: false, length: 0, digest: null };
  }
  return {
    configured: true,
    length: value.length,
    digest: createHash('sha256').update(value).digest('hex').slice(0, 8),
  };
}

/** 转成可下发给前端的形状（**明文在这一步被彻底丢掉**）。 */
export function toPublicSettings(
  settings: StoredSettings | null,
  options: { authenticated: boolean; envFallback: { zhihu: boolean; model: boolean } },
): PublicSettings {
  return {
    authenticated: options.authenticated,
    zhihuAccessSecret: maskSecret(settings?.zhihuAccessSecret),
    model: {
      apiKey: maskSecret(settings?.modelApiKey),
      baseUrl: settings?.modelBaseUrl ?? null,
      model: settings?.modelModel ?? null,
      jsonMode: settings?.modelJsonMode ?? true,
    },
    updatedAt: settings?.updatedAt && settings.updatedAt.length > 0 ? settings.updatedAt : null,
    envFallback: options.envFallback,
  };
}
