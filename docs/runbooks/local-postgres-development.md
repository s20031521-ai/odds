# Runbook: Local PostgreSQL Development

How to work against the **disposable** PostgreSQL test database. Never point any of these commands at production. Environment variable **names** are listed below; values live only in your shell session or the tunnel/compose definition — never in the repo, reports, or logs.

## 1. Get a disposable database

Either:

- **SSH tunnel** to the VM-hosted disposable instance, exposing it as
  `postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test` (this exact URL is asserted by all DB test helpers — see `scripts/lib/test-db.mjs`), or
- **`compose.test.yaml`** local container, if Docker is available.

Confirm reachability before running anything DB-backed.

## 2. Environment variables (names only)

| Name | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | server, migrations, importer, parity, integrity `--database`, DB tests | must equal the disposable URL for tests |
| `SESSION_SECRET` | server runtime | ≥ 32 bytes; throwaway locally |
| `PUBLIC_ORIGIN` | server runtime | **strictly HTTPS**; `http://127.0.0.1` is rejected by `server/config.mjs` |
| `RUN_MIGRATIONS` | server runtime | only exact `false` skips startup migrations; default runs them |
| `TRUSTED_PROXY_CIDRS` | server runtime | comma-separated IPv4 CIDRs allowed to set `X-Forwarded-For`; default empty trusts nothing |
| `OWNER_USERNAME` | one-time owner bootstrap | |
| `OWNER_PASSWORD_FILE` | one-time owner bootstrap | path to a secret file; delete after use |
| `STORAGE_BACKEND` | collector scripts | `file` (default) or `postgres` |
| `ODDS_API_KEY`, `API_FOOTBALL_KEY` | collectors/importer | from `.env.local`; never print |

Export them in the shell; do **not** write them into files.

## 3. Schema migrations

```bash
export DATABASE_URL="postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test"
npm run db:migrate
```

Idempotent: the second run reports `migrationsApplied=0`. Current schema version: **003** (`db/migrations/001`–`003`). The server entry (`server/entry.mjs`) also runs migrations automatically at startup unless `RUN_MIGRATIONS=false` (used by the Phase 2 api container; a one-shot migration job runs them instead).

## 4. Legacy archive import + parity

⚠️ **The npm scripts require `--source-root`; the bare invocations fail with `status=failed`.** Working commands:

```bash
npm run db:import:legacy -- --source-root .
npm run db:import:legacy -- --source-root .   # second run: zero additions (already-complete)
npm run db:check:parity -- --source-root .
```

Expected parity: `status=ok`, snapshotRows=183, resultRows=853, valid-current=3, legacy=93, invalid=87, distinctMatches=286, settlements=0. See `docs/runbooks/legacy-migration.md` for semantics.

## 5. Integrity check against the database

```bash
node scripts/check-data-integrity.mjs --database
```

Read-only; prints `mode=database` plus the same metric lines as file mode; exits non-zero on failures. Without `DATABASE_URL` it exits 1 with a clear error. Default file mode (`npm run check:data`) is unchanged.

## 6. Server + owner bootstrap (local)

```bash
export DATABASE_URL=...            # disposable DB
export SESSION_SECRET=...          # throwaway, ≥32 bytes
export PUBLIC_ORIGIN="https://odds.local"   # must be HTTPS even locally
npm run server                     # loopback 127.0.0.1:8787

export OWNER_USERNAME=...
export OWNER_PASSWORD_FILE=/path/to/temp-secret   # delete afterwards
npm run auth:create-owner
```

The frontend (`npm run dev`) talks to the same-origin `/api/v1`; there is no dev proxy yet, so UI-only work uses the Playwright mocks.

## 7. Test commands and which need `DATABASE_URL`

| Command | Needs disposable DB? |
|---|---|
| `npm run server:self-test` | no |
| `node scripts/{hdc-collector,hkjc-import,odds-monitor}.mjs --self-test` | no |
| `npm run check:data` | no |
| `npm test` (vitest, `src/**`) | no |
| `node --test scripts/lib/storage-backend.test.mjs` | no |
| `npm run build` / `npm run test:ui:only` | no |
| `node --test server/app.test.mjs server/auth/auth.test.mjs` | **yes — both are DB-backed**, despite living outside `server/db/` |
| `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs` | yes |
| `node --test scripts/lib/postgres-sink.test.mjs scripts/hdc-collector-pg.test.mjs scripts/odds-monitor-pg.test.mjs scripts/hkjc-import-pg.test.mjs scripts/check-data-integrity.test.mjs` | yes |

All DB tests use `scripts/lib/test-db.mjs` (`withDatabase`/`withDatabaseUrl`): a unique UUID schema per test, migrations run in, dropped afterwards, and a hard assertion that `DATABASE_URL` is exactly the disposable URL. They skip cleanly when `DATABASE_URL` is unset.

## 8. Collector storage backend

Collectors default to file mode. PostgreSQL persistence is opt-in:

```bash
export STORAGE_BACKEND=postgres   # requires DATABASE_URL; NODE_ENV=production rejects anything else
```

Do not run collectors against live providers for verification — use `--self-test` and the fixture-driven pg tests only.
