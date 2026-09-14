import type {
  ProblemFrame,
  QualificationTrack,
  RetrievedExperienceSource,
  SearchPlan,
  SearchPurpose,
  SourceQualification,
} from '@/features/experience/domain';
import { qualifyExperienceSource } from '@/features/experience/qualification';
import type { KnowledgeSource } from '@/features/run/knowledgeSource';

export const MAX_EXPERIENCE_SOURCES = 12;
export const RETRIEVAL_CONCURRENCY = 2;

export type ExperienceSearch = (
  query: string,
  count?: number,
) => Promise<readonly KnowledgeSource[]>;

export interface RetrieveRun {
  readonly queryId: string;
  readonly query: string;
  readonly purpose: SearchPurpose;
  readonly sourceCount: number;
  readonly status: 'ok' | 'empty' | 'failed';
}

export interface RetrieveExperienceResult {
  readonly sources: readonly RetrievedExperienceSource[];
  readonly runs: readonly RetrieveRun[];
  readonly rawSourceCount: number;
  readonly rejectedCount: number;
}

function sameSource(left: KnowledgeSource, right: KnowledgeSource): boolean {
  return left.id === right.id || left.url === right.url;
}

interface Accumulator {
  readonly source: KnowledgeSource;
  readonly purposes: SearchPurpose[];
  readonly matchedQueryIds: string[];
}

interface QualifiedAccumulator extends Accumulator {
  readonly qualification: SourceQualification;
}

const TRACK_CAP: Readonly<Record<QualificationTrack, number>> = {
  similar: 3,
  adjacent: 2,
  alternative: 2,
  counter: 2,
};

function authorKey(source: KnowledgeSource): string {
  const author = source.author.trim().toLowerCase();
  return author && author !== '匿名用户' ? author : source.id;
}

function compareLegacy(left: Accumulator, right: Accumulator): number {
  if (right.purposes.length !== left.purposes.length) return right.purposes.length - left.purposes.length;
  const authorityGap = rank(right.source.authority) - rank(left.source.authority);
  if (authorityGap !== 0) return authorityGap;
  const upvoteGap = rank(right.source.upvotes) - rank(left.source.upvotes);
  if (upvoteGap !== 0) return upvoteGap;
  const freshnessGap = rank(right.source.editTime) - rank(left.source.editTime);
  if (freshnessGap !== 0) return freshnessGap;
  return left.source.id.localeCompare(right.source.id);
}

function compareQualified(left: QualifiedAccumulator, right: QualifiedAccumulator): number {
  if (right.qualification.rankScore !== left.qualification.rankScore) {
    return right.qualification.rankScore - left.qualification.rankScore;
  }
  return compareLegacy(left, right);
}

function selectBalanced(items: readonly QualifiedAccumulator[]): readonly QualifiedAccumulator[] {
  const selected: QualifiedAccumulator[] = [];
  const seenAuthors = new Set<string>();
  const order: readonly QualificationTrack[] = ['similar', 'alternative', 'counter', 'adjacent'];

  for (const track of order) {
    let count = 0;
    for (const item of items) {
      if (item.qualification.assignedTrack !== track || count >= TRACK_CAP[track]) continue;
      const author = authorKey(item.source);
      if (seenAuthors.has(author)) continue;
      selected.push(item);
      seenAuthors.add(author);
      count += 1;
    }
  }
  return selected.slice(0, MAX_EXPERIENCE_SOURCES);
}

export async function retrieveExperienceSources(input: {
  readonly plan: SearchPlan;
  readonly search: ExperienceSearch;
  /** 有 frame 才启用人物资格审查；省略时保留旧调用兼容行为。 */
  readonly frame?: ProblemFrame;
}): Promise<RetrieveExperienceResult> {
  const runs: RetrieveRun[] = [];
  const merged: Accumulator[] = [];
  const queries = input.plan.queries;

  for (let start = 0; start < queries.length; start += RETRIEVAL_CONCURRENCY) {
    const batch = queries.slice(start, start + RETRIEVAL_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (query) => {
        try {
          const found = await input.search(query.query);
          return { query, found, failed: false };
        } catch {
          return { query, found: [] as readonly KnowledgeSource[], failed: true };
        }
      }),
    );

    for (const { query, found, failed } of results) {
      runs.push({
        queryId: query.id,
        query: query.query,
        purpose: query.purpose,
        sourceCount: found.length,
        status: failed ? 'failed' : found.length > 0 ? 'ok' : 'empty',
      });

      for (const source of found) {
        const existing = merged.find((item) => sameSource(item.source, source));
        if (existing) {
          if (!existing.purposes.includes(query.purpose)) existing.purposes.push(query.purpose);
          if (!existing.matchedQueryIds.includes(query.id)) existing.matchedQueryIds.push(query.id);
          continue;
        }
        merged.push({ source, purposes: [query.purpose], matchedQueryIds: [query.id] });
      }
    }
  }

  if (!input.frame) {
    const sources = merged.sort(compareLegacy).slice(0, MAX_EXPERIENCE_SOURCES).map((item) => ({
      source: item.source,
      purposes: [...item.purposes],
      matchedQueryIds: [...item.matchedQueryIds],
    }));
    return { sources, runs, rawSourceCount: merged.length, rejectedCount: 0 };
  }

  const qualified: QualifiedAccumulator[] = merged.map((item) => ({
    ...item,
    qualification: qualifyExperienceSource({
      source: item.source,
      frame: input.frame!,
      purposes: item.purposes,
    }),
  }));
  const eligible = qualified.filter((item) => item.qualification.eligibleAsCase).sort(compareQualified);
  const selected = selectBalanced(eligible);
  const sources: readonly RetrievedExperienceSource[] = selected.map((item) => ({
    source: item.source,
    purposes: [...item.purposes],
    matchedQueryIds: [...item.matchedQueryIds],
    qualification: item.qualification,
  }));

  return {
    sources,
    runs,
    rawSourceCount: merged.length,
    rejectedCount: merged.length - selected.length,
  };
}

function rank(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}
