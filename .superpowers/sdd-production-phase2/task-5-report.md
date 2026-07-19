# Phase 2 Task 5 Report: Private-Network Smoke Tests (Before Any Tunnel)

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 5.

## Pre-step — Caddy edge tightened (deviation, improves Phase 1 parity)

Phase 1's probe table expects legacy paths to 404, but through the Task 2 Caddyfile any non-`/api/v1` path fell through to the SPA fallback (200 HTML), and `dist/hkjc-odds.json` (stale legacy snapshot, baked into the image; the PWA never references it — `src/App.test.tsx` asserts this) was publicly servable. Fixed in `deploy/Caddyfile` before probing:

- `handle /api/*` → 404 (after the `/api/v1/*` proxy block) — fail-closed API namespace
- `handle /hkjc-odds.json` → 404 and `handle /health` → 404 — legacy public paths denied

Caddy image rebuilt on the VM from the synced build tree; container recreated healthy. Local and VM Caddyfile are in sync.

## Step 1+2 — Security + data probe matrix (throwaway container on `app_net`, through caddy)

Probe script: `.superpowers/sdd-production-phase2/task5-probe.mjs`. **29 PASS / 0 FAIL / 0 error-body leaks** (SQL/path/stack scan on every error body):

| Group | Probes | Result |
|---|---|---|
| Unauthenticated denial | GET odds/live, results, backtest + POST predictions → 401 ×4 | PASS |
| Session without cookie | 200 `authenticated:false` | PASS |
| Login indistinguishability | wrong types / wrong password / nonexistent user → byte-identical 401 | PASS |
| Malformed JSON | 400 generic `bad_request` | PASS |
| Body limits | login >16 KiB → 413; authed predictions >1 MiB → 413 | PASS |
| Login + cookie | 200, `__Host-odds_session; Path=/; Secure; HttpOnly; SameSite=Strict`, no Domain | PASS |
| Origin/CSRF matrix on logout | no Origin / foreign Origin / no CSRF → 403 ×3 | PASS |
| Route inventory | unknown route 404, wrong method 405 | PASS |
| `/internal/*` at edge | 404 | PASS |
| Legacy paths | `/hkjc-odds.json`, `/api/backtest`, `/api/hdc-live`, `/api/predictions`, `/health`, `/api/import/*` → 404 ×6 | PASS |
| Data (authed) | results 200 (~853 result rows, 200 KB payload); backtest 200 (rows incl. `hit:null` unsettled — parity-consistent); odds/live 200 valid JSON payload | PASS |
| Logout + revoke | 200 with Origin+CSRF; post-logout session `authenticated:false` | PASS |
| Login throttle | 4×401 then **429 on the 5th failure** (fake username `throttle-probe-nobody`, throwaway container IP) — matches Phase 1 behavior | PASS |

Cleanup after probes: `sessions` and `login_attempts` wiped (1 + 4 rows), `owners` untouched (1), re-staged owner password file deleted again.

## Step 3 — Collector posture (zero paid quota)

- Compose defines **no collector service** → the paid cycle is disabled by construction, not just by config.
- `odds_api_key` secret installed on the VM (0400 root) but **mounted by no service** — no container can spend quota.
- `db_net` is `internal: true`; the api image's entrypoint runs only `server/entry.mjs` (Phase 1 scan: `server/` contains no collector references, no provider URLs, no `child_process`).
- All three collectors' offline self-tests pass inside **`--network none`** containers (outbound impossible by construction): `hdc-collector`, `hkjc-import`, `odds-monitor` → all `self-test passed`.
- Optional owner-approved one-shot `hkjc-import` cycle (proves the pg write path, free HKJC source): **deferred — pending explicit owner approval**.

## Step 4 — PWA shell

- Over the private network: `/` 200 HTML, `/sw.js` 200 `text/javascript`, `/registerSW.js` 200, `/manifest.webmanifest` 200.
- Built service worker (`dist/sw.js` scan + `vite.config.ts`): `runtimeCaching: []` (no runtime caching of anything), `navigateFallbackDenylist: [/^\/api\//]` (SW never intercepts API calls), precache explicitly excludes `**/hkjc-odds.json` and `**/*result*`. **No runtime caching of API/JSON possible.**

## Gate

- Every probe matches the Phase 1 table: **PASS**
- Collector spends zero paid quota while disabled: **PASS**
- PWA loads, SW safe: **PASS**

Stack remains fully private. Ready for Task 6 (Cloudflare Tunnel — requires owner-supplied tunnel credentials).
