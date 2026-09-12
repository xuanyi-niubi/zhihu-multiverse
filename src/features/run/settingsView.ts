/**
 * 密钥配置页的展示逻辑（与页面组件分开，便于单测）。
 *
 * 为什么单独一个文件：Next.js 对 `page.tsx` / `route.ts` 的导出有严格校验，
 * 多导出任何东西都会让 `next build` 失败。
 */

export interface SecretView {
  readonly configured: boolean;
  readonly length: number;
  readonly digest: string | null;
}

/** 模型端点的默认值：默认 DeepSeek，也支持任意 OpenAI 兼容端点。 */
export const DEFAULT_MODEL_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MODEL_NAME = 'deepseek-chat';

/**
 * 状态文案。
 *
 * 三态必须分清，否则用户会以为"填了没用"或"已经在用我的 key"：
 * - 已在此账号配置 → 给长度与指纹（用于核对是不是同一把 key）
 * - 未在此账号配置但环境变量兜底 → 明确说"只读"，避免用户以为能在这里改
 * - 都没有 → 未配置
 */
export function secretStatusText(secret: SecretView, envFallback: boolean): string {
  if (secret.configured) {
    return `已配置 · ${secret.length} 字符 · 指纹 ${secret.digest ?? '未知'}`;
  }
  if (envFallback) {
    return '未在此账号配置（当前使用服务器环境变量，只读）';
  }
  return '未配置';
}
