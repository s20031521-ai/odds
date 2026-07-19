# Task 8 Report: PostgreSQL Collector Sinks

Status: **complete**. All slices (A, B1, B2, C) implemented and GREEN against the disposable PostgreSQL test database (`postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`). No live provider calls were made at any point; archive files are untouched.

## Slice A: PostgreSQL sink

Status: implemented; **database GREEN achieved 2026-07-19** (orchestrator restored the disposable tunnel and ran the sink tests: 4/4 pass).

Changed files:

- Created `scripts/lib/postgres-sink.mjs`
- Created `scripts/lib/postgres-sink.test.mjs`

Implemented interface:

- `createPostgresSink({ pool })`
- `acquireCollectorLock(name, callback): Promise<"ran" | "busy">`
- `saveLiveOdds(provider, observedAt, entries): Promise<void>`
- `saveSnapshots(snapshots): Promise<InsertSummary>`
- `saveResults(results): Promise<UpsertSummary>`
- `loadCollectorState(key): Promise<object | null>`
- `saveCollectorState(key, state): Promise<void>`

Behavior:

- Uses existing Task 3 repository modules:
  - `createOddsRepository`
  - `createSnapshotRepository`
  - `createResultRepository`
  - `createCollectorStateRepository`
- Uses PostgreSQL advisory locks:
  - `pg_try_advisory_lock(hashtextextended($1::text, 0))`
  - `pg_advisory_unlock(hashtextextended($1::text, 0))`
- Releases advisory locks in `finally`.
- Provider-scoped live replacement through the existing live odds repository.
- Immutable snapshot insert semantics through the existing snapshot repository.
- Source-priority result upsert semantics through the existing result repository.
- Contains no JSON/JSONL file write implementation (asserted by a source-scan test).

RED evidence (pre-implementation):

- `DATABASE_URL=... node --test scripts/lib/postgres-sink.test.mjs` failed as expected with `ERR_MODULE_NOT_FOUND` because the sink did not exist.

GREEN evidence:

- 2026-07-19 (orchestrator, tunnel restored): `node --test scripts/lib/postgres-sink.test.mjs` — 4/4 pass (advisory lock exclusion, immutable snapshots + source-priority results, provider-scoped replacement + rollback, no file writes).
- Re-confirmed in the final Task 8 gate run (see "Final gate results" below): 4/4 pass.

Earlier blockage (resolved):

- Before 2026-07-19 the tunnel was not listening (`connect ECONNREFUSED 127.0.0.1:55432`); no local Docker fallback existed. Resolved by the orchestrator restoring the tunnel.

## Slice B1: storage backend + hdc-collector + odds-monitor

Changed files:

- Created `scripts/lib/storage-backend.mjs` — backend resolution + factory.
- Created `scripts/lib/storage-backend.test.mjs` — 6 pure unit tests.
- Created `scripts/lib/test-db.mjs` — shared disposable-schema `withDatabase` helper (UUID schema per test, migrations run in, dropped after; skips cleanly when `DATABASE_URL` is unset; asserts the URL is exactly the disposable test DB).
- Modified `scripts/hdc-collector.mjs` — collection separated from persistence via an injected store.
- Modified `scripts/odds-monitor.mjs` — odds-history persistence injected via store; alert inbox writes stay file-based in both modes (alerts are delivery output, not persistence).
- Created `scripts/hdc-collector-pg.test.mjs` — 7 tests.
- Created `scripts/odds-monitor-pg.test.mjs` — 5 tests.

Storage-backend behavior (`scripts/lib/storage-backend.mjs`):

- `STORAGE_BACKEND` unset/empty/`"file"` → file mode (legacy byte-for-byte behavior).
- `STORAGE_BACKEND=postgres` → requires `DATABASE_URL`, else a clear startup error; factory creates the pg pool via `server/db/pool.mjs` `createPool` and wraps `createPostgresSink({ pool })`. Collector scripts never run migrations (the server entry owns them).
- Any other value → throws.
- `NODE_ENV=production` with a non-postgres backend → throws (file mode cannot be selected accidentally in production).
- The factory exposes `close()` so tests and one-shot runs can end the pool.

Store interfaces:

- hdc-collector: `{ acquireLock(cb)→"ran"|"busy", loadState(), saveState(state), saveSnapshots(rows), saveResults(rows), saveLive(entriesBySport, now) }` via `createFileStore()` / `createPostgresStore(sink)`. File store is the legacy code moved verbatim (same files, order, merge/prune semantics). The 429-cooldown state write inside `fetchJson` routes through `store.saveState`, so pg mode writes zero files. Lock miss (`"busy"`) exits quietly with code 0 in both modes.
- odds-monitor: `{ writeSnapshots(snapshots) }` via `createFileHistoryStore()` (byte-identical JSONL append) / `createPostgresHistoryStore(sink)`; pg mode skips rows whose price is not a positive finite number with a warning before the sink call.

Live-odds flattening (hdc-collector): per sport, provider `the-odds-api:<sport>`; h2h → 3 rows (`home|draw|away`), totals → `totals` (`over|under`, line), corners → `alternate_totals_corners` (`over|under`, line); `expiresAt` = commenceTime + 3h; original entry kept under `raw`.

Post-B1 spreads fix (orchestrator): `flattenSportEntries` originally emitted the away spread row with the negated line (`-entry.line`); the frontend `groupFlatEntries` groups by `[matchId, market, line, bookmaker]`, so the two sides never re-paired. Fixed so the away row carries the same home line; `scripts/hdc-collector-pg.test.mjs` updated accordingly.

Entry-point safety: both scripts guard execution behind an `invokedDirectly` check (`process.argv[1]` resolves to the script path), making them importable by tests without side effects. `--self-test` and `--dry-run` remain offline; normal paths were never executed.

## Slice B2: hkjc-import

Changed files:

- Modified `scripts/hkjc-import.mjs` — injected store, `invokedDirectly` guard, live path wrapped in `runImport()`; `process.loadEnvFile(".env.local")` behavior unchanged.
- Created `scripts/hkjc-import-pg.test.mjs` — 8 tests.

Store interface: `{ loadState(), saveState(state), loadSnapshots(), loadResults(), saveResults(rows), saveLive(payload, now) }`.

- `loadState`/`saveState` — file: `data/api-football-state.json`; pg: collector state key `hkjc-import`.
- `loadSnapshots` — file: all of `data/prediction-snapshots.jsonl`; pg: snapshot repository `listAll()` (valid-current + legacy only; see limitations).
- `loadResults` — file: `data/result-archive.jsonl`; pg: result repository `listAll()`.
- `saveResults` — file: re-read + `mergeResultArchive` (last-wins) + full rewrite, byte-identical; pg: `sink.saveResults` with per-row `sourcePriority`.
- `saveLive` — file: byte-identical `public/hkjc-odds.json` write; pg: `sink.saveLiveOdds("hkjc", generatedAt, flatEntries)`; `resultEntries` never enter live odds. `data/corner-result-overrides.json` is still read from file in both modes (audited manual input).

Result source priorities (pg mapping only): the legacy importer (`scripts/import-legacy-to-postgres.mjs`) assigns **no** priority — all imported rows default to 0. Slice B2 therefore implements the minimal scale in the pg store: `manual:FOTMOB` = 40 > `API-Football` = 30 > HKJC historic (id contains `-historic-`) = 20 > HKJC live = 10. This preserves the file mode's last-wins correction order (self-test semantics) and makes every collector-written row outrank legacy-imported rows for the same `matchId|market` identity, so archive re-imports can never clobber fresh collector results.

Live flattening: h2h → 3 rows (`home|draw|away`); HIL → `totals`; CHL → **`corners`** (`over|under`) — chosen over `alternate_totals_corners` to keep HKJC vocabulary distinct from The Odds API provider (the frontend accepts both); HDC → `spreads` with the **same line on both sides** (frontend groups by line); `expiresAt` = commenceTime + 3h (fallback `generatedAt` + 3h); invalid-odds rows filtered before send.

## Slice C: check-data-integrity `--database` mode

Changed files:

- Modified `scripts/check-data-integrity.mjs` — checks refactored into pure exported functions (`analyzeRows`, `formatMetrics`) shared by both modes; file-mode console output unchanged; `--database` mode added; `invokedDirectly` guard added.
- Modified `scripts/lib/test-db.mjs` — added `withDatabaseUrl` (also exposes the schema-scoped connection URL for child-process tests); `withDatabase` behavior unchanged.
- Created `scripts/check-data-integrity.test.mjs` — 5 tests.

Database integrity mode behavior:

- `node scripts/check-data-integrity.mjs --database` requires `DATABASE_URL` (clear error, exit 1, if missing).
- Creates a pool via `createPool`, reads snapshots via `createSnapshotRepository(pool).listAll()` and results via `createResultRepository(pool).listAll()`, applies the SAME checks (late snapshots, duplicate snapshot keys, duplicate result keys, negative scores, missing-commenceTime warning, `summarizeSnapshotQuality` classification), prints `mode=database` followed by the same metric lines, exits non-zero on failures.
- Strictly read-only: no writes, no migrations; the pool is always closed in `finally`.
- The DB structurally cannot contain late/duplicate/invalid snapshots (identity unique constraint + insert-time classification), so DB-mode checks pass on fixture data; tests still prove the check functions run over DB rows and the metrics print.

Gate command note: the disposable DB's public schema initially had no tables, so migrations were run into it (`node server/db/migrate-cli.mjs` → `migrationsApplied=3, status=complete`), two fixture rows (1 snapshot + 1 result, synthetic — NOT production archives) were seeded via the sink, the gate command was run (see results below), and the fixture rows were deleted afterwards. The temporary seed script was removed.

## Final gate results (2026-07-19)

| Command | Result |
|---|---|
| `node scripts/hdc-collector.mjs --self-test` | pass |
| `node scripts/hkjc-import.mjs --self-test` | pass |
| `node scripts/odds-monitor.mjs --self-test` | pass |
| `npm run check:data` | pass — snapshots=183, results=853, lateSnapshots=0, duplicateSnapshotKeys=0, duplicateResultKeys=0, negativeScores=0, valid-current=3 / legacy=93 / invalid=87 |
| `node --test` all 5 pg test files with `DATABASE_URL` | **29/29 pass** (sink 4 + hdc 7 + odds-monitor 5 + hkjc-import 8 + integrity 5) |
| `node scripts/check-data-integrity.mjs --database` (seeded disposable DB) | pass — `mode=database`, snapshots=1, results=1, all failure counters 0, exit 0 |
| `node --test scripts/lib/storage-backend.test.mjs` (no `DATABASE_URL`) | 6/6 pass |
| DB tests without `DATABASE_URL` | clean skip (e.g. integrity: 4 pass, 1 skipped, 0 fail) |
| `npm test` (vitest) | 149/149 pass (25 files) |
| `npm run build` | pass (tsc + vite + PWA) |
| `npm audit` | found 0 vulnerabilities |

## Source/network safety evidence

- No live provider calls: collectors/importers were never run on their normal paths; only `--self-test` (offline) and fixture-driven unit/integration tests were executed. All pg tests run with network access to providers denied by construction (fixtures only).
- `.env.local` values were never read, printed, or logged by the agent.
- DB access was limited to the disposable test database; every test uses a unique UUID schema dropped afterwards (the one public-schema seed for the `--database` gate used synthetic fixtures and was cleaned up).
- Advisory locks are released in `finally` (sink) and file locks in `finally` (file store).
- File mode cannot be selected accidentally in production (`NODE_ENV=production` + non-postgres backend throws at startup).
- No browser/public route can invoke collector scripts (no server route changes were made in this task).

## Archive hashes

`sha256sum data/*.jsonl data/*.json public/hkjc-odds.json` recorded before and after every slice — **unchanged** across the whole task.

## Remaining limitations

- Pg-mode `loadSnapshots()` (hkjc-import) returns only valid-current + legacy snapshots; invalid rows are audit-ledger-only in pg mode, while file mode reads all rows. This only affects which matchIds count as "snapshotted 角球" for the API-Football fallback.
- odds-monitor alert inbox writes remain file-based in both modes (alerts are delivery output, not persistence).
- **odds-monitor pg mode does not keep append-only price history.** File mode appends every poll to `data/odds-history.jsonl` (line-movement history); pg mode routes through provider-scoped live replacement, so each poll replaces the previous rows and no time series survives. Nothing currently reads `odds-history.jsonl`, so impact is latent, but this semantic difference must be consciously accepted or redesigned (e.g. a dedicated price-history table) before the Task 9 production cutover. Flagged by the independent review (I1).
- Pg result priorities pin HKJC historic (20) permanently above HKJC live (10) across runs; file mode is pure last-wins. Within one import batch the order matches file mode, but across runs a later live row can never overwrite an earlier historic row for the same `matchId|market`. Judged more correct, but it is a deliberate divergence. Flagged by the independent review (M4).
- `hkjc-import.mjs` calls `process.loadEnvFile(".env.local")` at module top level, so importing the module (e.g. its pg test) loads `.env.local` into the process env. Values are never printed or used by tests. Flagged by the independent review (M1).
- `flattenSportEntries` (hdc-collector) does not pre-filter invalid odds, so one malformed bookmaker entry rejects the whole provider batch for that sport (previous rows survive via rollback). Parsers normally emit complete entries. Flagged by the independent review (M5).
- `data/hdc-collector.lock` (stale, dated 2026-07-14) was left untouched; the file lock owner is long gone and the next file-mode run will recover it via the existing stale-lock logic.
- The legacy importer writes priority-0 rows; collector rows (priority 10–40) always outrank them, which is intentional but means re-running the legacy import never refreshes a collector-written result.
- `hkjc-import.mjs` keeps a pre-existing quirk: `fetchApiFootballCornerOdds`'s return value is discarded (it mutates `state.cornerOdds`); preserved as-is.
- `scripts/check-data-integrity.mjs` file mode resolves data paths from `process.cwd()` (pre-existing behavior, unchanged).
- `server.mjs` legacy code, VM/Compose/Caddy/Cloudflare/DNS deployment, and production owner bootstrap remain out of scope (Phase 2).

## Independent review (2026-07-19)

Verdict: **APPROVED WITH MINOR FINDINGS** — no Critical findings. Reviewer re-ran all gates independently and reproduced every claimed result (3 self-tests, check:data 183/853, 29/29 pg tests, 149/149 Vitest, DATABASE_URL refusal, backend-resolution throws, archive mtimes unchanged). Findings:

- I1 (Important): odds-monitor pg history semantics — documented above in limitations; decision deferred to the Task 9 final gate.
- M2: advisory-unlock failure could return a lock-holding client to the pool — **fixed** (`client.release(error)` + rethrow in `postgres-sink.mjs`; sink + hdc pg tests re-run 11/11 pass after the fix).
- M1, M3, M4, M5, M6: documented above or accepted (M6 daemon-mode store failure crash matches pre-existing file-mode behavior; non-`--once` pg mode intentionally keeps the pool open).
