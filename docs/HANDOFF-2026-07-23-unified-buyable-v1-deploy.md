# Unified Buyable Odds v1 — deployment handoff

Date: 2026-07-23 (Asia/Shanghai)
Deploy commit: `0250666` (master HEAD)
Release branch: `codex/unified-buyable-v1` (merged, deleted)
Rollback source commit: `56c5aa4`
Migration: `db/migrations/004_unified_buyable.sql`

## Status

**Deployed.** All 9 operator steps executed and verified on the production VM
(`118.140.60.206:169`, user `hugo`, stack root `/opt/odds-tool/`).

## Deploy summary

| # | Step | Result |
|---|------|--------|
| — | Pre-deploy backup (git archive + pg_dump) | 2.8 MB tarball + 209 KB dump in `/opt/odds-tool/backups/` |
| — | Rollback image tags (`api:rollback`, `caddy:rollback`) | Tagged from running images before rebuild |
| 1 | Sync code to `/opt/odds-tool/build/` | Tarball extracted from `git archive HEAD` |
| 2 | Validate compose + build images | CONFIG-OK; api + caddy built clean |
| 3 | PostgreSQL health check | Already healthy |
| 4 | Converge roles | `odds_app` + `odds_migration` converged |
| 5 | Apply migration 004 | `migrationsApplied=1` |
| 6 | Recreate api + caddy | Both healthy |
| 7 | Smoke tests | All passed (see below) |
| 8 | Recreate collector | First loop OK: HDC, HKJC import, unified sampler |
| 9 | Cloudflared | 4 tunnels connected |

## Issues resolved during deploy

### 1. Migration entrypoint moved
The migration CLI entrypoint moved from `db/migrate.mjs` to
`server/db/migrate-cli.mjs` in the current tree. The `docker run` invocation
must use the new path. The container image build copies `server/` into the
image, so no host mount is needed for the migration runner itself.

### 2. Migration checksum drift
`001_initial.sql` in the new tarball has checksum
`bcf0fffd23df…`; the DB schema_migrations table records
`978f069ed8c2…`. The migration framework correctly refuses to proceed
on checksum mismatch. Resolution: mount the old migrations directory
(`/opt/odds-tool/app/db/migrations/`) over the image's built-in copy so
already-applied files retain their original checksums. Only 004 is new.

### 3. CRLF in deploy entrypoint scripts
`deploy/api-entrypoint.sh` and `deploy/collector-entrypoint.sh` were archived
with Windows CRLF line endings from the local git worktree. The container
could not execute them (`/bin/sh^M: not found`). Fixed with:
```bash
sed -i 's/\r$//' deploy/api-entrypoint.sh deploy/collector-entrypoint.sh
```
Images were rebuilt after the fix.

### 4. Secrets path mismatch
`deploy/compose.yaml` references secrets as `./secrets/<name>`, which resolves
relative to the compose file (`/opt/odds-tool/build/deploy/secrets/`).
Production secrets live at `/opt/odds-tool/secrets/`. Resolution:
```bash
ln -s /opt/odds-tool/secrets /opt/odds-tool/build/deploy/secrets
```
This symlink must be recreated if the build directory is wiped and re-extracted.

### 5. PowerShell ↔ bash quoting
All remote commands were executed over SSH from a Windows PowerShell session.
Shell `` command substitution in double-quoted SSH command strings is
interpreted by PowerShell before reaching bash. Workaround: write scripts
locally with PowerShell here-strings (``@"…"@``), scp them to the VM, and
execute via `bash /tmp/script.sh`. The VM sudo-rs `-A` flag works with a
properly constructed askpass helper.

## Pre-deploy verification (from release handoff)

Full release verification in `docs/HANDOFF-2026-07-22-unified-buyable-v1.md`.
Key results: 264 unit tests, 63 server tests, 50 PG tests, 84 UI tests,
disposable-DB rollout rehearsal, all red-line checks clean.

## Backup artifacts

| Artifact | Location | Size |
|----------|----------|------|
| Source tarball (git archive HEAD) | `/opt/odds-tool/backups/unified-buyable-v1-2026-07-23-0034.tar.gz` | 2.8 MB |
| Pre-deploy pg_dump | `/opt/odds-tool/backups/odds-dump-2026-07-23-0034.dump` | 209 KB |
| Rollback image tag | `odds-tool-api:rollback` | — |
| Rollback image tag | `odds-tool-caddy:rollback` | — |

## Smoke test results

```text
Internal readiness:
  http://api:8787/internal/health/ready  → 200
  http://caddy/internal/health/ready     → 404 (correctly hidden)
  http://caddy/api/v1/session            → 200 {"authenticated":false}

Public:
  https://odds.ballballchu.com.hk/                 → 200
  https://odds.ballballchu.com.hk/api/v1/results   → 401
  https://odds.ballballchu.com.hk/internal/health/ready → 404
  HSTS header: present

Cloudflared: 4 Registered tunnel connections
```

## Collector first loop

```text
[hkjc-import] wrote 87 HAD, 87 HIL, 31 CHL, 57 HDC entries
              and 651 result comparisons to postgres
[unified-sampler] ran
[hkjc-import] API-Football corner odds skipped: API-Football 200
```

## Migration ledger

```
         version          |          applied_at
--------------------------+-------------------------------
 001_initial.sql          | 2026-07-18 20:20:23.917244+00
 002_import_row_audit.sql | 2026-07-18 20:20:23.929051+00
 003_auth_constraints.sql | 2026-07-18 20:20:23.931133+00
 004_unified_buyable.sql  | 2026-07-22 16:52:18.823062+00
(4 rows)
```

## Rollback

Same procedure as the release handoff. Quick reference:

```bash
# Kill-switch (exposure incident)
sudo -A docker compose -f deploy/compose.yaml stop cloudflared

# App rollback
sudo -A docker tag odds-tool-api:rollback odds-tool-api:latest
sudo -A docker compose -f deploy/compose.yaml up -d --no-deps --force-recreate api collector
sudo -A docker tag odds-tool-caddy:rollback odds-tool-caddy:latest
sudo -A docker compose -f deploy/compose.yaml up -d --no-deps --force-recreate caddy

# DB rollback (only if app rollback incompatible with schema)
# Restore from: /opt/odds-tool/backups/odds-dump-2026-07-23-0034.dump
sudo -A docker exec -i odds-tool-postgres-1 pg_restore -U postgres -d odds --clean --if-exists < <dump>
```

Migration 004 is additive. Do not reverse it blindly. If rolling back the
application, old rows remain readable as `legacy-v0`.

## First 48 hours

Same monitoring checklist as the release handoff. Baseline recorded at deploy
time (2026-07-23 ~00:55 Asia/Shanghai). Check at least hourly for the first
six hours and every six hours thereafter.

## Known quirks for future deploys

1. **Secrets symlink**: `deploy/secrets` in the build directory must be a
   symlink to `/opt/odds-tool/secrets/`. Recreate it after extracting a new
   tarball.
2. **CRLF**: If building from a tarball created on Windows, strip CR from
   `deploy/*.sh` before building images.
3. **Migration checksums**: The `db/migrations/*.sql` files in the tarball may
   have different checksums than what's recorded in the DB. The migration
   framework will refuse to proceed. Mount the old migration directory (from
   the previous working app) instead of relying on the tarball copies.
4. **Migration entrypoint**: Use `server/db/migrate-cli.mjs`, not
   `db/migrate.mjs`.
