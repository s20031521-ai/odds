# Task 5 Report — UI quality audit and final verification

## Status

DONE. No Git commit is available because the workspace is not a valid Git repository.

## Implemented

- Added `snapshotQualityMessage()` in `src/marketDisplay.ts`.
- Updated `hasPredictionSnapshot()` and `currentModelRows()` so an explicit `snapshotStatus` must be `valid-current`, while rows from an older server without that field remain backward compatible.
- Added `SnapshotQuality` state and runtime shape guard in `src/App.tsx`.
- `loadBacktest()` consumes the additive `/api/backtest.snapshotQuality` field.
- History and Analysis render the isolation summary as a `sample-warning` with `role="status"`.
- Added formatter and snapshot-status compatibility tests in `src/marketDisplay.test.ts`.

## TDD evidence from the original Task 5 implementer

- RED 1: focused market-display run had 1/14 failure: `snapshotQualityMessage is not a function`.
- GREEN 1: minimal formatter implementation produced 14/14 passing.
- RED 2: explicit `snapshotStatus: "invalid"` row was incorrectly accepted; expected false.
- GREEN 2: compatibility filter implementation produced 15/15 passing.
- Initial build exposed two TypeScript shape/narrowing errors; the implementer fixed those before handoff.

## Fresh controller verification on final code

- `npm.cmd test -- --run src/marketDisplay.test.ts`: exit 0; 1/1 file, 15/15 tests passed.
- `node server.mjs --self-test`: exit 0; passed.
- `node scripts/hdc-collector.mjs --self-test`: exit 0; passed.
- `node scripts/odds-monitor.mjs --self-test`: exit 0; passed.
- `node scripts/hkjc-import.mjs --self-test`: exit 0; passed.
- `node scripts/check-data-integrity.mjs`: exit 0; 183 snapshots, 3 valid-current, 93 legacy, 87 invalid; invalid reasons `{"missing-commence-time":87}`.
- `npm.cmd test`: exit 0; 16/16 files, 104/104 tests passed.
- `npm.cmd run build`: exit 0; TypeScript and Vite production build passed (1,591 modules transformed).

## Archive immutability

- `data/prediction-snapshots.jsonl`: 42,922 bytes; SHA-256 `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` — exact baseline match.
- `data/background-hdc-snapshots.jsonl`: 0 bytes; SHA-256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` — exact baseline match.

## Files changed

- `src/App.tsx`
- `src/marketDisplay.ts`
- `src/marketDisplay.test.ts`

## Self-review

- API change is additive and guarded at runtime.
- No archive, model threshold/parameter, dependency, paid API, or write endpoint was touched.
- Browser black-box verification is intentionally left to the controller after independent task review.

## Reviewer-finding follow-up (2026-07-16)

### Status

FIXED. Failed backtest reloads now clear `resultEntries`, `readiness`, and `snapshotQuality` before displaying the existing error. The snapshot-quality runtime guard is exported, used by `App`, and accepts only a non-array object containing nonnegative integer top-level and reason counts. Missing quality data remains backward compatible because it fails the guard and is stored as `null`.

### TDD RED

- Added focused regression tests before production edits for the success-to-failed-load state transition and runtime quality validation.
- Command: `npm.cmd test -- --run src/marketDisplay.test.ts`
- Result: exit 1; 1 file failed; 2 tests failed and 15 passed.
- Expected failures: both desired exports were absent (`clearBacktestResponseState` and `isSnapshotQuality`), reported as `expected undefined to be type of 'function'`.

### TDD GREEN and verification

- Initial focused GREEN: `npm.cmd test -- --run src/marketDisplay.test.ts` exited 0; 17/17 tests passed.
- Initial full Vitest: `npm.cmd test` exited 0; 16/16 files and 106/106 tests passed.
- Initial build correctly caught a TypeScript control-flow narrowing issue around `invalidReasons`; the equivalent explicit null/object/array guard fixed it without changing behavior.
- Final focused verification after test cleanup: `npm.cmd test -- --run src/marketDisplay.test.ts` exited 0; 1/1 file and 17/17 tests passed.
- Final full verification: `npm.cmd test` exited 0; 16/16 files and 106/106 tests passed.
- Final production build: `npm.cmd run build` exited 0; TypeScript and Vite passed, with 1,591 modules transformed.

### Files changed for reviewer findings

- `src/App.tsx`
- `src/marketDisplay.ts`
- `src/marketDisplay.test.ts`
- `.superpowers/sdd/task-5-report.md`

No Git commit was created. No archives, policy, models, dependencies, or APIs were modified. Browser black-box verification remains with the controller as requested.
