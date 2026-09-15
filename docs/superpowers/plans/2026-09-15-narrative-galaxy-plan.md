# Narrative Galaxy Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restrained, mobile-first celestial background whose state reinforces observation, retrieval, simulation, and the warm-paper return to reality.

**Architecture:** A single semantic SVG component renders deterministic stars, planets, and orbit paths from pure configuration data. Route-level consumers choose a scene and pass real retrieval track states; CSS owns all slow transform/opacity motion and complete reduced-motion fallback, with no animation loop or network asset.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, SVG, CSS, Vitest 2

**Spec:** `docs/superpowers/specs/2026-09-15-tiered-similarity-retrieval-design.md#13-叙事型星系背景`

## Global Constraints

- Mobile first: at most 36 stars, two main orbits, and two visible planets at 360–430px.
- Desktop: at most 72 stars, three main orbits, and three visible planets.
- No `requestAnimationFrame`, timer, pointer listener, external image, font, or runtime request.
- Continuous motion changes only `transform` and `opacity`, with cycles of at least 45 seconds.
- Reduced-motion mode is fully static.
- The warm paper contains no stars; celestial effects remain outside its edge.
- The existing `--sil-*` tokens remain the sole palette source.

---

### Task 1: Celestial scene contract and deterministic geometry

**Files:**
- Create: `src/features/visual/celestial.ts`
- Create: `src/components/visual/CelestialBackdrop.tsx`
- Create: `tests/celestialBackdrop.test.ts`

**Interfaces:**
- Produces: `CelestialScene = 'observatory' | 'retrieving' | 'simulation' | 'returning'`
- Produces: `CelestialTrackState { id: 'similar' | 'alternative' | 'counter'; found: number | null }`
- Produces: `CelestialBackdrop({ scene, tracks?, className? })`

- [ ] **Step 1: Write failing pure-data and source contract tests**

Assert deterministic star arrays, 36 mobile/72 desktop caps, unique coordinates, four scene names, `aria-hidden`, and absence of `requestAnimationFrame`, `setInterval`, `mousemove`, and external URLs.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/celestialBackdrop.test.ts`

- [ ] **Step 3: Implement fixed geometry and semantic SVG**

The component renders one `.sil-celestial` root, separate mobile/desktop star groups, orbit groups, a shaded primary planet, and optional track planets. Track elements use `data-state="pending|hit|empty"` derived only from `found`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/celestialBackdrop.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/visual/celestial.ts src/components/visual/CelestialBackdrop.tsx tests/celestialBackdrop.test.ts
git commit -m "feat: add deterministic celestial backdrop"
```

### Task 2: Visual system CSS and observatory home scene

**Files:**
- Modify: `src/app/silver.css`
- Modify: `src/app/page.tsx`
- Modify: `tests/designSystem.test.ts`
- Modify: `tests/observatory.test.ts`

**Interfaces:**
- Consumes: `CelestialBackdrop scene="observatory"`
- Replaces: overlapping decorative use of `OrbitField` and desktop-only dust on the homepage

- [ ] **Step 1: Add failing style contracts**

Assert the celestial root uses pointer-events none, mobile and desktop caps are expressed by responsive visibility, animations are at least 45 seconds, and both media-query and `html[data-reduce-motion='true']` disable motion.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/designSystem.test.ts tests/observatory.test.ts`

- [ ] **Step 3: Add token-only celestial styling**

Implement radial planet shading, thin elliptical paths, two soft radial-gradient nebula layers, content-area dimming, and transform/opacity-only keyframes. Remove homepage `DUST` and the duplicate full-page `OrbitField`; mount one observatory backdrop behind the existing content grid.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/designSystem.test.ts tests/observatory.test.ts tests/celestialBackdrop.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/silver.css src/app/page.tsx tests/designSystem.test.ts tests/observatory.test.ts
git commit -m "feat: bring celestial depth to observatory"
```

### Task 3: Retrieval state planets in World Forge

**Files:**
- Modify: `src/components/visual/WorldForge.tsx`
- Modify: `src/app/session/[id]/page.tsx`
- Modify: `tests/experienceReveal.test.ts`
- Modify: `tests/pathReveal.test.ts`

**Interfaces:**
- Consumes: existing `ForgeStage[]`
- Maps: similar-person → similar, alternative → alternative, counterexample → counter
- Renders: `CelestialBackdrop scene="retrieving" tracks={...}`

- [ ] **Step 1: Add failing state-mapping tests**

Assert `null` maps to pending, positive counts to hit, zero to empty, and the component does not invent a count or percentage.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/experienceReveal.test.ts tests/pathReveal.test.ts`

- [ ] **Step 3: Mount the retrieval scene**

Put the celestial SVG behind World Forge content, remove its duplicate decorative ring if visually redundant, and keep all textual stage status unchanged and accessible.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/experienceReveal.test.ts tests/pathReveal.test.ts tests/celestialBackdrop.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/visual/WorldForge.tsx src/app/session/[id]/page.tsx tests/experienceReveal.test.ts tests/pathReveal.test.ts
git commit -m "feat: visualize real retrieval orbits"
```

### Task 4: Low-interference simulation and return-to-reality scene

**Files:**
- Modify: `src/components/game/session/SessionPlayScreen.tsx`
- Modify: `src/components/game/session/SessionEndgameScreen.tsx`
- Modify: `src/components/visual/RealityPass.tsx`
- Modify: `tests/sessionPlayScreen.contract.test.ts`
- Modify: `tests/sessionEndgameView.test.ts`

**Interfaces:**
- Consumes: `CelestialBackdrop scene="simulation"` for active acts
- Consumes: `CelestialBackdrop scene="returning"` outside the warm report paper

- [ ] **Step 1: Add failing layout contracts**

Assert simulation uses a subdued celestial scene, endgame uses returning, the background is outside the Reality Pass paper, and the paper retains its existing warm classes and identity signature.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/sessionPlayScreen.contract.test.ts tests/sessionEndgameView.test.ts`

- [ ] **Step 3: Integrate the two scenes**

Replace duplicate high-density `OrbitField` usage with one simulation backdrop. Wrap, but do not place inside, Reality Pass with a returning backdrop whose central mask leaves the paper clean.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/sessionPlayScreen.contract.test.ts tests/sessionEndgameView.test.ts tests/realityQuestView.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/game/session/SessionPlayScreen.tsx src/components/game/session/SessionEndgameScreen.tsx src/components/visual/RealityPass.tsx tests/sessionPlayScreen.contract.test.ts tests/sessionEndgameView.test.ts
git commit -m "feat: carry galaxy through the final return"
```

### Task 5: Responsive and production verification

**Files:**
- Modify only files required by failures attributable to Tasks 1–4

- [ ] **Step 1: Run type and feature tests**

Run: `npm run typecheck && npx vitest run tests/celestialBackdrop.test.ts tests/designSystem.test.ts tests/observatory.test.ts tests/pathReveal.test.ts tests/sessionPlayScreen.contract.test.ts tests/sessionEndgameView.test.ts`

- [ ] **Step 2: Run the full suite**

Run: `npm run test`

- [ ] **Step 3: Build and record route sizes**

Run: `npm run build`

Expected: build succeeds and homepage First Load JS increases by no more than 5KB gzip compared with the current 103KB baseline recorded in the spec context.

- [ ] **Step 4: Verify mobile widths and reduced motion**

Render the home, retrieval, simulation, and endgame states at 360×800, 390×844, and 430×932. Confirm no horizontal overflow, no bright planet behind body text, and static geometry under reduced motion.

- [ ] **Step 5: Run smoke test**

Run: `npm run smoke`

- [ ] **Step 6: Confirm the verification task created no uncommitted output**

Run: `git status --short`

Expected: empty. If mobile verification required a correction, return to the owning task, rerun its focused test, and commit the exact files listed there before repeating this verification task.
