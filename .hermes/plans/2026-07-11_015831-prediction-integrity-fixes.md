# Prediction Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or inline TDD task-by-task.

**Goal:** Make displayed probabilities, snapshots, result joins, settlement, and History agree with one auditable backend truth.

**Architecture:** Dashboard odds-only cards must not reuse manual demo team stats. Until a per-team stats source exists, they expose de-vig market probability and only produce a pick when cross-book best prices clear the configured edge. Backend owns immutable versioned snapshots and backtests; History consumes `/api/backtest`. Shared market/result keys replace mutable browser-only joins.

**Tech Stack:** React 19, TypeScript, Vitest, Node.js stdlib server/importer.

## Global Constraints

- Ponytail full: smallest root-cause diff, no new dependencies.
- Preserve existing local-first Node/JSONL architecture.
- Do not fabricate team stats, historic picks, odds, or ROI.
- Existing legacy snapshots remain readable as `legacy-v0`; new snapshots use explicit model versions.
- Fresh tests, self-tests, build, live backend probe, and browser History probe must pass.

## Baseline / source of truth

- `src/App.tsx`: card production and History UI.
- `src/odds.ts`: H2H consensus rows.
- `src/totals.ts`, `src/corners.ts`: Poisson manual models.
- `src/predictionSnapshots.ts`: browser snapshot fallback and Asian settlement.
- `server.mjs`: immutable snapshot owner and backtest settlement.
- `scripts/hkjc-import.mjs`: live/historic results and archive.
- Current evidence: 93 snapshots, 93 missing `modelVersion`; backend 3 settled/0 hit/3 miss; static History 0 compared.

## Hypotheses and evidence plan

1. **Shared demo stats cause non-team-specific cards.** Removing `baseInputs` from imported card production should make card probability depend only on its own market odds; changing manual forms must not change cards.
2. **Split settlement implementations cause disagreement.** A shared test matrix for whole/half/quarter lines must give identical frontend/backend settlements.
3. **Browser History is stale because it ignores backend backtest.** Fetching `/api/backtest` should make the browser show the existing three misses.
4. **Unversioned identity prevents reproducibility.** New persisted snapshots must contain `modelVersion`; two versions for the same match/market/line must remain distinct and both settle.
5. **Fixed historic page and ID-only merge lose/copy results.** Pagination must continue until a short/no-new page; archive merge must key by `matchId|market` and prefer fresh corrected rows.

## Success criteria

- Imported totals/corners cards no longer consume `initialTotalsForm` or `initialCornerForm` stats.
- Card copy says `市場` rather than claiming model hit chance.
- Quarter lines settle correctly in frontend and backend; Asian edge includes pushes/half outcomes.
- H2H joins use `matchId`, not team display strings.
- New snapshots include `modelVersion` and provenance; backend keeps distinct versions.
- History uses `/api/backtest` and renders settled state including push/half outcomes.
- Historic importer paginates and stable-key deduplicates.
- Full test/self-test/build and real browser/API probes pass.

## Independent failure signals

- Any existing test regresses.
- Manual form changes still alter imported cards.
- `2.25` splits to `2/3` anywhere.
- Browser History remains all `待對比` while backend has settled rows.
- New snapshot payload lacks `modelVersion` or selected odds.
- Same result appears more than once per `matchId|market` in archive.
- Import loop repeats an unchanged page indefinitely.

## Ablations

- Disable backend: History must show an honest unavailable/error state, not silently recalculate from mutable localStorage.
- Remove per-team stats source: imported cards remain market-only; no demo fallback.
- Legacy snapshot without version: remains readable as `legacy-v0`, but does not collide with new `market-v1`.
- Quarter-line test: old frontend implementation must fail before fix; corrected implementation must pass.

---

### Task 1: Asian settlement and expected value

**Files:** `src/predictionSnapshots.test.ts`, `src/predictionSnapshots.ts`, `src/totals.test.ts`, `src/totals.ts`, `src/corners.test.ts`, `src/corners.ts`, `server.mjs`.

- [x] Add failing quarter-line split and whole-line push/EV tests.
- [x] Run targeted tests and confirm RED.
- [x] Correct `.25/.75` line splitting and calculate side outcome probabilities/fair odds/expected profit.
- [x] Reuse the same semantics in totals and corners analysis; keep half-line behavior unchanged.
- [x] Extend backend self-test for versioned multi-snapshot settlement and hit-rate excluding pushes.
- [x] Run targeted tests and server self-test GREEN.

### Task 2: Honest imported market cards and matchId joins

**Files:** `src/odds.ts`, `src/odds.test.ts`, `src/marketCalibration.ts`, `src/marketCalibration.test.ts`, `src/App.tsx`.

- [x] Add failing tests for `AnalysisRow.matchId` and de-vig market-only card probability helper.
- [x] Run targeted tests RED.
- [x] Add `matchId` to analysis rows and use it for fixture selection/snapshot production.
- [x] Make imported totals/corners cards use only their own prices; remove shared manual form inputs from card generation.
- [x] Change card percentage label to `市場` and keep `唔買` unless real cross-book edge clears threshold.
- [x] Run targeted/full tests GREEN.

### Task 3: Versioned immutable snapshots and backend-owned History

**Files:** `src/predictionSnapshots.test.ts`, `src/predictionSnapshots.ts`, `src/App.tsx`, `server.mjs`.

- [x] Add failing tests/self-tests for modelVersion identity, line-aware local key, and multiple versions settling.
- [x] Run RED.
- [x] Add `modelVersion` and `source`; emit `market-v1` for odds-only cards and `consensus-v1` for H2H.
- [x] Include version in backend snapshot key; normalize missing versions to `legacy-v0`; expand results across matching snapshots.
- [x] Fetch `/api/backtest` on History; remove localStorage as settlement owner.
- [x] Render settlement labels faithfully and show backend unavailable state.
- [x] Run targeted tests and backend/API probe GREEN.

### Task 4: Complete, stable result archive

**Files:** `scripts/hkjc-import.mjs`.

- [x] Extend self-test to prove fresh rows replace stale rows by `matchId|market` and duplicate live/historic IDs collapse.
- [x] Run importer self-test RED.
- [x] Paginate historic results in pages of 20 until short/no-new page with a finite safety cap.
- [x] Merge archive by `matchId|market`, preferring incoming corrected rows.
- [x] Run importer self-test and live import GREEN; verify archive has no duplicate stable keys.

### Task 5: Verification and handoff

**Files:** `docs/prediction-log.md`.

- [x] Run `node server.mjs --self-test`.
- [x] Run `node scripts/hkjc-import.mjs --self-test` and `node scripts/odds-monitor.mjs --self-test`.
- [x] Run `npm test` and `npm run build`.
- [x] Run disposable POST/readback probe for versioned immutable snapshots without corrupting real data.
- [x] Browser smoke Dashboard totals/corners and History; inspect console.
- [x] Independent read-only final review.
- [x] Update prediction log with decisions and fresh evidence.

## Drift check

Before each task, re-read the touched functions. Do not add a team-stat provider, database, router, state library, or Docker work. If a real team-stat source becomes available later, replace `market-v1` with a separately versioned per-match model rather than silently changing it.
