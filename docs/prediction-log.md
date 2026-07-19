# Prediction Log

## Current system state

- App: Vite + React + TypeScript.
- Core models: 1X2 odds, Kelly stake, corners Poisson.
- Data source: The Odds API.
- Monitor: `scripts/odds-monitor.mjs`.

## Decisions

| Date | Decision | Reason | Files |
|---|---|---|---|
| 2026-07-08 | Extract Odds API parser to `src/oddsApi.ts` | Keep `App.tsx` UI-focused and give future API changes a small test seam. | `src/oddsApi.ts`, `src/oddsApi.test.ts`, `src/App.tsx` |
| 2026-07-08 | Guard malformed Odds API bookmaker/market/outcome shapes | Parser is a trust boundary; bad API rows should be skipped, not crash the UI. | `src/oddsApi.ts`, `src/oddsApi.test.ts` |
| 2026-07-08 | Add minimal monitor config validation | Prevent bad `pollSeconds`, non-array `watchlist`, or typo operator from silent wrong alerts. | `scripts/odds-monitor.mjs` |

| 2026-07-08 | Remove hardcoded Arsenal vs Chelsea sample fixture from app startup | Sample data was polluting the real dashboard and selected fixture view after live odds import. | `src/App.tsx` |
| 2026-07-08 | Add HKJC HAD import path | HKJC GraphQL only accepts whitelisted query shapes; use a Node importer to write `public/hkjc-odds.json`, then load it in the app. | `scripts/hkjc-import.mjs`, `package.json`, `src/App.tsx` |
| 2026-07-08 | Split analysis tools into dashboard market tabs | Keep 主客和 fixtures, 大細波 model, and 角球 model under Dashboard market tabs; keep Analysis page for import/manual 1X2 tooling. | `src/App.tsx`, `src/styles.css` |
| 2026-07-08 | Add real football totals model | Use Poisson goal total baseline from team goal-for/against averages, with over/under fair odds, edge, and Kelly stake. | `src/totals.ts`, `src/totals.test.ts`, `src/App.tsx`, `src/styles.css` |
| 2026-07-08 | Upgrade football totals model | Add home/away split, recent-form weighting, and league-average calibration. | `src/totals.ts`, `src/totals.test.ts`, `src/App.tsx` |
| 2026-07-08 | Store totals odds snapshots | `odds-monitor` now appends each successful totals poll to `data/odds-history.jsonl`, giving line movement a real history source. | `scripts/odds-monitor.mjs` |
| 2026-07-09 | Import totals as dashboard cards | The Odds API fetch now requests `h2h,totals`; totals parser stores Over/Under lines and Dashboard 大細波 tab renders API cards. | `src/oddsApi.ts`, `src/oddsApi.test.ts`, `src/App.tsx`, `src/styles.css` |
| 2026-07-09 | Import HKJC corner cards | HKJC importer now requests `CHL` corner high/low pool and Dashboard 角球 tab auto-loads/render line + 大角/細角 cards from API data. | `scripts/hkjc-import.mjs`, `src/App.tsx` |
| 2026-07-09 | Rank corner cards by Poisson edge | Dashboard 角球 cards now feed HKJC line/odds into the existing weighted corner Poisson model, showing over/under edge, stake, and sorting by best edge. | `src/App.tsx` |
| 2026-07-08 | Add weighted recent form to corners model | Blend season corner baseline with recent corner form via user-controlled recent-weight percentage. | `src/corners.ts`, `src/corners.test.ts`, `src/App.tsx` |
| 2026-07-09 | Simplify market cards to single pick | Dashboard market cards now show one direct action (`買主勝/買大/買細/唔買`) instead of exposing both sides and detailed edge rows. | `src/App.tsx`, `src/styles.css` |
| 2026-07-09 | Import HKJC totals for dashboard 大細波 | HKJC importer now requests `HIL` and the Dashboard totals tab auto-loads HKJC near-term 大細波 instead of stale EPL The Odds API fixtures. | `scripts/hkjc-import.mjs`, `src/App.tsx`, `public/hkjc-odds.json` |
| 2026-07-09 | Keep all API imports and highlight HKJC | Dashboard merges The Odds API and HKJC imports instead of replacing prior data; HKJC-backed cards get a green outline. | `src/App.tsx`, `src/styles.css` |
| 2026-07-09 | Show hit chance on cards | Dashboard card percentage now displays the selected side's model probability (`中 xx%`) instead of value edge. | `src/App.tsx` |
| 2026-07-09 | Calibrate market-card hit chance | HKJC currently has no final completed rows to backtest; in-play data only. Shrink totals/corners Poisson probability toward bookmaker-implied probability to reduce unsupported overconfidence until enough final results exist. | `src/marketCalibration.ts`, `src/marketCalibration.test.ts`, `src/App.tsx` |
| 2026-07-09 | Add completed-result comparison page | Add `#/history` page and HKJC result parser for completed HAD/HIL/CHL comparisons; current live import has 0 final rows, so page shows empty state until HKJC exposes final results. | `src/route.ts`, `src/route.test.ts`, `scripts/hkjc-import.mjs`, `src/App.tsx` |
| 2026-07-09 | Use HKJC historic result endpoint | `npm run import:hkjc` now calls HKJC `matchResult` historic endpoint for the last 7 days and writes actual-result rows; rows without saved pre-match prediction are marked `待對比`. | `scripts/hkjc-import.mjs`, `src/App.tsx` |
| 2026-07-09 | Save pre-match prediction snapshots | Dashboard now saves HKJC card picks in localStorage before kickoff and `#/history` applies them to completed rows for `中/錯`; older rows remain `待對比`. | `src/predictionSnapshots.ts`, `src/predictionSnapshots.test.ts`, `src/App.tsx` |
| 2026-07-09 | Add local backend for prediction/backtest loop | Node stdlib server persists prediction snapshots to JSONL and exposes `/api/results`, `/api/backtest`, `/api/predictions`, `/api/import/hkjc`; frontend posts snapshots best-effort while keeping localStorage fallback. | `server.mjs`, `package.json`, `src/predictionSnapshots.ts`, `src/App.tsx` |
| 2026-07-10 | Make backtest records durable and settleable | First snapshot per `matchId|market|line` is immutable, retains odds for ROI, supports draw normalization and Asian-line settlement; HKJC imports merge historic results into `data/result-archive.jsonl`. | `server.mjs`, `scripts/hkjc-import.mjs`, `src/predictionSnapshots.ts` |
| 2026-07-10 | Include selected decimal odds in frontend snapshots | Backend ROI logic already required odds, but dashboard snapshot creation omitted them; new snapshots now preserve the actual selected price. Existing unpriced snapshots remain valid for hit rate only. | `src/App.tsx` |
| 2026-07-10 | Add API-Football as missing-corner-result fallback | Keep HKJC as odds owner; only query API-Football for completed matches that have a saved corner snapshot but no HKJC corner total. Match by English team names plus kickoff and archive the summed `Corner Kicks`. | `scripts/hkjc-import.mjs`, `.env.local` |
| 2026-07-11 | Make imported totals/corners cards honest market-only views | Removed shared demo team stats from every imported fixture. Cards now show de-vig bookmaker probability as `市場 xx%` and `資料不足，唔買` until a real per-team data source exists. | `src/App.tsx`, `src/marketCalibration.ts` |
| 2026-07-11 | Unify Asian settlement and expected-value semantics | Whole, half and quarter lines now account for pushes, half-wins and half-losses through one frontend implementation; backend self-test uses the same settlement matrix. | `src/asianTotals.ts`, `src/totals.ts`, `src/corners.ts`, `src/predictionSnapshots.ts`, `server.mjs` |
| 2026-07-11 | Make backend backtest the History source of truth | History reads `/api/backtest`, renders full/half/push outcomes, uses `matchId` joins, and no longer settles from mutable localStorage. New snapshots include model version and provenance; backend identity includes version. | `src/App.tsx`, `src/odds.ts`, `src/predictionSnapshots.ts`, `server.mjs` |
| 2026-07-11 | Paginate and stable-key the result archive | Historic HKJC results paginate in batches of 20; archive rows merge by `matchId|market`, preferring fresh corrected rows. | `scripts/hkjc-import.mjs` |
| 2026-07-11 | Parse only HKJC full-time result stage | Historic result arrays contain partial stages before full time. Settlement now requires `stageId: 5` (preferring `resultType: 1`) instead of falling back to the first row. | `scripts/hkjc-import.mjs` |
| 2026-07-11 | Apply configured H2H edge threshold everywhere | Dashboard labels and snapshot creation share the configured threshold, preventing sub-threshold picks from being displayed or archived. | `src/picks.ts`, `src/App.tsx` |
| 2026-07-11 | Use leave-one-out HDC market comparison | Every The Odds API same-line market is analyzed without requiring HKJC. Each candidate price is compared with the de-vigged consensus of all other bookmakers; the highest edge wins. HKJC joins the candidate set and receives a green `HKJC 同盤` marker only when the fixture and signed line match. | `src/handicap.ts`, `src/handicap.test.ts`, `src/App.tsx` |
| 2026-07-11 | Settle external HDC snapshots from The Odds API scores | HDC snapshots preserve the selected bookmaker under model `hdc-loo-v2`; backend imports completed scores hourly while the HDC dashboard is active, keyed by The Odds API event ID for immutable backtest settlement. | `src/predictionSnapshots.ts`, `server.mjs`, `src/App.tsx` |
| 2026-07-11 | Settle HDC from immutable snapshots | HDC snapshots preserve side, signed line, odds, chance, edge, model version and source. Frontend/backend settle whole, half and quarter handicaps from the full-time score; no snapshot remains `待對比`. | `src/predictionSnapshots.ts`, `server.mjs`, `scripts/hkjc-import.mjs` |
| 2026-07-11 | Default Odds API region to US for spreads | Live EPL probe returned 0 spread markets for UK but 38 spread markets across 4 US bookmakers, so US is the useful default while region remains user-selectable. | `src/App.tsx` |
| 2026-07-11 | Use API-Football as the second corner-odds feed | Existing key returned bookmaker-level `Corners Over Under` markets. The HKJC importer queries only CHL fixtures inside 30 minutes, matches by kickoff/team, merges exact-line prices, and reuses leave-one-out cards/snapshots as `corner-loo-v1`; this protects the 100 requests/day plan. | `scripts/hkjc-import.mjs`, `src/App.tsx` |
| 2026-07-11 | Expand background collection to the three focused markets | Request `spreads,totals` only inside the 30-minute pre-kickoff window; reuse the tested HDC leave-one-out engine through thin Over/Under adapters (`totals-loo-v1`, `corner-loo-v1`), settle from archived results, and refresh HKJC HIL/CHL/HDC plus focused API-Football corner odds every 15 minutes. | `scripts/hdc-collector.mjs`, `scripts/hkjc-import.mjs`, `src/oddsApi.ts`, `server.mjs`, `src/App.tsx`, cron `4565663f9970` |
| 2026-07-11 | Refresh HDC every three minutes while its dashboard tab is open | Reuse the existing HKJC importer and Odds API parser; backend proxies its existing `ODDS_API_KEY`, so unattended refresh does not expose the key in the browser. Each refresh replaces stale source rows before recalculating same-line value. Superseded for paid The Odds API calls by the quota-aware background collector; Dashboard polling now reads the local collector cache. | `src/App.tsx`, `server.mjs` |
| 2026-07-11 | Correct result-import trust boundaries before further backtesting | The Odds API totals result now stores summed goals instead of a score string; HKJC historic results reject negative provider sentinel scores. Removed two invalid `-1--1` archive rows. | `server.mjs`, `scripts/hkjc-import.mjs`, `data/result-archive.jsonl` |
| 2026-07-12 | Split History by market | 完場對比分為主客和／角球／大細波／亞洲讓球 tabs。每個 tab 只顯示自己的 rows，右上角以 matched snapshots 計中／錯百分比；push 另列並排除於百分比分母。 | `src/App.tsx`, `src/marketDisplay.ts`, `src/styles.css` |
| 2026-07-12 | Budget API-Football free quota | Keep the existing importer cadence but persist a UTC-day request budget. Results run before odds; stop at 90 calls/day, cap result-stat calls at 60, cache fixture IDs and corner odds, retry missing results at most once per UTC day, and stop immediately after a provider quota error. | `scripts/hkjc-import.mjs`, `data/api-football-state.json` |
| 2026-07-12 | Retire duplicate The Odds API browser polling | The background collector is the automatic owner. Remove the two-hour browser auto-fetch; preserve only the explicit manual pull. Poll paid spreads+totals at most near T-25m and T-5m, start score checks at T+180m with 12-hour retries, reserve 50 credits, and persist a 15-minute cooldown after HTTP 429. | `src/App.tsx`, `scripts/hdc-collector.mjs` |
| 2026-07-12 | Replace legacy Analysis tools with model performance | Remove browser API/manual 1X2/risk-form surfaces. Reuse canonical backtest rows for four market summaries, per-model hit rate/ROI, prediction-direction distribution, and market-scoped calibration buckets. | `src/App.tsx`, `src/marketDisplay.ts`, `src/styles.css` |

## Formulas

| Area | Formula | Source / rationale |
|---|---|---|
| Implied probability | `1 / decimalOdds` | Standard decimal odds conversion. |
| Value edge | `decimalOdds * fairProbability - 1` | Positive edge means model probability is above break-even. |
| Kelly stake | Fractional Kelly capped by bankroll percentage. | Risk control; see `src/odds.ts`. |
| Corners | Poisson under-line probability from expected total corners. | Simple baseline model; see `src/corners.ts`. |
| Goals totals | Poisson under-line probability from expected total goals, where expected home/away goals are averaged from for/against rates. | Simple 大細波 baseline; see `src/totals.ts`. |

## Data sources

| Source | Use | Notes |
|---|---|---|
| The Odds API | Live 1X2, totals and Asian-spread import; monitor alerts. | Backend and scripts read `ODDS_API_KEY` from `.env.local`; browser startup must not auto-spend paid Odds API credits. HDC only compares exact same signed line. |
| API-Football | Completed fixture corner statistics fallback. | Uses `API_FOOTBALL_KEY`; free plan is 100 requests/day, so importer only queries snapshotted missing results. |
| Manual entry | Ad-hoc bookmaker odds comparison. | Currently in React state only. |

## Backtest results

First live batch on 2026-07-10: 3 settled 大細波 snapshots, all `大 2.5`; final totals were 0, 1, and 1, so 0 hit / 3 miss. These seven early snapshots omitted selected odds, therefore ROI remains unavailable rather than fabricated. Sample is too small for calibration changes.

2026-07-11 settlement audit: 18 settled 大細波 snapshots, 9 win / 9 loss. Four are unpriced and excluded from ROI; 14 priced bets produced -1.02 units, ROI/yield -7.29%. No real settled HDC or corner snapshots exist yet, so those markets are verified by settlement matrix self-tests only.

## Verification snapshot

| Date | Command | Result |
|---|---|---|
| 2026-07-08 | `npm test` | 5 files passed, 18 tests passed. |
| 2026-07-08 | `npm run build` | TypeScript and Vite build passed. |
| 2026-07-08 | `node scripts/odds-monitor.mjs --self-test` | Monitor validation self-test passed. |
| 2026-07-10 | `npm test && npm run build && node server.mjs --self-test` | 9 files / 28 tests passed; production build and backend settlement self-test passed. |
| 2026-07-10 | Browser dashboard snapshot probe | 61 immutable snapshots persisted; 54 new snapshots include selected decimal odds, while 7 older snapshots remain unpriced and are excluded from ROI. |
| 2026-07-10 | API-Football live probe | Key authenticated; dated fixture feed returned data; completed France vs Morocco statistics returned 5+5 corners. |
| 2026-07-10 | `npm run import:hkjc && node server.mjs --self-test && npm test && npm run build` | Live import passed; backend self-test passed; 9 files / 28 tests and production build passed. |
| 2026-07-11 | Prediction integrity full verification | Live import wrote 89 HAD / 89 HIL / 48 CHL and 346 current result comparisons into a 350-row archive; archive had 0 duplicate `matchId|market` keys. Full-time-stage correction changed `hkjc-50070597` from 1-0 to 5-0 and backend summary from 0中/3錯 to 1中/2錯. Server/importer/monitor self-tests passed, 11 files / 33 tests passed, production build passed. Disposable versioned POST stored two model versions then restored real data. Browser History showed 350 rows: 1中, 2錯, 347待對比; console had 0 JS errors. |
| 2026-07-11 | HDC方案 2 full verification | Live HKJC import wrote 65 valid HDC rows with 0 missing English team names, invalid lines/odds or duplicate IDs. Live Odds API EPL probe returned 38 US spread markets across 4 bookmakers; UK returned none, so default changed to US. Full suite passed: 12 files / 38 tests, production build, server/importer/monitor self-tests. Browser HDC tab rendered signed lines and honest `資料不足，唔買` cards when no exact cross-book match existed; console had 0 JS errors. |
| 2026-07-11 | Settlement trust-boundary audit | RED self-tests reproduced The Odds API totals parsing `2-1` as 2 goals and HKJC `-1` score sentinels entering the archive. Fixes passed server/importer self-tests, 13 files / 48 tests, production build. Live backtest: 563 rows, 18 settled, zero negative-score rows; History showed 18 comparable / 563 total and zero console errors. |
| 2026-07-12 | History market tabs and score summary | RED tests covered market filtering and win/loss/push summary. Full suite passed 13 files / 50 tests and production build. Browser-smoked all four tabs: 主客和 0 comparable, 角球 4 at 0%/100%, 大細波 38 at 57.9%/42.1%, 亞洲讓球 0; console had 0 JS errors. |
| 2026-07-12 | API-Football quota guard | RED importer self-test covered UTC reset, 90-call ceiling, once-daily result retries, and 10-minute odds retry throttling. Exhausted-quota live smoke made one detection call, persisted `quotaExhausted`, then a second full HKJC import made zero extra API-Football calls and still exited 0. Importer/collector self-tests, 13 files / 51 tests, and production build passed. |
| 2026-07-12 | The Odds API efficiency gate | RED collector self-test reproduced pre-T-25 polling, repeated early polling, short score retries, low reserve, and ignored cooldown. GREEN verification passed collector/importer self-tests, 12 files / 50 tests, and production build. Live dry-run reported no due paid sports with 245 credits remaining; a fresh Dashboard load made 0 requests to `the-odds-api.com` or local `/api/odds`, with 0 browser JS errors. |
| 2026-07-12 | Model performance Analysis UI | RED helper tests covered priced/unpriced ROI, `legacy-v0`, direction shares, calibration buckets, and empty input. Full suite passed 12 files / 52 tests and production build. Browser-smoked all four markets: 主客和/HDC honest empty states, 角球 10 samples at 10.00% and -66.50% ROI with small-sample warning, 大細波 47 samples at 48.94% and -2.20% ROI; 0 paid provider requests and 0 JS errors. |
| 2026-07-12 | Pre-sample model readiness | Server self-test covers pending/current-model snapshots, odds/chance completeness, and dominant direction. Analysis now separates current and legacy snapshot counts, settled/pending, completeness, source and health flags. Full suite passed 12 files / 52 tests, server self-test and build; browser showed 2 readiness cards for 大細波, 0 paid requests and 0 JS errors. |
| 2026-07-12 | Pending-age and pre-kick integrity guard | New snapshots persist `commenceTime`; browser storage and `POST /api/predictions` reject `savedAt >= commenceTime`. Readiness splits pending into upcoming, normal T+180m settlement wait, overdue result, and unclassified legacy data, with result-time fallback for old snapshots. Server self-test, 12 files / 53 tests and build passed; live late-snapshot POST returned 400, browser showed overdue badges, 0 paid requests and 0 JS errors. |
| 2026-07-12 | Corner result backlog recovery | The apparent 59-result backlog was four matches across 59 correlated line snapshots. API-Football was retried under the 90/60 caps but still omitted corner statistics. Added bounded 12-hour ISO retries, legacy attempt migration, and an auditable FotMob override path requiring canonical match ID, integer total, source URL and verification timestamp. Verified totals 9, 7, 10 and 10; current `corner-loo-v1` now has 7/7 matches and 69/69 snapshots settled with 0 overdue. Readiness reports matches separately from line snapshots and uses settled matches for the 30-match warning. Server/importer/collector self-tests, 12 files / 53 tests, build and browser smoke passed; 0 paid browser requests and 0 JS errors. |
| 2026-07-12 | Current-model performance isolation | Market overview, direction and calibration now exclude `legacy-v0`; version cards retain legacy as an explicitly separate historical row. Performance summaries report unique matches plus correlated market lines, and the small-sample gate uses unique matches. Browser verified corner overview as current-only 7 matches / 69 lines with the 7-match warning; totals correctly showed no current settled sample instead of legacy performance. 12 files / 53 tests and production build passed. |
| 2026-07-12 | Dashboard HKJC-only card recovery | `buildHandicapCards` seeded groups only from non-HKJC rows, so when `/api/hdc-live` had no external rows it discarded valid HKJC HIL/CHL/HDC entries and all three Dashboard tabs appeared empty. Added RED coverage and retained unmatched HKJC event+line groups as honest one-bookmaker `資料不足，唔買` cards. Browser verified 35 totals, 21 corners and 29 handicap cards; 12 files / 54 tests, build and browser console passed. |
| 2026-07-12 | Source-neutral odds ingestion | Replaced the eight-league collector allowlist with quota-free discovery of 33 active non-outright soccer competitions. The Odds API now caches and serves `h2h`, `totals` and `spreads` independently; Dashboard merges those records without requiring HKJC, while HKJC remains an optional standalone/matching bookmaker. Live collection exposed and fixed a provider contract failure: millisecond ISO query timestamps caused 422 `INVALID_COMMENCE_TIME_FROM`; timestamps now use second precision. Bounded live run cost 3 credits, leaving 242, and produced 8 h2h, 6 totals and 4 handicap bookmaker rows for Brazil Série B. Browser verified an 8-bookmaker h2h card and multi-bookmaker totals/handicap cards alongside HKJC-only cards. Server/importer/collector self-tests, 12 files / 54 tests, build and console passed. |
| 2026-07-13 | Canonical fixture merge and corner feed | Added one shared fixture matcher using accent-insensitive English team names, safe non-empty normalization, common club suffix removal and a ±10-minute kickoff bound. Cross-provider groups prefer the HKJC match ID so combined h2h/totals/handicap snapshots retain settlement compatibility. A bounded live France vs Spain probe confirmed The Odds API event markets: Pinnacle returned 10 `alternate_spreads_corners` and 18 `alternate_totals_corners` outcomes at response cost 2. Added event-specific corner-total parsing and near-kickoff collection only, exposed corner cache through backend/UI, and deliberately skipped unused corner-handicap ingestion. 12 files / 57 tests, server/importer/collector self-tests, build and browser console passed. |

| 2026-07-16 | Add local operations README and data integrity check | Added a concise local runbook plus a read-only `npm run check:data` guard for post-kick snapshots, duplicate snapshot/archive keys, and negative provider scores. Historical snapshots without `commenceTime` are reported as warnings and kept for audit. | `README.md`, `scripts/check-data-integrity.mjs`, `package.json`, `docs/prediction-log.md` |

## Next useful work

1. Keep collecting immutable pre-kick snapshots until current-model settled distinct matches reach 30.
2. Improve durable cross-provider fixture identity (alias registry) beyond English normalize + kickoff matching.
3. Re-run settlement diagnostics after more HDC / totals / corner current-model rows settle; do not retune thresholds early.
4. Codex handoff: start from `docs/CODEX-HANDOFF-2026-07-16.md`, then this log.

## Session handoff rule

New sessions should read this file first for project context. Only inspect source files for the task being changed; do not rescan the whole project unless this log is stale or the task scope is unclear.
