import type { KnowledgeSource } from '@/features/run/knowledgeSource';

/**
 * 真实起点词：从**第一轮检索返回的来源**里抽「这些人是从哪儿来的」。
 *
 * ## 为什么要有它（实测驱动）
 *
 * 放宽层原来只有一个词源：一次模型扩展。实测（2026-09-16，真实接口）发现
 * 模型给的是**抽象标签**——问「电工转导游」它返回「技能型蓝领 / 持证技术工种 /
 * 职业资格转型」，这些词谁都不会写在回答里，于是放宽查询一条都命中不了，
 * 等级分布里 0 条 same-family / same-domain。
 *
 * 而第一轮返回的 40 条候选里，**标题与作者徽章本来就写着真实起点词**：
 * 「机械工程」「电气自动化」「教师」「会计」…… 它们是真人真事里长出来的词。
 *
 * 所以这里把放宽层的词源换成**检索驱动**：先从语料里学词，再去放宽。
 *
 * ## 三条纪律
 *
 * 1. **任何行业都适用**：只做通用的词形切分与频次统计，**不含任何职业 /
 *    专业 / 关系 / 学业清单**（`GENERIC` 里只有"经历、分享、知乎"这类
 *    与领域无关的泛词）。
 * 2. **零模型成本**：纯函数，同输入必得同输出。
 * 3. **学到词不等于放宽门槛**：这些词只用来构造查询；来源是否合格，
 *    仍然由同一套资格审查（相似等级矩阵）决定 —— 抽错了词只是白花一次
 *    查询，不会把无关内容放进经验层。
 */

/** 与领域无关的泛词：它们出现在任何行业里，拿去做查询没有区分度。 */
const GENERIC: ReadonlySet<string> = new Set([
  // 内容形态
  '回答', '问题', '文章', '专栏', '评论', '分享', '经历', '经验', '故事', '记录', '总结', '复盘', '建议',
  // 泛化主体
  '大家', '我们', '自己', '别人', '朋友', '同学', '同事', '孩子', '父母', '家人', '普通人', '年轻人',
  // 动作 / 状态
  '转行', '辞职', '选择', '决定', '开始', '后来', '最后', '结果', '过程', '付出', '代价', '努力',
  '成功', '失败', '后悔', '焦虑', '迷茫', '纠结', '坚持', '放弃', '成长', '改变',
  // 场景泛词
  '工作', '职业', '行业', '专业', '公司', '单位', '企业', '学校', '大学', '毕业', '求职', '面试',
  '工资', '收入', '薪资', '待遇', '发展', '前景', '方向', '路径', '方法', '方式',
  // 平台
  '知乎', '用户', '匿名', '答主', '作者', '博主',
]);

/** 切词用的分隔符（含全角标点与空白）。 */
const SPLITTER = /[^\p{Script=Han}A-Za-z0-9]+/u;

const MIN_TERM = 2;
const MAX_TERM = 8;
/** 同一个词至少出现在几条来源里才算"这一批人的共同起点"。 */
const MIN_SOURCES = 2;

interface Candidate {
  /** 出现次数（同一条来源里重复只算一次）。 */
  count: number;
  /** 是否来自作者徽章 / 签名（身份线索，权重更高）。 */
  fromBadge: boolean;
}

const HAS_HAN = /\p{Script=Han}/u;

function isUsable(term: string): boolean {
  if (term.length < MIN_TERM || term.length > MAX_TERM) return false;
  if (GENERIC.has(term)) return false;
  if (!/[\p{Script=Han}A-Za-z]/u.test(term)) return false;
  return true;
}

/** 一条来源里可用的短语：徽章/签名整段与其中的片段、标题里的片段。 */
function phrasesOf(source: KnowledgeSource): readonly { readonly term: string; readonly badge: boolean }[] {
  const out: { term: string; badge: boolean }[] = [];
  const badgeFields = [source.authorBadge ?? '', source.authorSignature ?? ''];

  for (const raw of badgeFields) {
    const text = raw.trim();
    if (text.length === 0) continue;
    /**
     * 徽章整段只在**没有分隔符**时采用（「机械工程」是身份词）；
     * 带空格的整段（「AI 从业」）要拆成片段，否则会把一整句话当词。
     */
    if (!SPLITTER.test(text)) {
      out.push({ term: text, badge: true });
    }
    for (const part of text.split(SPLITTER)) {
      if (part.length >= MIN_TERM) out.push({ term: part, badge: true });
    }
  }

  const title = (source.title ?? '').trim();
  if (title.length > 0) {
    for (const part of title.split(SPLITTER)) {
      if (part.length < MIN_TERM) continue;
      /**
       * 标题是句子，不是身份声明：**短片段**（≤4 字）本身可能就是词
       * （"土木""会计"），长片段则要切窗 —— "机械工程专业毕业" 里真正
       * 可复用的是"机械工程"这种 4 字词，整句不是词。
       */
      if (part.length <= 4) {
        out.push({ term: part, badge: false });
        continue;
      }
      for (const size of [4, 3, 2]) {
        for (let index = 0; index + size <= part.length; index += 1) {
          out.push({ term: part.slice(index, index + size), badge: false });
        }
      }
    }
  }

  return out;
}

export interface HarvestOriginTermsInput {
  readonly sources: readonly KnowledgeSource[];
  /** 用户的目标词：它出现的地方不算"起点"。 */
  readonly target?: string | null;
  /** 用户自己写下的起点词（如「电工」）：排除，避免自己放宽到自己。 */
  readonly origin?: string | null;
  /** 最多取几个词（默认 3）。 */
  readonly limit?: number;
}

/**
 * 从一轮真实来源里抽「共同起点词」。**纯函数**。
 *
 * 规则：同一个词至少出现在 `MIN_SOURCES` 条来源里（徽章词只要 1 条即可，
 * 因为徽章本身就是身份声明）；排除泛词、目标词、用户自己的起点词；
 * 按（徽章优先 → 出现次数 → 词长 → 字典序）稳定排序。
 */
export function harvestOriginTerms(input: HarvestOriginTermsInput): readonly string[] {
  const limit = Math.max(1, Math.round(input.limit ?? 3));
  const target = input.target?.trim() ?? '';
  const origin = input.origin?.trim() ?? '';

  const stats = new Map<string, Candidate>();
  for (const source of input.sources) {
    const seenInSource = new Set<string>();
    for (const phrase of phrasesOf(source)) {
      const term = phrase.term.trim();
      if (!isUsable(term)) continue;
      if (target.length > 0 && (target.includes(term) || term.includes(target))) continue;
      if (origin.length > 0 && (origin.includes(term) || term.includes(origin))) continue;
      if (seenInSource.has(term)) {
        // 同一条来源里重复出现：只把"徽章"这个更强的信号补上
        if (phrase.badge) {
          const existing = stats.get(term);
          if (existing) existing.fromBadge = true;
        }
        continue;
      }
      seenInSource.add(term);
      const existing = stats.get(term);
      if (existing) {
        existing.count += 1;
        if (phrase.badge) existing.fromBadge = true;
      } else {
        stats.set(term, { count: 1, fromBadge: phrase.badge });
      }
    }
  }

  return [...stats.entries()]
    /**
     * 徽章词只要 1 条来源也采用 —— 但**只对中文词**生效。
     *
     * 实测教训：某条来源的签名里带 "wu fang zhen" 这类拼音，它的碎片被
     * 当成身份词直接进了放宽查询（`wu fang zhen 导游 亲身经历 后来`），
     * 白花一次检索还挤掉了真词。所以拉丁片段必须跨来源重复才算数。
     */
    .filter(([term, value]) => (value.fromBadge && HAS_HAN.test(term)) || value.count >= MIN_SOURCES)
    .sort((left, right) => {
      const [leftTerm, leftValue] = left;
      const [rightTerm, rightValue] = right;
      if (leftValue.fromBadge !== rightValue.fromBadge) return leftValue.fromBadge ? -1 : 1;
      if (rightValue.count !== leftValue.count) return rightValue.count - leftValue.count;
      // 同频时中文优先：中文身份词比拉丁片段更可能是真实起点
      const leftHan = HAS_HAN.test(leftTerm) ? 0 : 1;
      const rightHan = HAS_HAN.test(rightTerm) ? 0 : 1;
      if (leftHan !== rightHan) return leftHan - rightHan;
      if (rightTerm.length !== leftTerm.length) return rightTerm.length - leftTerm.length;
      return leftTerm.localeCompare(rightTerm);
    })
    .slice(0, limit)
    .map(([term]) => term);
}
