# Task 4 report: idempotent legacy importer and PostgreSQL parity

Date: 2026-07-18 (Asia/Shanghai)

## Outcome

Implemented the four-file allowlisted legacy importer, import run/physical-row audit ledger, Pool-or-client repository transaction contract, file/DB parity verifier, migration CLI, package scripts, and real-PostgreSQL fixture coverage. No Git repository was initialized and no commit was created or claimed.

## RED evidence

All database RED/GREEN runs used exactly `postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`, with each test owning a generated UUID schema through `search_path` and dropping it in teardown.

1. `node --test scripts/legacy-import.test.mjs`
   - RED: `ERR_MODULE_NOT_FOUND` for `scripts/import-legacy-to-postgres.mjs`.
   - This proved the fixture suite exercised the missing Task 4 interface.
2. `node --test --test-name-pattern='existing client transaction' server/db/repositories.test.mjs`
   - RED: `Client has already been connected. You cannot reuse a client.`
   - This proved the repository test caught the former nested transaction/connect behavior.
3. Malformed-line regression, before the failed-run fix:
   - RED: expected one `{status: 'failed', total_rows: 2}` run, received no run.
4. Domain-corruption parity regression, before the representative comparison:
   - RED: missing expected `parity mismatch: snapshot domain representatives` rejection.
5. `node --test server/db/migrate.test.mjs` after adding migration 002:
   - RED: expected only `001_initial.sql`; actual also included `002_import_row_audit.sql`.
6. Independent-review regressions:
   - completed-run UPDATE guard RED: rerun raised `completed run must not update`;
   - reversed repository-row proxy added for the unordered parity finding and GREEN after canonical sorting;
   - client-side failure after the run lock plus injected rollback failure RED: cleanup order was `['status', 'release']`, not the required `['release', 'status']`.

## GREEN evidence

- `node --test scripts/legacy-import.test.mjs`: 3/3 pass.
- Existing-client focused repository test: 1/1 pass.
- `node --test server/db/repositories.test.mjs`: 11/11 pass.
- `node --test server/db/migrate.test.mjs`: 14/14 pass.
- `node --test server/domain/backtest.test.mjs`: 8/8 pass.

The fixture first import produced:

- 10 nonblank source rows and 10 audit rows;
- snapshot inserted/duplicate/rejected = 3/2/1;
- result inserted/updated/ignored = 2/1/1;
- duplicate snapshot and result canonical identities remained separate physical audit rows;
- the deliberately blank physical line produced source row numbers `[1, 3, 4, 5]`;
- row classifications included valid-current, legacy/legacy-model, and invalid/invalid-odds;
- all four fixture source hashes were identical before and after import.

The same fixture's second import produced 10 source rows, zero audit rows added, and zero snapshot/result additions or updates. Audit row count remained 10.

The failure/retry fixture injected a client-side failure on the second audit insert after the transaction held the run-row lock, then injected rollback failure. It proved the uncertain client was destroyed before a clean pool connection recorded failed status, preserved the primary and rollback errors, left zero domain/audit rows, and retried the same hash/run identity into 2 snapshot inserts and 2 audit rows. A separate malformed nonblank JSON fixture failed twice at physical row 2, retained exactly one failed run with `total_rows=2`, and left both audit/domain tables empty.

## Real archive import and parity

The final real run used disposable schema `0cbe01bf-a673-4335-aaa2-570cca2faea6`; no public-schema destructive operation was used.

First import:

- prediction snapshots: 183 rows, SHA-256 `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`;
- background snapshots: 0 rows, SHA-256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`;
- result archive: 853 rows, SHA-256 `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`;
- background results: 0 rows, SHA-256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`;
- audit rows added: 1,036;
- snapshot inserted/duplicate/rejected: 96/0/87;
- result inserted/updated/ignored: 853/0/0.

Second/current-code rerun:

- all four file statuses: `already-complete`;
- source rows: 1,036;
- audit rows added: 0;
- every snapshot/result inserted/updated/ignored/rejected counter: 0.

Parity returned `status=ok`, 183 snapshot rows, 853 result rows, snapshot quality 3 valid-current / 93 legacy / 87 invalid, 286 distinct backtest-result matches, and 0 settlements for the three current snapshots. `check:data` independently reported 0 late snapshots, 0 duplicate snapshot keys, 0 duplicate result keys, and invalid reasons exactly `{"missing-commence-time":87}`. The disposable schema was dropped; the final UUID/task2-pattern query returned `leftoverDisposableSchemas=0`.

Parity imports and executes the shared `classifySnapshot`, `snapshotIdentity`, `resultIdentity`, and `buildBacktest` functions. It compares source hashes/counts; row identities/classifications/reasons/raw representatives; domain identity sets and stored representatives; valid-current/legacy/invalid totals; result priority representatives; distinct matches; repository-`listCurrent` readiness; settlements; summary hit rate/profit/ROI; market summaries; chance buckets; readiness; and representative backtest rows.

## Source immutability

Before and after hashes were identical:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/background-hdc-snapshots.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `data/background-result-archive.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `public/hkjc-odds.json` (not an import source and never touched): `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

The importer only calls `readFile` on the four allowlisted relative paths and hashes the exact `Buffer` before parsing. It has no source-file write operation.

## Package interfaces

- `npm run db:migrate`
- `npm run db:import:legacy -- --source-root <path>`
- `npm run db:check:parity -- --source-root <path>`

The CLIs print hashes, counts, and statuses only. Their failure path prints only `status=failed`; they never print raw records, database URLs, secrets, or credentials.

## Files

- Added `db/migrations/002_import_row_audit.sql`
- Added `server/db/migrate-cli.mjs`
- Modified `server/db/snapshot-repository.mjs`
- Modified `server/db/result-repository.mjs`
- Modified `server/db/repositories.test.mjs`
- Modified `server/db/migrate.test.mjs`
- Added `scripts/import-legacy-to-postgres.mjs`
- Added `scripts/check-postgres-parity.mjs`
- Added `scripts/legacy-import.test.mjs`
- Modified `package.json`
- Added this report

## Final gates

- `node --test scripts/legacy-import.test.mjs`: 3 pass, 0 fail
- `node --test server/db/repositories.test.mjs`: 11 pass, 0 fail
- `node --test server/db/migrate.test.mjs`: 14 pass, 0 fail
- `node --test server/domain/backtest.test.mjs`: 8 pass, 0 fail
- `npm.cmd test`: 22 files, 139 tests pass
- `npm.cmd run server:self-test`: passed
- `npm.cmd run check:data`: passed with 183/853 and 3/93/87
- `npm.cmd run build`: passed; 1,600 modules transformed
- `npm.cmd audit`: 0 vulnerabilities

## Self-review and concerns

- Accepted current and legacy snapshots are the only rows sent to the snapshot repository; invalid rows exist only in `import_rows`, so they cannot contaminate current repository statistics.
- Results use the repository's strict source-priority upsert semantics, including within and across files.
- Migration 002 removes the global audit-key uniqueness boundary while preserving `(import_run_id, source_row)` as the audit identity and adds a non-unique lookup index plus required `record_kind` check.
- Import migrations must be applied before invoking the importer/parity CLI; the package exposes `db:migrate` explicitly for that purpose.
- No provider, SSH, Docker, VM, Astra, or public-schema operation was performed.
- An independent read-only reviewer initially identified unordered parity, completed-run write, and uncertain-client cleanup issues. Focused RED/GREEN fixes canonicalized parity inputs, changed run creation to `ON CONFLICT DO NOTHING` plus `SELECT`, and destroyed an uncertain client before failed-status recording. The final focused re-review returned `Approved` with no remaining Important issue.

## Formal Review Fix (controller pass)

The formal controller review supplied the RED baseline: concurrent/post-commit run-state exposure, completed rerun statements, primitive JSON loss/domain routing, path escape, CLI leakage/cleanup, helper teardown, and unverified ledger counts were all failing requirements in the reviewed implementation. Focused regression coverage was then added before the final GREEN gate:

- Two concurrent same-file callers now converge under `FOR UPDATE`; summed evidence is exactly one audit addition and one domain insert, with one stored audit row. Final status, counts, and `finished_at` are written inside that transaction before `COMMIT`, hence become visible atomically. The ambiguous-COMMIT regression executes the commit then loses its response: the client is destroyed with the primary error, the run remains complete, retry reports `already-complete`, and audit count stays one.
- Confirmed rollback records failed using the clean transaction client. Rollback uncertainty destroys/releases first, then conditionally records failed from the pool only when prior state is `pending`/`failed`; primary and secondary errors remain attached. The regression uses a real `max:1` PostgreSQL pool and returns without deadlock.
- Completed reruns SELECT the unique identity before any INSERT. Row-level and statement-level `BEFORE INSERT` counters both remain zero, the completed-row UPDATE rejection trigger does not fire, and audit/domain/run values remain unchanged.
- `null`, string, number, and array JSON rows are retained exactly as `jsonb`, classified `invalid-snapshot`/`invalid-result`, assigned deterministic audit-row fallback keys, and excluded from both domain repositories. Importer and parity share `classifyImportedRow`; SQL sends `JSON.stringify(raw)::jsonb`.
- Source root and each allowlisted target are resolved with `realpath`; containment is checked before reading the resolved path. The Windows symlink escape regression is present and was skipped with explicit `symlink privilege unavailable` rather than weakening containment.
- Migration CLI construction, connection, migration, and cleanup failures are sanitized. The credential-bearing child-process regression returns only `status=failed` and excludes URL, username, password, stack text, and workspace path. Importer/parity already use the same generic outer failure path.
- Both Task 4 schema helpers register teardown before schema creation/pool setup, independently attempt pool close, UUID-validated `DROP SCHEMA IF EXISTS`, and admin close, retaining the first cleanup error.
- Parity now validates `accepted_rows` and `rejected_rows` against shared row classifications as well as hash, status, and total count.

Formal-fix GREEN evidence: legacy importer 6 pass / 1 privilege skip; repositories 11/11; migrations 15/15; backtest 8/8; Vitest 139/139; server self-test, data check, build, and audit all passed. Fresh real schema `bac0eef5-f3f0-48c3-97a1-b4afcdc329d0` imported 183/853 with 96 accepted snapshot inserts and 87 rejects; second pass added zero rows; parity returned `ok` at 3/93/87. All five immutable hashes stayed exact and final `leftoverDisposableSchemas=0`. No Git repository or commit was created or claimed.

## Final Formal Re-review Fix

The final review supplied three focused RED requirements. The malformed JSON regression injects a failed-status write failure and proves the caller still receives the original physical-row parse error while `statusUpdateError` retains the secondary failure. The migration CLI regression injects successful migration plus rejected `pool.end()`; before the fix completion could be printed and cleanup swallowed, while GREEN returns code 1, prints only `status=failed`, and emits no complete status or secret/error detail. Primitive fixture expectations now distinguish four snapshot rejects from four result rejects and require parity to report all four invalid snapshot audit classifications.

Implementation changes:

- parse-failure failed-status recording is guarded and attaches secondary failure without replacing the malformed-row error;
- exported `runMigrateCli` accepts injected pool/migration/output dependencies, treats cleanup as part of success, and prints completion only after successful `pool.end()`;
- import results include `resultRejected`; `snapshotRejected` is snapshot-only in file, empty, aggregate, and CLI counts;
- parity snapshot 3/93/87-style counts derive from shared audit classifications, including primitive invalid snapshots, while strict backtest parity remains separate; result audit rows expose `resultRejected`.

Final GREEN evidence: importer 6 pass / 1 Windows symlink-privilege skip; repositories 11/11; migrations 16/16; backtest 8/8; Vitest 139/139; self-test, data check, build, and audit passed. Fresh disposable schema `d21e169c-5684-485e-a47b-108ab23ab824` imported 183 snapshots and 853 results with `snapshotRejected=87`, `resultRejected=0`; rerun added zero; parity returned `ok`, 3/93/87, and `resultRejected=0`. Immutable hashes remained exact and `leftoverDisposableSchemas=0`. No Git repository or commit was created or claimed.
