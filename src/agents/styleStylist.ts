import type { StyleDirective, WorldBrief } from '@/agents/types';

/**
 * Style Stylist（规范 §4.2「Style Stylist」）。
 *
 * 只决定**怎么讲**：语气、节奏、篇幅。绝不碰机制。
 *
 * 之所以把它做成确定性函数而不是又一次模型调用：语气本该由世界状态决定
 * （SAN 见底就该绝望），交给模型反而会出现"身体报警却写得欢快"的错位。
 */

export const STYLE_MIN_CHARS = 80;
export const STYLE_MAX_CHARS = 240;

export function directStyle(world: WorldBrief, act?: number): StyleDirective {
  const { san } = world.stats;
  const signals = world.signals.join(' ');

  const tone: StyleDirective['tone'] = san < 25
    ? 'desperate'
    : san < 45 || signals.includes('报警') || signals.includes('压力')
      ? 'tense'
      : act !== undefined && act >= world.totalActs
        ? 'tense'
        : world.relics.length > 0
          ? 'hopeful'
          : 'calm';

  const pace: StyleDirective['pace'] = tone === 'desperate' ? 'fast' : tone === 'calm' ? 'slow' : 'normal';

  // 紧张时句子更短（节奏来自机制，不是随便调的）
  const maxChars = tone === 'desperate' ? STYLE_MIN_CHARS + 60 : tone === 'calm' ? STYLE_MAX_CHARS : STYLE_MAX_CHARS - 40;

  return { tone, pace, maxChars };
}

/** 语气的中文指令，直接拼进 prompt。 */
export function styleInstruction(style: StyleDirective): string {
  const toneText: Record<StyleDirective['tone'], string> = {
    calm: '语气平稳，像深夜的自习室',
    tense: '语气紧绷，句子要短',
    hopeful: '语气里有一次翻盘的机会感',
    desperate: '语气逼近极限，不要安慰读者',
  };
  const paceText: Record<StyleDirective['pace'], string> = {
    slow: '节奏放慢，留出观察空间',
    normal: '节奏正常',
    fast: '节奏急促，一段话推进一个转折',
  };
  return `${toneText[style.tone]}；${paceText[style.pace]}；正文控制在 ${STYLE_MIN_CHARS}–${style.maxChars} 字。`;
}
