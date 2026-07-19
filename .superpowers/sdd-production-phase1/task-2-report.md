# Phase 1 Task 2 implementation report

## Status

DONE — the isolated PostgreSQL 18 test harness, exact initial schema, server configuration loader, pool/transaction helper, and migration runner are implemented and verified.

The controller-provided tunnel was used throughout. The database reported PostgreSQL `18.4 (Debian 18.4-1.pgdg12+1)`. No local Docker command, SSH command, VM change, Astra access, or provider call was made.

## Implementation

- Added the specified PostgreSQL 18 test-only Compose service bound to `127.0.0.1:55432`, with the required health check and PostgreSQL 18 tmpfs path `/var/lib/postgresql`.
- Installed only the approved runtime dependencies: `pg@8.22.0` and `@node-rs/argon2@2.0.2`. The lockfile resolves those exact versions.
- Added `loadServerConfig(env)` with fail-closed validation for a PostgreSQL database URL, a UTF-8 session secret of at least 32 bytes, and a pathless/credential-free HTTPS public origin. Validation errors identify the setting without echoing its value.
- Added `createPool(databaseUrl)` using `pg.Pool` and `withTransaction(pool, callback)` using `BEGIN`, `COMMIT`, and `ROLLBACK`. If rollback itself fails, the primary error is preserved and the contaminated client is destroyed through `release(error)`.
- Added `runMigrations(pool, migrationsDir)`. It reads only regular `.sql` files, sorts by filename, hashes exact UTF-8 contents with SHA-256, stores the hash in `schema_migrations`, rejects checksum drift, rejects migrations inserted before recorded lexical history, and applies each migration transactionally.
- The runner holds a PostgreSQL advisory lock on one dedicated client across ledger creation and the complete migration pass. Concurrent runners therefore serialize. Rollback/unlock failures preserve the primary failure and destroy the affected connection rather than returning transaction- or lock-contaminated state to the pool.
- Added the specified ten-table initial schema (including `schema_migrations`), primary/foreign/unique constraints, JSONB raw data, explicit persisted classification fields, and PostgreSQL-safe checks rejecting non-positive/non-finite odds and out-of-range/non-finite chance values.
- Integration tests use real PostgreSQL and a fresh UUID-named schema per test. The database guard requires the exact controller-provided disposable `odds_test` endpoint. Cleanup drops only the owned schema; final inspection found zero `task2_%` schemas.

## Files changed

- `compose.test.yaml` — isolated PostgreSQL 18 test service.
- `db/migrations/001_initial.sql` — exact initial schema and numeric checks.
- `server/config.mjs` — validated server configuration loader.
- `server/db/pool.mjs` — `pg.Pool` factory and transaction helper.
- `server/db/migrate.mjs` — serialized, checksummed, transactional migration runner.
- `server/db/migrate.test.mjs` — real PostgreSQL integration/config tests.
- `package.json` — two approved runtime dependencies.
- `package-lock.json` — npm-generated dependency lock updates.
- `.superpowers/sdd-production-phase1/task-2-report.md` — this report.

The completed Task 1 domain files were not altered.

## Dependency installation and audit

Command:

```powershell
npm.cmd install pg@8.22.0 @node-rs/argon2@2.0.2
```

Relevant output:

```text
added 16 packages, and audited 400 packages in 2s
found 0 vulnerabilities
```

Final audit command (no auto-fix was run):

```powershell
npm.cmd audit
```

Final output: `found 0 vulnerabilities` (exit 0). There are no unresolved low, moderate, high, or critical advisories.

## TDD evidence

For every database command below, `DATABASE_URL` was set to the controller-provided disposable tunnel URL. Its value is not repeated in command output. The test `SESSION_SECRET` is non-production, at least 32 bytes, and was never printed. `PUBLIC_ORIGIN` was `https://odds.ballballchu.com.hk`.

### Initial RED

Command:

```powershell
node --test server/db/migrate.test.mjs
```

Result: exit 1. The expected missing-production-module failure occurred before implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\server\config.mjs'
tests 1; pass 0; fail 1
```

### Initial GREEN

After the minimal config/pool/runner/schema implementation, the first execution reached PostgreSQL. Six tests passed and the schema-introspection assertion exposed a test-only PostgreSQL `name[]` parsing mismatch; casting the aggregate to `text[]` corrected the test without changing production code. The immediate rerun passed:

```text
tests 7; pass 7; fail 0
```

### Independent-review RED/GREEN

The first independent review identified concurrent-runner serialization, historical lexical ordering, exact disposable-DB guarding, and rollback-error preservation. Tests were added before fixes.

RED command:

```powershell
node --test server/db/migrate.test.mjs
```

Relevant RED output:

```text
tests 10; pass 7; fail 3
concurrent runner: PostgreSQL 23505 duplicate object/ledger race
historical ordering: Missing expected rejection
rollback cleanup: original error was replaced by connection cleanup failure
```

After advisory locking, monotonic history validation, the exact test-URL guard, and primary-error preservation, the focused suite passed `10/10`.

The targeted re-review then identified that rollback/unlock failures needed to destroy rather than normally release clients. Two deterministic cleanup assertions were added first.

Second RED output:

```text
tests 11; pass 9; fail 2
expected release(error), received release() for rollback and unlock failure paths
```

Final GREEN command:

```powershell
node --test server/db/migrate.test.mjs
```

Final output:

```text
tests 11
pass 11
fail 0
duration_ms 883.3722
```

## Migration rerun and failure evidence

The final integration suite proves all of the following against PostgreSQL 18.4:

- lexical application order (`002_first.sql`, then `010_second.sql`) despite reverse file creation order;
- non-SQL files are ignored;
- a 64-character lowercase SHA-256 is recorded for each migration;
- an unchanged rerun returns no applied versions and does not repeat data writes;
- changed content for an applied filename is rejected while the original ledger row remains;
- two simultaneous runners serialize: one applies the migration, the other observes it as already applied, and the ledger has one row;
- adding `005_earlier.sql` after recorded `010_later.sql` is rejected and not recorded;
- SQL that creates an object and then fails rolls the object back and leaves no migration ledger row;
- advisory-unlock or rollback cleanup failure destroys the client while preserving the primary error;
- the initial migration reruns idempotently and exposes the specified tables and unique constraints;
- invalid zero/infinite odds and invalid chance values fail database check constraints.

## Final baseline gates

All commands were rerun after the final code changes with `DATABASE_URL` set to the tunneled test database.

| Command | Result |
| --- | --- |
| `node --test server/db/migrate.test.mjs` | exit 0; 11 passed, 0 failed |
| `npm.cmd test` | exit 0; 22 files passed; 139 tests passed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd run check:data` | exit 0; 183 snapshots, 853 results, 0 late snapshots, 0 duplicate keys, 0 negative scores; quality 3 current / 93 legacy / 87 invalid |
| `npm.cmd run build` | exit 0; TypeScript check passed; Vite transformed 1600 modules and completed the production/PWA build |
| `npm.cmd audit` | exit 0; 0 vulnerabilities |

## Archive integrity

| File | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `data/prediction-snapshots.jsonl` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` | `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA` |
| `data/result-archive.jsonl` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` | `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424` |
| `public/hkjc-odds.json` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` | `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E` |

## Review and concerns

Independent review covered schema constraints, checksum drift, lexical history, concurrent migration execution, transaction and cleanup failure behavior, exact test database isolation, secret-safe validation, test-only port binding, dependency versions, and archive write risk. After two fix/re-review rounds, the reviewer approved the implementation with no remaining Critical, Important, or Minor findings.

Self-review found no unresolved Task 2 correctness concern. The Compose service was inspected rather than launched because the controller explicitly prohibited local Docker use for this task; equivalent integration behavior was exercised against the controller-owned PostgreSQL 18.4 test container through the tunnel. No test schemas remain.

## Formal Review Fix

### Findings addressed

The formal controller review requested two Important fixes and two Minor coverage extensions. All were addressed:

- `runMigrations` now compares every recorded ledger version with the complete current `.sql` filename set and rejects any recorded migration missing from the supplied directory. Existing checksum-drift and historical out-of-order rejection remain intact.
- Advisory-lock acquisition is marked uncertain before the query. If the server may have acquired the lock but its response is lost, the dedicated client is destroyed through `release(error)` so connection close releases any possible session lock.
- Transaction state is marked uncertain before `BEGIN`. If `BEGIN` may have succeeded but its response is lost, the dedicated client is destroyed rather than returned with a possible open transaction.
- A confirmed `BEGIN` followed by ordinary SQL failure still performs `ROLLBACK`; if rollback and advisory unlock are confirmed, the connection is proven clean and released normally. Ambiguous commit, failed rollback, and failed unlock paths remain destructive.
- Initial-schema assertions now cover both required foreign keys, every brief-specified column type and nullability boundary, and explicit PostgreSQL `NaN` rejection for prediction odds/chance and live odds.
- Configuration regression coverage now proves an invalid `DATABASE_URL` containing credentials is never echoed by the thrown error.

### Strict RED evidence

The production regressions were added before changing `server/db/migrate.mjs`. With `DATABASE_URL` set to the exact controller-provided disposable tunnel URL, the command was:

```powershell
node --test server/db/migrate.test.mjs
```

Relevant RED output:

```text
tests 14
pass 11
fail 3

runMigrations rejects recorded migration history whose SQL file is missing
  AssertionError: Missing expected rejection.

runMigrations destroys the client after an ambiguous advisory-lock acquisition failure
  expected release(error); actual release argument was undefined

runMigrations destroys the client after an ambiguous BEGIN failure
  expected release(error); actual release argument was undefined
```

The newly added foreign-key, type/nullability, `NaN`, and database-credential leak assertions passed during RED, confirming those requested boundaries were already correctly implemented and only lacked regression coverage.

### GREEN implementation and output

Production changes were minimal and confined to `server/db/migrate.mjs`:

- build a set of current SQL filenames and reject every recorded version absent from it;
- carry explicit `lockAcquisitionUncertain` and `transactionUncertain` state through the dedicated migration client lifecycle;
- pass the primary error to `release(error)` whenever lock or transaction acquisition cannot be proven clean;
- clear uncertainty only after confirmed acquisition/commit or confirmed rollback, preserving normal clean primary-error reuse.

Immediate GREEN command:

```powershell
node --test server/db/migrate.test.mjs
```

Immediate GREEN output:

```text
tests 14
pass 14
fail 0
duration_ms 724.6853
```

### Final gates after formal fixes

All required commands were rerun after the final production changes with `DATABASE_URL` set to the exact tunneled `odds_test` database:

| Command | Final result |
| --- | --- |
| `node --test server/db/migrate.test.mjs` | exit 0; 14 passed, 0 failed; `duration_ms 1105.2146` |
| `npm.cmd test` | exit 0; 22 files passed; 139 tests passed |
| `npm.cmd run server:self-test` | exit 0; `[server] self-test passed` |
| `npm.cmd run check:data` | exit 0; 183 snapshots, 853 results, zero late snapshots/duplicate keys/negative scores; quality 3 current / 93 legacy / 87 invalid |
| `npm.cmd run build` | exit 0; TypeScript passed; Vite transformed 1600 modules; production/PWA build completed |
| `npm.cmd audit` | exit 0; `found 0 vulnerabilities` (no auto-fix run) |

Final archive hashes remain unchanged:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `public/hkjc-odds.json`: `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

Final database cleanup inspection returned `leftoverTestSchemas: []`.

### Files amended for formal review

- `server/db/migrate.test.mjs` — missing-history, ambiguous acquisition, FK/type/nullability, `NaN`, and credential-leak regressions.
- `server/db/migrate.mjs` — missing-history validation and uncertain connection-state cleanup.
- `.superpowers/sdd-production-phase1/task-2-report.md` — formal-review RED/GREEN and verification evidence.

### Formal-fix review and self-review

The targeted post-fix reviewer approved the result with no remaining Critical, Important, or Minor findings. It specifically confirmed complete recorded-history validation, preservation of checksum/out-of-order checks, destructive cleanup for ambiguous lock/`BEGIN`/commit states, normal reuse only after confirmed rollback and unlock, and complete requested coverage.

Self-review found no unresolved Task 2 concern. The exact disposable database guard remains in place, all integration tests isolate and remove only UUID-named owned schemas, archives remain byte-for-byte unchanged, and no Docker/SSH/VM/provider action occurred.
