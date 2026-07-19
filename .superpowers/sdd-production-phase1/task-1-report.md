# Phase 1 Task 1 Report — Extract and freeze file-independent domain behavior

## Implementation

- Extracted the file-independent backtest, health, live-cache, immutable snapshot/result merge, score conversion, and result-selection behavior into `server/domain/backtest.mjs` without changing its formulas, order, readiness branches, settlement branches, snapshot policy, or API response shapes.
- Added `server/domain/identity.mjs` as the canonical owner of the existing snapshot key (`matchId|market|finite-line-or-empty|modelVersion-or-legacy-v0`), result key (`matchId|market`), and existing provider-result persistence key (`id` or `matchId-market`).
- Updated `server.mjs` to import the domain functions and provider identity; its existing `--self-test` assertions remain in place and pass.
- Added Node runner parity coverage for quarter-line settlement, push-hit denominator handling, Asian handicap settlement, distinct-match readiness, current/legacy/invalid classification, immutable versioned snapshots, source priority, identities, cache flattening, score conversion, and health shape.

## Files changed

- Created `server/domain/backtest.mjs`
- Created `server/domain/identity.mjs`
- Created `server/domain/backtest.test.mjs`
- Modified `server.mjs`
- Created this report

## TDD evidence

### RED

Command: `node --test server/domain/backtest.test.mjs`

Result: exit 1. Node raised `ERR_MODULE_NOT_FOUND` for `server/domain/backtest.mjs`, the expected failure before the future extraction module existed.

### GREEN

Command: `node --test server/domain/backtest.test.mjs`

Result: exit 0; 4/4 Node tests passed. After server rewiring, `node --test server/domain/backtest.test.mjs; npm.cmd run server:self-test` exited 0; all 4/4 Node tests passed and printed `[server] self-test passed`.

During rewiring, the original self-test initially exposed one missed moved helper: `ReferenceError: bucket is not defined` at the unchanged self-test’s grouping assertion. Root cause was the helper being extracted but not imported into `server.mjs`; exporting/importing that same unchanged helper fixed the wiring. No behavior branch or formula changed.

## Full verification commands and results

| Command | Result |
| --- | --- |
| `node --test server/domain/backtest.test.mjs` | exit 0; 4 tests passed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd test` | exit 0; 22 files, 139/139 Vitest tests passed |
| `npm.cmd run check:data` | exit 0; snapshots=183, results=853, valid-current=3, legacy=93, invalid=87 (`missing-commence-time`=87), all duplicate/late/negative counters 0 |
| `npm.cmd run build` | exit 0; TypeScript check and production Vite build passed |

## Archive integrity

The read-only baselines were checked before implementation and after all gates; every SHA-256 value is exact and unchanged.

| File | Before | After |
| --- | --- | --- |
| `data/prediction-snapshots.jsonl` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` |
| `data/result-archive.jsonl` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` |
| `public/hkjc-odds.json` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` |

## Self-review and review gate

- Current-file review confirmed `server.mjs` imports all requested domain functions; their prior definitions are absent from that file and present in `server/domain/backtest.mjs`. The domain module delegates every snapshot/result key to `identity.mjs`; `persistResults` delegates its pre-existing provider-result key to `liveOddsIdentity`.
- Re-checked unchanged behaviors through the exact server self-test and parity tests: Asian quarter settlement, push exclusion, representative sorting, readiness status/counts, legacy/current/invalid treatment, result source priority, cache shape, and score conversion.
- No usable Git metadata exists by project constraint, so no Git diff/commit claim is made. Independent-review handoff was sent to the parent reviewer; independent approval is pending and must be recorded by that reviewer before the phase’s review gate is considered approved.

## Concerns

- None in the implementation or verification evidence. The only outstanding process item is the required independent reviewer approval, which the implementer cannot self-approve.

## Fix Review — reviewer findings addressed

### Coverage amended

- Added direct canonical-identity assertions for the empty snapshot line, default `legacy-v0` model version, and `liveOddsIdentity` fallback `${matchId}-${market}`.
- Added extracted-module parity assertions for the inline self-test’s corner and every Asian handicap settlement branch; readiness `upcomingMatches` and `overdueMatches`; stale and missing health source behavior; and detailed snapshot-policy current/legacy/invalid reasons.
- Added direct extracted-module coverage for representative selection order, winning representative, profit, ROI/yield, market group summary, and chance bucket (`80-85%`). `selectDistinctPerformanceRows` is exported only to characterize its pre-existing behavior; its formula and ordering logic are unchanged.
- Removed the unused duplicate `isPredictionSnapshot` helper from `server.mjs`; the extracted module remains the only owner of that merge predicate.

### Assertion-capability RED evidence

To prove a newly added identity fallback assertion can fail, it was temporarily changed (and then fully restored) using `apply_patch`.

Command: `node --test --test-name-pattern "freezes versioned identities" server/domain/backtest.test.mjs`

Result: exit 1, expected `AssertionError`: actual `same-大細波` versus intentionally wrong expected `same`. No production source was mutated; the test expectation was immediately restored to `same-大細波` before GREEN verification.

### GREEN and full verification after fixes

| Command | Result |
| --- | --- |
| `node --test server/domain/backtest.test.mjs` | exit 0; 7/7 Node tests passed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd test` | exit 0; 22 files, 139/139 Vitest tests passed |
| `npm.cmd run check:data` | exit 0; snapshots=183, results=853, valid-current=3, legacy=93, invalid=87 (`missing-commence-time`=87), all duplicate/late/negative counters 0 |
| `npm.cmd run build` | exit 0; TypeScript check and production Vite build passed |

### Archive re-check

| File | SHA-256 after fixes |
| --- | --- |
| `data/prediction-snapshots.jsonl` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` |
| `data/result-archive.jsonl` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` |
| `public/hkjc-odds.json` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` |

### Files amended and self-review

- Amended `server/domain/backtest.test.mjs`, `server/domain/backtest.mjs`, `server.mjs`, and this report.
- Current-file review confirmed the three requested identity branches are asserted directly; all inline self-test settlement/readiness/health/classification behaviors called out by the reviewer are represented in the Node suite; and `rg` found no `isPredictionSnapshot` definition or call remaining in `server.mjs`.
- No Git metadata is available and no commit claim is made. No implementation concerns remain.

## Second Fix Review — final representative tie-break characterization

### Amendments

- Returned `selectDistinctPerformanceRows` to a private function and removed its direct test import/call.
- Added characterization through the existing exported `summarize` interface for equal-edge representatives: earliest `savedAt`, then lowest finite `line`, then original insertion order. Each selected candidate has distinct hit/profit/ROI values, so the existing summary output independently exposes the selected representative.
- Retained the existing edge-descending, market summary, and chance-bucket coverage without comparator changes.

### Tie-break assertion RED evidence

The new earliest-`savedAt` expectation was temporarily changed (and fully restored) with `apply_patch`.

Command: `node --test --test-name-pattern "equal-edge representative" server/domain/backtest.test.mjs`

Result: exit 1, expected `AssertionError`: actual selected summary was `hit=1`, `profit=2`, `roi=2`, `yield=2`; the temporary wrong expectation asserted the later losing row (`hit=0`, `profit=-1`, `roi=-1`, `yield=-1`). The expectation was restored before GREEN; no production logic was changed for the proof.

### GREEN and full verification

| Command | Result |
| --- | --- |
| `node --test server/domain/backtest.test.mjs` | exit 0; 8/8 Node tests passed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd test` | exit 0; 22 files, 139/139 Vitest tests passed |
| `npm.cmd run check:data` | exit 0; snapshots=183, results=853, valid-current=3, legacy=93, invalid=87 (`missing-commence-time`=87), all duplicate/late/negative counters 0 |
| `npm.cmd run build` | exit 0; TypeScript check and production Vite build passed |

### Archive re-check

| File | SHA-256 after final fixes |
| --- | --- |
| `data/prediction-snapshots.jsonl` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` |
| `data/result-archive.jsonl` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` |
| `public/hkjc-odds.json` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` |

### Final self-review

- Confirmed the comparator remains private (`function selectDistinctPerformanceRows`), with no test import or direct call; `summarize` is the sole public observation surface used by the new tie-break tests.
- Confirmed each new equality stage is isolated: identical edge for all cases, identical edge plus timestamps for line ordering, and identical edge/timestamp/line for insertion ordering.
- No Git metadata is available and no commit claim is made. No concerns remain.
