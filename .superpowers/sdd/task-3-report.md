# Task 3 Report — PostgreSQL-only unified sampler

## Outcome

Implemented the server-only `unified-buyable-v1` sampling cycle:

1. Acquire the session advisory lock named exactly `unified-buyable-sampler`.
2. Read live odds through PostgreSQL only.
3. Resolve provider fixture aliases through the fixture repository.
4. Call `evaluateUnifiedOdds` exactly once for the cycle.
5. Persist the evaluation through the transactional opportunity repository.

The sampler has no provider API path. A test replaces `globalThis.fetch` with a throwing sentinel during a real PostgreSQL cycle and verifies zero calls; a source assertion also rejects collector imports, provider URLs, or a fetch call.

## Files

- Added `scripts/unified-sampler.mjs`.
- Added `scripts/unified-sampler-pg.test.mjs`.
- Modified `scripts/lib/postgres-sink.mjs`.
- Modified `scripts/lib/postgres-sink.test.mjs`.
- This report is intentionally not staged with the task commit.

Existing `.superpowers` and `package-lock.json` scratch changes were preserved and excluded from staging.

## TDD RED

The sampler tests were written before production changes. Command:

```powershell
$env:DATABASE_URL='postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
node --test scripts/unified-sampler-pg.test.mjs
```

Observed expected failure (exit 1):

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'C:\tmp\odds-unified-buyable-v1\scripts\unified-sampler.mjs'
```

This was the intended RED cause: the requested sampler module did not exist.

## Implementation details

### Sink methods

- `listLiveOdds(now)` validates/canonicalizes the timestamp and delegates to `oddsRepository.listLive`.
- `resolveFixtures(rows)` validates the array and delegates to `fixtureRepository.resolveBatch`.
- `recordRecommendationEvaluation(value)` delegates to `opportunityRepository.recordEvaluation`, whose existing transaction covers the entire evaluation persistence operation.

### Evaluation behavior

- `createUnifiedEvaluation(liveRows, resolvedFixtures, now)` evaluates only successfully resolved rows.
- Freshness, future-observation rejection, canonical bookmaker dedupe, and value thresholding remain owned by the shared pure engine.
- Qualifying quotes for one fixture/market/selection/line are retained together in one opportunity.
- The sampler adds deterministic empty opportunity shells for identities visible in fresh canonical inputs. The repository skips never-qualified empty shells, but an already-created sample receives a fingerprinted empty observation when it is no longer buyable. `last_qualified_at` therefore does not advance on no-buy cycles.
- The evaluation timestamp is excluded from the fingerprint payload by the repository, so identical inputs extend `last_evaluated_at`; input or quote changes create a new observation.

### CLI and self-test

- Normal CLI execution requires `DATABASE_URL`, creates a PostgreSQL pool, runs one locked cycle, and closes the pool.
- `--self-test` does not create a pool. It exercises the 0.03 threshold with a multi-bookmaker opportunity and proves the same input recurs with an identical observation fingerprint.

## GREEN evidence

Focused required suite:

```text
node --test scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.test.mjs
tests 9, pass 9, fail 0, skipped 0
```

Database-free self-test:

```text
node scripts/unified-sampler.mjs --self-test
[unified-sampler] self-test passed
```

Adjacent engine/repository regression suite, using the exact disposable URL:

```text
node --test shared/unified-recommendations.test.mjs server/db/repositories.test.mjs scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.test.mjs
tests 44, pass 44, fail 0, skipped 0
```

`git diff --check` exited 0.

## Commit

- Commit: `0b7fded` (`feat: sample unified buyable odds from postgres`)
- Committed scope: exactly the four task code/test files listed above.
- The report and pre-existing scratch changes remain unstaged.

## Coverage checklist

- [x] Exact advisory lock miss returns `busy` and performs no DB work.
- [x] DB-only execution with zero fetch calls.
- [x] One stale provider is excluded without suppressing fresh-provider evaluation.
- [x] Canonical bookmaker aliases dedupe to the newest quote.
- [x] Multiple qualifying bookmaker quotes remain under one opportunity.
- [x] Changed peer odds create a new fingerprint.
- [x] Unchanged inputs extend the existing observation.
- [x] A later no-buy cycle persists an empty observation for an existing sample.
- [x] Sink methods read, resolve, and record through real PostgreSQL repositories.
- [x] `--self-test` covers thresholding and fingerprint idempotency without a database.

## Self-review and concerns

- The shared recommendation engine remains the only odds calculator and is called once per sampler cycle.
- No dependency, migration, provider call, legacy archive, UI file, or model constant was changed.
- The initial implementation could associate empty observations only with identities still inferable from fresh canonical input. The follow-up review fix below reconciles fully omitted pre-kickoff samples transactionally, closing that boundary.
- During the first GREEN attempt, the lock test teardown deadlocked because its checked-out client was scheduled for release after pool teardown. The test was corrected to unlock/release in a local `finally`; no production change was involved.

## Follow-up review fix — fully omitted opportunities

Review identified that an already-qualified opportunity stayed non-empty when every provider row was cleared or every remaining row became more than 45 minutes stale. In both cases `evaluateUnifiedOdds` correctly returned no canonical inputs and no opportunities, but `recordEvaluation` had no opportunity to iterate and therefore wrote no empty observation.

### Follow-up RED

Tests were added first for real PostgreSQL provider clearing and full staleness, plus a direct repository omission case.

```powershell
$env:DATABASE_URL='postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
node --test scripts/unified-sampler-pg.test.mjs
```

Observed: 6 tests, 4 passed, 2 failed. Both failures showed the original non-empty inputs/quotes remaining latest after the omitted cycle.

```powershell
node --test --test-name-pattern="omitted (pre|post)-kickoff" server/db/repositories.test.mjs
```

Observed: the pre-kickoff omission failed because the original quote remained current; the post-kickoff exclusion passed.

### Follow-up implementation

`opportunityRepository.recordEvaluation` now reconciles omitted existing samples inside its existing transaction:

- It builds the evaluated identity set once.
- One set-based `UPDATE` extends a prior deterministic empty observation for omitted, pre-kickoff `unified-buyable-v1` samples.
- One set-based `INSERT ... SELECT` creates that empty observation only when absent.
- Both JSON payloads are `[]`; the fingerprint is `observationFingerprint({ inputs: [], buyableQuotes: [] })`.
- Existing parent samples are selected; no parent is created for a never-qualified identity.
- `commence_time > evaluatedAt` prevents reconciliation at or after kickoff.
- Present opportunity identities remain handled by the normal path, retaining their opportunity-specific inputs.

### Follow-up GREEN

```text
node --test scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.test.mjs server/db/repositories.test.mjs
tests 37, pass 37, fail 0, skipped 0
```

```text
node scripts/unified-sampler.mjs --self-test
[unified-sampler] self-test passed
```

Follow-up commit: `5000e46` (`fix: reconcile omitted buyable observations`). It contains only the repository implementation and the sampler/repository regression tests; the report remains unstaged.
