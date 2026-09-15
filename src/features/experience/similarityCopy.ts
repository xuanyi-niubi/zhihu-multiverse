import type { SimilaritySummary, SimilarityTier } from '@/features/experience/domain';

const LABELS: Readonly<Record<SimilarityTier, string>> = {
  exact: '完全同路',
  'same-family': '相似起点',
  'same-domain': '同类背景',
  'same-target': '相同终点',
  'adjacent-target': '相邻路径',
  unrelated: '不相关',
};

export function similarityTierLabel(tier: SimilarityTier): string {
  return LABELS[tier];
}

export function similaritySummaryCopy(summary: SimilaritySummary): string {
  if (summary.bestAvailableTier === null) {
    return '没有找到可核验的相关亲历者。';
  }
  if (!summary.widened) {
    return `找到 ${summary.exactCount} 位完全同路的亲历者。`;
  }
  return `没有找到完整同路经历；已诚实放宽到「${similarityTierLabel(summary.bestAvailableTier)}」。`;
}
