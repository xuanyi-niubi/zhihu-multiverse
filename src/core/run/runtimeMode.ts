/**
 * 运行模式（v2 §11 · 三种模式）。
 *
 * 这是**路演稳定性的结构性保证**，不是装饰徽章：
 *
 * | 模式 | 条件 | 能力 |
 * |---|---|---|
 * | `full` | AI Key ✓ + 知乎 Key ✓ | 动态理解 + 实时检索 + 动态叙事 + 确定性裁决 |
 * | `ai`   | 只有 AI Key | 动态叙事，但**重大裁决只用离线规则与已验证数据** |
 * | `demo` | 无 Key | 精调场景 + 固定证据 + 确定性引擎，**保证 100% 可演示** |
 *
 * 三条纪律：
 * 1. **模式由能力决定，不由开关决定** —— 免得出现「配了 key 却还在演示模式」
 *    或「没 key 却宣称在线」这种对评委不诚实的界面。
 * 2. **降级必须是显式的**：`ai` 模式必须在界面明说「当前世界不包含实时知乎证据」。
 * 3. **DEMO MODE 不允许编造真人经历**：它保证的是「离线也能完整走完一局」，
 *    而不是「用假数据把界面填满」。
 */

export type RuntimeMode = 'full' | 'ai' | 'demo';

export interface RuntimeCapability {
  readonly aiKey: boolean;
  readonly zhihuKey: boolean;
}

/** 由能力推导模式。**唯一入口**，任何界面都不要自己拼条件。 */
export function modeOf(capability: RuntimeCapability): RuntimeMode {
  if (capability.aiKey && capability.zhihuKey) {
    return 'full';
  }
  if (capability.aiKey) {
    return 'ai';
  }
  return 'demo';
}

export interface ModeMeta {
  readonly mode: RuntimeMode;
  readonly title: string;
  readonly engine: string;
  readonly evidence: string;
  /** 给玩家/评委看的一句话说明（诚实优先，不吹）。 */
  readonly notice: string;
  /** 该模式下证据是否可用于硬裁决。 */
  readonly evidenceCanJudge: boolean;
}

const META: Readonly<Record<RuntimeMode, Omit<ModeMeta, 'mode'>>> = {
  full: {
    title: '完整平行宇宙',
    engine: '● ONLINE',
    evidence: '● ONLINE',
    notice: 'AI 与知乎证据都已接入：路径来自实时检索，裁决由确定性引擎执行。',
    evidenceCanJudge: true,
  },
  ai: {
    title: '叙事模式（无知乎证据）',
    engine: '● ONLINE',
    evidence: '○ OFFLINE',
    notice:
      '当前世界不包含实时知乎证据，重大裁决只使用离线规则与已验证数据。AI 可以讲故事，但不决定胜负。',
    evidenceCanJudge: false,
  },
  demo: {
    title: '离线演示模式',
    engine: '○ OFFLINE',
    evidence: '○ OFFLINE',
    notice:
      '未配置模型与知乎凭证：本局走离线精调剧本，零延迟、完整可玩。证据网格会如实显示「证据不足」，不会编造真人经历。',
    evidenceCanJudge: false,
  },
};

export function modeMeta(mode: RuntimeMode): ModeMeta {
  return { mode, ...META[mode] };
}

/** 三个引擎指示灯（路演页顶部展示用，v2 §11.1 / §20.1）。 */
export interface EngineLights {
  readonly ai: string;
  readonly zhihu: string;
  readonly world: string;
}

export function engineLights(mode: RuntimeMode): EngineLights {
  const meta = META[mode];
  return {
    ai: `AI ENGINE       ${meta.engine}`,
    zhihu: `ZHIHU EVIDENCE  ${meta.evidence}`,
    // 世界引擎永远就绪：它是纯函数，不依赖任何外部服务
    world: 'WORLD ENGINE    ● READY',
  };
}

/**
 * 降级链（v2 §20.2「双保险」）。
 *
 * 返回从「最理想」到「一定可用」的尝试顺序。
 * 调用方按顺序尝试，第一个成功的即采用 —— 因此**任何外部 API 挂掉都不影响一局完成**。
 */
export function fallbackChain(mode: RuntimeMode): readonly ('live' | 'snapshot' | 'offline')[] {
  if (mode === 'full') {
    return ['live', 'snapshot', 'offline'];
  }
  if (mode === 'ai') {
    return ['snapshot', 'offline'];
  }
  return ['offline'];
}
