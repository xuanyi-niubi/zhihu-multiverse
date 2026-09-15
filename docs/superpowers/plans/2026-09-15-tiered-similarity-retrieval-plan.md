# Tiered Similarity Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace weak keyword matching with target-preserving, progressively relaxed retrieval that labels every Zhihu experience by an honest similarity tier.

**Architecture:** Extract exact endpoints with topic-agnostic language patterns, run exact Zhihu retrieval without AI, and request one short cached semantic expansion only when fewer than two qualified exact experiences exist. The validated expansion is reused for relaxed queries, source tiers, counterexample terms, and UI copy.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Vitest 2

**Spec:** `docs/superpowers/specs/2026-09-15-tiered-similarity-retrieval-design.md`

## Global Constraints

- The target occupation remains a hard condition until the final explicitly labelled adjacent-target fallback.
- AI may understand and classify queries but may not create or rewrite Zhihu evidence.
- `ExperienceFact.exactQuote` remains a verbatim source substring.
- `unrelated` sources never enter the experience layer.
- Similar, alternative, and counterexample tracks may remain empty; no quota-filling with weak evidence.
- No new runtime dependency; at most one short model call when exact evidence is insufficient.
- No hard-coded profession, major, relationship, education, or life-decision taxonomy.

---

### Task 1: Transition intent and concept normalization

**Files:**
- Create: `src/features/experience/transitionIntent.ts`
- Modify: `src/features/experience/domain.ts`
- Modify: `src/core/dm/profile.ts`
- Test: `tests/transitionIntent.test.ts`
- Test: `tests/dmProfile.test.ts`

**Interfaces:**
- Produces: `SimilarityTier`, `ConceptTerms`, `TransitionExpansion`, `TransitionIntent`, `buildTransitionIntent(frame, expansion?): TransitionIntent`
- Consumes: existing `ProblemFrame.currentSituation`, `desiredChange`, and `rawQuestion`

- [ ] **Step 1: Write failing intent tests**

```ts
const intent = buildTransitionIntent(frameOf('我是电工专业，然后想转导游'));
expect(intent.origin.exact).toContain('电工');
expect(intent.origin.family).toContain('电气');
expect(intent.origin.domain).toContain('工科');
expect(intent.target.exact).toContain('导游');
expect(intent.target.adjacent).toContain('领队');
expect(intent.transition).toBe('career-change');
```

Also assert unrelated domains such as moving dorms and ending a relationship preserve their own endpoints without any topic catalogue.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npx vitest run tests/transitionIntent.test.ts tests/dmProfile.test.ts`

Expected: FAIL because the generic intent module does not exist.

- [ ] **Step 3: Add domain types and deterministic mappings**

Define:

```ts
export type SimilarityTier =
  | 'exact'
  | 'same-family'
  | 'same-domain'
  | 'same-target'
  | 'adjacent-target'
  | 'unrelated';

export interface ConceptTerms {
  readonly exact: readonly string[];
  readonly family: readonly string[];
  readonly domain: readonly string[];
  readonly adjacent: readonly string[];
}

export interface TransitionIntent {
  readonly origin: ConceptTerms;
  readonly target: ConceptTerms;
  readonly transition: 'career-change' | 'major-change' | 'entry' | 'choice' | 'other';
}
```

Implement generic Chinese transition-pattern extraction and strict expansion normalization. The deterministic path returns exact terms only. Add a model expander with a 4-second timeout, 250-token-oriented prompt, maximum four short terms per tier, generic-word rejection, and a 24-hour normalized-question cache. Extend `extractProfile` with generic background/target captures rather than topic entries.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/transitionIntent.test.ts tests/dmProfile.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/experience/domain.ts src/features/experience/transitionIntent.ts src/core/dm/profile.ts tests/transitionIntent.test.ts tests/dmProfile.test.ts
git commit -m "feat: model tiered transition intent"
```

### Task 2: Progressive query planning

**Files:**
- Modify: `src/features/experience/queryPlan.ts`
- Modify: `src/features/experience/domain.ts`
- Test: `tests/queryPlan.test.ts`

**Interfaces:**
- Consumes: `buildTransitionIntent(frame)`
- Produces: `SearchQuery.expectedTier?: SimilarityTier`

- [ ] **Step 1: Add failing query tests**

Assert deterministic planning initially exposes one exact query. Given a validated expansion, assert the final plan contains exact origin, relaxed origin, alternative, and counterexample queries; every similar query retains the exact target.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/queryPlan.test.ts`

- [ ] **Step 3: Implement target-preserving queries**

Build initial and follow-up candidates from the supplied intent. Add `expectedTier` for diagnostics only, keep unique normalized queries, and keep the hard request cap at four.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/queryPlan.test.ts tests/fullPersonalizedRun.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/experience/domain.ts src/features/experience/queryPlan.ts tests/queryPlan.test.ts tests/fullPersonalizedRun.test.ts
git commit -m "feat: plan progressive experience searches"
```

### Task 3: Independent similarity qualification

**Files:**
- Modify: `src/features/experience/qualification.ts`
- Modify: `src/features/experience/domain.ts`
- Test: `tests/experienceQualification.test.ts`

**Interfaces:**
- Consumes: the resolved open-ended `TransitionIntent` and `SimilarityTier`
- Produces on `SourceQualification`: `similarityTier`, `matchedOriginTerms`, `matchedTargetTerms`

- [ ] **Step 1: Add the tier matrix as failing tests**

```ts
expect(tierOf('我以前是电工，后来转行做了导游')).toBe('exact');
expect(tierOf('我自动化专业毕业，后来转行做导游')).toBe('same-family');
expect(tierOf('我机械专业毕业，后来做了导游')).toBe('same-domain');
expect(tierOf('我原来做会计，后来考证做导游')).toBe('same-target');
expect(tierOf('我工科毕业，后来做了领队')).toBe('adjacent-target');
expect(tierOf('我从程序员转成产品经理')).toBe('unrelated');
```

Also assert a source returned by a `similar-person` query stays unrelated when the source body misses the target.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/experienceQualification.test.ts`

- [ ] **Step 3: Implement hard endpoint gates**

Accept the resolved intent as input and calculate origin and target hits against title, badge, and quote. Require firsthand evidence plus a transition action for similarity tiers. Keep n-gram topic score only as an intra-tier rank signal. Assign narrative track after tier classification, and make `unrelated` ineligible.

- [ ] **Step 4: Run qualification and extraction tests**

Run: `npx vitest run tests/experienceQualification.test.ts tests/experienceExtraction.test.ts tests/experienceQuoteIntegrity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/experience/domain.ts src/features/experience/qualification.ts tests/experienceQualification.test.ts
git commit -m "feat: classify source similarity independently"
```

### Task 4: Tier-first selection and retrieval summary

**Files:**
- Modify: `src/features/experience/retrieve.ts`
- Modify: `src/features/experience/domain.ts`
- Test: `tests/experienceRetrieve.test.ts`

**Interfaces:**
- Produces: `SimilaritySummary { exactCount; bestAvailableTier; widened }` on `RetrieveExperienceResult`
- Consumes: qualified sources from Task 3 and an optional `expandIntent(frame)` callback

- [ ] **Step 1: Add failing selection tests**

Cover zero AI calls when exact returns two qualified people, one AI call when exact is insufficient, cache reuse, fallback from exact to supplied similar/domain terms, rejection of unrelated quota fillers, and `widened: true` when exact is absent.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/experienceRetrieve.test.ts`

- [ ] **Step 3: Replace balanced weak filling with tier-first selection**

Execute exact first. Expand at most once only when exact has fewer than two qualified people, then run remaining queries without exceeding four total. Use the tier order `exact`, `same-family`, `same-domain`, `same-target`, `adjacent-target`; preserve empty tracks and calculate the summary from selected sources.

- [ ] **Step 4: Run retrieval tests**

Run: `npx vitest run tests/experienceRetrieve.test.ts tests/fullPersonalizedRun.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/experience/domain.ts src/features/experience/retrieve.ts tests/experienceRetrieve.test.ts
git commit -m "feat: select highest available similarity tier"
```

### Task 5: Honest service copy and source labels

**Files:**
- Modify: `src/features/decision-session/service.ts`
- Modify: `src/components/visual/ExperienceReveal.tsx`
- Modify: `src/components/session/SessionSourceDialog.tsx`
- Modify: `src/components/game/ExperienceSourceModal.tsx`
- Test: `tests/experienceReveal.test.ts`
- Test: `tests/decisionSession.test.ts`

**Interfaces:**
- Consumes: `SourceQualification.similarityTier` and `RetrieveExperienceResult.similarity`
- Produces: honest retrieval notes and visible tier labels

- [ ] **Step 1: Add failing copy contract tests**

Assert each tier maps to exactly one Chinese label, exact absence produces “没有找到完整同路经历”, and unrelated source text cannot appear in reveal props.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/experienceReveal.test.ts tests/decisionSession.test.ts`

- [ ] **Step 3: Implement shared label mapping and service notes**

Display `完全同路 / 相似起点 / 同类背景 / 相同终点 / 相邻路径`. Include actual matched origin and target terms in details. Distinguish upstream failure, zero candidates, zero qualified people, and widened results.

- [ ] **Step 4: Run the feature test set**

Run: `npx vitest run tests/transitionIntent.test.ts tests/queryPlan.test.ts tests/experienceQualification.test.ts tests/experienceRetrieve.test.ts tests/experienceReveal.test.ts tests/decisionSession.test.ts tests/fullPersonalizedRun.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/decision-session/service.ts src/components/visual/ExperienceReveal.tsx src/components/session/SessionSourceDialog.tsx src/components/game/ExperienceSourceModal.tsx tests/experienceReveal.test.ts tests/decisionSession.test.ts
git commit -m "feat: explain retrieval similarity honestly"
```

### Task 6: Retrieval verification

**Files:**
- Modify only files required by failures attributable to Tasks 1–5

- [ ] **Step 1: Run static verification**

Run: `npm run typecheck`

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`

- [ ] **Step 3: Run production build**

Run: `npm run build`

- [ ] **Step 4: Run main-path smoke test**

Run: `npm run smoke`

- [ ] **Step 5: Confirm the verification task created no uncommitted output**

Run: `git status --short`

Expected: empty. If a feature test required a correction, return to the owning task, rerun its focused test, and commit the exact files listed in that task before repeating this verification task.
