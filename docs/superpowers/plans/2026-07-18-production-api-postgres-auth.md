# Production API, PostgreSQL, and Owner Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser loopback/file-backed production paths with a same-origin `/api/v1`, PostgreSQL persistence, idempotent legacy import, and secure single-owner authentication while preserving every model and archive invariant.

**Architecture:** Keep the current React/Vite PWA and pure odds/model modules. Extract file-independent domain logic from `server.mjs`, place PostgreSQL behind small repository interfaces, expose an injected Node HTTP application, and gate all odds/backtest/prediction data behind an opaque owner session. Phase 1 runs locally against an isolated PostgreSQL test database. The approved fallback is an ephemeral VM container exposed only on VM loopback through an SSH tunnel; Phase 1 does not create DNS or call paid providers.

**Tech Stack:** Node ESM, React 19, Vite 6, Vitest, Node test runner, PostgreSQL 18, `pg@8.22.0`, `@node-rs/argon2@2.0.2`, Docker Compose test database.

## Global Constraints

- `BUY_EDGE_THRESHOLD` remains exactly `0.03`.
- Do not change model weights, settlement, Kelly, hit-rate, distinct-match, ROI, snapshot classification, or fixture matching behavior.
- Never call The Odds API, API-Football, HKJC, or another provider from automated tests.
- `data/prediction-snapshots.jsonl` and all existing JSON/JSONL archives are read-only migration inputs; record SHA-256 before and after every task.
- Preserve the approved baseline of 183 prediction snapshots and 853 results, including all legacy/invalid classifications.
- The browser uses relative `/api/v1` only. No production browser code may contain `127.0.0.1:8787`.
- No public route may start an importer/collector or spend provider quota.
- No wildcard CORS. Authenticated mutations require exact-origin and CSRF validation.
- No public signup, MFA, roles, password-reset email, Redis, ORM, or speculative multi-user abstraction.
- Phase 1 must not modify Cloudflare, DNS, SSH configuration, existing Compose projects, or S3. User-approved exception on 2026-07-18: Tasks 2–4 may use one isolated ephemeral PostgreSQL 18 test container on the VM, bound only to VM loopback `127.0.0.1:55432` and reached through an SSH tunnel; it must not join, inspect, or modify Astra networks, volumes, databases, or Compose files.
- This workspace has no usable Git metadata. Record task reports and review gates instead of pretending commits exist.
- Tasks 2–9 require a real PostgreSQL 18 test database. If local Docker/PostgreSQL is unavailable, use only the approved isolated VM test container through an SSH tunnel; do not substitute `pg-mem`, SQLite, or an existing VM database.

---

### Task 1: Extract and freeze file-independent domain behavior

**Files:**
- Create: `server/domain/backtest.mjs`
- Create: `server/domain/identity.mjs`
- Create: `server/domain/backtest.test.mjs`
- Modify: `server.mjs`
- Create: `.superpowers/sdd-production-phase1/task-1-report.md`

**Interfaces:**
- Produces: `buildBacktest(snapshots, results, now)`, `buildHealth(updatedAtBySource, now)`, `flattenLiveCache(cached)`, `mergeSnapshots(existing, incoming)`, `mergeResults(existing, incoming)`, `oddsScoreRows(events)`, `selectBacktestResults(liveResults, archivedResults)`, plus canonical `snapshotIdentity(snapshot)`, `resultIdentity(result)`, and the existing provider-result `providerResultIdentity(entry)` shared by later repositories and importers.
- Preserves: all current `server.mjs --self-test` assertions and output shapes.

- [ ] **Step 1: Write the failing import/parity tests**

Create `server/domain/backtest.test.mjs` with Node's test runner. Import the future module and reproduce the existing server self-test fixtures, including Asian quarter lines, push exclusion, distinct-match readiness, legacy/current separation, invalid snapshot classification, and result-source priority.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildBacktest, mergeSnapshots } from "./backtest.mjs";

test("preserves quarter-line settlement and push denominators", () => {
  const response = buildBacktest(quarterLineSnapshots, quarterLineResults, NOW);
  assert.deepEqual(response.rows.map((row) => row.settlement), [
    "win", "half-win", "push", "half-loss", "loss",
  ]);
  assert.equal(response.summary.hitRate, 3 / 6);
});

test("keeps immutable versioned snapshot identities", () => {
  const merged = mergeSnapshots([], duplicateIdentitySnapshots);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].odds, duplicateIdentitySnapshots[0].odds);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test server/domain/backtest.test.mjs`

Expected: fail because `server/domain/backtest.mjs` does not exist.

- [ ] **Step 3: Extract without rewriting algorithms**

Move the named pure functions and constants from `server.mjs` into `server/domain/backtest.mjs`. Move the existing snapshot/result/provider-result key construction into `server/domain/identity.mjs`; make the extracted domain module and `server.mjs` import those identities. Export them and import them back into `server.mjs`. Do not change function bodies except imports/exports required by extraction.

- [ ] **Step 4: Verify parity**

Run:

```powershell
node --test server/domain/backtest.test.mjs
npm.cmd run server:self-test
npm.cmd test
npm.cmd run check:data
```

Expected: new tests pass; existing 139 Vitest tests, server self-test, and integrity check pass with unchanged archive hashes.

- [ ] **Step 5: Independent review gate**

Reviewer checks the diff for any changed domain formula, sort, identity, readiness, or settlement branch. Record approval and exact commands in the task report.

---

### Task 2: Add the isolated PostgreSQL test harness and migration runner

**Files:**
- Create: `compose.test.yaml`
- Create: `db/migrations/001_initial.sql`
- Create: `server/config.mjs`
- Create: `server/db/pool.mjs`
- Create: `server/db/migrate.mjs`
- Create: `server/db/migrate.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.superpowers/sdd-production-phase1/task-2-report.md`

**Interfaces:**
- Produces: `loadServerConfig(env)`, `createPool(databaseUrl)`, `withTransaction(pool, callback)`, `runMigrations(pool, migrationsDir)`.
- Test database: `postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`.

- [ ] **Step 1: Install only the approved runtime dependencies**

Run:

```powershell
npm.cmd install pg@8.22.0 @node-rs/argon2@2.0.2
```

Do not add an ORM, web framework, Redis client, or migration package.

- [ ] **Step 2: Write the test database Compose file**

`compose.test.yaml` contains one PostgreSQL 18 service, binds only `127.0.0.1:55432`, uses test-only credentials, a health check, and a tmpfs data directory. It is never reused for production.

```yaml
services:
  postgres-test:
    image: postgres:18-bookworm
    environment:
      POSTGRES_DB: odds_test
      POSTGRES_USER: odds_test
      POSTGRES_PASSWORD: odds_test
    ports:
      - "127.0.0.1:55432:5432"
    tmpfs:
      - /var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U odds_test -d odds_test"]
      interval: 2s
      timeout: 2s
      retries: 20
```

- [ ] **Step 3: Write failing migration/config tests**

Tests must prove:

- missing/invalid `DATABASE_URL`, `SESSION_SECRET`, and `PUBLIC_ORIGIN` fail startup;
- migrations run in lexical order inside a transaction;
- rerunning migrations is idempotent;
- the expected tables and unique constraints exist;
- app code cannot mark a migration successful when its SQL fails.

Run: `node --test server/db/migrate.test.mjs`

Expected: fail because config, pool, migration runner, and schema do not exist.

- [ ] **Step 4: Add the exact initial schema**

`001_initial.sql` creates:

- `schema_migrations(version text primary key, checksum_sha256 text not null, applied_at timestamptz not null)`;
- `owners(id uuid primary key, username text unique not null, password_hash text not null, disabled_at timestamptz, created_at timestamptz not null)`;
- `sessions(id uuid primary key, owner_id uuid references owners, token_hash bytea unique not null, csrf_hash bytea not null, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at)`;
- `login_attempts(scope_key text primary key, failed_count integer, window_started_at, blocked_until)`;
- `prediction_snapshots(id bigserial primary key, identity_key text unique not null, match_id, market, prediction, line double precision, odds double precision, chance double precision, edge double precision, saved_at, commence_time, model_version, source, snapshot_status, rejection_reason, raw jsonb not null)`;
- `results(id bigserial primary key, identity_key text unique not null, match_id, market, actual, source, source_priority integer, completed_at, raw jsonb not null)`;
- `live_odds(id bigserial primary key, identity_key text unique not null, entry_id, provider, match_id, home_team, away_team, commence_time, market, selection, line double precision, odds double precision, observed_at, expires_at, raw jsonb not null)`;
- `collector_state(state_key text primary key, state jsonb not null, updated_at timestamptz not null)`;
- `import_runs(id uuid primary key, source_name, source_sha256, importer_version, status, total_rows, accepted_rows, rejected_rows, started_at, finished_at, unique(source_name, source_sha256, importer_version))`;
- `import_rows(import_run_id uuid references import_runs, source_row integer, idempotency_key text, classification text, rejection_reason text, raw jsonb not null, primary key(import_run_id, source_row), unique(idempotency_key))`.

Add checks for finite/positive odds and chance where PostgreSQL can express them safely. Domain-specific pre-kickoff and classification validation remains in shared policy code and is also persisted explicitly.

- [ ] **Step 5: Implement minimal config/pool/migration code**

Use `pg.Pool`, parameterized queries, `BEGIN/COMMIT/ROLLBACK`, and SHA-256 migration content logging. The runner reads only `.sql` files from the supplied directory and never interpolates environment values into SQL.

- [ ] **Step 6: Run GREEN and baseline gates**

Run with local Docker when available:

```powershell
docker compose -f compose.test.yaml up -d --wait
$env:DATABASE_URL='postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
node --test server/db/migrate.test.mjs
npm.cmd test
npm.cmd audit
docker compose -f compose.test.yaml down
```

Approved VM fallback: confirm the controller-provided SSH tunnel is listening at `127.0.0.1:55432`, set the same `DATABASE_URL`, run the migration/tests/audits above, and omit both local `docker compose` commands. The implementer must not SSH to or modify the VM; the controller owns the isolated test container lifecycle.

Expected: migrations and reruns pass; 139 Vitest tests pass; audit reports no unresolved high/critical issue. Record but do not auto-fix audit findings.

- [ ] **Step 7: Independent review gate**

Reviewer checks SQL constraints, transaction failure behavior, test-only port scope, config secret handling, and absence of archive writes.

---

### Task 3: Implement PostgreSQL repositories and immutable identities

**Files:**
- Modify: `server/domain/identity.mjs`
- Modify: `server/domain/backtest.test.mjs`
- Modify: `server.mjs`
- Create: `server/db/snapshot-repository.mjs`
- Create: `server/db/result-repository.mjs`
- Create: `server/db/odds-repository.mjs`
- Create: `server/db/collector-state-repository.mjs`
- Create: `server/db/repositories.test.mjs`
- Create: `.superpowers/sdd-production-phase1/task-3-report.md`

**Interfaces:**

```js
createSnapshotRepository(pool) -> {
  insertBatch(snapshots): Promise<{ inserted, duplicate, rejected, rejectedByReason }>;
  listAll(): Promise<object[]>;
  listCurrent(): Promise<object[]>;
}

createResultRepository(pool) -> {
  upsertBatch(results): Promise<{ inserted, updated, ignored }>;
  listAll(): Promise<object[]>;
}

createOddsRepository(pool) -> {
  replaceProviderSnapshot(provider, observedAt, entries): Promise<void>;
  listLive(now): Promise<object[]>;
}
```

- [ ] **Step 1: Write failing repository integration tests**

Cover immutable first-snapshot wins, exact versioned identity, repeated batch idempotency, partial rejection counts, legacy/invalid preservation, result source priority, live-provider replacement in one transaction, expired odds exclusion, rollback on malformed row, and concurrent duplicate insert behavior.

Run: `node --test server/db/repositories.test.mjs`

Expected: fail because repositories do not exist.

- [ ] **Step 2: Reuse the canonical identities extracted in Task 1**

Rename the extracted provider-result fallback to `providerResultIdentity` without changing its behavior in `server.mjs`. Add canonical `liveOddsIdentity(entry)` as `provider|matchId|market|selection|finite-line-or-empty`, with exact-string semantics and no observed-time component. Import `snapshotIdentity`, `resultIdentity`, and `liveOddsIdentity` from `server/domain/identity.mjs`. Extend tests for null line, quarter line, model version, provider, selection, and saved-time boundaries; do not create a second identity implementation.

- [ ] **Step 3: Implement parameterized transactional repositories**

- Classify snapshots with `shared/snapshot-policy.mjs` before insertion.
- Persist accepted valid-current and legacy snapshots in `prediction_snapshots`. Persist invalid/rejected source rows only in the Task 4 `import_rows` audit ledger so invalid numeric values cannot conflict with database constraints. `listAll()` returns accepted current and legacy rows for migration parity; `listCurrent()` is the only snapshot query used by current readiness and selects `snapshot_status = 'valid-current'`.
- Use `ON CONFLICT DO NOTHING` for immutable predictions.
- Allow result updates only when incoming `source_priority` is greater than the stored value.
- Replace one provider's live snapshot within a single transaction; never delete another provider's rows.

- [ ] **Step 4: Run GREEN, concurrency, and baseline checks**

Run repository tests twice, once serially and once with the explicit concurrent test. Then run all existing tests and archive hash verification.

- [ ] **Step 5: Independent review gate**

Reviewer compares every identity and source-priority rule with current `server.mjs`, `shared/snapshot-policy.mjs`, and integrity checks.

---

### Task 4: Build the idempotent legacy importer and parity verifier

**Files:**
- Create: `db/migrations/002_import_row_audit.sql`
- Modify: `server/db/snapshot-repository.mjs`
- Modify: `server/db/result-repository.mjs`
- Modify: `server/db/repositories.test.mjs`
- Create: `scripts/import-legacy-to-postgres.mjs`
- Create: `scripts/check-postgres-parity.mjs`
- Create: `scripts/legacy-import.test.mjs`
- Modify: `package.json`
- Create: `.superpowers/sdd-production-phase1/task-4-report.md`

**Interfaces:**

```text
npm run db:migrate
npm run db:import:legacy -- --source-root <path>
npm run db:check:parity -- --source-root <path>
```

The scripts read `DATABASE_URL` from environment, accept a source root, print counts/hashes only, never print secrets, and never call providers.

Repository transaction contract: `createSnapshotRepository(db)` and `createResultRepository(db)` accept either a pool or an already-open transaction client. Pool-backed calls own their transaction; client-backed calls participate in the caller's existing transaction and must not issue nested `BEGIN`/`COMMIT`.

- [ ] **Step 1: Write fixture-based RED tests**

Use temporary copies containing valid-current, legacy missing-commence, invalid odds, duplicate snapshot keys within one file and across two source files, duplicate result identities, and higher-priority results. Tests prove first import counts, second import zero additions, failed run rollback, source hash ledger, every source row retained in the audit ledger even when canonical identities duplicate, row-level classification, and unchanged source bytes.

`002_import_row_audit.sql` removes the global uniqueness constraint from `import_rows.idempotency_key`, makes it a non-unique lookup index, and adds non-null `record_kind` (`snapshot` or `result`). The primary key `(import_run_id, source_row)` remains the row audit identity; repository/domain identities, not the audit table, deduplicate accepted data.

- [ ] **Step 2: Implement import run/row ledger**

For every source file:

1. stream/read bytes and compute SHA-256;
2. create or reuse the unique `import_runs` identity;
3. parse each row without rewriting source;
4. record `import_rows` classification and idempotency key;
5. insert through client-backed repositories inside the same per-file transaction as `import_rows`;
6. mark the run complete only after transaction commit.

- [ ] **Step 3: Implement parity checks**

The verifier loads file-backed and DB-backed data through the same pure domain functions and fails on any mismatch in:

- source SHA-256 and row counts;
- identity sets and classifications;
- valid-current/legacy/invalid counts and rejection reasons;
- distinct matches, readiness, settlements, hit rate, ROI/profit, buckets, and representative backtest rows.

- [ ] **Step 4: Run against isolated fixtures**

Run: `node --test scripts/legacy-import.test.mjs`

Expected: all fixture imports and repeated imports pass.

- [ ] **Step 5: Run read-only parity against the real local archives**

Reset only the disposable test database, migrate it, import the real workspace data, run the importer a second time, and execute parity. Expected baseline: 183 snapshots, 853 results, no late snapshots, no duplicate keys, and unchanged archive hashes. If the computed result differs, stop and report rather than changing an archive or the expected count.

- [ ] **Step 6: Independent review gate**

Reviewer verifies source files were opened read-only, import reruns are idempotent, invalid/legacy rows cannot contaminate current statistics, and parity uses actual domain functions rather than duplicated formulas.

---

### Task 5: Add owner password, session, CSRF, and login throttling services

**Files:**
- Create: `server/auth/password.mjs`
- Create: `server/auth/session.mjs`
- Create: `server/auth/login-throttle.mjs`
- Create: `server/auth/auth-service.mjs`
- Create: `server/auth/auth.test.mjs`
- Create: `scripts/create-owner.mjs`
- Create: `.superpowers/sdd-production-phase1/task-5-report.md`

**Interfaces:**

```js
hashPassword(password): Promise<string>
verifyPassword(hash, password): Promise<boolean>
createAuthService({ pool, clock, randomBytes }): {
  login({ username, password, clientIp }): Promise<LoginResult>;
  authenticate(rawToken): Promise<SessionContext | null>;
  issueCsrf(sessionId): Promise<string>;
  logout(sessionId): Promise<void>;
}
```

- [ ] **Step 1: Write RED security tests**

Cover password minimum 14 characters, Argon2id encoding, wrong-password constant-path verification, disabled owner, five failures/fifteen-minute window, thirty-minute cooldown, cooldown expiry, opaque token randomness, SHA-256-only token storage, 14-day idle and 30-day absolute expiry, last-seen update, revoked session, CSRF hash comparison, and no plaintext secret in returned/logged objects.

- [ ] **Step 2: Implement Argon2id with benchmarked config hook**

Use `@node-rs/argon2` with Argon2id. Keep parameters in a single exported configuration and add a benchmark command that records runtime without logging the password. Do not silently lower below the approved security minimum when slow.

- [ ] **Step 3: Implement DB-backed sessions and throttle**

Generate 32 random bytes for session and CSRF tokens, expose base64url values once, and store only SHA-256 hashes. `issueCsrf` rotates and returns a fresh session-bound raw token so an authenticated `GET /api/v1/session` can restore mutation capability after a PWA reload without storing plaintext CSRF values. Update login attempts and sessions transactionally. Use dependency-injected clock/randomness in tests.

- [ ] **Step 4: Implement the internal owner bootstrap CLI**

`scripts/create-owner.mjs` requires `DATABASE_URL`, reads the password from a hidden terminal prompt or an explicitly mounted password file, rejects command-line plaintext password arguments, creates exactly one owner, and refuses to overwrite an existing owner without an explicit internal rotation workflow.

- [ ] **Step 5: Run GREEN and review**

Run auth tests, migration/repository tests, full Vitest, dependency audit, and a source scan proving no test password or credential entered production files. Independent reviewer checks token/cookie assumptions and timing/cooldown boundaries.

---

### Task 6: Replace the legacy router with a secure injected `/api/v1` application

**Files:**
- Create: `server/http/body.mjs`
- Create: `server/http/cookies.mjs`
- Create: `server/http/responses.mjs`
- Create: `server/http/security.mjs`
- Create: `server/app.mjs`
- Create: `server/app.test.mjs`
- Modify: `server.mjs`
- Modify: `package.json`
- Create: `.superpowers/sdd-production-phase1/task-6-report.md`

**Interfaces:**

```js
createApp({ repositories, auth, publicOrigin, clock, logger }) -> (req, res) => Promise<void>
```

`server.mjs` only loads config, creates pool/repositories/auth/app, listens on configured container host/port, and performs graceful shutdown.

- [ ] **Step 1: Write RED HTTP contract tests**

Start the injected app on an ephemeral local port. Cover:

- unauthenticated login/session/minimal liveness, and authenticated session refresh returning a newly rotated raw CSRF token after reload;
- 401 for odds/results/backtest/predictions without a session;
- login cookie exact attributes: `__Host-odds_session`, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain;
- authenticated odds/results/backtest response shapes;
- logout revocation;
- exact Origin and session-bound CSRF on predictions;
- malformed JSON, auth body over 16 KiB, prediction body over 1 MiB;
- invalid/duplicate/post-kickoff prediction batches;
- safe 4xx/5xx bodies without stack/path/SQL leakage;
- no `Access-Control-Allow-Origin: *`;
- legacy `/api/import/*`, `/api/odds`, `/api/hdc-live`, `/api/backtest`, `/api/predictions`, and `/health` return 404;
- no route invokes `child_process` or a provider fetch.

- [ ] **Step 2: Implement bounded parsing and safe responses**

Stream request bodies while counting bytes, stop and destroy oversized bodies, parse JSON once, and map internal errors to stable codes. Cookie parsing/serialization handles only the exact session cookie and never reflects arbitrary cookie input.

- [ ] **Step 3: Implement route/auth/security middleware explicitly**

Do not add a framework. The small route table declares method, path, auth requirement, body limit, Origin/CSRF requirement, and handler. Public readiness is not routed; `/internal/health/ready` is accepted only when the request originates from the private container listener configuration established in Phase 2.

- [ ] **Step 4: Wire DB-backed handlers**

- `/api/v1/odds/live` returns provider-neutral entries from PostgreSQL.
- `/api/v1/results` returns stored results.
- `/api/v1/backtest` runs the extracted pure domain logic on repository data.
- `/api/v1/predictions` validates/classifies and inserts immutable batches.
- login/logout/session use the auth service.

- [ ] **Step 5: Run GREEN and regression gates**

Run app tests, server self-test, all server tests, 139 Vitest tests, build, integrity, audit, and archive hashes. Reviewer verifies public route inventory and safe failures.

---

### Task 7: Move the PWA to authenticated same-origin data

**Files:**
- Create: `src/apiClient.ts`
- Create: `src/apiClient.test.ts`
- Create: `src/pages/LoginPage.tsx`
- Create: `src/pages/LoginPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/predictionSnapshots.ts`
- Modify: `src/predictionSnapshots.test.ts`
- Modify: `src/pwaConfig.test.ts`
- Modify: `tests/ui/dashboard.spec.ts`
- Modify: `vite.config.ts`
- Remove after verified migration bundle copy: `public/hkjc-odds.json`
- Create: `.superpowers/sdd-production-phase1/task-7-report.md`

**Interfaces:**

```ts
createApiClient(fetchImpl = fetch): {
  session(): Promise<SessionState>;
  login(username: string, password: string): Promise<SessionState>;
  logout(csrfToken: string): Promise<void>;
  liveOdds(): Promise<LiveOddsResponse>;
  backtest(): Promise<BacktestResponse>;
  savePredictions(csrfToken: string, snapshots: PredictionSnapshot[]): Promise<void>;
}
```

- [ ] **Step 1: Write RED frontend/API-client tests**

Prove every URL is relative `/api/v1`, credentials use same-origin cookies, non-2xx/invalid bodies fail closed, authenticated `session()` refreshes the in-memory CSRF token after reload, the CSRF header appears only on mutations, 401 clears authenticated UI state, and no source contains `127.0.0.1:8787`.

- [ ] **Step 2: Write RED LoginPage/App tests**

Cover initial session loading, single-owner username/password form, disabled submit while pending, generic invalid-login copy, cooldown copy without account disclosure, authenticated shell, logout, offline unauthenticated state, stale/failing protected data hiding picks, and no password persistence/logging.

- [ ] **Step 3: Implement one API client and auth gate**

All App data loaders consume `apiClient`. App does not mount odds/history/model requests until session authentication succeeds. A 401 returns to LoginPage and clears in-memory odds/picks. Logout revokes the server session before clearing UI; network failure remains fail-closed.

- [ ] **Step 4: Remove the public static odds path safely**

Before removal, record the exact `public/hkjc-odds.json` hash in the migration bundle/report. Update importer code in Task 8 so no runtime writes to `public/`. Verify the production build and service worker contain no odds JSON. Use `apply_patch` for text-source removal; preserve the migration copy as read-only data outside the public build.

- [ ] **Step 5: Update Playwright network contract**

Mock `/api/v1/session`, login/logout, odds, backtest, predictions, and health. Add login-first flows for all four viewports, unauthenticated denial, session expiry, logout, stale/offline failure, and existing 3%/pre-match/one-card/touch/overflow assertions. Abort any unmocked external request.

- [ ] **Step 6: Run GREEN**

Run focused frontend tests, full Vitest, production build, Playwright, and generated service-worker inspection. Expected: no loopback URL, no public odds JSON, no cached API/data response, and all responsive behavior preserved.

- [ ] **Step 7: Independent review gate**

Reviewer checks password handling, session transitions, fail-closed races, service-worker cache, and the complete browser request inventory.

---

### Task 8: Add PostgreSQL collector sinks without enabling paid automation

**Files:**
- Create: `scripts/lib/postgres-sink.mjs`
- Create: `scripts/lib/postgres-sink.test.mjs`
- Modify: `scripts/hdc-collector.mjs`
- Modify: `scripts/hkjc-import.mjs`
- Modify: `scripts/odds-monitor.mjs`
- Modify: `scripts/check-data-integrity.mjs`
- Create: `.superpowers/sdd-production-phase1/task-8-report.md`

**Interfaces:**

```js
createPostgresSink({ pool }) -> {
  acquireCollectorLock(name, callback): Promise<"ran" | "busy">;
  saveLiveOdds(provider, observedAt, entries): Promise<void>;
  saveSnapshots(snapshots): Promise<InsertSummary>;
  saveResults(results): Promise<UpsertSummary>;
  loadCollectorState(key): Promise<object | null>;
  saveCollectorState(key, state): Promise<void>;
}
```

- [ ] **Step 1: Write RED sink tests with all provider networks denied**

Use fixture inputs only. Prove PostgreSQL advisory lock exclusion, transaction rollback, immutable snapshots, source-priority results, provider-scoped live replacement, state persistence, and zero JSON/JSONL writes in PostgreSQL mode.

- [ ] **Step 2: Separate collection from persistence**

Refactor each script so parsing/decision logic accepts an injected sink. Keep existing file sink only as a temporary local compatibility path; production configuration requires `STORAGE_BACKEND=postgres` and refuses startup without `DATABASE_URL`.

- [ ] **Step 3: Implement the PostgreSQL sink**

Use the Task 3 repositories and `pg_try_advisory_lock`/`pg_advisory_unlock` around each named cycle. Always release locks in `finally`. A failed provider response or write leaves previous rows present but stale.

- [ ] **Step 4: Extend integrity checking to PostgreSQL**

Add an explicit `--database` mode that reads repository data and applies the same identity, timing, negative-score, classification, and duplicate checks. Default file mode remains read-only.

- [ ] **Step 5: Run self-tests and DB fixture tests only**

Run the three script self-tests, sink tests, database integrity mode against fixture data, and all previous gates. Do not run live collector/import commands and do not load provider keys.

- [ ] **Step 6: Independent review gate**

Reviewer verifies no browser/public route can invoke these scripts, all network tests deny external access, advisory locks are released, and file compatibility cannot be selected accidentally in production.

---

### Task 9: Phase 1 final parity, security, and handoff gate

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/local-postgres-development.md`
- Create: `docs/runbooks/legacy-migration.md`
- Create: `.superpowers/sdd-production-phase1/final-report.md`

**Interfaces:**
- Produces the approved application/database artifact consumed by the separate Phase 2 VM/Compose/Tunnel plan.

- [ ] **Step 1: Run the complete fresh verification matrix**

Run, without paid keys:

```powershell
npm.cmd run server:self-test
node scripts/odds-monitor.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/hdc-collector.mjs --self-test
npm.cmd run check:data
npm.cmd test
npm.cmd run test:server
npm.cmd run build
npm.cmd run test:ui:only
npm.cmd audit --omit=dev
npm.cmd audit
```

Also run migrations twice, real-archive import twice into a disposable database, file/DB parity, PostgreSQL integrity mode, generated service-worker forbidden-cache inspection, source scan for loopback/wildcard CORS/public importer routes, and archive SHA-256 comparison.

- [ ] **Step 2: Run a security-focused black-box pass**

Verify unauthenticated denial, login cooldown, session expiry/revocation, CSRF/Origin, body limits, safe errors, 401 UI clearing, logout, no public odds JSON, and no provider network traffic.

- [ ] **Step 3: Perform whole-phase independent review**

Reviewer reads the complete Phase 1 diff/current files and reports Critical/Important/Minor findings. Fix every Critical/Important with systematic debugging and strict TDD, then rerun covering and full gates.

- [ ] **Step 4: Record the Phase 2 contract**

The final report records schema migration version, image/runtime requirements, environment and secret names (never values), internal ports, readiness paths, owner bootstrap command, exact archive hashes/counts, resource expectations, and remaining limitations. Do not deploy to the VM in Phase 1.

## Plan self-review

- Spec coverage: same-origin API, PostgreSQL, legacy import, owner auth, CSRF/rate/body limits, protected odds, collector DB sink, parity, and all Phase 1 gates are assigned to explicit tasks.
- Scope: VM Compose/Tunnel, SSH changes, S3 backup, GitHub, image deployment, DNS, and production cutover are intentionally deferred to separate Phase 2 and Phase 3 plans.
- Type consistency: repositories feed both importer, HTTP handlers, and collector sink; `createApp` receives the same repository/auth interfaces tested independently; frontend consumes only `/api/v1`.
- Placeholder scan: no implementation placeholder or unassigned requirement remains.
