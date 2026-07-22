# Task 2 report: additive fixture and opportunity persistence

## Status

Implemented and committed as `b4b6dfd feat: persist unified fixtures and quote observations`.

The required PostgreSQL GREEN run could not execute in this worker environment. There is no injected `DATABASE_URL`, Docker is not installed, `psql`/a PostgreSQL service is not present, and `127.0.0.1:55432` refuses connections. This is an environment blocker rather than test evidence of a code failure; no passing database result is claimed.

## RED

Tests were added before production implementation for:

- additive tables, columns, constraints, indexes, and byte/value preservation of pre-004 `raw` JSON;
- null strategy read mapping and rejection of browser/legacy `unified-buyable-v1` writes;
- exact alias precedence and uniqueness, normalized same-direction team matching within the inclusive ten-minute boundary, league compatibility, and ambiguous-match audit/unmatched behavior;
- fixture/market/selection/line/model/strategy opportunity identity;
- immutable first-qualified sample fields, best first-batch legacy scalar quote, identical fingerprint extension, changed fingerprint insertion, and an empty quote observation after a sample exists;
- trusted `listLive` overlay for entry ID, provider, source match ID, observation time, and expiry.

Command:

```text
node --test server/db/migrate.test.mjs server/db/repositories.test.mjs
```

Observed RED summary before implementation:

```text
pass 4
fail 14
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../server/db/fixture-repository.mjs
```

The migration tests also hit their intentional controller URL guard because `DATABASE_URL` was not injected. The missing repository module is the expected feature RED.

## Implementation

- Added migration `004_unified_buyable.sql` only; migrations 001-003 were not edited.
- Added source-neutral `fixtures`, unique `fixture_aliases`, ambiguous-match `fixture_match_audit`, nullable snapshot strategy/fixture/qualification columns, and fingerprinted `recommendation_observations` plus requested lookup/history indexes.
- Added transactionally serialized fixture resolution: exact alias first, normalized same-direction/team-time/league matching second, UUID creation for zero candidates, and audit-without-alias for ambiguity.
- Added transactional opportunity persistence with six-part identities, immutable first-write parent data, only `last_qualified_at` updates, deterministic observation fingerprints, and empty quote observations for existing samples.
- Added current/history/backtest repository reads using observation JSON and `legacy-v0` fallback.
- Legacy snapshot insertion rejects `unified-buyable-v1`; snapshot reads overlay null strategy as `legacy-v0` without rewriting stored raw JSON.
- Live odds reads overlay trusted relational metadata after raw JSON.
- Registered fixture and opportunity repositories in the server entry point.

## GREEN / verification evidence

Required database command attempted with the exact controller URL:

```powershell
$env:DATABASE_URL='postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
node --test server/db/migrate.test.mjs server/db/repositories.test.mjs
```

Observed infrastructure result:

```text
tests 37
pass 5
fail 32
Error: connect ECONNREFUSED 127.0.0.1:55432
```

All 32 database-dependent tests failed at initial connection setup; none reached migration/repository assertions. The five non-database tests passed.

Additional checks:

```text
node --check [all changed .mjs and both changed test files]
exit 0

node --test --test-name-pattern "loadServerConfig|migration CLI|opportunity identity includes" server/db/migrate.test.mjs server/db/repositories.test.mjs
5 passed, 0 failed

node --test shared/unified-recommendations.test.mjs server/app.test.mjs server/domain/backtest.test.mjs
23 passed, 0 failed

npx.cmd tsc --noEmit -p tsconfig.json
exit 0

node server/entry.mjs --self-test
[server] self-test passed

git diff --cached --check
exit 0 before commit
```

`npm.cmd run build` completed TypeScript checking but Vite could not create `node_modules/.vite-temp/...` (`EPERM`); the independent TypeScript check passed. This is separate from the PostgreSQL blocker.

## Files committed

- `db/migrations/004_unified_buyable.sql`
- `server/db/fixture-repository.mjs`
- `server/db/opportunity-repository.mjs`
- `server/db/migrate.test.mjs`
- `server/db/repositories.test.mjs`
- `server/db/odds-repository.mjs`
- `server/db/snapshot-repository.mjs`
- `server/domain/identity.mjs`
- `server/entry.mjs`

## Self-review

- Confirmed existing migrations and snapshot raw rows are never updated by migration 004.
- Confirmed exact alias lookup happens before metadata validation/matching; cross-provider matching preserves home/away direction and uses an inclusive ten-minute window.
- Confirmed fixture resolution and per-opportunity persistence use transaction advisory locks to avoid concurrent duplicate aliases/samples.
- Confirmed parent conflict handling changes only `last_qualified_at`, while observation conflict handling changes only `last_evaluated_at`.
- Confirmed latest/current quote data comes from observation JSON, not the first-write scalar/raw snapshot.
- Confirmed only the nine Task 2 files were committed. Pre-existing `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-2-brief.md`, and `package-lock.json` changes remain unstaged and untouched by the commit.

## Concerns / follow-up

The additive SQL and real `pg` behavior still require the exact database command above in an environment with the disposable PostgreSQL service listening on port 55432. In particular, the schema-introspection expectations and all transaction/concurrency assertions have not received runtime PostgreSQL GREEN evidence in this worker.

## Review fixes (`7bcf10a fix: harden opportunity observation persistence`)

### Findings addressed

- Observation `inputs` and `buyable_quotes` are now explicitly `JSON.stringify`-encoded before binding to `jsonb`; empty arrays bind as the valid JSON text `[]`, not a PostgreSQL array literal.
- `listCurrent` now chooses the observation with the greatest `last_evaluated_at`, with descending `id` as a deterministic tie-break. This preserves A as current for A→B→A.
- Parent `last_qualified_at` and observation `last_evaluated_at` updates now use `GREATEST(existing, incoming)`, preventing out-of-order replay regressions.
- The ambiguous fixture test now omits the optional `league` field instead of expecting enumerable `league: undefined` to round-trip through JSONB.

### Review RED

Command:

```text
node --test --test-name-pattern "bind JSON arrays|evaluated most recently|monotonic qualification" server/db/repositories.test.mjs
```

Observed before implementation:

```text
tests 3
pass 0
fail 3
[] !== '[]'
query used ORDER BY first_evaluated_at DESC, id DESC
update used SET last_qualified_at = $2
```

The failures directly reproduced the three production issues without requiring PostgreSQL.

### Review GREEN and regression checks

Focused command after implementation:

```text
node --test --test-name-pattern "bind JSON arrays|evaluated most recently|monotonic qualification" server/db/repositories.test.mjs
tests 3, pass 3, fail 0
```

Broader non-database verification:

```text
node --check server/db/opportunity-repository.mjs
node --check server/db/repositories.test.mjs
exit 0

node --test --test-name-pattern "opportunity observations|current opportunities|opportunity replay|opportunity identity includes|loadServerConfig|migration CLI" server/db/migrate.test.mjs server/db/repositories.test.mjs
tests 8, pass 8, fail 0

node --test shared/unified-recommendations.test.mjs server/app.test.mjs server/domain/backtest.test.mjs
tests 23, pass 23, fail 0

npx.cmd tsc --noEmit -p tsconfig.json
exit 0

node server/entry.mjs --self-test
[server] self-test passed

git diff --cached --check
exit 0 before review-fix commit
```

The exact required database command was rerun with the expected URL. Result:

```text
node --test server/db/migrate.test.mjs server/db/repositories.test.mjs
tests 41
pass 8
fail 33
Error: connect ECONNREFUSED 127.0.0.1:55432
```

Every database-dependent test failed during connection setup; the new A→B→A/out-of-order integration regression did not reach its assertions. Real PostgreSQL GREEN therefore remains an environment blocker, not claimed evidence.

### Remaining note

The review's Minor delimiter-collision concern in opportunity identity remains intentionally unchanged, as permitted. The only unresolved verification concern is the unavailable disposable PostgreSQL service.
