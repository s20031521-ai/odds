# UI Correctness and Accessibility Phase 1 Implementation Plan

> **For Hermes:** Execute with strict TDD and verify in the live browser.

**Goal:** Remove misleading betting states and make the existing UI reliable, responsive, and accessible without redesigning the product.

**Architecture:** Keep market calculations in existing pure modules. Add pure display helpers where behavior needs deterministic tests, then make the smallest JSX/CSS changes. Do not change edge thresholds, exact-line matching, collectors, snapshot identity, or API credentials.

**Tech Stack:** React, TypeScript, Vitest, Vite, CSS.

## Baseline / source of truth
- Market-card truth: `src/oddsApi.ts`, `src/handicap.ts`
- Date grouping: `src/dashboard.ts`
- UI state and rendering: `src/App.tsx`
- Responsive/accessibility styles: `src/styles.css`
- Verification: focused Vitest, full Vitest, production build, live browser console + visual smoke
- Repository constraint: workspace has no `.git`; use file diffs and fresh tests instead of commit gates.

## Hypotheses
1. Live one-bookmaker “buy” is stale frontend code because pure card builders already return `資料不足，唔買`; expose a build marker and regression-test the presentation guard.
2. Date headings differ from card dates because grouping slices UTC input while cards format in Hong Kong local time.
3. History empty flash exists because no loading state is tracked.

## Success criteria
- Cards with fewer than two independent bookmakers cannot render a buy label or edge.
- Fixture group heading and card date use `Asia/Hong_Kong` consistently.
- History displays loading, error with retry, empty, and populated states distinctly.
- Page/market navigation exposes active state to assistive tech and has visible keyboard focus.
- Mobile tabs do not overflow; metadata wraps.
- Empty-state copy describes automatic collection and offers a UI retry.
- Live browser identifies the current build and has no console errors.

## Independent failure signals
- Single-bookmaker test returns any label starting with `買`.
- Hong Kong midnight-boundary fixture groups under its UTC date.
- Loading UI shows the empty/error message before request completion.
- 375px-equivalent CSS lacks wrapping/scroll behavior.
- Browser build marker absent or old.

## Tasks
1. Add RED tests for Hong Kong date grouping and single-bookmaker corner presentation.
2. Implement the smallest pure helper/date fix and run focused tests GREEN.
3. Add History loading/retry and accessible async/navigation semantics in `src/App.tsx`.
4. Update stale empty copy, add HKJC text badge and build marker.
5. Add mobile tab/meta wrapping and focus-visible CSS.
6. Run full tests and production build.
7. Restart/refresh the live frontend, verify build marker, one-bookmaker behavior, all pages, mobile CSS behavior, and browser console.

## Scope decisions
- Phase 2 display aggregation and History snapshot filtering were included after phase 1 evidence exposed the totals label root cause.
- Legacy calculator code was not deleted.
- Snapshot persistence, collectors, credentials, and consensus math were not changed.

## Evidence Log
- RED: focused tests failed on Hong Kong date grouping and the missing single-bookmaker UI guard.
- RED: `src/oddsApi.test.ts` proved `buildTotalsCards` converted insufficient single-bookmaker data into `買大`.
- GREEN: `npm test -- --run` passed 48/48 tests across 13 files.
- Build: `npm run build` passed TypeScript and Vite; emitted `index-xmq5GxL0.js`.
- Browser dashboard: marker `ui-2026.07.11.1`; heading `2026/08/22` matches the first fixture's Hong Kong date.
- Browser History: default filter showed 18 snapshot-backed rows; All showed 565; comparable rows all had model metadata.
- Browser console: zero JavaScript errors and no document-level horizontal overflow in the checked viewport.
- Live totals/corners feeds were empty, so grouped-card rendering is covered by unit tests rather than fabricated browser evidence.
