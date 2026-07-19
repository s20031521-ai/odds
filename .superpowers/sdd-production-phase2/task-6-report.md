# Phase 2 Task 6 Report: Cloudflare Tunnel Go-Live

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 6.

## Pre-step — Owner-approved one-shot hkjc-import (free path, proves pg write path)

- First run **failed** on a real least-privilege gap: `odds_app` had table CRUD (via default privileges) but **no sequence USAGE** → `permission denied for sequence results_id_seq`. Fixed `deploy/postgres/create-roles.sh` (added `ALTER DEFAULT PRIVILEGES … ON SEQUENCES` + explicit `GRANT … ON ALL TABLES/SEQUENCES` for existing objects), synced to both VM locations, re-ran (idempotent) — role converged.
- Second run (one-shot container on db_net + app_net, `STORAGE_BACKEND=postgres`, `NODE_ENV=production`, app role, `API_FOOTBALL_KEY` from secret): **success** — 37 HAD + 37 HIL + 28 CHL + 30 HDC live odds entries and 717 result comparisons written to production PostgreSQL; API-Football responded 200 (corner fallback skipped, minimal quota). Post-run DB: `live_odds`=301, `results`=1234 (853 imported + new merges), `collector_state`=1.

## Step 1 — Dedicated tunnel + DNS route

- Owner created the tunnel in the Cloudflare Zero Trust dashboard and supplied the connector token; token staged as `/opt/odds-tool/secrets/cloudflared_token` (0400 root) and injected via root-only `env_file` `/opt/odds-tool/secrets/cloudflared.env` (`TUNNEL_TOKEN=…`) — never in compose.yaml, CLI, or logs.
- `cloudflared` service added to `deploy/compose.yaml` (digest-pinned `cloudflare/cloudflared:latest@sha256:188bb035…bafe`, `tunnel --no-autoupdate run`, `tunnel_net` only, 128m, restart unless-stopped). VM compose copy synced (build-context paths adjusted). `docker compose config` clean.
- 4/4 QUIC connections registered to Cloudflare HKG edge (hkg01/09/10/11).
- **Incident:** owner's first public-hostname entry pointed at `http://caddy:88` → origin connection refused in cloudflared logs. Owner corrected to `http://caddy:80`; immediately healthy.

## Step 2 — Public verification matrix (probed externally over the internet)

| Probe | Expected | Actual |
|---|---|---|
| `GET /` | 200 PWA | **PASS** 200 text/html |
| `GET /api/v1/session` | 200 JSON unauthenticated | **PASS** |
| `GET /api/v1/results` `/backtest` `/odds/live` no cookie | 401 ×3 | **PASS** |
| `GET /internal/health/ready` | 404 at edge | **PASS** |
| Legacy `/hkjc-odds.json` `/api/backtest` `/health` | 404 ×3 | **PASS** |
| Security headers | HSTS, nosniff, no-referrer, DENY, CSP | **PASS** all present (edge `Server: cloudflare`, CF-RAY HKG) |
| Wrong login | generic 401 | **PASS** `invalid_credentials` |
| Full login flow | 200 + `__Host` cookie → authed results 200 → logout 200 → session revoked | **PASS** (note: session token value briefly appeared unredacted in probe output due to a sed miss; the session was revoked seconds later via logout and the row deleted — token is dead) |

## Step 3 — Exposure audit

- `ss -tlnp`: host listeners **unchanged** — sshd `:22`, pre-existing `docker-proxy` `10.80.10.85:2222` (astra) and `127.0.0.1:55432` (disposable test DB). **Zero** new listeners; odds-tool publishes no ports. The tunnel is outbound-only (QUIC to Cloudflare).
- Post-probe cleanup: sessions/login_attempts wiped, owners=1.

## Step 4 — Paid collector enabled (owner approval 2026-07-19, "開")

- `deploy/collector-entrypoint.sh`: root start → compose `DATABASE_URL`/`ODDS_API_KEY`/`API_FOOTBALL_KEY` from `/run/secrets` → setpriv drop to uid 1000 → supervisor loop: one `hdc-collector` cycle every 5 min (state-driven; idle cycles make **zero** provider calls) + `hkjc-import` every 3rd cycle (~15 min, free source). Paid quota guarded in-code (50-credit reserve, provider cooldown).
- `deploy/compose.yaml`: `collector` service on the same digest-pinned api image (`odds-tool-api:latest`), app_net+db_net, three secrets mounted, `STORAGE_BACKEND=postgres`, `NODE_ENV=production`, 256m, restart unless-stopped. `odds_api_key` + `api_football_key` added to the Compose secrets block.
- **Incident:** first loop iteration — `hkjc-import` crashed as uid 1000 (`EACCES mkdir /app/public`; it unconditionally mkdirs the legacy out dir even in postgres mode). Fixed in `deploy/api.Dockerfile` (`mkdir -p /app/data /app/public` + chown 1000), image rebuilt on VM.
- Verified after restart: `hkjc-import` wrote 37/37/28/30 entries + 717 comparisons (API-Football 200, corner fallbacks skipped as designed); `hdc-collector` ran silently by design (no stdout on success) — `collector_state` shows real EPL fixtures discovered (`lastDiscoveryAt` matches run time) and **`quotaRemaining: 500`** (healthy, far above the 50 reserve; off-season means near-zero paid calls until matches approach). Tables: snapshots=96, live_odds=301, results=1234.
- Housekeeping: redundant raw `cloudflared_token` file removed (compose uses `cloudflared.env` only); `deploy/secrets/README.md` corrected to document the env_file mechanism.

## Gate

- Tunnel live, public matrix PASS, exposure audit clean: **PASS**
- Collector running with paid quota enabled under owner approval, quota healthy: **PASS**
- Stack reachable at `https://odds.ballballchu.com.hk` with all Phase 1/2 protections verified end-to-end over the internet.
