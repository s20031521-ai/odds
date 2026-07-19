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

