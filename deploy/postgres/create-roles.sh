#!/bin/sh
# One-shot role bootstrap for the odds database. Run on the VM with sudo:
#   sudo /opt/odds-tool/postgres/create-roles.sh
# Idempotent: safe to re-run (also re-locks passwords to the mounted secrets).
#
# Why not docker-entrypoint-initdb.d: this Docker/Compose version ignores
# secret uid/gid/mode and mounts /run/secrets root-only, so the postgres
# user running init scripts cannot read them (see task-1 report).
set -eu

APP_PW="$(cat /opt/odds-tool/secrets/pg_app_password)"
MIGRATION_PW="$(cat /opt/odds-tool/secrets/pg_migration_password)"

docker exec -i odds-tool-postgres-1 psql -U postgres -d odds -v ON_ERROR_STOP=1 \
  -v app_pw="$APP_PW" \
  -v migration_pw="$MIGRATION_PW" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'odds_app') THEN
    CREATE ROLE odds_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'odds_migration') THEN
    CREATE ROLE odds_migration LOGIN;
  END IF;
END
$$;

-- Always converge passwords to the mounted secrets.
ALTER ROLE odds_app PASSWORD :'app_pw';
ALTER ROLE odds_migration PASSWORD :'migration_pw';

GRANT CONNECT ON DATABASE odds TO odds_app, odds_migration;
GRANT USAGE ON SCHEMA public TO odds_app;
GRANT USAGE, CREATE ON SCHEMA public TO odds_migration;

-- Tables created later by odds_migration become CRUD-able by odds_app.
ALTER DEFAULT PRIVILEGES FOR ROLE odds_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odds_app;

-- Sequences too: INSERTs use nextval() on identity/serial columns.
ALTER DEFAULT PRIVILEGES FOR ROLE odds_migration IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO odds_app;

-- Converge objects that already exist (idempotent; covers anything
-- created before these grants or by a different path).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odds_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odds_app;
SQL

echo "[create-roles] odds_app + odds_migration converged"
