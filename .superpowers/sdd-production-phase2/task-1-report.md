# Phase 2 Task 1 Report: Compose Stack Skeleton — postgres, networks, volumes, secrets

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 1.

## Files created (repo)

- `deploy/compose.yaml` — Compose project `odds-tool`; postgres-only for this task; networks `tunnel_net` / `app_net` / `db_net` (internal); volume `pgdata`; no `ports:` on any service; digest-pinned image; 1g mem limit; bounded json-file logs.
- `deploy/postgres/create-roles.sh` — idempotent least-privilege role bootstrap (see deviation below).
- `deploy/secrets/README.md` — secret names, permissions, creation/rotation procedure (no values).
- `.superpowers/sdd-production-phase2/task-1-report.md` (this file).

## Deviation from plan: role bootstrap moved out of `docker-entrypoint-initdb.d`

Plan called for `deploy/postgres/init/01-roles.sql` reading mounted secrets at bootstrap. Two findings made that impossible on this VM:

1. The VM's Docker/Compose (Engine 29.6.1 / Compose v5.3.1) **ignores secret `uid`/`gid`/`mode`** (`warning: secrets uid, gid and mode are not supported, they will be ignored`).
2. Secrets therefore mount `/run/secrets/*` **root-only**, and init scripts run as the `postgres` user → `cat: /run/secrets/pg_app_password: Permission denied`; roles were not created.

Resolution: role creation runs post-start as `deploy/postgres/create-roles.sh` via `sudo docker exec` (root inside the container reads `/run/secrets` fine; local socket is trust-auth during bootstrap). The script is idempotent (`DO ... IF NOT EXISTS` + `ALTER ROLE ... PASSWORD` convergence to the mounted secrets). The init-directory mount was removed from `compose.yaml`.

## What was done on the VM

1. Secrets generated on the VM (never transited this machine): `pg_postgres_password`, `pg_app_password`, `pg_migration_password` — `openssl rand -hex 24`, files at `/opt/odds-tool/secrets/`, `0400 root:root`.
2. Image pinned: `postgres:18-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296` (18.4).
3. `docker compose config` — clean.
4. `docker compose up -d postgres` — healthy on `odds-tool_db_net`; database `odds` created.
5. `create-roles.sh` — `odds_app` (CRUD-only) + `odds_migration` (DDL) converged; `ALTER DEFAULT PRIVILEGES` grants future migration-owned tables to `odds_app`.
6. Migrations 001–003 applied via one-shot container: `node:24-bookworm-slim`, repo subset mounted ro at `/app`, `pg@8.22.0` from `/opt/odds-tool/migrate-deps` mounted at `/app/node_modules` (host-side empty `app/node_modules` dir required as mountpoint because `/app` is ro), `DATABASE_URL` composed at runtime from the `pg_migration_password` secret. Result: `migrationsApplied=3`, `status=complete`; ledger `schema_migrations` has 001/002/003.

## Gate verification

- postgres healthy on `db_net`, schema 003: **PASS**
- Zero published host ports — `ss -tln` shows only pre-existing listeners (`:22`, `10.80.10.85:2222`, `127.0.0.1:55432`): **PASS**
- `docker compose config` clean: **PASS**
- Least privilege proven live: `odds_app` `SELECT count(*) FROM schema_migrations` → 3; `CREATE TABLE ddl_probe` → `permission denied for schema public`: **PASS**

## Notes for Task 2

- `server/entry.mjs` runs `runMigrations` at startup with the app pool; `odds_app` has no DDL. Task 2 must add a migration-skip path (e.g. `RUN_MIGRATIONS=false`, strict TDD) or the api service will crash-loop. Migrations run only via the one-shot migration container (migration role).
- `/opt/odds-tool/app/` currently holds only `server/db/*.mjs` + `db/migrations/*.sql` (migration subset); Task 2 replaces this with the built application image.
- `/opt/odds-tool/migrate-deps/` (pg driver) and the empty `/opt/odds-tool/app/node_modules` mountpoint are required by the migration procedure — documented in `docs/runbooks/local-postgres-development.md` successor (production runbook in Task 7).
- Existing stacks (`astra`, `store-network-dashboard`, `odds-tool-test`) untouched throughout.
