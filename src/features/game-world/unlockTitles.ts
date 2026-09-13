import type { ProviderRouter } from '@/agents/providerRouter';
import type { ExperienceChoiceUnlock } from '@/features/game-world/domain';
import type { ExperienceFact } from '@/features/experience/domain';

/**
 * 经验卡 / 解锁项的**行动式标题**（产品化方案 §24）。
 *
 * ## 为什么需要它
 *
 * 解锁文案是「按『X』的路子先试一小步」，X 原本是原文的**首个小句**。
 * 实测这会把表态句原样搬进来：「按『大一想参加竞赛』的路子先试一小步」——
 * 读起来不像一个可以做的动作。
 *
 * 方案给的样例是「先验证，再下注」「先找人，再开局」——**行动式**的短语。
 * 所以这里让模型给每条真实经历起一个行动式标题。
 *
 * ## 三条纪律
 *
 * 1. **只有标题可以生成**：正文（`description` / `sourceFactIds` / 原文链接）
 *    仍然是逐字片段，一个字都不许动（§36：AI 不可以发明知乎事实）。
 * 2. **失败就是失败**：模型没给、给了数字、太长 → 保留原来的短标签，
 *    不编一个凑数的标题。
 * 3. **数量可控**：只给本局最多 3 条解锁起名，一次调用，不额外增加回合成本。
 */

export interface UnlockTitleInput {
  readonly unlocks: readonly ExperienceChoiceUnlock[];
  readonly facts: readonly ExperienceFact[];
  readonly router: ProviderRouter | null;
}

const TITLE_MAX = 12;
const TITLE_MIN = 2;

const SYSTEM_PROMPT = `你在给「一条真实经历」起一个短标题。

要求：
1. 标题必须是**一个可以做的动作**，不是评价、不是道理、不是结论；
2. 4～10 个字，形如「先验证，再下注」「先找人，再开局」「先留一条退路」；
3. 不得出现数字、百分比、成功率、匹配度、推荐之类的词；
4. 不得出现「你应该」「建议」「最好」这类替你下决定的说法；
5. 输出 JSON：{"titles":[{"id":"...","title":"..."}]}`;

interface Proposal {
  readonly id: string;
  readonly title: string;
}

/** 从模型文本里抠 JSON（沿用 extract 层的宽容策略）。 */
function parseTitles(text: string): readonly Proposal[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { titles?: unknown };
    if (!Array.isArray(parsed.titles)) {
      return [];
    }
    return parsed.titles.flatMap((item) => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      return id && title ? [{ id, title }] : [];
    });
  } catch {
    return [];
  }
}

/** 标题是否可用（长度合适、不含数字与承诺式措辞）。 */
export function isUsableTitle(title: string): boolean {
  const length = [...title].length;
  if (length < TITLE_MIN || length > TITLE_MAX) {
    return false;
  }
  if (/\d|[%％]/.test(title)) {
    return false;
  }
  return !/(成功率|匹配度|推荐|建议|你应该|最好)/.test(title);
}

/**
 * 给本局解锁项补行动式标题。**失败不改动原值**。
 *
 * 返回新的解锁数组（不可变）；模型不可用或标题不可用时就返回原数组。
 */
export async function withUnlockTitles(input: UnlockTitleInput): Promise<readonly ExperienceChoiceUnlock[]> {
  const router = input.router;
  const targets = input.unlocks.slice(0, 3);
  if (!router || targets.length === 0) {
    return input.unlocks;
  }

  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const userContent = JSON.stringify({
    unlocks: targets.map((unlock) => ({
      id: unlock.id,
      // 只给「这条经验是什么」，不给它现在的标签 —— 避免模型照抄片段
      quote: unlock.description.slice(0, 120),
      author: factById.get(unlock.sourceFactIds[0] ?? '')?.author ?? '',
    })),
  });

  let routed;
  try {
    routed = await router.complete(
      'world-simulator',
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { jsonMode: true },
    );
  } catch {
    return input.unlocks;
  }
  if (!routed.ok) {
    return input.unlocks;
  }

  const titles = new Map(
    parseTitles(routed.text)
      .filter((proposal) => isUsableTitle(proposal.title))
      .map((proposal) => [proposal.id, proposal.title]),
  );
  if (titles.size === 0) {
    return input.unlocks;
  }

  return input.unlocks.map((unlock) => {
    const title = titles.get(unlock.id);
    if (!title) {
      return unlock;
    }
    return {
      ...unlock,
      label: title,
      choice: { ...unlock.choice, text: `按「${title}」的路子先试一小步` },
    };
  });
}
