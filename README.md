# Odds Tool

Local football odds value dashboard for risk analysis and backtesting. It does not place bets and does not promise profit.

## Architecture

- `server/entry.mjs` (`npm run server`) — auth-protected JSON API at `/api/v1`, backed by PostgreSQL. Requires `DATABASE_URL`, `SESSION_SECRET`, and `PUBLIC_ORIGIN` (HTTPS origin string) in the process environment; migrations run automatically at startup unless `RUN_MIGRATIONS=false` (Phase 2 containers use a one-shot migration job instead). `TRUSTED_PROXY_CIDRS` (comma-separated IPv4 CIDRs, default empty = trust nothing) controls which peers may supply `X-Forwarded-For`. Listens on loopback `127.0.0.1:8787`.
- `npm run dev` — Vite frontend. The browser talks to the same-origin `/api/v1`; UI-only development uses the Playwright mocks.
- Collector scripts (`scripts/hdc-collector.mjs`, `scripts/hkjc-import.mjs`, `scripts/odds-monitor.mjs`) default to **file mode** (legacy JSON/JSONL archives). Set `STORAGE_BACKEND=postgres` (plus `DATABASE_URL`) for PostgreSQL persistence; `NODE_ENV=production` refuses file mode.
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

## Data Refresh

```powershell
npm run import:hkjc
```

Imports HKJC odds/results. In default file mode it writes local files such as `public/hkjc-odds.json` and `data/result-archive.jsonl`; with `STORAGE_BACKEND=postgres` it persists through the database instead.

```powershell
node scripts/hdc-collector.mjs
```

Runs the quota-aware background collector. It reads `ODDS_API_KEY` from `.env.local`, keeps a credit reserve, and only spends paid The Odds API calls inside the configured pre-kickoff windows.

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
npm run check:data
npm test
npm run build
```

`npm run check:data` is read-only. It fails on post-kick snapshots, duplicate archive keys, duplicate snapshot keys, and negative provider scores. Older snapshots without `commenceTime` are reported as a warning because historical rows are kept for audit. `node scripts/check-data-integrity.mjs --database` applies the same checks to PostgreSQL (see the runbooks).

## Safety Rules

- Keep `.env.local` local. Do not print or commit API keys.
- Do not lower the 3% edge threshold just to create picks.
- Do not retune weights, thresholds, or Kelly until current-model settled distinct matches reach 30.
- Count distinct settled matches as the model sample size, not bookmaker rows, dashboard cards, or correlated line snapshots.
- Browser startup must not automatically spend paid The Odds API credits.
- Titan007 is for human cross-checking only, not source of truth.
- Corner handicap is intentionally not integrated yet; corner totals are the active corner market.

## Artwork Assets

`public/chiikawa/` 內嘅 Chiikawa 插圖下載自 chiikawa-wallpaper.com，僅供本地個人用途，不得商用或對外發佈。版權屬原作者 Nagano 所有。
