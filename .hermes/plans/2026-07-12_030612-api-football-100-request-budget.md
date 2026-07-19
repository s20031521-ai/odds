# API-Football 100 Request Budget Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Keep API-Football below 100 requests/day while preserving pre-match corner odds and eventually settling every snapshotted corner match.

**Architecture:** Keep the existing 15-minute importer cadence, but make API-Football calls stateful and due-only inside `scripts/hkjc-import.mjs`. Cache fixture IDs and corner odds on disk, prioritize missing completed results, and stop at a local 90-request daily ceiling so 10 requests remain for manual recovery/debugging.

**Tech Stack:** Existing Node.js importer, JSON/JSONL files, Vitest/Node self-test. No new dependency or cron job.

## Current evidence

- API-Football free limit: 100 requests/day.
- `hdc-collector.mjs` invokes `hkjc-import.mjs` every 15 minutes.
- Each import currently re-fetches fixture lists and then statistics for every snapshotted match still missing a corner result.
- Current corner snapshots cover 22 matches; only 1 match has a corner result, leaving 21 missing matches.
- The current API response is HTTP 200 with `errors.requests = "You have reached the request limit for the day"`.
- Worst case today: roughly 1 fixture-list request per date plus up to 21 statistics calls on every 15-minute run. Four runs can consume the full allowance.

## Budget policy

1. Hard local ceiling: **90 calls per UTC day**. Keep 10 calls unused for manual checks and accounting drift.
2. Priority 1: completed snapshotted matches missing corner results, maximum 60 calls/day.
3. Priority 2: pre-match corner odds, using only the remaining budget.
4. One fixture-list fetch per date per UTC day; reuse cached fixture IDs afterward.
5. One statistics attempt per match after kickoff +150 minutes. If unavailable, retry no sooner than the next UTC day.
6. One odds fetch per matched fixture inside the existing 30-minute pre-kick window. Cache the returned rows until kickoff +3 hours so later imports do not call again or erase the feed.
7. On API-Football quota error, stop all API-Football work for that UTC day immediately. HKJC import must continue normally.

## Hypothesis and evidence plan

**Hypothesis:** Reusing fixture IDs/odds and enforcing per-match retry timestamps reduces steady-state use from repeated 15-minute bursts to approximately one result call per completed match and one odds call per new eligible fixture.

**Success:** 15-minute imports continue, repeated imports make zero duplicate API-Football calls, daily count never exceeds 90, cached odds stay available to the browser, and missing corner results settle after publication.

**Independent failure signals:** Daily count exceeds 90; the same fixture/date endpoint is called repeatedly; cached corner odds disappear before the browser snapshot flow; quota error aborts HKJC import; a failed statistics query retries within the same UTC day.

**Ablation expectations:** Without persisted state, duplicate calls return. Without cached odds rows, quota is saved but the browser loses the second bookmaker needed for snapshots. Without result priority, fresh odds can starve the 21-match result backlog.

---

### Task 1: Add quota state and pure due checks

**Objective:** Make request eligibility deterministic and testable before touching live calls.

**Files:**
- Modify: `scripts/hkjc-import.mjs`

**State file:** `data/api-football-state.json` generated at runtime, with this shape:

```json
{
  "utcDay": "2026-07-12",
  "calls": 0,
  "quotaExhausted": false,
  "fixturesByDate": {},
  "fixtureIds": {},
  "oddsAttempts": {},
  "resultAttempts": {},
  "cornerOdds": []
}
```

**Steps:**

1. Extend the existing importer `--self-test` with assertions that:
   - a new UTC day resets `calls` and `quotaExhausted`;
   - `calls >= 90` blocks a request;
   - result attempts are not due twice on the same UTC day;
   - odds attempts are not due twice for the same match unless the first attempt found no fixture and at least 10 minutes passed.
2. Run `node scripts/hkjc-import.mjs --self-test`; expect RED on missing helpers.
3. Add minimal pure helpers: `utcDay(now)`, `rollApiFootballDay(state, now)`, `apiFootballAllowed(state)`, `resultDue(state, matchId, now)`, and `oddsDue(state, matchId, now)`.
4. Re-run self-test; expect PASS.

---

### Task 2: Count calls and stop cleanly on quota exhaustion

**Objective:** Put the budget guard at the shared `fetchApiFootball()` boundary so every API-Football caller is covered once.

**Files:**
- Modify: `scripts/hkjc-import.mjs:655-662`

**Steps:**

1. Add a self-test with a fake fetch response proving one attempted request increments `calls` exactly once and a quota error sets `quotaExhausted: true`.
2. Run self-test; expect RED.
3. Pass the persisted state into `fetchApiFootball(resource, params, apiKey, state)`.
4. Before fetch, reject when `calls >= 90` or `quotaExhausted`.
5. Increment `calls` immediately before the network request.
6. If `payload.errors.requests` reports daily exhaustion, set `quotaExhausted = true` and throw a recognizable `API_FOOTBALL_QUOTA` error.
7. Save state in the importer `finally` path so failures cannot lose accounting.
8. Ensure catch blocks still return `[]`, allowing HKJC data to be written.
9. Re-run self-test; expect PASS.

---

### Task 3: Cache fixture lookups and IDs

**Objective:** Reduce fixture discovery to one request per date/day and reuse provider fixture IDs for odds and results.

**Files:**
- Modify: `scripts/hkjc-import.mjs:556-670`

**Steps:**

1. Add a self-test fixture where two HKJC matches on the same date require only one fixture-list load and both matched IDs are written to `state.fixtureIds[hkjcMatchId]`.
2. Run self-test; expect RED.
3. Add `fixturesForDate(date, apiKey, state, now)`:
   - return `state.fixturesByDate[date].rows` when cached for the current UTC day;
   - otherwise call `/fixtures`, cache the response and UTC day, then return it.
4. After `matchApiFootballFixture()`, persist `state.fixtureIds["hkjc-<id>"] = fixture.fixture.id`.
5. Use the cached ID first in both odds and result paths; call `fixturesForDate()` only when missing.
6. Re-run self-test; expect PASS.

---

### Task 4: Cache pre-match corner odds

**Objective:** Fetch each eligible fixture's corner odds once and keep those rows visible across later importer runs.

**Files:**
- Modify: `scripts/hkjc-import.mjs:556-609, 386-406`

**Steps:**

1. Add a self-test proving a second importer pass returns cached corner-odds rows without another API call.
2. Run self-test; expect RED.
3. Before fetching `/odds`, skip matches that already have cached rows or a persisted corner snapshot.
4. Cache successful parsed rows in `state.cornerOdds` with `matchId`, `commenceTime`, and `savedAt`.
5. Keep cached rows until `commenceTime + 3 hours`; prune older rows each run.
6. Merge `state.cornerOdds` with HKJC `CHL` rows when writing `public/hkjc-odds.json`.
7. For a no-fixture/no-market response, store an attempt and permit only one retry after 10 minutes while still pre-kick.
8. Re-run self-test; expect PASS.

---

### Task 5: Prioritize and throttle corner-result settlement

**Objective:** Clear the 21-match backlog without repeatedly charging the same missing result.

**Files:**
- Modify: `scripts/hkjc-import.mjs:611-653`

**Steps:**

1. Add a self-test proving:
   - only matches with corner snapshots and no corner result are candidates;
   - candidates must be at least 150 minutes past kickoff;
   - a failed attempt is not retried until the next UTC day;
   - successful results are never queried again.
2. Run self-test; expect RED.
3. Sort candidates oldest kickoff first.
4. Process result candidates before pre-match odds candidates.
5. Cap result calls at 60 per UTC day and stop when the global `calls` reaches 90.
6. Record `state.resultAttempts[matchId] = { attemptedUtcDay, status }` after each request.
7. Preserve the existing `apiFootballCornerTotal()` parsing and durable result archive merge.
8. Re-run self-test; expect PASS.

---

### Task 6: Verify live behavior without spending unnecessary quota

**Files:**
- Update: `docs/prediction-log.md`

**Steps:**

1. Run offline checks:

```bash
node scripts/hkjc-import.mjs --self-test
npm test
npm run build
```

Expected: all pass.

2. While today is already quota-exhausted, run one normal import. Expected:
   - HKJC import exits 0;
   - API-Football makes no further calls after state marks the day exhausted;
   - `public/hkjc-odds.json` is still written.
3. After the next API-Football UTC reset, run one import and inspect `data/api-football-state.json`. Expected:
   - `calls <= 90`;
   - oldest missing corner-result matches are attempted first;
   - repeated import within 15 minutes does not increase calls for the same work.
4. Read `/api/backtest` and verify newly available corner results join existing snapshots.
5. Record call count, settled corner-match count, and verification commands in `docs/prediction-log.md`.

## Expected daily usage after implementation

- Existing backlog day: approximately 21 statistics calls plus a small number of date/fixture lookups, safely below 90.
- Normal day: one cached fixture-date lookup per active date, one odds call per eligible new fixture, and one statistics call per completed snapshotted fixture.
- No API calls merely because the 15-minute importer ran again.

## Deliberate exclusions

- No new database, queue, dependency, service, or cron job.
- No attempt to spend all 100 calls; 10 remain reserved.
- No polling of unsnapshotted completed matches.
- Do not increase the API-Football plan until the 90-call policy still proves insufficient from recorded daily counts.
