#!/bin/sh
# odds-tool collector entrypoint (Phase 2 Task 6 Step 4).
#
# Compose mounts secrets root-only (this Docker ignores secret uid/gid/mode),
# so this script starts as root, composes the env from /run/secrets, then
# drops to uid/gid 1000 (node) via setpriv before running the supervisor loop.
#
# Loop cadence: hdc-collector every 5 minutes. The collector is state-driven
# (discovery 15 min, odds window 25/5 min, score delay 3 h), so idle cycles
# make ZERO provider calls. hkjc-import (free HKJC source) runs every 3rd
# cycle (~15 min). Paid quota is guarded inside hdc-collector (keeps 50
# credits in reserve, honors provider cooldowns).
set -eu

PG_PW="$(cat /run/secrets/pg_app_password)"
export DATABASE_URL="postgres://odds_app:${PG_PW}@postgres:5432/odds"
unset PG_PW
export ODDS_API_KEY="$(cat /run/secrets/odds_api_key)"
export API_FOOTBALL_KEY="$(cat /run/secrets/api_football_key)"
export STORAGE_BACKEND=postgres NODE_ENV=production

cd /app

# Supervisor loop (runs as uid 1000). Each iteration is one collector cycle;
# a failing cycle is logged and the loop continues.
exec setpriv --reuid=1000 --regid=1000 --init-groups /bin/sh -c '
i=0
while :; do
  node scripts/hdc-collector.mjs || echo "[collector-loop] hdc-collector exited nonzero" >&2
  if [ $((i % 3)) -eq 0 ]; then
    node scripts/hkjc-import.mjs || echo "[collector-loop] hkjc-import exited nonzero" >&2
  fi
  i=$((i + 1))
  sleep 300
done
'
