# ADR 0002: Delete off-path LOO analyzers and orphan client modules

**Date:** 2026-07-25  
**Status:** accepted

## Context

After ADR 0001 (sole unified recommendation engine), several client modules still
looked like live strategy but had zero production callers:

- LOO analyzers: `totals.ts`, `corners.ts`, `marketCalibration.ts`
- Orphan presentation / local snapshot stack: `marketDisplay.ts`,
  `predictionSnapshots.ts` (localStorage + client settle)

App also still ran `analyzeEntries` + `sortFixturesByBestEdge` and re-paired
point-market rows in `liveOddsMapping` after C2 had removed all card consumers.

## Decision

1. **Delete** LOO modules and their unit tests. Model version strings such as
   `totals-loo-v1` remain labels only; they do not invoke LOO math.
2. **Delete** `marketDisplay` and client `predictionSnapshots` runtime.
   `PredictionSnapshot` type lives on `apiClient` for the HTTP save contract.
3. **Production fixtures path** uses `upcomingFixtures` only (kickoff order).
   `normalizeLiveOddsPayload` only builds h2h `entries` for the UI.
4. Keep `oddsApi` / `handicap` / `asianTotals` while collectors still Vite-load
   parsers (C5 / un-Vite is a later deepening).

## Consequences

- Agents no longer treat LOO or local snapshot apply as live buy strategy.
- 即將開賽 / 賽程 ordering is kickoff-based, not edge-based.
- Collector still depends on `src/oddsApi.ts` until live-odds adapters deepen.
