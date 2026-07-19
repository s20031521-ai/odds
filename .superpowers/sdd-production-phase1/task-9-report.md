# Task 9 Report: Phase 1 Final Parity, Security, and Handoff Gate

Date: 2026-07-19. Scope executed: Steps 1 (fresh verification matrix), 2 (security black-box), and 4 (runbooks, final report, README). Step 3 (whole-phase independent review) is pending — see placeholder below.

## Step 1: Verification matrix — commands and exact results

| # | Command | Result |
|---|---|---|
| 1 | `sha256sum data/*.jsonl data/*.json public/hkjc-odds.json` (baseline) | recorded (9 files) |
| 2 | `npm run server:self-test` | ✅ `[server] self-test passed` |
| 3 | `node scripts/odds-monitor.mjs --self-test` | ✅ pass |
| 4 | `node scripts/hkjc-import.mjs --self-test` | ✅ pass |
| 5 | `node scripts/hdc-collector.mjs --self-test` | ✅ pass |
| 6 | `npm run check:data` | ✅ snapshots=183, results=853, lateSnapshots=0, duplicateSnapshotKeys=0, duplicateResultKeys=0, negativeScores=0, missingCommenceTime=180 (warning), quality 3 valid-current / 93 legacy / 87 invalid |
| 7 | `npm test` (vitest) | ✅ 149/149 (25 files) |
| 8 | `node --test server/app.test.mjs server/auth/auth.test.mjs` | ⚠️ fails without `DATABASE_URL` — both files are **DB-backed, not pure** (finding F4). With disposable `DATABASE_URL`: ✅ 15/15 pass |
| 9 | `npm run build` | ✅ (tsc + vite + PWA) |
| 10 | `npm run test:ui:only` (Playwright, mocked APIs) | ✅ 32/32 pass |
| 11 | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| 12 | `npm audit` | ✅ 0 vulnerabilities |
| 13 | `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs` (+`DATABASE_URL`) | ✅ 27/27 pass |
| 14 | `node --test` 5 pg test files: `scripts/lib/postgres-sink.test.mjs scripts/hdc-collector-pg.test.mjs scripts/odds-monitor-pg.test.mjs scripts/hkjc-import-pg.test.mjs scripts/check-data-integrity.test.mjs` (+`DATABASE_URL`) | ✅ 29/29 pass |

Note: the plan's `npm run test:server` does not exist; server node tests were run directly per the brief.

### Disposable-DB sequence (public schema pre-inspected: migrated tables, 0 leftover rows)

- `npm run db:migrate` ×2 → `migrationsApplied=0` both runs (idempotent; schema already at 003 from Slice C). ✅
- `npm run db:import:legacy` (bare) → ⚠️ `status=failed` — npm script lacks the required `--source-root` (finding F1).
- `npm run db:import:legacy -- --source-root .` run 1 → ✅ `status=complete`: sourceRows=1036, auditRowsAdded=1036, snapshotInserted=96, snapshotRejected=87, resultInserted=853.
- Same, run 2 → ✅ all 4 files `already-complete`, **zero additions** (sourceRows=1036 re-read, inserted/updated/ignored all 0).
- `npm run db:check:parity` (bare) → ⚠️ `status=failed` (same F1 gap). With `-- --source-root .` → ✅ `status=ok`, snapshotRows=183, resultRows=853, resultRejected=0, snapshotValidCurrent=3, snapshotLegacy=93, snapshotInvalid=87, distinctMatches=286, settlements=0.
- `node scripts/check-data-integrity.mjs --database` → ✅ exit 0: `mode=database`, snapshots=96 (3 valid-current + 93 legacy; 87 invalid are audit-ledger-only), results=853, lateSnapshots=0, duplicateSnapshotKeys=0, duplicateResultKeys=0, negativeScores=0, snapshotsMissingCommenceTime=93 (legacy warning only).
- **Hygiene**: the legacy import was intentionally **left in the disposable DB** for Step 2 (96 snapshots, 853 results, 4 import runs, 1036 audit rows).

### Service-worker scan

Grepped `dist/sw.js` for `addEventListener`, `fetch`, `/api/`, `.json`, `runtimeCaching` → 0 hits. `vite.config.ts` workbox: `runtimeCaching: []`, `navigateFallbackDenylist: [/^\/api\//]`, `globIgnores` excludes `**/*.json`, `**/hkjc-odds.json`, `**/data/**`, `**/archives/**`, `**/*result*`; precache = app shell only (registerSW.js, index.html, built css/js, icons, manifest). **PASS — no runtime caching of API/JSON/odds/results.**

### Source scan

- `src/` (excluding tests) and the `dist/` bundle: **no** `127.0.0.1`/`localhost`. ✅
- `server/`: **no** CORS headers anywhere (same-origin only; no wildcard possible). ✅
- **no** `child_process`/`execFile`/`spawn`/collector-script references in `server/` — no public route can invoke collectors. ✅
- `server/app.mjs` route inventory is an explicit allowlist; legacy paths fail closed 404. ✅
- ⚠️ `GET /internal/health/ready` is mounted in the **same route table on the public listener** (finding F2).

## Step 2: Security black-box

Setup: `PUBLIC_ORIGIN` is strictly HTTPS-only in `server/config.mjs` (no loopback HTTP exception) — used a throwaway origin string `https://odds.local` against the plain-HTTP loopback listener; documented, production checks not weakened. Throwaway 64-hex `SESSION_SECRET`; throwaway owner via `OWNER_PASSWORD_FILE` (random 48-hex password, 0600 temp file deleted immediately after; never printed). Server `127.0.0.1:8787` against the disposable DB; killed after probing. No outbound provider traffic (server only queries the DB; no provider URLs exist in `server/`).

### Probe table (probe → expected → actual)

| Probe | Expected | Actual |
|---|---|---|
| GET `/api/v1/odds/live`, `/api/v1/results`, `/api/v1/backtest`, POST `/api/v1/predictions` without cookie | 401 | ✅ 401 `{"error":"unauthorized"}` ×4 |
| GET `/api/v1/session` without cookie | unauthenticated | ✅ 200 `{"authenticated":false}` |
| Correct login | 200 + cookie + CSRF | ✅ 200; `Set-Cookie: __Host-odds_session=<redacted>; Path=/; Secure; HttpOnly; SameSite=Strict`, no Domain; csrfToken in body |
| GET `/api/v1/session` with cookie | authenticated + CSRF | ✅ 200 authenticated:true |
| POST logout: no Origin / foreign Origin / correct Origin without CSRF | 403 ×3 | ✅ 403 `{"error":"forbidden"}` ×3 |
| POST logout with correct Origin + CSRF | 200 + revoke | ✅ 200; subsequent GET session → `authenticated:false` |
| POST login body > 16 KiB | rejected | ✅ 413 `body_too_large` |
| POST `/api/v1/predictions` body > 1 MiB (authed) | rejected | ✅ 413 `body_too_large` |
| Malformed JSON login | 400 generic | ✅ 400 `bad_request`; no SQL/paths/stack |
| Wrong types / wrong password / nonexistent user | identical 401 | ✅ identical `{"ok":false,"reason":"invalid_credentials"}` — no user-exists leak |
| Unknown route / wrong method | 404 / 405 | ✅ `not_found` / `method_not_allowed` |
| GET `/internal/health/ready` | internal-only | ⚠️ **200 on the public port** (finding F2) |
| Legacy paths: `/hkjc-odds.json`, `/api/backtest`, `/api/hdc-live`, `/api/predictions` (GET+POST), `/health`, `/api/import/*` | fail closed | ✅ 404 ×7 |
| Login throttle | cooldown after 5 failures | ✅ 429 `rate_limited, retryAfterSeconds:1800` — fires **on the 5th failure itself** (impl: `failedCount >= 5`), both account + IP scopes (finding F3: brief phrased it as the 6th) |
| Authed data routes | 200 with data | ✅ 200 ×3 (odds/live, results, backtest) against imported data (re-verified with a second throwaway owner after clearing throttle rows) |
| Error responses contain SQL/paths/secrets | never | ✅ all bodies are short generic JSON |

### Step 2 cleanup

Disposable DB after cleanup: `owners=0, sessions=0, login_attempts=0` (all throwaway rows removed; legacy import data retained intentionally). All temp secret files, probe scripts, and logs deleted; no server processes left running.

## Findings (Steps 1+2)

- **F1**: `db:import:legacy` / `db:check:parity` npm scripts fail bare (`status=failed`); require `-- --source-root .`. Documented in both runbooks + final report §8; recommend baking the flag into the scripts in a follow-up.
- **F2**: `/internal/health/ready` shares the public listener — Phase 2 must block `/internal/*` at the Caddy/public route layer (final report §3).
- **F3**: login throttle returns 429 from the **5th** failed attempt (30-min cooldown), not the 6th as phrased in the brief — implementation matches `THROTTLE_FAILURE_LIMIT=5` with `>=`; accepted and documented (final report §6).
- **F4**: `server/app.test.mjs` / `server/auth/auth.test.mjs` are DB-backed, not pure — they require the disposable `DATABASE_URL` (documented in the runbook test matrix).

## Step 4 deliverables

- `docs/runbooks/local-postgres-development.md` — disposable DB setup, env names, migrations, working import/parity invocations, integrity `--database`, test matrix (which tests need `DATABASE_URL`).
- `docs/runbooks/legacy-migration.md` — idempotency, audit ledger, parity expectations, hash discipline, priority-0 vs collector priorities 10–40, safe re-run checklist.
- `.superpowers/sdd-production-phase1/final-report.md` — Phase 2 contract (schema 003, runtime, secret names, `/internal/health/ready` exposure rule, owner bootstrap, cutover preconditions, I1 decision, archive hashes, resource expectations, limitations).
- `README.md` — updated for the new architecture; all safety rules kept verbatim.

### Task 8 review item I1 — decision

odds-monitor pg mode keeps no price-history time series (provider-scoped replacement only). **Accepted limitation**; a dedicated append-only price-history table may be added in a later phase. Recorded in final report §7.

## Archive hashes

`sha256sum data/*.jsonl data/*.json public/hkjc-odds.json` recorded before and after Steps 1+2 — **identical**; exact values are in `final-report.md` §9.

## Whole-phase independent review

Reviewer: independent agent (no Phase 1 implementation involvement), 2026-07-19. Re-ran permitted gates and reproduced reported results exactly (archive hashes 9/9, server self-test, check:data 183/853, app+auth 15/15, migrate+repositories 27/27); hunted auth/session, transactions/locking, trust-policy, cross-surface, fail-closed, docs-vs-reality (9 claims verified), and secrets hygiene (clean).

Verdict: **APPROVED WITH MINOR FINDINGS** — no Critical findings.

Important findings and resolutions:

- **I1 — login throttle degenerates behind the Phase 2 reverse proxy** (shared IP scope; repeatable single-owner lockout; `server/app.mjs:113-115`). No Phase 1 code defect on loopback. **Resolution:** decision recorded in `final-report.md` §7b — honor `X-Forwarded-For` from the trusted proxy only, or explicitly accept the single-bucket behavior, before go-live.
- **I2 — `server.legacy-file-router.mjs` is a live executable legacy server in the deployable tree** (binds 127.0.0.1:8787, unauthenticated API, spawns collectors; nothing references it). **Resolution: deleted 2026-07-19 with owner approval.** Post-deletion gates re-run green: server self-test, 3 script self-tests, check:data 183/853, Vitest 149/149, production build. Recorded in `final-report.md` §11.

Minor findings (accepted/documented): CSRF rotation on session poll (single-tab unaffected); client-supplied `savedAt` trusted under the single-owner model; 413 stream not destroyed (Task 6 debt); `/internal/*` must be denied at Caddy (already §3); dead frontend helpers + localStorage mirror; Task 8 carried minors; dead `IS NULL` branch in result repository.

Phase 2 blockers (none require Phase 1 code changes): deny `/internal/*` at the public route; trusted-proxy IP decision (§7b); delete `server.legacy-file-router.mjs`; SSH key auth + password rotation; keep archive-hash verification around any Phase 2 migration activity.

## Remaining limitations

- `server.mjs` legacy code not yet cleaned up (runtime hands off to `server/entry.mjs`).
- `public/hkjc-odds.json` inert artifact; stale `data/hdc-collector.lock` from 2026-07-14 left for file-mode stale-lock recovery.
- Task 6 minor debt: oversized request streams not explicitly destroyed after limit rejection.
- VM Compose/Caddy/Cloudflare Tunnel/DNS/backup/private GitHub/CI: all Phase 2.
- SSH password previously disclosed in chat must be treated as compromised — verify key auth, then rotate before go-live.
- All four current models at 0 settled distinct matches; no retune until 30 each.
