# Phase 1 Task 3 implementation report

## Status

DONE — canonical immutable identities and PostgreSQL repositories for prediction snapshots, results, live odds, and collector state are implemented and verified against the controller-owned real PostgreSQL database.

Only the exact controller tunnel URL was accepted by destructive integration tests. Each test created one schema whose complete name was a generated UUID, validated that name before creation and deletion, and removed only its owned schema. No Docker, SSH, VM/Astra, provider-network, or archive-write action was performed.

## Implementation

- Renamed the pre-existing provider result fallback helper to `providerResultIdentity` and updated its only `server.mjs` consumer without behavior change.
- Added canonical `liveOddsIdentity(entry)` as `provider|matchId|market|selection|finite-line-or-empty`, using exact caller strings and excluding observation time.
- Kept snapshot identity as `matchId|market|finite-line-or-empty|modelVersion-or-legacy-v0`; saved time is deliberately absent. Result identity remains `matchId|market`.
- Added `createSnapshotRepository(pool)`:
  - classifies every row through `shared/snapshot-policy.mjs`;
  - inserts valid-current and legacy rows transactionally;
  - uses `ON CONFLICT DO NOTHING` so the first immutable snapshot wins;
  - returns inserted, duplicate, rejected, and per-reason rejection counts;
  - returns accepted current and legacy raw objects from `listAll()` and only `valid-current` raw objects from `listCurrent()`;
  - keeps invalid rows out of `prediction_snapshots`;
  - stores malformed legacy typed projections as safe nullable values while retaining the complete caller JSON in `raw`.
- Added `createResultRepository(pool)` with transactional, parameterized upserts. A conflict updates only when incoming `source_priority` is strictly greater; equal/lower inputs are ignored. The decision is made by PostgreSQL in the conflict clause, so concurrent writers converge on the highest priority.
- Added `createOddsRepository(pool)` with transactional provider replacement, exact expiry filtering (`expires_at > now`), provider-scoped deletion, and empty-snapshot clearing. A per-provider transaction-scoped advisory lock prevents concurrent disjoint replacements from producing a union. Malformed inserts roll back deletion and all preceding inserts.
- Added `createCollectorStateRepository(pool)` with parameterized key reads and atomic upserted state replacement.
- All repository query methods return the stored `raw` JSON objects, without reconstructing or normalizing caller-visible domain values.

## Files changed

- `server/domain/identity.mjs`
- `server/domain/backtest.test.mjs`
- `server.mjs`
- `server/db/snapshot-repository.mjs`
- `server/db/result-repository.mjs`
- `server/db/odds-repository.mjs`
- `server/db/collector-state-repository.mjs`
- `server/db/repositories.test.mjs`
- `.superpowers/sdd-production-phase1/task-3-report.md`

No migration, snapshot policy, archive, public odds, package, or lock file was changed.

## TDD evidence

### Initial RED

Repository integration command:

```powershell
node --test server/db/repositories.test.mjs
```

Observed result: exit 1 before production implementation with the expected missing-module error:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\server\db\collector-state-repository.mjs'
tests 1; pass 0; fail 1
```

Identity command:

```powershell
node --test server/domain/backtest.test.mjs
```

Observed result: exit 1 because `identity.mjs` did not yet export `providerResultIdentity`. This proved the rename and new identity assertions preceded the implementation.

### Initial GREEN and ordering correction

After minimal repository implementation, five of six repository tests passed. The remaining assertion assumed a `listLive()` order absent from the contract. A temporary production ordering was rejected during controller review; it was removed, and the test now compares entries by stable test key. No ordering contract was added.

The immediate corrected run passed:

```text
tests 6; pass 6; fail 0
```

The domain identity suite also passed `8/8`.

### Independent-review RED

Independent review identified two missing cases. Real PostgreSQL tests were added before either production fix.

Command:

```powershell
node --test --test-name-pattern='legacy rows|concurrent same-provider' server/db/repositories.test.mjs
```

Observed RED:

```text
tests 2; pass 0; fail 2
legacy row: PostgreSQL 22007 invalid timestamptz input "not-a-date"
concurrent provider replacement: expected 100 rows, received a 200-row union
```

Minimal fixes normalized only typed legacy projections to safe nullable database values and acquired a provider-keyed transaction advisory lock before deletion. Raw JSON remained untouched.

Immediate targeted GREEN:

```text
tests 2; pass 2; fail 0
```

The review's Minor cleanup finding was also addressed: test cleanup attempts scoped-pool close, owned-schema drop, and admin-pool close even if an earlier cleanup step fails, retaining the first cleanup error.

## Repository, concurrency, and rollback evidence

Final normal repository run:

```text
node --test server/db/repositories.test.mjs
tests 8; pass 8; fail 0
```

Final serial run:

```text
node --test --test-concurrency=1 server/db/repositories.test.mjs
tests 8; pass 8; fail 0
```

Explicit final concurrency run:

```text
node --test --test-name-pattern='concurrent snapshot inserts|concurrent same-provider' server/db/repositories.test.mjs
tests 2; pass 2; fail 0
```

The integration suite proves:

- twelve concurrent inserts of one snapshot identity produce exactly one insert and eleven duplicates;
- a saved-time-only change is a duplicate and the first raw snapshot remains unchanged;
- a model-version change produces a distinct immutable snapshot;
- repeated batches are idempotent and invalid rows are counted without insertion;
- valid-current and malformed legacy raw rows coexist while `listCurrent()` excludes legacy;
- equal/lower result priority is ignored, higher priority replaces, and concurrent writers converge on the maximum priority;
- provider replacement never deletes another provider and an empty array clears only the named provider;
- an odds row expiring exactly at `now` is excluded;
- a malformed live-odds row rolls back both provider deletion and earlier replacement inserts;
- two disjoint concurrent 100-row snapshots for one provider finish as exactly one complete 100-row snapshot, never a 200-row union or mixture.

## Final baseline gates

All commands below were rerun after the independent-review fixes.

| Command | Result |
| --- | --- |
| `node --test server/db/repositories.test.mjs` | exit 0; 8 passed, 0 failed |
| `node --test --test-concurrency=1 server/db/repositories.test.mjs` | exit 0; 8 passed, 0 failed |
| targeted concurrent repository run | exit 0; 2 passed, 0 failed |
| `node --test server/domain/backtest.test.mjs` | exit 0; 8 passed, 0 failed |
| `node --test server/db/migrate.test.mjs` | exit 0; 14 passed, 0 failed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd test` | exit 0; 22 files passed; 139 tests passed |
| `npm.cmd run check:data` | exit 0; 183 snapshots, 853 results, zero late snapshots/duplicate keys/negative scores; quality 3 current / 93 legacy / 87 invalid |
| `npm.cmd run build` | exit 0; TypeScript check and Vite/PWA production build passed; 1600 modules transformed |
| `npm.cmd audit` | exit 0; `found 0 vulnerabilities` |

No audit auto-fix was run.

## Archive integrity

Final SHA-256 values equal the controller-provided immutable baselines:

| File | Required and final SHA-256 |
| --- | --- |
| `data/prediction-snapshots.jsonl` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` |
| `data/result-archive.jsonl` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` |
| `public/hkjc-odds.json` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` |

## Leftover-schema check

After every final database run, a read-only catalog query selected schema names matching the exact generated UUID-v4 pattern. Result:

```json
[]
```

No UUID integration-test schema remains.

## Review and concerns

The independent reviewer compared the implementation with the Task 3 brief, initial migration, canonical backtest identities, snapshot policy, current server consumer, and integrity checker. The first review reported two Important issues and one Minor issue; all received RED tests and fixes. Focused re-review found no remaining Critical, Important, or Minor issues and assessed the task ready.

Self-review found no unresolved Task 3 correctness issue. The initial review noted nullable stored `source_priority` as a future-context boundary; the formal controller review subsequently defined and verified its semantics in the Formal Review Fix section below.

No provider call or source/archive write occurs in these repositories or tests.

## Formal Review Fix

### Findings addressed

The formal controller review requested three Important fixes and one Minor test-isolation fix. All were implemented:

- Live-odds replacement now validates every entry before opening the write transaction. A present line must be finite, and odds must be positive and finite. `NaN`/infinite lines therefore cannot collapse onto the empty-line identity or be silently serialized as JSON `null`; malformed batches never delete the prior provider snapshot. Accepted entries still store and return their exact raw JSON.
- Result conflict handling now defines a stored `NULL source_priority` as lower than every numeric priority supplied by the repository. The SQL conflict predicate is `stored IS NULL OR incoming > stored`, preserving strict equal/lower numeric behavior and PostgreSQL concurrency safety.
- `listAll()` and `listCurrent()` for snapshots and `listAll()` for results no longer contain `ORDER BY`. Tests sort only their local comparison copies or find by stable keys; no repository ordering contract exists.
- The destructive-test helper now generates and validates its owned UUID identifier first, allocates the admin pool, and immediately registers cleanup before schema creation or scoped-pool setup. Cleanup independently attempts scoped-pool close when allocated, `DROP SCHEMA IF EXISTS` for only the validated owned UUID, and admin-pool close, preserving and rethrowing the first cleanup error after all attempts.

### Strict RED evidence

The PostgreSQL regressions were added before production changes. The focused command, with the exact disposable database URL guard active, was:

```powershell
node --test --test-name-pattern='NULL priority|malformed live row|non-finite live lines' server/db/repositories.test.mjs
```

Exact result summary:

```text
tests 3
pass 0
fail 3
duration_ms 314.595

a numeric result priority updates a directly stored NULL priority
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  actual   { inserted: 0, updated: 0, ignored: 1 }
  expected { inserted: 0, updated: 1, ignored: 0 }

a malformed live row rolls back provider deletion and all replacement inserts
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /positive finite odds/i.
  Input: 'error: new row for relation "live_odds" violates check constraint "live_odds_odds_valid"'

non-finite live lines are rejected without replacing or JSON-coercing the provider snapshot
  AssertionError: Missing expected rejection.
```

This RED proved the repository ignored numeric updates over stored `NULL`, relied on the database rather than explicit odds validation, and accepted a non-finite live line.

### GREEN implementation and output

Minimal production changes were confined to:

- `server/db/odds-repository.mjs` — pre-write domain-field validation for finite present line and positive finite odds;
- `server/db/result-repository.mjs` — explicit stored-`NULL` priority branch and removal of result list ordering;
- `server/db/snapshot-repository.mjs` — removal of snapshot list ordering.

Test-only changes were confined to `server/db/repositories.test.mjs`: the three real PostgreSQL regressions, order-independent comparisons, and immediate robust cleanup registration.

Immediate focused GREEN command:

```powershell
node --test --test-name-pattern='NULL priority|malformed live row|non-finite live lines' server/db/repositories.test.mjs
```

Exact GREEN output:

```text
tests 3
pass 3
fail 0
duration_ms 338.8697
```

The non-finite-line test exercises both `Number.NaN` and `Number.POSITIVE_INFINITY`. After each rejected two-row replacement, it verifies the provider's previous complete two-row raw snapshot remains unchanged.

The nullable-priority test directly inserts a PostgreSQL result row with `NULL source_priority`, then verifies an incoming repository priority of `-100` updates it. Existing equal/lower and concurrent higher-priority tests remain green.

### Final gates after formal fixes

Every required command was rerun after the final production changes:

| Command | Final result |
| --- | --- |
| `node --test server/db/repositories.test.mjs` | exit 0; 10 passed, 0 failed; `duration_ms 1164.4758` |
| `node --test --test-concurrency=1 server/db/repositories.test.mjs` | exit 0; 10 passed, 0 failed; `duration_ms 938.6114` |
| `node --test server/domain/backtest.test.mjs` | exit 0; 8 passed, 0 failed |
| `node --test server/db/migrate.test.mjs` | exit 0; 14 passed, 0 failed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd test` | exit 0; 22 files passed; 139 tests passed |
| `npm.cmd run check:data` | exit 0; 183 snapshots, 853 results, zero late snapshots/duplicate keys/negative scores; quality 3 current / 93 legacy / 87 invalid |
| `npm.cmd run build` | exit 0; TypeScript and Vite/PWA production build passed; 1600 modules transformed |
| `npm.cmd audit` | exit 0; `found 0 vulnerabilities` |

No audit auto-fix was run.

### Final integrity and cleanup evidence

Fresh post-fix SHA-256 values remain unchanged:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `public/hkjc-odds.json`: `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

The final read-only catalog query for exact UUID-v4 schema names returned:

```json
[]
```

### Formal-fix self-review

All formal findings are covered by tests or direct static inspection. Validation runs before provider deletion, so malformed non-finite fields cannot mutate database state or reach JSONB serialization. Accepted JSON-compatible raw values are still stored unchanged. The result predicate handles stored `NULL` without weakening strict numeric priority. No repository query now invents list order. Cleanup is registered before any schema/scoped-pool operation and attempts every teardown action independently.

No unresolved Critical, Important, or Minor concern remains. The exact disposable database guard, UUID-only ownership validation, provider-scoped advisory lock, archive protection, and prohibition on Docker/SSH/VM/provider activity remain unchanged. No Git operation or claim was made.
