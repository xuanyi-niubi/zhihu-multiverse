import type { TargetStat } from '@/types/game';

/**
 * 出身流派。
 *
 * 三个流派对应三种「最优策略」，不是单纯的数值高低：
 * - 文科刺客：属性偏软，但跨界检定更容易（DC -2），适合走高风险路线。
 * - 工科狂战士：专业力极高、SAN 极低，自带一件遗物，容错空间小。
 * - 保研边缘游侠：属性均衡、羁绊高，但同辈压力事件的 SAN 伤害放大 50%。
 *
 * 数据是纯静态映射，初始化时一次性写入 RunState，不做运行时计算。
 */

export type OriginId = 'assassin' | 'berserker' | 'ranger';

export interface Origin {
  readonly id: OriginId;
  readonly name: string;
  /** 一句话人设，显示在拨档开关下方。 */
  readonly tagline: string;
  /** 专属旁白，进入第一幕时以系统节拍打出。 */
  readonly openingLine: string;
  readonly stats: { readonly san: number; readonly skill: number; readonly bond: number };
  /** 风险检定 DC 修正：负数 = 更容易通过。 */
  readonly dcModifier: number;
  /** 开局自带遗物 id（对应 RELIC_LIBRARY）。 */
  readonly startingRelicId?: string;
  /** 负向 SAN 伤害倍率。 */
  readonly sanDamageMultiplier: number;
  /** 倍率只对标记了 peerPressure 的选项生效。 */
  readonly peerOnly: boolean;
  /** 拨档开关的强调色。 */
  readonly accent: 'blue' | 'amber' | 'violet';
}

export const ORIGINS: readonly Origin[] = [
  {
    id: 'assassin',
    name: '文科刺客',
    tagline: '底子薄，但跨界这一步比别人轻',
    openingLine: '「你不是这个专业的——所以你不必按他们的规矩来。」',
    stats: { san: 90, skill: 10, bond: 20 },
    dcModifier: -2,
    sanDamageMultiplier: 1,
    peerOnly: false,
    accent: 'blue',
  },
  {
    id: 'berserker',
    name: '工科狂战士',
    tagline: '手上功夫硬，心态是真的脆',
    openingLine: '「你已经把能写的代码都写了，剩下的只是撑住。」',
    stats: { san: 40, skill: 70, bond: 10 },
    dcModifier: 0,
    startingRelicId: 'relic-all-nighter',
    sanDamageMultiplier: 1,
    peerOnly: false,
    accent: 'amber',
  },
  {
    id: 'ranger',
    name: '保研边缘游侠',
    tagline: '什么都会一点，最怕室友的消息',
    openingLine: '「你比谁都清楚，保研线上下浮动的那几分有多要命。」',
    stats: { san: 60, skill: 45, bond: 45 },
    dcModifier: 0,
    sanDamageMultiplier: 1.5,
    peerOnly: true,
    accent: 'violet',
  },
];

export const DEFAULT_ORIGIN_ID: OriginId = 'assassin';

export function getOrigin(id: string | null | undefined): Origin {
  return ORIGINS.find((origin) => origin.id === id) ?? ORIGINS[0];
}

export const ORIGIN_ACCENT: Record<Origin['accent'], { text: string; ring: string; glow: string }> = {
  blue: {
    text: 'text-zhihu-300',
    ring: 'border-zhihu-500/60',
    glow: 'shadow-[0_0_28px_-10px_rgba(0,132,255,0.7)]',
  },
  amber: {
    text: 'text-amber-300',
    ring: 'border-relic-gold/60',
    glow: 'shadow-[0_0_28px_-10px_rgba(245,184,65,0.7)]',
  },
  violet: {
    text: 'text-violet-300',
    ring: 'border-violet-400/60',
    glow: 'shadow-[0_0_28px_-10px_rgba(167,139,250,0.7)]',
  },
};

/** 应用出身到初始属性。 */
export function applyOriginStats(origin: Origin): { san: number; skill: number; bond: number } {
  return { ...origin.stats };
}

/**
 * 计算某次属性变化实际生效的 SAN 伤害倍率。
 * 只有「同辈压力」类选项会吃易伤。
 */
export function sanMultiplierFor(
  origin: Origin,
  isPeerPressure: boolean,
): number {
  if (!origin.peerOnly) {
    return origin.sanDamageMultiplier;
  }
  return isPeerPressure ? origin.sanDamageMultiplier : 1;
}

export const ORIGIN_STAT_LABEL: Record<TargetStat, string> = {
  san: 'SAN',
  skill: '专业力',
  bond: '羁绊',
};
