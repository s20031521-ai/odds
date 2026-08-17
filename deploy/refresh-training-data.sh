#!/bin/sh
# Weekly refresh of offline training data on the production VM (root cron).
#
#   1. download the CURRENT season's football-data CSVs (scorelines + closing odds)
#   2. re-fetch the current season's Understat xG (older seasons are cached
#      and immutable, so only the live season is re-requested)
#   3. upsert both into the production DB — import and join are idempotent
#
# Season rollover is automatic: from July onward the script targets the
# season starting this calendar year, so a new season's files appear as soon
# as the providers publish them. Historical rows are never touched.
#
# Install (root crontab):
#   47 6 * * 3 /opt/odds-tool/build/deploy/refresh-training-data.sh
#
# Log: /var/log/odds-data-refresh.log

set -eu

BUILD=/opt/odds-tool/build
NETWORK=odds-tool_db_net
SECRETS=/opt/odds-tool/secrets
LOG=/var/log/odds-data-refresh.log
LEAGUES="E0 SP1 D1 I1 F1"

cd "$BUILD"

YEAR=$(date -u +%Y)
MONTH=$(date -u +%m)
if [ "$MONTH" -ge 7 ]; then START=$YEAR; else START=$((YEAR - 1)); fi
SEASON_CODE=$(printf '%02d%02d' "$((START % 100))" "$(((START + 1) % 100))")

echo "[refresh] $(date -Is) season=$SEASON_CODE start" >> "$LOG"

# 1. football-data current-season CSVs (404 early in the season is fine)
for LG in $LEAGUES; do
  TMP="data/historical/.${LG}-${SEASON_CODE}.tmp"
  if curl -fsS "https://www.football-data.co.uk/mmz4281/${SEASON_CODE}/${LG}.csv" -o "$TMP" 2>> "$LOG"; then
    mv "$TMP" "data/historical/${LG}-${SEASON_CODE}.csv"
    echo "[refresh] downloaded ${LG}-${SEASON_CODE}.csv" >> "$LOG"
  else
    rm -f "$TMP"
    echo "[refresh] warn: ${LG} ${SEASON_CODE} not available yet" >> "$LOG"
  fi
done

# 2. Understat xG for the live season (host has internet; no deps needed)
node scripts/fetch-understat-xg.mjs --from "$START" --to "$START" --force >> "$LOG" 2>&1

# 3. DB upserts run inside the network (postgres publishes no host ports)
APP_URL="postgres://odds_app:$(cat "$SECRETS/pg_app_password")@postgres:5432/odds"

docker run --rm --network "$NETWORK" \
  -v "$BUILD/data/historical:/app/data/historical:ro" \
  -e DATABASE_URL="$APP_URL" \
  --entrypoint node odds-tool-api:latest \
  scripts/import-historical-scores.mjs --dir data/historical >> "$LOG" 2>&1

docker run --rm --network "$NETWORK" \
  -v "$BUILD/data/understat:/app/data/understat:ro" \
  -e DATABASE_URL="$APP_URL" \
  --entrypoint node odds-tool-api:latest \
  scripts/join-xg-history.mjs >> "$LOG" 2>&1

echo "[refresh] $(date -Is) done" >> "$LOG"
