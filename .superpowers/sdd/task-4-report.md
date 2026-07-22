# Task 4 Report: Server-authoritative recommendations and audit API

Base: `5000e46`
Commits:

- `8648eb6 feat: expose recorded buyable recommendation ranges`
- `d855c87 fix: tighten recorded recommendation contracts`

## Implemented

- Added authenticated, GET-only `GET /api/v1/recommendations/current` and `GET /api/v1/predictions/observations?sampleId=<positive integer>` routes to the exact API inventory.
- Current recommendations are shaped only from `opportunities.listCurrent(now)`: future kickoff, latest evaluation no older than 45 minutes, non-empty buyable quotes, and quote timestamps within the 45-minute evaluation boundary. Quotes are sorted best-first and expose the persisted bookmaker/provider/odds/chance/edge/minimum/observed fields plus `quoteRange` and `bestQuote`.
- Observation history returns the persisted audit rows without recomputing recommendations. PostgreSQL `bigint` sample IDs are safely normalized to the numeric browser contract.
- Legacy prediction POST remains supported; any browser-supplied `strategyVersion: "unified-buyable-v1"` is rejected as `server-only-strategy` before repository insertion.
- Backtest now reads `opportunities.listForBacktest()`. Active readiness includes only `unified-buyable-v1` and counts settled `fixtureId + market` once. Performance settles each selection/line opportunity, aggregates lower/upper one-unit profit and ROI ranges, uses only the final pre-kick evaluation for the closing benchmark, excludes void/unsettleable outcomes, and counts pushes as settled without a win/loss.
- Added typed client methods and contracts for current recommendations and observation history.

## TDD evidence

### Baseline

`node --test server/app.test.mjs server/domain/backtest.test.mjs`

```text
tests 12
pass 12
fail 0
```

The first sandboxed `npm.cmd test -- src/apiClient.test.ts` did not collect tests because Vite could not create `node_modules/.vite-temp/...mjs` (`EPERM: operation not permitted`). Re-running the same command with approved worktree permissions collected normally.

### Initial RED

`node --test server/app.test.mjs server/domain/backtest.test.mjs`

```text
tests 13
pass 11
fail 2

serves the secure same-origin api/v1 contract:
  404 !== 401

settles unified opportunities independently with return ranges and distinct fixture-market readiness:
  actual unified rows []
  expected [[1, "win"], [2, "push"]]
```

`npm.cmd test -- src/apiClient.test.ts`

```text
Test Files  1 failed (1)
Tests       2 failed | 1 passed (3)
TypeError: client.currentRecommendations is not a function
```

These failures were the missing Task 4 route, domain, and client behaviors rather than setup or syntax errors.

### Review regression RED 1: unified-only readiness

After the first GREEN pass, the global constraint that legacy snapshots never count toward unified readiness was made explicit in the legacy domain test.

`node --test server/domain/backtest.test.mjs`

```text
tests 10
pass 9
fail 1
Expected readiness [] but received legacy readiness rows.
```

The implementation was narrowed so readiness is always computed from the unified-strategy set; legacy rows/performance remain compatible.

### Review regression RED 2: PostgreSQL bigint sample IDs

The route fixture was changed to the actual `pg` shape (`sampleId: "101"`) while the expected browser contract remained numeric.

`node --test server/app.test.mjs`

```text
tests 3
pass 2
fail 1
actual sampleId: "101"
expected sampleId: 101
```

The API boundary now accepts only a positive safe integer representation and emits a number.

### Code-review RED: mixed legacy + unified audit compatibility

The required review checkpoint reproduced a mixed dataset regression: after the first unified opportunity existed, a settled legacy result was returned as an unmatched result with `settlement: null`. A mixed-strategy assertion was added before changing production code.

`node --test server/domain/backtest.test.mjs`

```text
tests 10
pass 9
fail 1
legacy audit rows survive alongside unified performance
null !== "win"
```

Row matching and pending output now retain valid legacy snapshots alongside unified opportunities. Active readiness and range summary remain unified-only. The reviewer reported no Critical issues; this Important issue was fixed and covered before commit.

## Final GREEN evidence

Using `DATABASE_URL=postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test` for the focused Node command:

`node --test server/app.test.mjs server/domain/backtest.test.mjs`

```text
tests 13
pass 13
fail 0
duration_ms 135.508
```

`npm.cmd test -- src/apiClient.test.ts`

```text
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    161ms
```

`npm.cmd run build`

```text
tsc --noEmit -p tsconfig.json: exit 0
vite v6.4.3: 1619 modules transformed
built in 1.11s
```

`git diff --check` completed without task-file whitespace errors.

## Self-review

- Route inventory remains fail-closed: unknown paths are 404 and wrong methods are 405 before handlers run.
- Both new data routes require an authenticated session and inherit JSON `cache-control: no-store`.
- Current/API code does not call provider APIs or recommendation math; it only filters and shapes persisted server observations.
- The 45-minute boundary is inclusive and rejects future observation/evaluation times.
- Empty latest observations remove an opportunity from current output but remain visible through the audit route.
- Opportunity identity keeps fixture, market, selection, line, model, and strategy distinct in performance rows.
- Legacy audit rows and pending behavior remain available both alone and alongside unified opportunities; active readiness and range summary intentionally exclude all legacy strategies.
- No repository/schema/provider/dependency/model parameter changes were made, so no PostgreSQL integration test was required for this task. The supplied disposable database URL was retained for commands that could consult configuration.
- Only the six Task 4 source/test files will be staged. Existing `.superpowers` scratch changes, this report, and `package-lock.json` remain unstaged as instructed.

## Concerns

- Vitest/build require approved permission to write Vite temporary files under this isolated `C:\tmp` worktree; this is an environment ACL issue, not a test failure.
- Task 6 will extend result lifecycle/fixture alias resolution. Task 4 already recognizes `void` and `unsettleable` terminal values and fixture-based results without implementing Task 6's repository changes.

## Follow-up review fixes

### Important 1: quote age at response time

The first implementation checked `evaluatedAt - observedAt <= 45 minutes` but did not also require `now - observedAt <= 45 minutes`. The new route fixture combines an evaluation 44 minutes old with a quote 88 minutes old; it remains valid relative to evaluation but must not appear current. The same test keeps an exact 45-minute current-age quote and rejects future evaluation/quote timestamps.

RED, `node --test server/app.test.mjs server/domain/backtest.test.mjs`:

```text
tests 13
pass 11
fail 2

current route included fixture-combined-age-stale as a second opportunity
```

The quote filter now requires both evaluation age and current age to be within the inclusive `0..45 minutes` range.

Independent GREEN, `node --test server/app.test.mjs`:

```text
tests 3
pass 3
fail 0
```

### Important 2: explicit backtest audit contract

The backtest repository already returned `firstQualifiedAt`, `lastQualifiedAt`, and observation history, but public rows exposed only the compatibility `savedAt` field and client collections were typed as `unknown`.

RED, focused Node command:

```text
unified row firstQualifiedAt: undefined
unified row lastQualifiedAt: undefined
unified row observationSummary: undefined
```

RED, `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`:

```text
TS2305: Module './apiClient' has no exported member 'BacktestRow'.
TS2305: Module './apiClient' has no exported member 'BacktestSummary'.
```

Matched, unmatched, and pending rows now expose authoritative qualification timestamps plus:

```ts
type BacktestObservationSummary = {
  count: number;
  firstEvaluatedAt: string | null;
  lastEvaluatedAt: string | null;
  buyableQuoteCount: number;
};
```

`savedAt` remains for compatibility. `BacktestResponse` now uses explicit row, summary, readiness, pending, range, settlement, closing-benchmark, and snapshot-quality types. Typecheck also verifies compatibility with the existing App state setters.

### Follow-up final GREEN

Using the supplied disposable database URL for the focused Node command:

```text
node --test server/app.test.mjs server/domain/backtest.test.mjs
tests 13; pass 13; fail 0; duration_ms 137.2409

npm.cmd test -- src/apiClient.test.ts
Test Files 1 passed (1); Tests 3 passed (3); Duration 160ms

npm.cmd run build
tsc exit 0; 1619 modules transformed; built in 1.14s
```

`git diff --check` passed. The follow-up commit stages only the six Task 4 source/test files; this report and all existing scratch/package-lock changes remain unstaged.
