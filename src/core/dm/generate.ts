import { buildDmMessages, buildRepairMessages, type DmTurnInput } from '@/core/dm/prompt';
import { parseDmTurnPayload } from '@/core/dm/parse';
import { extractProfile, normalizeProfile, type PlayerProfile } from '@/core/dm/profile';
import { validateDmTurn, type DmIssue } from '@/core/dm/validate';

import type { DmModelClient } from '@/core/dm/provider';
import type { ScenarioTurn } from '@/data/prebuiltScenarios';

/**
 * AI DM 编排层：把「模型 → 解析 → 校验 → 修复 → 兜底」串成一条**不可能抛异常**的管线。
 *
 * 关键保证：
 * - `generateTurn` 的返回类型里没有失败态——它总会给出一个 `ScenarioTurn`。
 * - 最坏情况回落顺序：模型输出 → 修复轮 → 离线剧本 → 硬编码最小关卡。
 * - 任何未预期异常都被最外层 catch 吸收，并计入 diagnostics。
 */

export type DmSource = 'model' | 'model-repaired' | 'fallback';

export interface DmDiagnostic {
  readonly stage: 'provider' | 'parse' | 'validate' | 'repair' | 'fallback' | 'internal';
  readonly code: string;
  readonly message: string;
}

export interface DmTurnResult {
  readonly turn: ScenarioTurn;
  readonly source: DmSource;
  readonly diagnostics: readonly DmDiagnostic[];
  /**
   * 玩家处境档案。
   * 优先用模型第一回合读出来的；模型没给就回落到确定性解析——两者必有其一。
   */
  readonly profile: PlayerProfile;
}

/**
 * 最后一道硬编码兜底。
 *
 * 当离线剧本本身也读取失败（理论上不可能，但兜底不该有前提假设）时使用。
 * 它必须永远是合法的 ScenarioTurn：a 无检定、b 有检定且带失败分支。
 */
export const MINIMAL_TURN: ScenarioTurn = {
  turnIndex: 1,
  title: '十字路口',
  storyText:
    '你站在一个并不起眼的路口。手机屏幕亮着，消息停在输入框里没有发出去。你知道无论往哪边走，接下来的几个月都会不太一样。',
  zhihuBullet: {
    author: '知乎匿名用户',
    quote: '别急着下结论，先把信息补齐，再决定要不要下注。',
    sourceUrl: 'https://www.zhihu.com',
  },
  choices: [
    {
      id: 'a',
      text: '先按原计划推进，稳住节奏',
      hint: '稳妥：收益有限但风险低',
      ghostEchoStat: '很多人在这一步都会犹豫',
      onSuccess: {
        feedback: '你把手上该做的事继续做完，进度不快，但至少没有被情绪带走。',
        statDeltas: { san: -4, skill: 6 },
      },
    },
    {
      id: 'b',
      text: '推翻原计划，赌一次大的',
      hint: '高危：需要专业力检定',
      ghostEchoStat: '推倒重来，只有少数人敢',
      check: { targetStat: 'skill', difficulty: 12 },
      onSuccess: {
        feedback: '你把旧的方案全部推翻，从零搭了一个新东西，居然真的跑通了。',
        statDeltas: { san: 8, skill: 16 },
      },
      onFail: {
        feedback: '新方案在第三天就卡住了，你花了一整晚收拾残局，心气也掉了一截。',
        statDeltas: { san: -14, skill: 2 },
      },
    },
  ],
};

export interface DmGenerateDeps {
  /** null 表示未配置模型，直接走离线兜底。 */
  readonly client: DmModelClient | null;
  /** 离线剧本兜底：按输入回合取预置关卡。 */
  readonly fallback: (input: DmTurnInput) => ScenarioTurn;
  /** 总轮次，默认 2（首次 + 一次修复）。 */
  readonly maxRounds?: number;
}

function isUsableTurn(turn: unknown): turn is ScenarioTurn {
  if (typeof turn !== 'object' || turn === null) {
    return false;
  }

  const candidate = turn as Partial<ScenarioTurn>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.storyText === 'string' &&
    Array.isArray(candidate.choices) &&
    candidate.choices.length >= 2
  );
}

export async function generateTurn(
  input: DmTurnInput,
  deps: DmGenerateDeps,
): Promise<DmTurnResult> {
  const diagnostics: DmDiagnostic[] = [];

  // 确定性兜底档案：模型没给出可用 profile 时用它
  const fallbackProfile = extractProfile(input.goal);

  const safeFallback = (): ScenarioTurn => {
    try {
      const turn = deps.fallback(input);
      if (isUsableTurn(turn)) {
        return turn;
      }
    } catch (error) {
      diagnostics.push({
        stage: 'fallback',
        code: 'fallback-threw',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return MINIMAL_TURN;
  };

  try {
    if (!deps.client) {
      diagnostics.push({
        stage: 'provider',
        code: 'no-provider',
        message: '未配置模型密钥，直接使用离线剧本与确定性处境解析',
      });
      return {
        turn: safeFallback(),
        source: 'fallback',
        diagnostics,
        profile: fallbackProfile,
      };
    }

    const ctx = {
      turnIndex: input.turnIndex,
      totalTurns: input.totalTurns,
      goal: input.goal,
      snippets: input.zhihuSnippets,
      /**
       * P0-10：蓝图模式把「允许引用的真实经验」交给校验层做逐字基准。
       *
       * 模型可以写出很漂亮但被改写过的引用 —— 那是本产品最不能犯的错。
       * 有基准时，引用不是逐字原文就整条替换（含署名与链接）。
       * 没有蓝图（legacy）时这个字段为空数组，校验行为与此前完全一致。
       */
      exactQuotes:
        input.worldContext?.sourceFacts.map((fact) => ({
          quote: fact.quote,
          author: fact.author,
          sourceUrl: fact.sourceUrl,
        })) ?? [],
    };

    const baseMessages = buildDmMessages(input);
    const maxRounds = Math.max(1, deps.maxRounds ?? 2);

    let previousRaw = '';
    let lastIssues: DmIssue[] = [];

    for (let round = 0; round < maxRounds; round += 1) {
      const messages =
        round === 0 ? baseMessages : buildRepairMessages(input, previousRaw, lastIssues);

      const completion = await deps.client.complete(messages, { jsonMode: true });

      if (!completion.ok) {
        diagnostics.push({
          stage: 'provider',
          code: completion.code,
          message: completion.message,
        });
        break;
      }

      previousRaw = completion.text;

      const parsed = parseDmTurnPayload(completion.text);

      if (!parsed.ok) {
        diagnostics.push({
          stage: 'parse',
          code: parsed.reason,
          message: `解析失败，已尝试策略：${parsed.tried.join(' → ') || '无'}`,
        });
        lastIssues = [];
        continue;
      }

      const validated = validateDmTurn(parsed.payload.value, ctx);

      validated.issues.forEach((issue) => {
        diagnostics.push({
          stage: 'validate',
          code: issue.code,
          message: `${issue.path}: ${issue.message}`,
        });
      });

      if (validated.ok) {
        // 模型第一回合读出的处境档案；没给或不可用则回落确定性解析
        const rawProfile = (parsed.payload.value as { profile?: unknown }).profile;
        const modelProfile = input.profile ?? normalizeProfile(rawProfile);

        if (modelProfile) {
          diagnostics.push({
            stage: 'validate',
            code: 'profile-from-model',
            message: `处境档案：${modelProfile.background} → ${modelProfile.target}`,
          });
        } else {
          diagnostics.push({
            stage: 'validate',
            code: 'profile-fallback',
            message: '没有可用处境档案，已回落到确定性解析',
          });
        }

        return {
          turn: validated.turn,
          source: round === 0 ? 'model' : 'model-repaired',
          diagnostics,
          profile: modelProfile ?? fallbackProfile,
        };
      }

      lastIssues = [...validated.issues];
      diagnostics.push({
        stage: 'repair',
        code: 'retry',
        message: `第 ${round + 1} 轮校验未通过（${lastIssues.length} 个问题），进入修复轮`,
      });
    }

    diagnostics.push({
      stage: 'fallback',
      code: 'fallback-used',
      message: '模型链路不可用，已回退到离线剧本',
    });
    return { turn: safeFallback(), source: 'fallback', diagnostics, profile: fallbackProfile };
  } catch (error) {
    diagnostics.push({
      stage: 'internal',
      code: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
    });
    return { turn: safeFallback(), source: 'fallback', diagnostics, profile: fallbackProfile };
  }
}
