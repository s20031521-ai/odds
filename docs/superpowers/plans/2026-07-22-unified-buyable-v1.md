# Unified Buyable Odds v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify HKJC, The Odds API, and API-Football-backed football odds into a server-authoritative `unified-buyable-v1` opportunity ledger that preserves every genuinely updated buyable quote and exposes current ranges, per-bookmaker thresholds, history, readiness, and settlement.

**Architecture:** Collectors remain source-specific adapters that write flat live odds with provider metadata. A source-neutral fixture registry and a pure recommendation engine turn fresh canonical quotes into opportunity samples and versioned observations; a PostgreSQL-only sampler persists them. The authenticated API serves the recorded current state and history to the existing React shell, while legacy snapshots remain immutable audit data.

**Tech Stack:** TypeScript/React/Vite, Node.js ESM, PostgreSQL 16, `pg`, Vitest, Node `node:test`, Playwright, Docker Compose.

## Global Constraints

- Strategy version is exactly `unified-buyable-v1`; existing model version strings are unchanged.
- Buy edge threshold remains exactly `0.03`; model parameters and result-source priority remain unchanged.
- A quote is fresh only when `evaluatedAt - observedAt <= 45 minutes`, `observedAt <= evaluatedAt`, and kickoff is still in the future.
- Opportunity identity is `fixtureId|market|selection|line|modelVersion|strategyVersion`.
- Readiness counts each settled `fixtureId + market` at most once; quote observations never inflate readiness.
- Existing snapshots remain unchanged; a missing strategy version reads as `legacy-v0` and never counts toward `unified-buyable-v1` readiness.
- `src/pages/BuyDashboard.tsx` must have zero diff.
- Browser code never writes `unified-buyable-v1`; only the locked PostgreSQL sampler may write it.
- Do not add a new odds provider, paid API call, dependency, model parameter, or secret.
- Preserve LF line endings for shell scripts and deployment files.

---

### Task 1: Pure canonical quote and recommendation engine

**Files:**
- Create: `shared/unified-recommendations.mjs`
- Create: `shared/unified-recommendations.d.mts`
- Create: `shared/unified-recommendations.test.mjs`
- Modify: `src/odds.ts`, `src/handicap.ts`, `src/oddsApi.ts`
- Test: `src/odds.test.ts`, `src/handicap.test.ts`, `src/oddsApi.test.ts`

**Interfaces:**
- Produces `UNIFIED_STRATEGY_VERSION`, `BUY_EDGE_THRESHOLD`, `FRESHNESS_MS`, `minimumBuyOdds(chance)`, `canonicalBookmaker(name)`, `dedupeFreshQuotes(rows, evaluatedAt)`, `evaluateUnifiedOdds(rows, evaluatedAt)`, and `observationFingerprint(value)`.
- `evaluateUnifiedOdds` returns `{ opportunities, inputs }`; each opportunity contains fixture input metadata, unchanged model version, market, selection, optional line, and every qualifying quote `{ bookmaker, provider, odds, chance, edge, minimumBuyOdds, observedAt }`.

- [ ] **Step 1: Write failing engine tests**

  Cover exact two-decimal ceiling (`chance=.55` gives `1.88`), 45-minute boundary, future timestamps rejected, newest canonical bookmaker quote winning, native HKJC tie-break, ambiguous/malformed rows dropped, H2H consensus parity, and per-bookmaker LOO probabilities for spreads/totals/corners. Add a deterministic fingerprint test proving key-order independence and `observedAt` sensitivity.

- [ ] **Step 2: Run RED tests**

  Run: `node --test shared/unified-recommendations.test.mjs`

  Expected: FAIL because the module or exports do not exist.

- [ ] **Step 3: Implement the pure API minimally**

  Use these public shapes verbatim:

  ```js
  export const UNIFIED_STRATEGY_VERSION = "unified-buyable-v1";
  export const BUY_EDGE_THRESHOLD = 0.03;
  export const FRESHNESS_MS = 45 * 60_000;

  export function minimumBuyOdds(chance) {
    return Math.ceil((((1 + BUY_EDGE_THRESHOLD) / chance) - Number.EPSILON) * 100) / 100;
  }
  ```

  Keep H2H consensus behavior identical to `analyzeEntries`. For two-way point markets, calculate every candidate against peers excluding that canonical bookmaker, require at least two bookmakers on the exact fixture/line, and retain all candidates whose edge is at least `0.03`; do not reduce to the best candidate. Use normalized English market keys internally: `h2h`, `totals`, `corners`, `handicap`.

- [ ] **Step 4: Make existing model wrappers use the shared math where applicable**

  Preserve all existing public TypeScript types, labels, sort order, and test outputs. The shared engine is the model source of truth; wrappers may translate labels only.

- [ ] **Step 5: Run GREEN and regression tests**

  Run: `node --test shared/unified-recommendations.test.mjs`

  Run: `npm.cmd test -- src/odds.test.ts src/handicap.test.ts src/oddsApi.test.ts`

  Expected: all selected tests pass with no changed model outputs.

- [ ] **Step 6: Commit**

  ```powershell
  git add shared/unified-recommendations.mjs shared/unified-recommendations.d.mts shared/unified-recommendations.test.mjs src/odds.ts src/handicap.ts src/oddsApi.ts
  git commit -m "feat: add unified buyable recommendation engine"
  ```

### Task 2: Additive fixture and opportunity persistence

**Files:**
- Create: `db/migrations/004_unified_buyable.sql`
- Create: `server/db/fixture-repository.mjs`
- Create: `server/db/opportunity-repository.mjs`
- Modify: `server/db/odds-repository.mjs`, `server/db/snapshot-repository.mjs`, `server/domain/identity.mjs`, `server/entry.mjs`
- Test: `server/db/migrate.test.mjs`, `server/db/repositories.test.mjs`

**Interfaces:**
- `fixtureRepository.resolveBatch(liveRows)` returns `{ fixtures, unmatched }` and persists provider aliases.
- `opportunityRepository.recordEvaluation(evaluation)` upserts immutable samples and fingerprinted observations in one transaction.
- `opportunityRepository.listCurrent(now)`, `.listObservations(sampleId)`, and `.listForBacktest()` support later API tasks.

- [ ] **Step 1: Write failing migration and repository tests**

  Assert additive tables/columns, old snapshot raw remains byte-for-byte unchanged, null strategy maps to legacy, alias uniqueness, exact alias reuse, unique ±10-minute team match, ambiguous match audit, strategy/selection-aware identity, identical fingerprint extending only `last_evaluated_at`, changed fingerprint inserting a row, and empty qualifying quote arrays remaining valid observations after a sample exists.

- [ ] **Step 2: Run RED database tests**

  Run: `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs`

  Expected: FAIL on missing migration columns/tables/modules.

- [ ] **Step 3: Add the migration**

  Add source-neutral `fixtures`, `fixture_aliases`, and `fixture_match_audit`; add nullable `strategy_version`, `fixture_id`, `first_qualified_at`, and `last_qualified_at` to `prediction_snapshots`; add `recommendation_observations` with unique `(snapshot_id, fingerprint)`, `first_evaluated_at`, `last_evaluated_at`, `inputs jsonb`, and `buyable_quotes jsonb`. Add indexes for current strategy, kickoff, sample history, and alias lookup. Do not update existing rows.

- [ ] **Step 4: Implement fixture resolution**

  Match exact aliases first. For unseen aliases, normalize team names with the existing fixture normalization, require same home/away direction, kickoff difference no greater than ten minutes, and compatible league when both leagues exist. Auto-link only one candidate; create a new internal UUID fixture when zero candidates exist; write `fixture_match_audit` and leave the row unmatched when multiple candidates exist.

- [ ] **Step 5: Implement opportunity persistence**

  Insert the parent snapshot only on first qualification. Store the first batch's best quote in legacy scalar columns for compatibility, but make new reads use observation JSON. On conflict, preserve the parent's first-write fields and update only `last_qualified_at`. For observations, identical fingerprints update only `last_evaluated_at`; new fingerprints insert a row. Reject `unified-buyable-v1` through legacy `insertBatch`.

- [ ] **Step 6: Return live metadata**

  Change `listLive` to merge trusted DB columns into raw output so `provider`, `observedAt`, source `matchId`, and expiry cannot be lost or spoofed by nested raw data. Preserve existing field names consumed by the UI.

- [ ] **Step 7: Run GREEN database tests and commit**

  Run: `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs`

  ```powershell
  git add db/migrations/004_unified_buyable.sql server/db server/domain/identity.mjs server/entry.mjs
  git commit -m "feat: persist unified fixtures and quote observations"
  ```

### Task 3: PostgreSQL-only unified sampler

**Files:**
- Create: `scripts/unified-sampler.mjs`
- Create: `scripts/unified-sampler-pg.test.mjs`
- Modify: `scripts/lib/postgres-sink.mjs`

**Interfaces:**
- Export `runUnifiedSampler({ sink, now })` and `createUnifiedEvaluation(liveRows, resolvedFixtures, now)`.
- Sink gains `listLiveOdds(now)`, `resolveFixtures(rows)`, and `recordRecommendationEvaluation(value)`.

- [ ] **Step 1: Write failing sampler tests**

  Test advisory lock miss, DB-only execution, stale-provider exclusion without global shutdown, canonical bookmaker dedupe, one opportunity with multiple buyable quotes, changed peer odds producing a new fingerprint, unchanged input extending the observation, and a later no-buy/empty batch being recorded for an already-created sample.

- [ ] **Step 2: Run RED sampler tests**

  Run: `node --test scripts/unified-sampler-pg.test.mjs`

  Expected: FAIL because the sampler does not exist.

- [ ] **Step 3: Implement the sampler**

  Acquire the existing session advisory-lock mechanism with lock name `unified-buyable-sampler`. Read only PostgreSQL live odds, resolve fixture aliases, call the pure engine once per cycle, and persist each evaluation transactionally. Never call `fetch`, HKJC, The Odds API, or API-Football.

- [ ] **Step 4: Add a self-test and GREEN verification**

  `node scripts/unified-sampler.mjs --self-test` must exercise thresholding and fingerprint idempotency without a database.

  Run: `node --test scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.test.mjs`

- [ ] **Step 5: Commit**

  ```powershell
  git add scripts/unified-sampler.mjs scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.mjs scripts/lib/postgres-sink.test.mjs
  git commit -m "feat: sample unified buyable odds from postgres"
  ```

### Task 4: Server-authoritative recommendations and audit API

**Files:**
- Modify: `server/app.mjs`, `server/app.test.mjs`, `server/domain/backtest.mjs`, `server/domain/backtest.test.mjs`
- Modify: `src/apiClient.ts`, `src/apiClient.test.ts`

**Interfaces:**
- `GET /api/v1/recommendations/current`
- `GET /api/v1/predictions/observations?sampleId=<positive integer>`
- Extended `GET /api/v1/backtest`

- [ ] **Step 1: Write failing route and domain tests**

  Assert authentication, method inventory, required positive `sampleId`, no-store JSON response, current filtering by future kickoff/latest non-empty observation/45-minute freshness, quote-range sorting, per-bookmaker fields, legacy POST rejection for the new strategy, legacy POST compatibility, distinct fixture+market readiness, opportunity-level settlement, lower/upper unit return, and closing benchmark `N/A` when the last pre-kick observation is empty.

- [ ] **Step 2: Run RED tests**

  Run: `node --test server/app.test.mjs server/domain/backtest.test.mjs`

  Run: `npm.cmd test -- src/apiClient.test.ts`

- [ ] **Step 3: Implement API response contracts**

  Current response:

  ```ts
  type CurrentRecommendationsResponse = {
    generatedAt: string;
    strategyVersion: "unified-buyable-v1";
    opportunities: BuyableOpportunity[];
  };
  ```

  Each `BuyableOpportunity` exposes `sampleId`, fixture/team/league/kickoff metadata, market, selection, optional line, `quoteRange { min, max, count }`, `bestQuote`, sorted `quotes`, and latest evaluation time. Observation history includes `firstEvaluatedAt`, `lastEvaluatedAt`, inputs, and buyable quotes.

- [ ] **Step 4: Extend backtest semantics**

  Filter active readiness to `unified-buyable-v1`. Count settled distinct fixture+market values. Settle each opportunity selection/line separately; compute its minimum/maximum unit profit across all qualifying quotes, aggregate lower/upper ROI with one unit per opportunity, and compute closing benchmark from the final pre-kick evaluation only. Exclude `void` and `unsettleable`; count push as settled but not win/loss.

- [ ] **Step 5: Run GREEN tests and commit**

  Run: `node --test server/app.test.mjs server/domain/backtest.test.mjs`

  Run: `npm.cmd test -- src/apiClient.test.ts`

  ```powershell
  git add server/app.mjs server/app.test.mjs server/domain/backtest.mjs server/domain/backtest.test.mjs src/apiClient.ts src/apiClient.test.ts
  git commit -m "feat: expose recorded buyable recommendation ranges"
  ```

### Task 5: Today, professional, match, and history display

**Files:**
- Create: `src/components/BuyableOddsRange.tsx`
- Create: `src/components/BuyableOddsRange.test.tsx`
- Modify: `src/App.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/TodayPage.tsx`, `src/components/PickCard.tsx`, `src/pages/MatchAnalysisPage.tsx`, relevant CSS and tests
- Must not modify: `src/pages/BuyDashboard.tsx`

**Interfaces:**
- App loads `apiClient.currentRecommendations()` after authentication and uses it as the only Today/pro opportunity source.
- `BuyableOddsRange` renders summary and disclosure rows without recalculating model values.

- [ ] **Step 1: Write failing component/page tests**

  Assert summary copy for exact selection/line, sampled min-max, best quote, bookmaker count and timestamp; expanded rows for bookmaker/provider/price/minimum/edge/observed time; explicit same-line warning; stale/empty current response hidden; Today uses server data rather than locally computed candidates; pro mode renders a sibling range panel; match/history links lazy-load observations; and `BuyDashboard.tsx` content hash remains unchanged.

- [ ] **Step 2: Run RED UI tests**

  Run: `npm.cmd test -- src/components/BuyableOddsRange.test.tsx src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`

- [ ] **Step 3: Implement progressive disclosure**

  Keep the first layer compact: selection/line, sampled range, best, count, evaluated time. Native `<details>` shows exact per-bookmaker thresholds. Match analysis/history fetch observations only on explicit navigation or expansion. Do not infer that a different line is buyable.

- [ ] **Step 4: Remove browser writes for the new strategy**

  Stop the App effect that creates/posts recommendation snapshots. Retain legacy local snapshot helpers only where historical compatibility tests still require them. Map recorded opportunity summaries into the existing `BuyOpportunity` shape solely for the unchanged professional dashboard.

- [ ] **Step 5: Run GREEN tests, build, and commit**

  Run: `npm.cmd test -- src/components/BuyableOddsRange.test.tsx src/pages/TodayPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/MatchAnalysisPage.test.tsx src/App.test.tsx`

  Run: `npm.cmd run build`

  ```powershell
  git add src
  git commit -m "feat: show server-recorded buyable odds ranges"
  ```

### Task 6: Result coverage and seven-day terminal lifecycle

**Files:**
- Modify: `scripts/hdc-collector.mjs`, `scripts/hkjc-import.mjs`, their unit/PG tests
- Modify: `server/db/result-repository.mjs`, `server/domain/backtest.mjs`, related tests

**Interfaces:**
- The Odds API score conversion emits H2H, handicap, and totals results through existing priority rules.
- Result resolution maps provider event IDs through fixture aliases before settlement.
- Opportunity resolution state supports `pending`, settlement values, `void`, and `unsettleable`.

- [ ] **Step 1: Write failing result lifecycle tests**

  Cover H2H score rows, one fetched score resolving all same-fixture markets, API-Football corner fallback, alias-based result mapping, postponed kickoff update within seven days, `unsettleable` after seven days, no retry after terminal state, and fixed result-priority behavior.

- [ ] **Step 2: Run RED result tests**

  Run the focused collector, repository, and backtest test files; expected failures must be missing H2H/alias/terminal behavior.

- [ ] **Step 3: Implement lifecycle minimally**

  Add H2H result rows without changing existing HDC/totals output. Resolve external IDs to internal fixture IDs before persistence. Reuse one fixture result for all opportunity lines. Mark explicit cancelled/void results terminal; otherwise mark unresolved opportunities `unsettleable` seven days after the current registered kickoff. A recognized reschedule updates the fixture kickoff and resets the seven-day comparison naturally.

- [ ] **Step 4: Run GREEN result tests and commit**

  Run: `node --test scripts/hdc-collector-pg.test.mjs scripts/hkjc-import-pg.test.mjs server/db/repositories.test.mjs server/domain/backtest.test.mjs`

  ```powershell
  git add scripts/hdc-collector.mjs scripts/hkjc-import.mjs scripts/*-pg.test.mjs server/db/result-repository.mjs server/domain/backtest.mjs server/db/repositories.test.mjs server/domain/backtest.test.mjs
  git commit -m "feat: settle unified opportunities across result sources"
  ```

### Task 7: Collector cutover, integrity checks, and documentation

**Files:**
- Modify: `deploy/collector-entrypoint.sh`, `scripts/hdc-collector.mjs`, collector tests
- Modify: `scripts/check-data-integrity.mjs`, `scripts/check-postgres-parity.mjs`, related tests
- Modify: `docs/superpowers/specs/2026-07-22-unified-sampling-design.md`, `README.md`

**Interfaces:**
- One supervisor iteration always attempts HDC ingest, conditionally attempts HKJC every third iteration, then attempts `node scripts/unified-sampler.mjs` regardless of provider failure.

- [ ] **Step 1: Write failing cutover and integrity tests**

  Assert one sampler invocation per loop, HKJC only every third loop, HDC no longer spawns HKJC, old automatic HDC/totals snapshots stop, provider failures do not skip sampler, integrity detects duplicate observation fingerprints/invalid future observations/post-kick evaluations, parity understands strategy/observations, and LF is retained.

- [ ] **Step 2: Run RED tests**

  Run the focused collector/integrity tests and a shell-text assertion test; expected failures must identify old scheduling/snapshot behavior.

- [ ] **Step 3: Cut over scheduling**

  Remove `refreshHkjc`, child-process imports, legacy automatic snapshot creation, and snapshot store writes from HDC collection while preserving odds/result collection. Update the loop so each command handles failure independently and sampler always runs before the five-minute sleep.

- [ ] **Step 4: Update integrity/parity and approved design docs**

  Replace the old separate-source sampling design with `unified-buyable-v1`, server-authoritative current display, opportunity/observation identity, readiness, return range, and terminal rules. Document the new authenticated endpoints and sampler self-test.

- [ ] **Step 5: Run focused tests and commit**

  ```powershell
  git add deploy/collector-entrypoint.sh scripts/hdc-collector.mjs scripts/check-data-integrity.mjs scripts/check-postgres-parity.mjs scripts/*.test.mjs docs/superpowers/specs/2026-07-22-unified-sampling-design.md README.md
  git commit -m "chore: cut collectors over to unified sampling"
  ```

### Task 8: Full verification and release evidence

**Files:**
- Modify only when a failing verification first has a regression test proving the defect.

- [ ] **Step 1: Run complete frontend and shared tests**

  Run: `npm.cmd test`

- [ ] **Step 2: Run typecheck and production build**

  Run: `npm.cmd run build`

- [ ] **Step 3: Run server and collector self-tests**

  Run: `npm.cmd run server:self-test`

  Run: `node scripts/hdc-collector.mjs --self-test`

  Run: `node scripts/hkjc-import.mjs --self-test`

  Run: `node scripts/odds-monitor.mjs --self-test`

  Run: `node scripts/unified-sampler.mjs --self-test`

- [ ] **Step 4: Run database-backed suites**

  Run the documented PostgreSQL test commands for `server/app.test.mjs`, `server/auth/auth.test.mjs`, `server/db/*.test.mjs`, sink tests, collector PG tests, integrity, and parity. Do not claim database coverage if PostgreSQL is unavailable.

- [ ] **Step 5: Run UI suite**

  Run: `npm.cmd run test:ui:only`

- [ ] **Step 6: Verify invariants and diff**

  Confirm `git diff <merge-base> -- src/pages/BuyDashboard.tsx` is empty, no secrets/new dependencies/provider calls were added, shell files are LF, migrations are additive, old archives are untouched, and every approved requirement maps to code plus a test.

- [ ] **Step 7: Update release handoff without deploying**

  Record exact commands, pass/fail counts, migration filename, rollback commit, required `git archive`/`pg_dump`, API+Caddy rebuild order, and 48-hour monitoring signals. Production backup, migration, deployment, tag, and monitoring remain explicit operator actions and are not executed without separate deployment authority.

