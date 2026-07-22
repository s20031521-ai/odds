# Unified Buyable Odds v1 release handoff

Date: 2026-07-22  
Branch: `codex/unified-buyable-v1`  
Rollback source commit: `56c5aa4`  
Migration: `db/migrations/004_unified_buyable.sql`

## Status

`unified-buyable-v1` is implemented and locally verified. No production backup,
migration, image rebuild, deployment, tag, or monitoring action has been run.
Those remain operator actions requiring separate deployment authority.

## Verification evidence

Run from the isolated worktree with the disposable test database at the exact
test URL documented in `docs/runbooks/local-postgres-development.md`.

```text
npm.cmd test
  40 files, 264 tests passed

npm.cmd run build
  TypeScript passed; Vite transformed 1617 modules

npm.cmd run server:self-test
node scripts/hdc-collector.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/odds-monitor.mjs --self-test
node scripts/unified-sampler.mjs --self-test
  all passed

node --test server/app.test.mjs server/auth/auth.test.mjs server/db/migrate.test.mjs server/db/repositories.test.mjs
  63 passed

node --test scripts/lib/postgres-sink.test.mjs scripts/hdc-collector-pg.test.mjs scripts/odds-monitor-pg.test.mjs scripts/hkjc-import-pg.test.mjs scripts/unified-sampler-pg.test.mjs scripts/check-data-integrity.test.mjs
  50 passed

node --test scripts/legacy-import.test.mjs
  6 passed, 1 skipped because Windows symlink privilege was unavailable

npm.cmd run test:ui:only
  84 passed across desktop, tablet, tablet-landscape, and phone
```

Disposable-database rollout rehearsal:

```text
npm.cmd run db:migrate
  migrationsApplied=4

npm.cmd run db:import:legacy -- --source-root .
  sourceRows=1036; auditRowsAdded=1036; status=complete

# Second identical import
  auditRowsAdded=0; status=complete

npm.cmd run db:check:parity -- --source-root .
  status=ok; snapshotRows=183; resultRows=853

node scripts/check-data-integrity.mjs --database
  duplicate/future/post-kick/negative-score metrics all zero
```

Red-line checks: `src/pages/BuyDashboard.tsx`, `package.json`, and the committed
`package-lock.json` have zero diff from `56c5aa4`; the collector entrypoint is
LF in both index and worktree; no provider, model threshold, result priority,
secret, or production archive was changed.

## Required pre-deploy backups

Run these before syncing or rebuilding production. Keep the generated artifacts
outside the repository and verify that both files are non-empty.

```bash
git archive --format=tar.gz --output=/opt/odds-tool/backups/unified-buyable-v1-$(date +%F-%H%M).tar.gz 521eda5
sudo -A docker exec odds-tool-postgres-1 pg_dump -U postgres -d odds -Fc > /opt/odds-tool/backups/odds-unified-buyable-v1-$(date +%F-%H%M).dump
```

Before rebuilding, preserve the current application images as the rollback
point:

```bash
sudo -A docker tag odds-tool-api:latest odds-tool-api:rollback
sudo -A docker tag odds-tool-caddy:latest odds-tool-caddy:rollback
```

## Operator deployment order

Follow `docs/runbooks/production-deployment.md`. The required order for this
release is:

1. Validate the Compose configuration and sync the reviewed archive.
2. Build `api` and `caddy` images.
3. Start and health-check PostgreSQL.
4. Converge database roles.
5. Apply additive migration `004_unified_buyable.sql` with the migration role.
6. Recreate `api`, then `caddy`.
7. Smoke-test internal readiness, authenticated API boundaries, public PWA,
   Caddy's hidden internal route, and Cloudflare/TLS headers.
8. Only after smoke tests pass, recreate `collector`; verify its first loop runs
   HDC, conditionally HKJC, and exactly one unified sampler.
9. Start or retain `cloudflared` last.

Do not add a second sampler schedule. The collector entrypoint is the single
production supervisor for the five-minute cadence.

## Rollback

Application rollback uses the pre-deploy `api:rollback` and `caddy:rollback`
tags. Stop `cloudflared` first for any exposure or integrity incident. Migration
`004` is additive and old rows remain readable as `legacy-v0`; do not reverse it
blindly. If an application rollback cannot safely read the migrated schema,
keep traffic off and restore the verified pre-deploy `pg_dump` according to the
production runbook.

## First 48 hours

Record a baseline at deploy time, then check at least hourly for the first six
hours and every six hours thereafter:

- opportunity and observation growth rate, split by market and strategy;
- duplicate observation fingerprint count (must remain zero);
- stale provider and stale quote counts, including true `observedAt` age;
- current opportunities whose latest observation is empty or post-kick;
- dead pending opportunities and seven-day `unsettleable` transitions;
- result coverage and source-priority corrections by h2h, handicap, totals,
  and corners;
- readiness distinct `fixture + market` counts and settled push/void handling;
- The Odds API remaining quota and API-Football request budget;
- current/backtest/observations API error rate and latency;
- collector cycle order, advisory-lock busy count, and exactly one sampler run
  per five-minute iteration.

Stop the collector and investigate before spending more provider quota if
duplicate sampling, future observations, post-kick current cards, result
priority regression, or unexpected API-Football growth is observed.
