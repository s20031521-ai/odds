# Task 2 Report: Backend snapshot quality enforcement

## Status

Complete. Backend writes now accept only `valid-current` prediction snapshots, backtests classify all stored snapshots but settle/readiness-count only valid-current snapshots, and the data-integrity audit prints the canonical snapshot quality summary without modifying archive files.

## Scope and files

- Modified `server.mjs`.
- Modified `scripts/check-data-integrity.mjs`.
- Consumed the existing canonical policy from `shared/snapshot-policy.mjs` without changing it.
- Did not edit any JSON or JSONL archive.
- Did not call any paid API.

## TDD evidence

### Initial required RED

Command: `npm.cmd run server:self-test`

Result: exit 1. The first failure was the expected missing read-time quality output:

```text
TypeError: Cannot read properties of undefined (reading 'validCurrent')
at server.mjs:93:42
```

This confirmed that `buildBacktest()` did not yet expose `snapshotQuality`/`snapshotStatus`.

### Write-policy RED

After adding direct classification and partial-acceptance assertions, the same command failed with:

```text
ReferenceError: partitionIncomingSnapshots is not defined
at server.mjs:90:27
```

This confirmed that reason-counted write partitioning was not yet implemented.

### GREEN

The minimal implementation was then added. The next server self-test exposed old synthetic fixtures with deliberately incomplete fields; those fixtures were converted to valid-current fixtures so existing settlement scenarios remained meaningful under the new policy. No production archive row was rewritten.

## Implementation details

### Read-time classification and backtest filtering

- Imported `classifySnapshot()` and `summarizeSnapshotQuality()`.
- `buildBacktest()` now merges once into `stored`, summarizes `stored`, and filters `usable` to `status === "valid-current"`.
- Only `usable` snapshots participate in settlement and readiness.
- Unmatched result rows remain present and receive no prediction attachment.
- Settled rows copy `edge`, `savedAt`, and `snapshotStatus: "valid-current"`.
- The returned backtest payload includes `snapshotQuality`.

### Write validation

- Every incoming `POST /api/predictions` row is classified by the canonical policy.
- Only valid-current rows are persisted.
- Rejections are counted by canonical reason in `rejectedByReason`.
- Partial acceptance returns `{ saved, rejected, rejectedByReason }`.
- An all-rejected request returns HTTP 400 with `saved: 0`, the rejected count, and reason counts.
- Snapshot merge identity and first-write-wins behavior were not changed.

### Read-only quality audit

`scripts/check-data-integrity.mjs` now prints:

```text
snapshotQualityValidCurrent=<n>
snapshotQualityLegacy=<n>
snapshotQualityInvalid=<n>
snapshotQualityInvalidReasons=<json>
```

The script continues to read files only.

## Verification

### Task-specific checks

`npm.cmd run server:self-test` passed:

```text
[server] self-test passed
```

`npm.cmd run check:data` passed and reported:

```text
snapshots=183
results=853
lateSnapshots=0
duplicateSnapshotKeys=0
duplicateResultKeys=0
negativeScores=0
snapshotsMissingCommenceTime=180 (legacy/backfilled rows may be expected)
snapshotQualityValidCurrent=3
snapshotQualityLegacy=93
snapshotQualityInvalid=87
snapshotQualityInvalidReasons={"missing-commence-time":87}
```

All 180 missing-commence snapshots are excluded from valid-current: 93 are canonical legacy snapshots and 87 are invalid current-model snapshots.

### Broader regression check

`npm.cmd run test` passed after rerunning outside the restricted test sandbox:

```text
Test Files  13 passed (13)
Tests       63 passed (63)
```

## Self-review

- Requirements checked line by line against `.superpowers/sdd/task-2-brief.md`.
- Invalid and legacy snapshots cannot settle or enter readiness summaries.
- Partial and total rejection paths preserve canonical reasons.
- Existing archive merge identity remains unchanged.
- The integrity script performs no writes.
- No unrelated source files were changed.

## Concerns and limitations

- No material implementation concern remains.
- The live HTTP persistence path was not exercised with a real POST because doing so would modify the prediction archive, which this task explicitly prohibited. The partitioning behavior and response counts are covered by the server self-test, and the route uses that tested helper directly.
- This workspace is not a valid Git repository (`fatal: not a git repository`), so no commit was created and commit-based diff/status evidence is unavailable.
