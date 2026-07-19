# Task 3 TDD Report: Distinct-match summaries and priced-only ROI

Date: 2026-07-16 (Asia/Shanghai)

## Status

Complete. Frontend and server summaries now select one deterministic representative for each non-empty `market | modelVersion | matchId` identity before calculating performance, direction, market groups, or chance/calibration buckets. ROI includes only selected representatives with finite odds greater than 1.

## Scope and files

Modified only the Task 3 implementation/test files:

- `src/marketDisplay.ts`
- `src/marketDisplay.test.ts`
- `server.mjs`

This report was added at `.superpowers/sdd/task-3-report.md`.

No archive data, snapshot classification/policy, model threshold/parameter, dependency, lockfile, or paid-API code was changed. The workspace is not a valid Git repository, as stated in the brief, so no commit was created.

## TDD chronology and evidence

### Frontend RED

At first inspection, the Task 3 frontend cases were already present in `src/marketDisplay.test.ts`, while `selectDistinctPerformanceRows` did not exist in production. I preserved these test-first cases rather than duplicating them.

Command:

```powershell
npm.cmd test -- --run src/marketDisplay.test.ts
```

Observed RED:

- 13 tests executed; 3 failed and 10 passed.
- Two failures reported `TypeError: selectDistinctPerformanceRows is not a function`.
- The calibration failure showed that both lines for `m1` were still assigned to buckets (`40–49%`, `50–59%`, `80–89%`) instead of selecting the higher-edge line globally first (`50–59%`, `80–89%`).

This was the expected failure mode for the missing feature.

### Frontend GREEN implementation

Implemented the smallest behavior required by the failing tests:

- Extended `PerformanceRow` with optional `edge`, `savedAt`, and `line`.
- Added exported generic `selectDistinctPerformanceRows<T extends PerformanceRow>(rows: T[]): T[]`.
- Grouped only rows with a non-blank `matchId` by the exact identity `${market ?? ""}|${modelVersion ?? ""}|${matchId}`.
- Ranked candidates by:
  1. highest finite `edge`;
  2. earliest valid `savedAt`;
  3. lowest finite numeric `line`;
  4. original input index.
- Preserved rows without a usable match ID as independent rows.
- Preserved selected representatives in stable input order.
- Applied selection before `summarizePerformanceRows`, `predictionDistribution`, and `calibrationBuckets` filtering/bucketing.
- Kept ROI priced-only (`finite odds > 1`) and normalized aggregate frontend profit to avoid binary floating-point artifacts such as `0.7000000000000002`.

The first GREEN attempt correctly exposed two test-fixture compatibility issues: one older assertion still expected duplicate match lines to be counted, and the newly present calibration expectations contained literal corrupted `??` characters instead of an en dash. Those assertions were corrected to the new distinct-match contract. No production behavior was weakened to accommodate them.

Focused GREEN command:

```powershell
npm.cmd test -- --run src/marketDisplay.test.ts
```

Observed GREEN: 1 test file passed; 13/13 tests passed.

Frontend coverage now proves:

- the higher-edge `m1` win is selected over the lower-edge loss;
- `matches === 2` and `finished === 2` for two distinct matches;
- half-loss contributes `-0.5`;
- ROI is `(1.2 - 0.5) / 2`;
- a priced push contributes zero profit but remains in the priced ROI denominator;
- a representative without odds is excluded from priced count and ROI;
- saved-time, numeric-line, and stable-index tie-breaks are deterministic;
- missing match IDs are preserved;
- representative selection occurs globally before calibration buckets.

### Backend RED

Added server self-test rows for one match/model/market with two lines:

- lower edge: loss in the `40–45%` chance bucket;
- higher edge: win in the `80–85%` chance bucket.

The assertions require one finished/priced representative, ROI of 1, one market-group row, and only the higher-edge chance bucket.

Command:

```powershell
npm.cmd run server:self-test
```

Observed RED: process exited 1 at `summarizes one priced representative per match`, proving that the pre-change server counted both lines.

### Backend GREEN implementation

Added the same small selector and comparator semantics to `server.mjs`.

- `summarize()` reduces rows before hit, miss, push, priced-profit, ROI, and yield calculations.
- `groupSummary()` reduces the entire input before applying its grouping key.
- Because chance keys are computed only after this global reduction, a lower-edge line cannot survive merely by landing in a different chance bucket.

Focused GREEN commands and results:

```powershell
npm.cmd test -- --run src/marketDisplay.test.ts
# 13/13 passed

npm.cmd run server:self-test
# [server] self-test passed
```

## Final fresh verification

All verification was rerun after implementation:

```powershell
npm.cmd test
```

- 14 test files passed.
- 76/76 tests passed.
- Exit code 0.

```powershell
npm.cmd run server:self-test
```

- `[server] self-test passed`.
- Exit code 0.

```powershell
npm.cmd run build
```

- TypeScript `--noEmit` check passed.
- Vite production build completed (1,591 modules transformed).
- Exit code 0.

## Requirement checklist

- [x] Exported generic frontend representative selector.
- [x] Exact market/model/match grouping for non-empty match IDs.
- [x] Highest finite edge wins.
- [x] Earliest valid saved time breaks edge ties.
- [x] Numeric line breaks saved-time ties.
- [x] Stable input order is the final tie-break.
- [x] Frontend performance, direction, and calibration consume representatives.
- [x] Calibration selection is global before bucket assignment.
- [x] Server top-level, grouped, and chance-bucket summaries consume representatives.
- [x] ROI uses priced representatives only and preserves half-win, half-loss, push, win, and loss settlement profit rules.
- [x] Focused frontend tests, backend self-test, full suite, and build all pass.
- [x] No prohibited scope changes or dependencies.

## Concerns / handoff notes

- The frontend Task 3 tests existed before implementation began despite the dispatch note saying no Task 3 edits existed. The stored `.superpowers/sdd/task-3-base` confirms they were additions relative to the baseline; TDD ordering was still preserved because they were present and observed failing before production edits.
- The workspace has a `.git` directory entry but Git reports `not a git repository`; therefore there is no status/diff/commit evidence. Review should compare the three scoped files against `.superpowers/sdd/task-3-base` if an exact baseline diff is needed.
- The selector is intentionally duplicated between TypeScript and server JavaScript because the task explicitly requested the same small server-side selector. Future changes to representative ranking must keep both copies aligned.
