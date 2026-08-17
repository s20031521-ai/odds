# Odds Tool

Local football odds value dashboard for risk analysis and backtesting. It does not place bets and does not promise profit.

## Architecture

- `server/entry.mjs` (`npm run server`) — auth-protected JSON API at `/api/v1`, backed by PostgreSQL. Requires `DATABASE_URL`, `SESSION_SECRET`, and `PUBLIC_ORIGIN` (HTTPS origin string) in the process environment; migrations run automatically at startup unless `RUN_MIGRATIONS=false` (Phase 2 containers use a one-shot migration job instead). `TRUSTED_PROXY_CIDRS` (comma-separated IPv4 CIDRs, default empty = trust nothing) controls which peers may supply `X-Forwarded-For`. Listens on loopback `127.0.0.1:8787`.
- `npm run dev` — Vite frontend. The browser talks to the same-origin `/api/v1`; UI-only development uses the Playwright mocks.
- Provider collectors (`scripts/hdc-collector.mjs`, `scripts/hkjc-import.mjs`, `scripts/odds-monitor.mjs`) normalize odds/results. Set `STORAGE_BACKEND=postgres` (plus `DATABASE_URL`) for PostgreSQL persistence; `NODE_ENV=production` refuses file mode. `scripts/unified-sampler.mjs` is PostgreSQL-only and records `unified-buyable-v1` opportunities without making provider calls.
- Auth is single-owner: after migrations, bootstrap once with `npm run auth:create-owner` (`OWNER_USERNAME` + `OWNER_PASSWORD_FILE` env).

Runbooks:

- `docs/runbooks/local-postgres-development.md` — disposable DB, env names, migrations, import/parity, integrity `--database`, test matrix.
- `docs/runbooks/legacy-migration.md` — archive import semantics, idempotency, parity expectations, hash discipline.

## Quick Start

Backend (needs a reachable PostgreSQL and env):

```powershell
npm run server
```

Frontend (separate terminal):

```powershell
npm run dev
```

Then open `http://127.0.0.1:5173/#/dashboard`.

Useful pages:

- `#/dashboard` live market cards for 1X2, totals, corners, and Asian handicap.
- `#/history` completed-result comparison from the backend backtest loop.
- `#/analysis` model readiness and performance. Current models are shown separately from `legacy-v0`.

Authenticated recommendation endpoints:

- `GET /api/v1/recommendations/current` — recorded, still-fresh current opportunities with quote ranges and per-bookmaker minimum buy prices.
- `GET /api/v1/predictions/observations?sampleId=<positive integer>` — full audit timeline for one opportunity sample.
- `GET /api/v1/backtest` — strategy readiness, opportunity return ranges, and closing benchmarks.
- `GET /api/v1/odds/live` — source odds with provider and true observation timestamps.

## Data Refresh

```powershell
npm run import:hkjc
```

Imports HKJC odds/results. In default file mode it writes local files such as `public/hkjc-odds.json` and `data/result-archive.jsonl`; with `STORAGE_BACKEND=postgres` it persists through the database instead.

```powershell
node scripts/hdc-collector.mjs
```

Runs the quota-aware The Odds API adapter. It reads `ODDS_API_KEY` from `.env.local`, keeps a credit reserve, and only spends paid calls inside the configured pre-kickoff windows. It persists live odds and results, but does not launch HKJC or write legacy recommendation snapshots.

```powershell
node scripts/unified-sampler.mjs
```

Reads current PostgreSQL odds, resolves fixture aliases, applies the unchanged four models and 3% gate, and records fingerprinted observations. Production supervision attempts HDC each five-minute iteration, HKJC every third iteration, then exactly one sampler run even if a provider failed.

```powershell
npm run import:history -- --download E0 2425
npm run import:history -- --dir data/historical
```

Imports historical scorelines and closing odds (Pinnacle preferred, Bet365 fallback) from football-data.co.uk CSVs into `team_match_history` (migration 006). This is offline model-fitting and backtest data for new model experiments (ADR 0003); it is PostgreSQL-only, idempotent on `(source, league_code, match_date, home_team, away_team)`, and never touches live odds or snapshot tables.

```powershell
npm run backtest:dc
```

Runs the dc-v1 (Dixon-Coles) walk-forward offline backtest over `data/historical/*.csv`: per-league Brier/log-loss/RPS against de-vigged Pinnacle closing, plus a flat-stake simulation through the production 3% edge gate. Read-only research tooling; nothing here affects live recommendations.

```powershell
npm run tune:xi
```

Sweeps the dc-v1 time-decay parameter xi per league through the same walk-forward harness and reports h2h log-loss / Brier / RPS per value. Winners feed `XI_BY_LEAGUE` in `scripts/lib/dc-shadow.mjs` (used by the live shadow fits). Read-only; re-run when history is refreshed.

```powershell
npm run monitor:odds:once
```

Runs the odds monitor once using `monitor.config.json`.

## Verification

Run these before trusting a session:

```powershell
npm run server:self-test
node scripts/hdc-collector.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/odds-monitor.mjs --self-test
node scripts/unified-sampler.mjs --self-test
node scripts/import-historical-scores.mjs --self-test
node scripts/dc-v1-backtest.mjs --self-test
npm run check:data
npm test
npm run build
```

`npm run check:data` is read-only. It fails on post-kick snapshots, duplicate archive keys, duplicate snapshot keys, and negative provider scores. Older snapshots without `commenceTime` are reported as a warning because historical rows are kept for audit. `node scripts/check-data-integrity.mjs --database` also checks duplicate observation fingerprints, future input timestamps, and post-kick evaluations. PostgreSQL parity reports strategy and observation row counts (see the runbooks).

## Safety Rules

- Keep `.env.local` local. Do not print or commit API keys.
- Do not lower the 3% edge threshold just to create picks.
- Model experimentation is allowed (ADR 0003, 2026-08-16), but the existing four models (`consensus-v1`, `hdc-loo-v2`, `totals-loo-v1`, `corner-loo-v1`) stay byte-for-byte unchanged; new math ships only under new `modelVersion` labels via `evaluateUnifiedOdds`. 30 settled distinct matches remains the trust threshold for any model, old or new.
- `unified-buyable-v1` identity is `fixtureId|market|selection|line|modelVersion|strategyVersion`; identical fingerprints extend an observation and changed inputs create a new one.
- Count each settled `fixtureId + market` once for readiness, not bookmaker rows, observations, dashboard cards, or correlated line opportunities. Legacy rows never count toward new-strategy readiness.
- Opportunity returns use all qualifying prices as a lower/upper unit-return range. The last pre-kick evaluation is the closing benchmark; an empty closing observation is `N/A`.
- Push is settled without a win/loss; `void` and seven-day `unsettleable` terminal rows do not count toward readiness.
- Browser startup must not automatically spend paid The Odds API credits.
- Titan007 is for human cross-checking only, not source of truth.
- Corner handicap is intentionally not integrated yet; corner totals are the active corner market.

## Artwork Assets

`public/chiikawa/` 內嘅 Chiikawa 插圖下載自 chiikawa-wallpaper.com，僅供本地個人用途，不得商用或對外發佈。版權屬原作者 Nagano 所有。
