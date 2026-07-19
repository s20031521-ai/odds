# Phase 1 Final Report — Production Contract for Phase 2

Date: 2026-07-19. Phase 1 (local runtime: responsive PWA, auth-protected `/api/v1`, PostgreSQL persistence, collector sinks, security black-box) is complete and verified. This document is the contract Phase 2 (VM/Compose/Caddy/Cloudflare Tunnel/DNS/backup) builds against.

## 1. Schema and runtime

- **Schema migration version: 003** (`db/migrations/001_initial.sql`, `002_import_row_audit.sql`, `003_auth_constraints.sql`). Migrations are idempotent and run automatically at server startup.
- **Runtime**: Node.js 24 (developed/verified on v24.15.0), ESM throughout; no build step for the backend.
- **Database**: PostgreSQL 18 (verified on 18.4); driver `pg` 8.22.0 (`server/db/pool.mjs`).
- **Frontend**: Vite production build (`npm run build` → `dist/`), PWA with app-shell-only precache; service worker has **no** runtime caching (`runtimeCaching: []`, `/api/` denylisted, all JSON/data/result paths excluded from precache).
- **Listen**: `HOST`/`PORT` env, default `127.0.0.1:8787` — loopback only; TLS terminates at the Phase 2 reverse proxy.

## 2. Environment and secrets (names only — values never in repo/reports)

| Name | Purpose | Constraint |
|---|---|---|
| `DATABASE_URL` | server, migrations, importer, parity, integrity, collectors (pg mode) | valid PostgreSQL URL |
| `SESSION_SECRET` | session token digest + throttle HMAC | ≥ 32 bytes |
| `PUBLIC_ORIGIN` | exact-match Origin check for mutations | **strictly HTTPS** origin, no path/query; `http://` loopback is rejected by config |
| `RUN_MIGRATIONS` | api startup migration gate | only the exact value `false` skips `runMigrations` (Phase 2 one-shot migration job runs them instead) |
| `TRUSTED_PROXY_CIDRS` | comma-separated IPv4 CIDRs whose peers may set `X-Forwarded-For` | default empty (trust nothing); malformed entries fail config load |
| `OWNER_USERNAME` | one-time owner bootstrap | |
| `OWNER_PASSWORD_FILE` | one-time owner bootstrap | path to secret file, deleted after use; passwords never on command lines |
| `STORAGE_BACKEND` | collector persistence | `file` (default) / `postgres` |
| `ODDS_API_KEY` | hdc-collector, odds-monitor | `.env.local`; paid quota |
| `API_FOOTBALL_KEY` | hkjc-import corner fallback | `.env.local`; daily budget 90 calls |

Production secret handling (Phase 2): Compose/Docker mounted secrets under `/opt/odds-tool`; nothing in images, git, or frontend `VITE_` variables.

## 3. Readiness endpoint — Phase 2 exposure rule

`GET /internal/health/ready` currently shares the **same public listener** as `/api/v1` (verified live during the black-box pass: it returns 200 on the API port). It must be **blocked from public exposure at the Caddy/public route layer in Phase 2** — deny the `/internal/*` prefix on the public hostname and allow it only from the loopback/monitoring path. Do not rely on the application to hide it.

## 4. Owner bootstrap

After migrations, from a secure terminal on the host:

```bash
export DATABASE_URL=... SESSION_SECRET=... PUBLIC_ORIGIN="https://<public-hostname>"
export OWNER_USERNAME=<owner-name>
export OWNER_PASSWORD_FILE=/run/secrets/owner_password   # hidden file, deleted afterwards
npm run auth:create-owner
```

Single-owner constraint (migration 003); creating a second owner fails by design. Password ≥ 14 chars, Argon2id.

## 5. Production cutover preconditions

- `STORAGE_BACKEND=postgres` + `DATABASE_URL` set for all collector/import/monitor runs.
- Under `NODE_ENV=production`, any non-postgres `STORAGE_BACKEND` (including unset) **fails at startup** — file mode cannot be selected accidentally.
- Collectors in pg mode write zero JSON/JSONL files (proven by tests); the local archives stay as the immutable audit baseline.
- Browser/public routes cannot invoke collector scripts (no server route mounts them).
- Before go-live: verify SSH **key** login, then **rotate the previously disclosed VM password**; the repo stores no credentials.

## 6. Auth/security posture (verified black-box 2026-07-19)

- Cookie `__Host-odds_session`: `Path=/; Secure; HttpOnly; SameSite=Strict`, no Domain; 14-day idle / 30-day max; server-side revocation on logout.
- Mutations require exact same-origin `Origin` header **and** session-bound `x-csrf-token`; missing/foreign → 403.
- Login throttle: 15-minute window, **the 5th failed attempt already returns 429** `rate_limited` with a 30-minute cooldown (`retryAfterSeconds: 1800`); scoped by both account and client IP (HMAC'd scope keys). Note: the brief phrased this as "cooldown on the 6th attempt" — implementation blocks from the 5th failure onward; accepted as-is.
- Body limits: auth 16 KiB, predictions 1 MiB → 413. Error responses carry no SQL, paths, or stacks.
- Legacy routes (`/api/*`, `/health`, `/hkjc-odds.json`) fail closed 404.

## 7. Task 8 review item I1 — decision

**odds-monitor pg mode keeps no price-history time series.** In `STORAGE_BACKEND=postgres`, odds-monitor snapshots are written via `saveLiveOdds("odds-monitor", …)`, which *replaces* the provider's live rows each poll — the JSONL append history that file mode kept in `data/odds-history.jsonl` has no pg equivalent. **Decision: accepted limitation for Phase 1.** Live-point-in-time data is preserved; the historical tape exists only in the file archives. If price-history analytics are needed later, add a dedicated append-only `price_history` table in a later phase (no model behavior depends on it today).

## 7b. Whole-phase review item I1 — trusted-proxy client IP (Phase 2 decision required)

The login throttle scopes by account and by client IP taken from `req.socket.remoteAddress` (`server/app.mjs:113-115`). Behind the Phase 2 Caddy/Cloudflare reverse proxy every request shares one IP scope, so (a) any 5 failed logins from anyone cooldown all logins for 30 minutes, and (b) 5 failures on the owner username lock the owner's account scope regardless of source — a repeatable single-owner lockout with no self-service unlock. **Decision required before Phase 2 go-live:** either honor `X-Forwarded-For` from the trusted proxy only (Caddy in front, direct origin access firewalled) or explicitly accept the degenerate single-bucket behavior. No Phase 1 code change made; loopback behavior is correct as-is.

## 8. Known npm script gap

`db:import:legacy` and `db:check:parity` require a `--source-root` argument; the bare npm scripts exit `status=failed`. Working invocations (documented in both runbooks):

```bash
npm run db:import:legacy -- --source-root .
npm run db:check:parity -- --source-root .
```

Recommend baking `--source-root .` into the npm scripts in a small follow-up (one-line change, then re-run the verification matrix).

## 9. Archive counts and SHA-256 (computed 2026-07-19)

183 prediction snapshots + 853 results across the archives; DB parity: 3 valid-current / 93 legacy / 87 invalid snapshots, 286 distinct matches, 0 settlements.

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  data/background-hdc-snapshots.jsonl   (empty)
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  data/background-result-archive.jsonl  (empty)
e55625769e4560b524773bd4a8c2884eff236540afc63b2187f3fae7696617ba  data/prediction-snapshots.jsonl
df9b758d5ea22ba656b97b3c78f366f3120ebc4d6bfda6f535ae0ce94dfba424  data/result-archive.jsonl
fbc2095cc33ce4e14bcb4121d188b64183e182da4c331bc8e4fe8e9fce206dab  data/api-football-state.json
441d8ce648e302530d9b1ea1c1fe03fe19026522e961508980017e41760dcd32  data/background-hdc-odds.json
2b7eb7408acc27e3835b96f925755a83ac7fb156f221342871a5519f0e198682  data/corner-result-overrides.json
5608d3503deeaf3b9990bc7bd822b05f7c9ba7d6114b07cf916dfc5293a6a2cc  data/hdc-collector-state.json
2b33822e22aef9c112287c56613401774592313de047dc5ff16699d8bbf2eb8e  public/hkjc-odds.json
```

These files must remain byte-identical through Phase 2; verify with `sha256sum` before/after any migration activity.

## 10. Resource expectations

Modest single-host footprint: one Node backend process (loopback), one PostgreSQL instance, static `dist/` served by the reverse proxy. Collector scripts run as scheduled tasks (cron/systemd timers in Phase 2), each a short-lived Node process. The Odds API quota discipline (50-credit reserve, pre-kickoff windows) and the API-Football 90-call/day budget are enforced in the collectors; no always-on provider traffic.

## 11. Remaining limitations (carried into Phase 2)

- `server.mjs` retains early-handoff legacy code; normal runtime hands off to `server/entry.mjs`, but the file is not yet cleaned up.
- `server.legacy-file-router.mjs` was deleted on 2026-07-19 with owner approval (whole-phase review I2): it was directly runnable, bound 127.0.0.1:8787, and served the old unauthenticated API. Nothing referenced it (repo-wide grep verified). Post-deletion gates re-run green: server self-test, 3 script self-tests, check:data 183/853, Vitest 149/149, production build.
- Trusted-proxy client-IP / throttle decision required before go-live (whole-phase review I1 — see §7b).
- `public/hkjc-odds.json` is an inert migration artifact (frontend no longer reads it; the new server never serves it).
- `data/hdc-collector.lock` is a stale lock file from 2026-07-14; the file-mode stale-lock recovery handles it on the next file-mode run.
- Task 6 minor debt: oversized request streams are rejected at the limit but the socket is not explicitly destroyed.
- odds-monitor pg mode has no price-history time series (I1, accepted — see §7).
- npm script `--source-root` gap (§8).
- VM `/opt/odds-tool` Compose stack, Caddy, dedicated Cloudflare Tunnel, `odds.ballballchu.com.hk` DNS, encrypted backup + restore rehearsal, private GitHub/CI: all Phase 2, not started.
- SSH password previously disclosed in chat must be treated as compromised: verify key auth, then rotate, before go-live.
- All four current models remain at 0 settled distinct matches (30 needed before any retune); 3 valid-current totals snapshots are overdue awaiting settlement.
