import { profileToSummary, type PlayerProfile } from '@/core/dm/profile';

import type { DmModelClient } from '@/core/dm/provider';

/**
 * 终局复盘报告。
 *
 * 对应草稿里的「局终时根据玩家存活轮次与选择偏好，生成《知乎避坑指南》与知乎体锐评」。
 * 与关卡生成不同，这里要的是一段**自由文本**，不需要 JSON，所以不走校验层，
 * 只保留「模型失败 → 确定性模板兜底」这一层保护。
 */

export interface RunReportInput {
  readonly goal: string;
  /** 玩家处境档案；有它时报告会直接引用玩家的约束与恐惧。 */
  readonly profile?: PlayerProfile;
  /** AI 写的处境分析原文，作为报告的主要依据。 */
  readonly analysis?: string;
  readonly originName: string;
  readonly success: boolean;
  readonly survivedActs: number;
  readonly totalActs: number;
  readonly stats: { readonly san: number; readonly skill: number; readonly bond: number };
  readonly choices: readonly { readonly act: number; readonly text: string }[];
  readonly relics: readonly string[];
  readonly sanHistory: readonly number[];
}

export interface RunReportResult {
  readonly text: string;
  readonly source: 'model' | 'fallback';
}

export const REPORT_SYSTEM_PROMPT = `你是知乎平行宇宙的复盘作者。玩家刚走完一局人生推演，你要写一份简短复盘。

要求：
1. 总长 180-260 字，分三段：一句结论 → 关键转折 → 一条具体可执行的避坑建议。
2. 用第二人称，语气像知乎上的学长/学姐，克制、具体、不说教。
3. 必须引用玩家真实走过的幕数与最终属性，不要编造未发生的情节。
4. 避坑建议要落到具体动作（例如「先补一个能讲清楚的项目，再投算法岗」），不要写「要努力」这种空话。
5. 直接输出正文，不要标题、不要 markdown、不要 JSON、不要解释你在做什么。`;

export function buildReportUserMessage(input: RunReportInput): string {
  const choiceLines =
    input.choices.length > 0
      ? input.choices.map((choice) => `第 ${choice.act} 幕：${choice.text}`).join('\n')
      : '（没有记录到明确选择）';

  const relicLine = input.relics.length > 0 ? input.relics.join('、') : '无';
  const profileLine = input.profile ? `\n【玩家处境】${profileToSummary(input.profile)}` : '';
  const analysisLine = input.analysis ? `\n【AI 处境分析】\n${input.analysis}` : '';

  return `【玩家目标】${input.goal || '（未填写）'}${profileLine}${analysisLine}
【出身流派】${input.originName}
【结局】${input.success ? `通关，走完全部 ${input.totalActs} 幕` : `第 ${input.survivedActs} 幕中断（心智归零）`}
【最终属性】SAN ${input.stats.san} / 专业力 ${input.stats.skill} / 羁绊 ${input.stats.bond}
【SAN 曲线】${input.sanHistory.join(' → ')}
【关键选择】
${choiceLines}
【获得遗物】${relicLine}

请写这份复盘。`;
}

/** 确定性兜底：模型不可用时也要给出一份有信息量的复盘。 */
export function buildFallbackReport(input: RunReportInput): string {
  const worstDrop = (() => {
    let index = 0;
    let drop = 0;
    for (let i = 1; i < input.sanHistory.length; i += 1) {
      const delta = input.sanHistory[i - 1] - input.sanHistory[i];
      if (delta > drop) {
        drop = delta;
        index = i;
      }
    }
    return { index, drop };
  })();

  const lastChoice = input.choices[input.choices.length - 1];

  const conclusion = input.success
    ? `你用 ${input.survivedActs} 幕走完了「${input.goal || '这次推演'}」这条路，最终 SAN ${input.stats.san}、专业力 ${input.stats.skill}、羁绊 ${input.stats.bond}。这不是运气，是你没在最难的那一步掉头。`
    : `「${input.goal || '这次推演'}」走到第 ${input.survivedActs} 幕就断了，SAN 归零。不是你不够努力，是你在关键节点上把抗压余量算错了。`;

  const turning = worstDrop.drop > 0
    ? `转折出现在第 ${worstDrop.index} 幕：SAN 一次性掉了 ${worstDrop.drop} 点。${lastChoice ? `那一步你选的是「${lastChoice.text}」。` : ''}这一步本身不算错，错在它没有给你留退路。`
    : `整局的曲线相对平稳，${lastChoice ? `你最后一次选择是「${lastChoice.text}」，` : ''}说明你的节奏控制得住。`;

  const advice = input.stats.skill < 40
    ? '下一步：先把一个能讲清楚的项目做完再投简历。没有可复述的细节，面试官只会记住你的犹豫。'
    : input.stats.bond < 30
      ? '下一步：主动找一位走过这条路的人聊 20 分钟。你的信息缺口比能力缺口更致命。'
      : '下一步：把这次的选择写下来，隔一周再看一遍。能复盘的人，第二局通常不会犯同样的错。';

  // 有处境档案时，把「玩家自己说过的约束/恐惧」接回建议里，让报告贴着人写
  const profileHook = input.profile
    ? `你一开始说的那句「${input.profile.keyTension}」，这一局已经替你先试了一遍。`
    : '';

  return `${conclusion}\n\n${turning}\n\n${profileHook ? `${profileHook}\n\n` : ''}${advice}`;
}

export interface DmReportDeps {
  readonly client: DmModelClient | null;
}

/** 生成复盘；永不抛出，失败时返回兜底模板。 */
export async function generateReport(
  input: RunReportInput,
  deps: DmReportDeps,
): Promise<RunReportResult> {
  const fallback = (): RunReportResult => ({ text: buildFallbackReport(input), source: 'fallback' });

  try {
    if (!deps.client) {
      return fallback();
    }

    const completion = await deps.client.complete(
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: buildReportUserMessage(input) },
      ],
      { jsonMode: false },
    );

    if (!completion.ok) {
      return fallback();
    }

    const text = completion.text.trim();
    if (text.length < 40) {
      return fallback();
    }

    return { text, source: 'model' };
  } catch {
    return fallback();
  }
}
