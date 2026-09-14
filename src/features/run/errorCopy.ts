/**
 * 面向玩家的错误文案（05_AGENT §9）。
 *
 * ## 为什么单独一层
 *
 * 服务端返回的是**诊断信息**：它必须对开发者可解释（`429 quota-exceeded`、
 * `provider exception`、上游返回了什么），但那句话不该出现在页面上。
 * 玩家需要的是三件事：发生了什么、还能做什么、要不要重试。
 *
 * 所以这里把「错误码 + 服务端消息」翻译成一句人话：
 *
 * ```text
 * quota-exceeded / budget-exhausted  → 今天的公共体验额度暂时用完了。
 * app-provider-unavailable / upstream-* → 这次世界没能继续生成。
 * 其余可读的中文消息 → 原样透出（它本来就是给玩家写的）
 * 含技术词的任何消息 → 一律换成上面那句通用文案，绝不透出
 * ```
 *
 * 技术词检测是**白名单式兜底**：宁可少说一句，也不把 `429 quota exceed`
 * 或堆栈丢到界面上。
 */

export interface PlayerFacingError {
  /** 一句话说清发生了什么。 */
  readonly title: string;
  /** 还能做什么；没有补充时是 null。 */
  readonly hint: string | null;
}

/** §9：没找到可靠经历。 */
export const NO_RELIABLE_EXPERIENCE = {
  title: '这次没找到足够可靠的真实经历。',
  hint: '换一种更具体的说法再试一次。',
  /** 按钮文案（顺序即展示顺序）。 */
  actions: ['修改问题', '重新尝试'],
} as const;

/** §9：AI 暂时不可用。 */
export const AI_UNAVAILABLE: PlayerFacingError = {
  title: '这次世界没能继续生成。',
  hint: '你可以稍后重试。',
};

/** §9：公共体验额度用满。 */
export const PUBLIC_BUDGET_EXHAUSTED: PlayerFacingError = {
  title: '今天的公共体验额度暂时用完了。',
  hint: '你可以稍后再来，或在高级设置中使用自己的模型。',
};

/** 网络层失败（不是服务端语义错误）。 */
export const NETWORK_UNAVAILABLE: PlayerFacingError = {
  title: '网络好像没有连上。',
  hint: '检查一下网络，再试一次。',
};

/** 内容读不出来（会话不存在、链接过期）。 */
export const CONTENT_UNAVAILABLE: PlayerFacingError = {
  title: '这一局已经找不到了。',
  hint: '回到首页重新写下一个困惑，我们会重新编译一次世界。',
};

/**
 * 技术词表：命中就**不**把原话透给玩家。
 *
 * 关键词按「一定会出现在某种技术报错里、且对玩家毫无信息量」来取。
 *
 * ## 2026-09 补的一个真缺口
 *
 * 原来只认英文技术词与数字状态码，于是**本项目自己的错误码形态**
 * （kebab-case，如 `invalid-response` / `missing-story`）能整句漏到页面上 ——
 * `playerFacingError({ message: '提交失败：invalid-response' })` 原样透传。
 *
 * 这类「小写词 + 连字符 + 小写词」在中文文案里几乎不可能自然出现，
 * 所以它是个安全的强信号。`looksLikeErrorCode` 单独导出，便于别处复用。
 */
const TECHNICAL_PATTERN =
  /(429|quota|exceed|provider|exception|ECONN|ETIMEDOUT|timeout|stack|traceback|TypeError|SyntaxError|undefined|null|NaN|\{\s*"|<\w+>|\b[45]\d\d\b)/i;

/** 机器可读的错误码形态：`word-word`（本项目所有内部码都是这个样子）。 */
const ERROR_CODE_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/;

/** 这句话是不是技术报错（含英文错误码 / 堆栈 / JSON 残片 / kebab-case 内部码）。 */
export function looksTechnical(message: string | null | undefined): boolean {
  if (typeof message !== 'string') {
    return false;
  }
  return TECHNICAL_PATTERN.test(message) || ERROR_CODE_PATTERN.test(message);
}

/** 配额 / 额度类错误码：它们都归到同一句公共额度文案。 */
export function isQuotaCode(code: string | null | undefined): boolean {
  return code === 'quota-exceeded' || code === 'budget-exhausted';
}

/** 上游 / 生成类错误码：世界没能继续生成。 */
export function isGenerationCode(code: string | null | undefined): boolean {
  return (
    code === 'app-provider-unavailable' ||
    code === 'upstream-failed' ||
    code === 'upstream-unavailable'
  );
}

/**
 * 服务端错误 → 玩家能读的话。
 *
 * 传入 `undefined` 表示「连错误体都没解析出来」，按网络/生成失败处理。
 */
export function playerFacingError(input: {
  readonly code?: string | null;
  readonly message?: string | null;
}): PlayerFacingError {
  if (isQuotaCode(input.code)) {
    return PUBLIC_BUDGET_EXHAUSTED;
  }
  if (isGenerationCode(input.code)) {
    return AI_UNAVAILABLE;
  }
  if (input.code === 'not-found') {
    return CONTENT_UNAVAILABLE;
  }

  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length > 0 && !looksTechnical(message)) {
    return { title: message, hint: null };
  }
  return AI_UNAVAILABLE;
}
