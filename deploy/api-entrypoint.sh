#!/bin/sh
# odds-tool api container entrypoint (Phase 2 Task 2).
# Composes secrets-bearing env at runtime from /run/secrets so no secret is
# stored in the image, in compose env, or in the repo.
set -eu

: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is required (strict HTTPS origin)}"

export DATABASE_URL="postgresql://odds_app:$(cat /run/secrets/pg_app_password)@postgres:5432/odds"
export SESSION_SECRET="$(cat /run/secrets/session_secret)"

export NODE_ENV=production
# Migrations are applied by the one-shot migration job (odds_migration role),
# never by the long-running api container.
export RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
export HOST=0.0.0.0
export PORT=8787

# Drop to the non-root node user (uid/gid 1000) now that secrets are read.
# setpriv exec's the server directly, keeping it PID 1 for clean SIGTERM.
exec setpriv --reuid=1000 --regid=1000 --init-groups node server/entry.mjs
