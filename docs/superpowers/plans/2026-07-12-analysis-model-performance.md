# Analysis Model Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy manual Analysis page with canonical market/model performance summaries.

**Architecture:** Reuse `/api/backtest` and the existing History load path. Add pure summary helpers beside existing market display helpers, then render native React/CSS cards and bars. Delete obsolete manual-analysis UI state only where no longer used by Dashboard.

**Tech Stack:** React, TypeScript, CSS, Vitest.

## Global Constraints

- No new endpoint, dependency, chart library, router, or persistence.
- Analysis makes no paid provider request.
- Keep Dashboard and History behavior unchanged.
- ROI is unavailable when no priced rows exist.
- Label missing model versions `legacy-v0`; warn below 30 settled samples.

---

### Task 1: Pure performance summaries

**Files:**
- Modify: `src/marketDisplay.ts`
- Test: `src/marketDisplay.test.ts`

**Produces:** `summarizePerformanceRows(rows, groupBy)` and `predictionDistribution(rows)`.

- [ ] Add failing tests covering market/model grouping, missing model version, missing prices, direction percentages, and empty rows.
- [ ] Run `npx vitest run src/marketDisplay.test.ts`; expect missing exports.
- [ ] Implement structural row helpers using `Map`, existing settlement semantics, and no dependency.
- [ ] Re-run the focused test; expect PASS.

### Task 2: Replace the Analysis page

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Consumes:** `/api/backtest` rows and Task 1 helpers.

- [ ] Keep the full backtest response in state and reuse `loadBacktest()` on Analysis.
- [ ] Delete Analysis-only API controls, manual 1X2 form/list, bankroll/Kelly/stake controls, and legacy results table.
- [ ] Render four market buttons with sample, hit rate, ROI, and priced count.
- [ ] Render selected-market model-version summaries, prediction-direction bars, and market-scoped probability buckets.
- [ ] Add loading, retry, honest empty, ROI-unavailable, and sample-below-30 states.
- [ ] Add responsive CSS using existing color/radius tokens and native bars.

### Task 3: Verification and log

**Files:**
- Modify: `docs/prediction-log.md`

- [ ] Run `npm test` and `npm run build`; expect all pass.
- [ ] Browser-smoke all four market buttons, responsive layout, console, and resource list; expect zero paid provider requests.
- [ ] Record fresh counts and verification in `docs/prediction-log.md`.
