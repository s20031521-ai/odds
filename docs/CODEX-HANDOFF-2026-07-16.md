# Odds Tool · Hermes Handoff for Codex

Date written: 2026-07-16  
Handoff from: Hermes Agent (Telegram / local Windows host)  
Project root:

```text
C:\Users\itadmin\Documents\Codex\2026-07-06\new-chat\work\odds-tool
```

Not a git repository. There is no branch / commit history. Treat filesystem state + this report + `docs/prediction-log.md` as source of truth.

---

## 1. What this project is

Local-first football odds value dashboard + immutable prediction/backtest loop.

Primary markets:

- 主客和 (1X2 / h2h)
- 大細波 (goal totals)
- 角球 (corner totals)
- 亞洲讓球 (Asian handicap / spreads)

UI pages:

- `#/dashboard` live market cards
- `#/history` 完場對比
- `#/analysis` 模型分析 / readiness

Latest UI marker:

```text
UI_BUILD = "ui-2026.07.12.10"
```

in `src/App.tsx`.

---

## 2. Architecture after Hermes work

### Source roles

| Source | Role now | Notes |
|---|---|---|
| The Odds API | Primary multi-bookmaker odds feed | Dynamic active soccer discovery; collects `h2h,spreads,totals`; event-level corner totals only near kickoff |
| HKJC | Optional bookmaker + major settlement path | No longer fixture owner; English display/match names preferred when available |
| API-Football | Fixture mapping / scores / corner stats fallback | Free quota budgeted; not Dashboard card owner |
| FotMob | Manual/auditable corner-result override only | Used once for 4 missing corner results |
| Titan007 | Monitored fallback / human cross-check only | No stable public API; do not treat as source of truth |
| Sportmonks | Evaluated, not integrated | Optional later if result completeness is still weak |

### Runtime

| Piece | Path / command | Port / notes |
|---|---|---|
| Frontend | `npm run dev` | `http://127.0.0.1:5173` |
| Backend | `npm run server` / `node server.mjs` | `http://127.0.0.1:8787` |
| HKJC import | `npm run import:hkjc` | writes `public/hkjc-odds.json` + archives results |
| Background collector | `node scripts/hdc-collector.mjs` | cron every 3m via Hermes job `4565663f9970` |
| Tests | `npm test` | Vitest |
| Build | `npm run build` | `tsc --noEmit` + Vite |

### Credentials

Live in `.env.local` only. Never print values. Expected keys include:

- `ODDS_API_KEY`
- `API_FOOTBALL_KEY`
- optionally frontend Vite vars historically, but browser must not auto-spend paid Odds API credits

### Durable data

| File | Purpose |
|---|---|
| `data/prediction-snapshots.jsonl` | Immutable pre-kick prediction snapshots |
| `data/result-archive.jsonl` | Settlement archive |
| `data/background-hdc-odds.json` | Collector live cache for Dashboard |
| `data/hdc-collector-state.json` | discovery / slots / quota / cooldowns |
| `data/api-football-state.json` | API-Football daily budget / retry state |
| `data/corner-result-overrides.json` | Audited FotMob corner totals for 4 matches |
| `public/hkjc-odds.json` | Latest HKJC feed snapshot |

---

## 3. Model / sample rules (do not break)

Current model versions:

| Market | Current model | Notes |
|---|---|---|
| 亞洲讓球 | `hdc-loo-v2` | leave-one-out same-line |
| 大細波 | `totals-loo-v1` | leave-one-out same-line |
| 角球 | `corner-loo-v1` | leave-one-out same-line |
| Unknown / old | `legacy-v0` | retained in archive, hidden from main performance UI |

Hard rules:

1. **Do not lower the 3% edge threshold** just to generate picks.
2. **Do not retune weights / threshold / Kelly** until current-model settled distinct matches ≥ 30.
3. Sample unit is **distinct settled match**, not:
   - bookmaker rows
   - correlated line snapshots
   - Dashboard cards
   - “可對比” coverage counts
4. Push / 走盤 excluded from hit-rate denominator.
5. ROI only from priced settled records with valid decimal odds.
6. New snapshots must include `commenceTime`.
7. Frontend + backend reject post-kick snapshots (`savedAt >= commenceTime`).
8. Settlement grace: overdue after kickoff + 180 minutes.
9. Browser must not make automatic paid The Odds API requests.
10. Collector keeps ~50-credit reserve; paid bulk polls near T-25m and T-5m only.

Snapshot identity:

```text
matchId|market|line|modelVersion
```

Missing modelVersion is treated as `legacy-v0`.

Snapshot inventory when this handoff was written (local file count):

```text
total snapshots: 183
大細波|legacy-v0: 75
角球|legacy-v0: 18
大細波|totals-loo-v1: 21
角球|corner-loo-v1: 69
```

Important semantic example:

- corner current model historically reached **7 distinct matches / 69 snapshots settled**
- so “69” is lines, not 69 independent samples

---

## 4. Major changes Hermes completed

### A. Analysis / history honesty

- Analysis page rebuilt around `/api/backtest` as canonical source.
- Removed old API-key / bankroll-Kelly / manual 1X2 tooling from Analysis.
- Readiness cards by market + model version:
  - settled / pending / upcoming / settling / overdue / unknown
  - matches vs snapshots reported separately
- `legacy-v0` hidden from main 完場對比 + performance overview; only current-model stats drive main cards.
- UI label change:
  - old misleading: `可對比 72`
  - new: `現行模型 X場 · Y盤口`

Key files:

- `src/App.tsx`
- `src/marketDisplay.ts`
- `src/marketDisplay.test.ts`
- `server.mjs`

### B. Temporal integrity

- Snapshot contract requires `commenceTime`.
- Reject late snapshots on frontend storage and `POST /api/predictions`.
- Pending age split uses T+180m settlement grace.

### C. Corner result backlog recovery

- Apparent 59 overdue corner snapshots collapsed to 4 matches.
- API-Football unresolved-result retry changed to every 12 hours (with legacy date-state migration).
- Added audited override file `data/corner-result-overrides.json` for 4 verified corner totals: 9, 7, 10, 10.
- After recovery, current `corner-loo-v1` was 7/7 matches, 69/69 snapshots, 0 overdue.

Key files:

- `scripts/hkjc-import.mjs`
- `data/corner-result-overrides.json`

### D. Dashboard empty-state bugfix

Root cause:

- `buildHandicapCards` only seeded groups from non-HKJC rows.
- When external live cache was empty, HKJC-only lines disappeared and tabs looked empty.

Fix:

- Keep unmatched HKJC event+line groups as honest one-bookmaker cards: `資料不足，唔買`.

Key files:

- `src/handicap.ts`
- `src/handicap.test.ts`

### E. Source-neutral odds ingestion

- Collector no longer uses hard-coded 8 leagues.
- Discovers active soccer sports from free `/sports` endpoint.
- Collects `h2h,spreads,totals`.
- Server flattens sport caches into source-neutral `/api/hdc-live`.
- Dashboard merges HKJC + background cache independently of current tab.
- Fixed The Odds API 422 caused by millisecond ISO timestamps via `formatApiTime()`.

Key files:

- `scripts/hdc-collector.mjs`
- `server.mjs`
- `src/App.tsx`
- plan: `.hermes/plans/2026-07-12-source-neutral-odds.md`

### F. English match names + canonical fixture matching

1. HKJC importer now prefers English names:

```js
homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch
awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch
```

2. Shared matcher in `src/fixtureMatch.ts`:
   - accent-insensitive normalize
   - strip common suffixes (`fc`, `afc`, `cf`, `women`, `w`, etc.)
   - reject empty normalized names
   - kickoff tolerance ±10 minutes
   - prefer HKJC `matchId` when present so settlement still aligns with HKJC results

Applied to h2h grouping and handicap/totals-style matching.

Key files:

- `src/fixtureMatch.ts`
- `src/odds.ts`
- `src/handicap.ts`
- `scripts/hkjc-import.mjs`
- plan: `.hermes/plans/2026-07-12-canonical-fixture-corner-probe.md`

### G. The Odds API corner markets

Probe result (France vs Spain):

- market: event-specific `/events/{id}/odds`
- `alternate_totals_corners`: present (Pinnacle 18 outcomes)
- `alternate_spreads_corners`: present (Pinnacle 10 outcomes)
- cost: 2 credits for that probe

Integrated only:

- `alternate_totals_corners`
- only for events already inside collector paid window
- cache path: `cornerEntries`
- exposed via server flatten + Dashboard merge

Deliberately **not** integrated:

- `alternate_spreads_corners` (corner handicap), because UI/settlement path does not use it yet

### H. Collector bugfix after corner integration

Bug:

- `collectOdds()` referenced out-of-scope `eventsBySport[...]`
- cron job failed after bulk odds fetch (`exit 1`)

Fix:

- pure helper `dueCornerEvents(payload, now)`
- iterate current odds payload, not discovery map
- self-test covers the helper
- Hermes cron `4565663f9970` re-run: `last_status: ok`

Key file:

- `scripts/hdc-collector.mjs`

---

## 5. Verification baseline

Last full verification after corner/fixture work:

```text
node server.mjs --self-test     PASS
node scripts/hdc-collector.mjs --self-test  PASS
node scripts/hkjc-import.mjs --self-test    PASS
npm test                        12 files / 57 tests PASS
npm run build                   PASS
UI build                        ui-2026.07.12.10
Browser smoke                   Dashboard load + 0 recorded JS errors
```

Note: backend may not always be running. Check `http://127.0.0.1:8787/health` and restart with `node server.mjs` if needed.

---

## 6. External automations related to this project

Hermes cron:

| Job ID | Name | Schedule | Script | Notes |
|---|---|---|---|---|
| `4565663f9970` | 讓球/大細波/角球 background collector | every 3m | `hdc-background-collector.py` wrapper → project collector | fixed after corner scope bug |

Not part of odds-tool code, but adjacent ops incidents during same Hermes period:

- TG commute monitor DNS: `t.me` A-record NXDOMAIN on this host; switched public host to `telegram.me`
- TG monitor false morning alert: old posts resurfaced after DNS fix; added 20-minute same-day timestamp filter

Those live under Hermes scripts, not this project.

---

## 7. Known open issues / next work

Priority order recommended for Codex:

1. **Accumulate current-model settled samples**
   - do not retune before 30 distinct settled matches
   - keep reporting matches and snapshots separately

2. **Fixture identity still incomplete**
   - English normalize + kickoff matching helps
   - still no durable cross-provider alias registry
   - Chinese/English/spelling variants can still split cards
   - ideal: canonical fixture ID + provider aliases + keep raw names for audit

3. **Corner feed coverage**
   - event-level corner totals only near kickoff and only when provider has coverage
   - do not spam per-event corner requests outside window
   - corner handicap intentionally not collected yet

4. **H2H edge quality**
   - multi-book H2H edges observed well below 3% threshold, so all 唔買 can be correct
   - do not force picks

5. **Optional Sportmonks**
   - not required for system to run
   - consider only if fixture identity / corner result completeness remains weak

6. **Git**
   - repo is not git-initialized
   - if Codex wants version control, initialize carefully without committing secrets from `.env.local`

---

## 8. Safe bootstrap for Codex

```bash
cd "C:/Users/itadmin/Documents/賭"

# health / unit verification
node server.mjs --self-test
node scripts/hdc-collector.mjs --self-test
node scripts/hkjc-import.mjs --self-test
npm test
npm run build

# runtime
node server.mjs
npm run dev
```

Read first:

1. this handoff
2. `docs/prediction-log.md`
3. only the source files for the task being changed

Key source map:

| Concern | Start here |
|---|---|
| UI tabs / load / labels | `src/App.tsx` |
| sample/performance semantics | `src/marketDisplay.ts` |
| h2h consensus / edge | `src/odds.ts` |
| handicap cards | `src/handicap.ts` |
| totals/corner cards from Odds API | `src/oddsApi.ts` |
| fixture merge | `src/fixtureMatch.ts` |
| snapshot contract | `src/predictionSnapshots.ts` |
| backtest / readiness API | `server.mjs` |
| collector quota + discovery | `scripts/hdc-collector.mjs` |
| HKJC + result import | `scripts/hkjc-import.mjs` |

---

## 9. Explicit non-goals / anti-patterns

Do **not**:

- treat “可對比 / cards / bookmaker rows / snapshots” as independent model samples
- auto-fetch paid Odds API from browser mount
- reintroduce HKJC as sole fixture owner
- delete archive rows just because they are legacy
- invent settlement when result stats are missing
- lower edge threshold to create 買 picks
- spend corner event credits outside near-kickoff window without coverage probe

Do:

- keep market coverage and model sample language separate in UI copy
- prefer TDD for non-trivial behavior changes
- preserve immutable first snapshot per key
- prefer HKJC matchId when HKJC participates in a merged fixture, so settlement remains compatible

---

## 10. One-line status

Local football odds app is source-neutral for multi-book h2h/totals/spreads, HKJC is optional English-named bookmaker, backtest/readiness hide legacy noise and count distinct matches, corner event markets are probed and partially integrated, and model tuning is intentionally frozen until more current-model settled samples exist.
