# Personal Odds System Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore trustworthy collection, diagnostics, UI feedback, automated tests, and production operation for the single-owner football recommendation system.

**Architecture:** Keep provider collection and recommendation rules unchanged, but make HDC's reserve configurable and persist explicit provider health in the existing `collector_state` table. Add one read-only repository and authenticated API endpoint that projects collector/database state into a typed frontend status banner; repair the two broken feedback loops independently before integrating the status path.

**Tech Stack:** Node.js 24 ESM, React 19, TypeScript 5.7, PostgreSQL, Vitest, Node test runner, Playwright, Docker Compose, Caddy.

## Global Constraints

- This is a personal, single-owner system; do not add multi-tenant roles or commercial security controls.
- Keep model weights, the 3% value threshold, freshness windows, settlement rules, and the minimum-two-complete-bookmakers rule unchanged.
- `HDC_MIN_QUOTA` is a non-negative integer, defaults to `50` in code, and is explicitly `5` in production Compose.
- Provider cooldown behavior and the existing 25-minute/5-minute collection cadence remain unchanged.
- Persist only stable API-Football error codes; never persist provider error text or secret values.
- Do not add a database migration; use existing `collector_state`, `live_odds`, `prediction_snapshots`, `recommendation_observations`, and `fixtures` columns.
- Use `npm.cmd` rather than `npm` in PowerShell.
- Never stage or deploy unrelated working-tree changes, especially `public/team-logos.json`, diagnostic scripts, data files, or Playwright output.
- Production changes are limited to the `odds-tool` stack under `/opt/odds-tool`; do not touch `astra`, `store-network-dashboard`, or `odds-tool-test`, and never run `docker compose down -v`.

---

### Task 1: Restore the Playwright API contract

**Files:**
- Modify: `tests/ui/helpers.ts`
- Modify: `tests/ui/today.spec.ts`

**Interfaces:**
- Consumes: the existing strict `mockApi(page, scenario)` route and API response `{ resultEntries: unknown[] }`.
- Produces: a deterministic `GET /api/v1/results` mock while preserving failure on every unknown application request.

- [ ] **Step 1: Strengthen the authenticated-startup regression**

Add this assertion to the first test in `tests/ui/today.spec.ts`, after the page and cards are visible:

```ts
expect(requestedPaths).toContain("GET /api/v1/results");
```

- [ ] **Step 2: Run the focused test and confirm the current contract failure**

Run:

```powershell
npm.cmd run build
npm.cmd exec playwright test tests/ui/today.spec.ts -- --project=desktop --grep "today page shows server-recorded" --reporter=line
```

Expected: FAIL at `tests/ui/helpers.ts` with `Unmocked app data request: GET .../api/v1/results`.

- [ ] **Step 3: Add the deterministic results response before the recommendations branch**

Insert in `tests/ui/helpers.ts`:

```ts
if (pathname === "/api/v1/results" && method === "GET") {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      resultEntries: [{
        matchId: "match-finished",
        homeTeam: "Finished United",
        awayTeam: "Settled City",
        commenceTime: PAST_KICKOFF,
        score: "2-1",
        market: "h2h",
        actual: "home",
      }],
    }),
  });
  return;
}
```

Do not weaken or remove the final `throw new Error("Unmocked app data request...")` guard.

- [ ] **Step 4: Re-run the focused test**

Run the command from Step 2.

Expected: `1 passed`; `requestedPaths` contains both recommendations and results requests.

- [ ] **Step 5: Commit only the two test files**

```powershell
git add -- tests/ui/helpers.ts tests/ui/today.spec.ts
git commit -m "test(ui): mock results catalog"
```

---

### Task 2: Correct database integrity semantics

**Files:**
- Modify: `scripts/check-data-integrity.mjs`
- Modify: `scripts/check-data-integrity.test.mjs`

**Interfaces:**
- Consumes: `analyzeRows({ snapshots, results, observations })` with ISO-string timestamps.
- Produces: `personal-bet-v1` late-snapshot exemption and `isoTimestamp(value): string | null` normalization at the PostgreSQL boundary.

- [ ] **Step 1: Add the four semantic regression cases**

Add these tests to `scripts/check-data-integrity.test.mjs`:

```js
test("post-kick personal bets are history, not late recommendations", () => {
  const metrics = analyzeRows({
    snapshots: [validSnapshot({
      savedAt: "2026-07-18T12:30:00.000Z",
      strategyVersion: "personal-bet-v1",
    })],
    results: [],
  });
  assert.equal(metrics.lateSnapshots, 0);
  assert.deepEqual(metrics.failures, []);
});

test("post-kick unified recommendations still fail", () => {
  const metrics = analyzeRows({
    snapshots: [validUnifiedSnapshot({ firstQualifiedAt: "2026-07-18T12:00:00.001Z" })],
    results: [],
  });
  assert.equal(metrics.lateSnapshots, 1);
  assert.match(metrics.failures.join(","), /post-kick/);
});

test("same-second input before a millisecond evaluation is valid", () => {
  const metrics = analyzeRows({
    snapshots: [validSnapshot({ sampleId: 42 })],
    results: [],
    observations: [{
      snapshotId: 42,
      fingerprint: "millisecond-safe",
      firstEvaluatedAt: "2026-07-18T11:00:00.900Z",
      lastEvaluatedAt: "2026-07-18T11:00:00.900Z",
      inputs: [{ observedAt: "2026-07-18T11:00:00.100Z" }],
    }],
  });
  assert.equal(metrics.futureObservationInputs, 0);
});

test("an input genuinely after evaluation still fails", () => {
  const metrics = analyzeRows({
    snapshots: [validSnapshot({ sampleId: 42 })],
    results: [],
    observations: [{
      snapshotId: 42,
      fingerprint: "real-future-input",
      firstEvaluatedAt: "2026-07-18T11:00:00.100Z",
      lastEvaluatedAt: "2026-07-18T11:00:00.100Z",
      inputs: [{ observedAt: "2026-07-18T11:00:00.101Z" }],
    }],
  });
  assert.equal(metrics.futureObservationInputs, 1);
  assert.match(metrics.failures.join(","), /future observation inputs/);
});
```

- [ ] **Step 2: Run the integrity tests and verify the red cases**

Run:

```powershell
node --test scripts/check-data-integrity.test.mjs
```

Expected: the personal-bet test fails because it is counted as late; the existing database-mode scenario remains capable of exposing timestamp normalization errors when the test database is available.

- [ ] **Step 3: Exempt only personal-bet history and normalize database dates**

Change `isLateSnapshot` and add a boundary helper in `scripts/check-data-integrity.mjs`:

```js
function isLateSnapshot(item) {
  if (item?.strategyVersion === "personal-bet-v1") return false;
  const saved = Date.parse(item.firstQualifiedAt ?? item.savedAt);
  const commence = Date.parse(item.commenceTime);
  return Number.isFinite(saved) && Number.isFinite(commence) && saved >= commence;
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
```

Map both observation timestamps through the helper in database mode:

```js
firstEvaluatedAt: isoTimestamp(row.first_evaluated_at),
lastEvaluatedAt: isoTimestamp(row.last_evaluated_at),
```

Keep the current unified and legacy timestamp projection logic; the exemption must match exactly `personal-bet-v1` and no other strategy.

- [ ] **Step 4: Run pure and database-backed integrity tests**

Run:

```powershell
node --test scripts/check-data-integrity.test.mjs
```

Expected: all cases pass; if `DATABASE_URL` is absent the database-backed case reports its established skip, not a failure.

- [ ] **Step 5: Commit the integrity correction**

```powershell
git add -- scripts/check-data-integrity.mjs scripts/check-data-integrity.test.mjs
git commit -m "fix(data): align integrity checks with sample semantics"
```

---

### Task 3: Make the HDC reserve configurable and observable

**Files:**
- Modify: `scripts/hdc-collector.mjs`
- Modify: `scripts/hdc-collector-pg.test.mjs`
- Modify: `deploy/compose.yaml`
- Modify: `scripts/collector-entrypoint.test.mjs`

**Interfaces:**
- Consumes: environment variable `HDC_MIN_QUOTA` and collector state fields `quotaRemaining`, `quotaBlockedUntil`.
- Produces: `loadHdcConfig(env): { minimumQuota: number }`, `paidCollectionStatus(state, now, minimumQuota): { allowed: boolean, reason: "quota-reserve" | "provider-cooldown" | null }`, and persisted `quotaMinimum`, `paidCollectionBlocked`, `paidCollectionBlockedReason`.

- [ ] **Step 1: Add focused configuration and status tests**

Extend the import in `scripts/hdc-collector-pg.test.mjs` and add:

```js
import {
  createPostgresStore,
  dueScoreSports,
  flattenSportEntries,
  loadHdcConfig,
  paidCollectionStatus,
  scoreRows,
} from "./hdc-collector.mjs";

test("HDC quota reserve defaults to 50 and accepts a non-negative override", () => {
  assert.deepEqual(loadHdcConfig({}), { minimumQuota: 50 });
  assert.deepEqual(loadHdcConfig({ HDC_MIN_QUOTA: "5" }), { minimumQuota: 5 });
  assert.deepEqual(loadHdcConfig({ HDC_MIN_QUOTA: "0" }), { minimumQuota: 0 });
  for (const value of ["-1", "5.5", "five", ""]) {
    assert.throws(() => loadHdcConfig({ HDC_MIN_QUOTA: value }), /HDC_MIN_QUOTA/);
  }
});

test("HDC status distinguishes reserve blocking from provider cooldown", () => {
  const now = Date.parse("2026-08-09T10:00:00.000Z");
  assert.deepEqual(paidCollectionStatus({ quotaRemaining: 49 }, now, 50), {
    allowed: false,
    reason: "quota-reserve",
  });
  assert.deepEqual(paidCollectionStatus({ quotaRemaining: 49 }, now, 5), {
    allowed: true,
    reason: null,
  });
  assert.deepEqual(paidCollectionStatus({ quotaRemaining: 49, quotaBlockedUntil: new Date(now + 60_000).toISOString() }, now, 5), {
    allowed: false,
    reason: "provider-cooldown",
  });
});
```

Add a source assertion to `scripts/collector-entrypoint.test.mjs` proving Compose supplies the value:

```js
assert.match(compose, /HDC_MIN_QUOTA:\s*["']?5["']?/);
```

- [ ] **Step 2: Run the HDC tests and verify missing exports/configuration**

Run:

```powershell
node --test scripts/hdc-collector-pg.test.mjs scripts/collector-entrypoint.test.mjs
```

Expected: FAIL because `loadHdcConfig` and `paidCollectionStatus` are not exported and Compose has no override.

- [ ] **Step 3: Implement strict reserve parsing and reason classification**

Replace the fixed-only decision with:

```js
const DEFAULT_MIN_QUOTA = 50;

export function loadHdcConfig(env = process.env) {
  if (!("HDC_MIN_QUOTA" in env)) return { minimumQuota: DEFAULT_MIN_QUOTA };
  const raw = String(env.HDC_MIN_QUOTA ?? "");
  if (!/^\d+$/.test(raw)) throw new TypeError("HDC_MIN_QUOTA must be a non-negative integer");
  return { minimumQuota: Number(raw) };
}

export function paidCollectionStatus(state, now = Date.now(), minimumQuota = DEFAULT_MIN_QUOTA) {
  if (state.quotaRemaining != null && Number(state.quotaRemaining) <= minimumQuota) {
    return { allowed: false, reason: "quota-reserve" };
  }
  if (state.quotaBlockedUntil && now < Date.parse(state.quotaBlockedUntil)) {
    return { allowed: false, reason: "provider-cooldown" };
  }
  return { allowed: true, reason: null };
}

function applyPaidCollectionStatus(state, now, minimumQuota) {
  const status = paidCollectionStatus(state, now, minimumQuota);
  state.quotaMinimum = minimumQuota;
  state.paidCollectionBlocked = !status.allowed;
  state.paidCollectionBlockedReason = status.reason;
  return status.allowed;
}
```

Change the three declarations to these exact signatures:

```js
async function collectOdds(sports, key, state, store, now, minimumQuota)
async function collectScores(sports, key, state, store, now, minimumQuota)
async function main({ dryRun = false, store, env = process.env } = {})
```

As the first statement of `main`, add `const { minimumQuota } = loadHdcConfig(env);`. Inside the function bodies, replace every `paidAllowed(state, now)` call with `applyPaidCollectionStatus(state, now, minimumQuota)`. Call `applyPaidCollectionStatus` once immediately after loading state and again immediately before the final `store.saveState(state)` so quota headers from the current cycle are reflected. Pass `minimumQuota` in the existing `collectOdds(...)` and `collectScores(...)` calls. Keep all other statements in their current order.

The HTTP 429 branch saves state before control returns to `main`, so update it before that early save:

```js
if (response.status === 429) {
  state.quotaBlockedUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
  applyPaidCollectionStatus(state, Date.now(), state.quotaMinimum ?? DEFAULT_MIN_QUOTA);
  await store.saveState(state);
}
```

This guarantees even the early cooldown save carries the three descriptive status fields.

Replace the three old self-test assertions that reference `paidAllowed`/`MIN_QUOTA` with:

```js
assert(!paidCollectionStatus({ quotaRemaining: 50 }, now, 50).allowed, "keeps fifty credits in reserve by default");
assert(paidCollectionStatus({ quotaRemaining: 49 }, now, 5).allowed, "production override can use remaining credits above five");
assert(!paidCollectionStatus({ quotaRemaining: 257, quotaBlockedUntil: new Date(now + 60_000).toISOString() }, now, 5).allowed, "honors provider cooldown");
```

- [ ] **Step 4: Configure only the production collector reserve**

Add under `collector:` in `deploy/compose.yaml`:

```yaml
    environment:
      HDC_MIN_QUOTA: "5"
```

Update the nearby comment from `50-credit reserve` to `configurable credit reserve`. Do not change provider cadence, windows, or secrets.

- [ ] **Step 5: Run HDC tests, self-test, and Compose validation**

Run:

```powershell
node --test scripts/hdc-collector-pg.test.mjs scripts/collector-entrypoint.test.mjs
node scripts/hdc-collector.mjs --self-test
docker compose -f deploy/compose.yaml config --quiet
```

Expected: all tests and the self-test pass; Compose exits `0` and renders `HDC_MIN_QUOTA: "5"` for `collector`.

- [ ] **Step 6: Commit the HDC recovery change**

```powershell
git add -- scripts/hdc-collector.mjs scripts/hdc-collector-pg.test.mjs scripts/collector-entrypoint.test.mjs deploy/compose.yaml
git commit -m "fix(collector): make HDC quota reserve configurable"
```

---

### Task 4: Classify and persist API-Football provider state

**Files:**
- Modify: `scripts/hkjc-import.mjs`
- Create: `scripts/hkjc-import-errors.test.mjs`

**Interfaces:**
- Consumes: API-Football HTTP status plus normalized payload error strings.
- Produces: `classifyApiFootballError(errors, httpStatus): "API_FOOTBALL_AUTH" | "API_FOOTBALL_QUOTA" | "API_FOOTBALL_PROVIDER" | null`, `recordApiFootballOutcome(state, code, recordedAt)`, and state fields `apiFootballLastSuccessAt`, `apiFootballLastErrorAt`, `apiFootballLastErrorCode`.

- [ ] **Step 1: Create provider-classification tests**

Create `scripts/hkjc-import-errors.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { classifyApiFootballError, recordApiFootballOutcome } from "./hkjc-import.mjs";

test("API-Football payload errors map to stable operational codes", () => {
  assert.equal(classifyApiFootballError(["Missing application key"], 200), "API_FOOTBALL_AUTH");
  assert.equal(classifyApiFootballError(["Invalid application key"], 200), "API_FOOTBALL_AUTH");
  assert.equal(classifyApiFootballError(["You have reached the request limit"], 200), "API_FOOTBALL_QUOTA");
  assert.equal(classifyApiFootballError(["Temporary provider failure"], 200), "API_FOOTBALL_PROVIDER");
  assert.equal(classifyApiFootballError([], 503), "API_FOOTBALL_PROVIDER");
  assert.equal(classifyApiFootballError([], 200), null);
});

test("API-Football state stores timestamps and stable codes only", () => {
  const state = {};
  recordApiFootballOutcome(state, "API_FOOTBALL_AUTH", "2026-08-09T10:00:00.000Z");
  assert.deepEqual(state, {
    apiFootballLastErrorAt: "2026-08-09T10:00:00.000Z",
    apiFootballLastErrorCode: "API_FOOTBALL_AUTH",
  });

  recordApiFootballOutcome(state, null, "2026-08-09T10:05:00.000Z");
  assert.deepEqual(state, {
    apiFootballLastErrorAt: "2026-08-09T10:00:00.000Z",
    apiFootballLastErrorCode: null,
    apiFootballLastSuccessAt: "2026-08-09T10:05:00.000Z",
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing export**

Run:

```powershell
node --test scripts/hkjc-import-errors.test.mjs
```

Expected: FAIL because `classifyApiFootballError` is not exported.

- [ ] **Step 3: Implement classification without persisting provider text**

Add to `scripts/hkjc-import.mjs`:

```js
export function classifyApiFootballError(errors, httpStatus) {
  const messages = (Array.isArray(errors) ? errors : []).map(String);
  if (messages.some((message) => /(?:missing|invalid).*(?:application|api)[ -]?key|(?:application|api)[ -]?key.*(?:missing|invalid)/i.test(message))) {
    return "API_FOOTBALL_AUTH";
  }
  if (messages.some((message) => /request limit|quota|too many requests/i.test(message)) || httpStatus === 429) {
    return "API_FOOTBALL_QUOTA";
  }
  if (httpStatus < 200 || httpStatus >= 300 || messages.length > 0) return "API_FOOTBALL_PROVIDER";
  return null;
}

export function recordApiFootballOutcome(state, code, recordedAt) {
  if (code) {
    state.apiFootballLastErrorAt = recordedAt;
    state.apiFootballLastErrorCode = code;
    return;
  }
  state.apiFootballLastSuccessAt = recordedAt;
  state.apiFootballLastErrorCode = null;
}
```

Change `fetchApiFootball` after parsing the response:

```js
const code = classifyApiFootballError(errors, response.status);
const recordedAt = new Date().toISOString();
if (code) {
  state.quotaExhausted = code === "API_FOOTBALL_QUOTA";
  recordApiFootballOutcome(state, code, recordedAt);
  throw new Error(code);
}
recordApiFootballOutcome(state, null, recordedAt);
return payload;
```

Retain the current catch boundaries in corner odds/results so HKJC import continues. Their warning output will now contain only a stable code.

- [ ] **Step 4: Verify classification, importer self-test, and PostgreSQL isolation**

Run:

```powershell
node --test scripts/hkjc-import-errors.test.mjs scripts/hkjc-import-pg.test.mjs
node scripts/hkjc-import.mjs --self-test
```

Expected: all pass; the source contains no assignment of raw provider messages into collector state.

- [ ] **Step 5: Commit API-Football diagnostics**

```powershell
git add -- scripts/hkjc-import.mjs scripts/hkjc-import-errors.test.mjs
git commit -m "fix(import): expose API-Football failure state"
```

---

### Task 5: Add the authenticated system-status projection

**Files:**
- Create: `server/db/system-status-repository.mjs`
- Create: `server/db/system-status-repository.test.mjs`
- Modify: `server/entry.mjs`
- Modify: `server/app.mjs`
- Modify: `server/app.test.mjs`

**Interfaces:**
- Consumes: `collector_state` keys `hdc-collector` and `hkjc-import`, live-odds providers `hkjc` and `the-odds-api:%`, and unified snapshot/observation timestamps.
- Produces: `createSystemStatusRepository(pool).get(now)` and authenticated `GET /api/v1/system/status`.

The exact JSON contract is:

```js
{
  providers: {
    hkjc: { lastObservedAt: "ISO timestamp" | null },
    hdc: {
      lastObservedAt: "ISO timestamp" | null,
      quotaRemaining: number | null,
      quotaMinimum: number,
      paidCollectionBlocked: boolean,
      paidCollectionBlockedReason: "quota-reserve" | "provider-cooldown" | null,
    },
    apiFootball: {
      lastSuccessAt: "ISO timestamp" | null,
      lastErrorAt: "ISO timestamp" | null,
      lastErrorCode: "API_FOOTBALL_AUTH" | "API_FOOTBALL_QUOTA" | "API_FOOTBALL_PROVIDER" | null,
    },
  },
  recommendations: {
    lastObservedAt: "ISO timestamp" | null,
    futureHdcOdds: number,
    futureUnifiedSnapshots: number,
  },
}
```

- [ ] **Step 1: Write repository integration tests**

Create `server/db/system-status-repository.test.mjs` with this complete test body:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { withDatabase } from "../../scripts/lib/test-db.mjs";
import { createSystemStatusRepository } from "./system-status-repository.mjs";

const NOW = new Date("2026-08-09T10:00:00.000Z");

test("system status projects provider, quota, recommendation, and future-row state", async (t) => {
  await withDatabase(t, async (pool) => {
    await pool.query(`
      INSERT INTO live_odds (
        identity_key, provider, commence_time, observed_at, expires_at, raw
      ) VALUES
        ('hkjc-status', 'hkjc', $1, '2026-08-09T09:57:00.000Z', $2, '{}'),
        ('hdc-status', 'the-odds-api:soccer_epl', $1, '2026-08-09T09:59:00.000Z', $2, '{}')
    `, ["2026-08-09T12:00:00.000Z", "2026-08-09T15:00:00.000Z"]);
    await pool.query(`
      INSERT INTO collector_state (state_key, state, updated_at)
      VALUES
        ('hdc-collector', $1, $3),
        ('hkjc-import', $2, $3)
    `, [
      { quotaRemaining: 49, quotaMinimum: 5, paidCollectionBlocked: false, paidCollectionBlockedReason: null },
      { apiFootballLastSuccessAt: "2026-08-09T09:58:00.000Z", apiFootballLastErrorAt: null, apiFootballLastErrorCode: null },
      NOW.toISOString(),
    ]);
    const fixtureId = "00000000-0000-4000-8000-000000000099";
    await pool.query(`
      INSERT INTO fixtures (
        id, home_team, away_team, normalized_home_team, normalized_away_team, commence_time
      ) VALUES ($1, 'Home', 'Away', 'home', 'away', '2026-08-09T12:00:00.000Z')
    `, [fixtureId]);
    const snapshot = await pool.query(`
      INSERT INTO prediction_snapshots (
        identity_key, fixture_id, strategy_version, snapshot_status, raw
      ) VALUES ('system-status-snapshot', $1, 'unified-buyable-v1', 'valid-current', '{}')
      RETURNING id
    `, [fixtureId]);
    await pool.query(`
      INSERT INTO recommendation_observations (
        snapshot_id, fingerprint, first_evaluated_at, last_evaluated_at, inputs, buyable_quotes
      ) VALUES ($1, 'system-status-observation', $2, $2, '[]', '[]')
    `, [snapshot.rows[0].id, "2026-08-09T09:59:30.000Z"]);

    assert.deepEqual(await createSystemStatusRepository(pool).get(NOW), {
      providers: {
        hkjc: { lastObservedAt: "2026-08-09T09:57:00.000Z" },
        hdc: {
          lastObservedAt: "2026-08-09T09:59:00.000Z",
          quotaRemaining: 49,
          quotaMinimum: 5,
          paidCollectionBlocked: false,
          paidCollectionBlockedReason: null,
        },
        apiFootball: {
          lastSuccessAt: "2026-08-09T09:58:00.000Z",
          lastErrorAt: null,
          lastErrorCode: null,
        },
      },
      recommendations: {
        lastObservedAt: "2026-08-09T09:59:30.000Z",
        futureHdcOdds: 1,
        futureUnifiedSnapshots: 1,
      },
    });
  });
});

test("system status has truthful defaults on an empty migrated database", async (t) => {
  await withDatabase(t, async (pool) => {
    assert.deepEqual(await createSystemStatusRepository(pool).get(NOW), {
      providers: {
        hkjc: { lastObservedAt: null },
        hdc: {
          lastObservedAt: null,
          quotaRemaining: null,
          quotaMinimum: 50,
          paidCollectionBlocked: false,
          paidCollectionBlockedReason: null,
        },
        apiFootball: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
      },
      recommendations: { lastObservedAt: null, futureHdcOdds: 0, futureUnifiedSnapshots: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the repository test and verify the missing module**

Run:

```powershell
node --test server/db/system-status-repository.test.mjs
```

Expected: FAIL because `system-status-repository.mjs` does not exist.

- [ ] **Step 3: Implement one read-only repository**

Create `server/db/system-status-repository.mjs` with `Promise.all` over three parameterized read-only queries:

```js
export function createSystemStatusRepository(pool) {
  return {
    async get(now) {
      const at = new Date(now);
      const [live, states, recommendations] = await Promise.all([
        pool.query(`
          SELECT
            MAX(observed_at) FILTER (WHERE provider = 'hkjc') AS hkjc_last_observed_at,
            MAX(observed_at) FILTER (WHERE provider LIKE 'the-odds-api:%') AS hdc_last_observed_at,
            COUNT(*) FILTER (
              WHERE provider LIKE 'the-odds-api:%'
                AND commence_time > $1 AND expires_at > $1
            )::integer AS future_hdc_odds
          FROM live_odds
        `, [at]),
        pool.query(`
          SELECT state_key, state
          FROM collector_state
          WHERE state_key IN ('hdc-collector', 'hkjc-import')
        `),
        pool.query(`
          SELECT
            MAX(observation.last_evaluated_at) AS last_observed_at,
            COUNT(DISTINCT snapshot.id) FILTER (
              WHERE COALESCE(fixture.commence_time, snapshot.commence_time) > $1
            )::integer AS future_unified_snapshots
          FROM prediction_snapshots AS snapshot
          LEFT JOIN fixtures AS fixture ON fixture.id = snapshot.fixture_id
          LEFT JOIN recommendation_observations AS observation ON observation.snapshot_id = snapshot.id
          WHERE snapshot.strategy_version = 'unified-buyable-v1'
        `, [at]),
      ]);

      const liveRow = live.rows[0];
      const recommendationRow = recommendations.rows[0];
      const stateByKey = new Map(states.rows.map((row) => [row.state_key, row.state]));
      const hdc = stateByKey.get("hdc-collector") ?? {};
      const apiFootball = stateByKey.get("hkjc-import") ?? {};
      const iso = (value) => value instanceof Date ? value.toISOString() : value ?? null;

      return {
        providers: {
          hkjc: { lastObservedAt: iso(liveRow.hkjc_last_observed_at) },
          hdc: {
            lastObservedAt: iso(liveRow.hdc_last_observed_at),
            quotaRemaining: hdc.quotaRemaining == null || !Number.isFinite(Number(hdc.quotaRemaining))
              ? null
              : Number(hdc.quotaRemaining),
            quotaMinimum: Number.isInteger(hdc.quotaMinimum) ? hdc.quotaMinimum : 50,
            paidCollectionBlocked: Boolean(hdc.paidCollectionBlocked),
            paidCollectionBlockedReason: hdc.paidCollectionBlockedReason ?? null,
          },
          apiFootball: {
            lastSuccessAt: apiFootball.apiFootballLastSuccessAt ?? null,
            lastErrorAt: apiFootball.apiFootballLastErrorAt ?? null,
            lastErrorCode: apiFootball.apiFootballLastErrorCode ?? null,
          },
        },
        recommendations: {
          lastObservedAt: iso(recommendationRow.last_observed_at),
          futureHdcOdds: liveRow.future_hdc_odds,
          futureUnifiedSnapshots: recommendationRow.future_unified_snapshots,
        },
      };
    },
  };
}
```

- [ ] **Step 4: Add the protected HTTP contract test**

In `server/app.test.mjs`, first restore the fake repository contract by adding `bets: {}` to `createFakeRepositories`; without it the current three server tests all stop at `repositories.bets is required`. Then add `systemStatus.get`, returning this fixture:

```js
bets: {},
systemStatus: {
  async get(now) {
    assert.equal(now.toISOString(), NOW.toISOString());
    return {
      providers: {
        hkjc: { lastObservedAt: "2026-07-17T23:58:00.000Z" },
        hdc: {
          lastObservedAt: "2026-07-17T23:59:00.000Z",
          quotaRemaining: 49,
          quotaMinimum: 5,
          paidCollectionBlocked: false,
          paidCollectionBlockedReason: null,
        },
        apiFootball: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
      },
      recommendations: {
        lastObservedAt: "2026-07-17T23:59:00.000Z",
        futureHdcOdds: 1,
        futureUnifiedSnapshots: 1,
      },
    };
  },
},
```

Add `/api/v1/system/status` to the unauthenticated protected-route loop. After login, request it and assert status `200` plus `quotaMinimum === 5` and `futureHdcOdds === 1`.

- [ ] **Step 5: Wire the repository and route**

In `server/entry.mjs`, import/create `createSystemStatusRepository(pool)`. In `server/app.mjs`:

```js
if (!repositories?.systemStatus) throw new TypeError("repositories.systemStatus is required");
```

Add the route after live odds:

```js
if (route === "GET /api/v1/system/status") return json(res, 200, await repositories.systemStatus.get(new Date(clock())));
```

Add `GET` to `ROUTES`. Do not expose it before `requireSession` and do not add provider network calls to the server.

- [ ] **Step 6: Run repository and server tests**

Run:

```powershell
node --test server/db/system-status-repository.test.mjs server/app.test.mjs
node server/entry.mjs --self-test
```

Expected: all pass; unauthenticated status returns `401`; server self-test performs no provider request.

- [ ] **Step 7: Commit the backend status slice**

```powershell
git add -- server/db/system-status-repository.mjs server/db/system-status-repository.test.mjs server/entry.mjs server/app.mjs server/app.test.mjs
git commit -m "feat(status): expose collector health"
```

---

### Task 6: Show degraded provider state on Today

**Files:**
- Modify: `src/apiClient.ts`
- Modify: `src/apiClient.test.ts`
- Modify: `src/currentRecommendations.ts`
- Create: `src/components/SystemStatusBanner.tsx`
- Create: `src/components/SystemStatusBanner.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/TodayPage.tsx`
- Modify: `src/styles/today.css`
- Modify: `tests/ui/helpers.ts`
- Modify: `tests/ui/today.spec.ts`

**Interfaces:**
- Consumes: Task 5 `SystemStatusResponse`; Task 1 strict UI route mock.
- Produces: `apiClient.systemStatus()`, generic `startCurrentRecommendationsRefresh<T>`, and `<SystemStatusBanner status now />`.

- [ ] **Step 1: Add API-client path/type coverage**

Define these exported TypeScript types in `src/apiClient.ts`:

```ts
export type SystemStatusResponse = {
  providers: {
    hkjc: { lastObservedAt: string | null };
    hdc: {
      lastObservedAt: string | null;
      quotaRemaining: number | null;
      quotaMinimum: number;
      paidCollectionBlocked: boolean;
      paidCollectionBlockedReason: "quota-reserve" | "provider-cooldown" | null;
    };
    apiFootball: {
      lastSuccessAt: string | null;
      lastErrorAt: string | null;
      lastErrorCode: "API_FOOTBALL_AUTH" | "API_FOOTBALL_QUOTA" | "API_FOOTBALL_PROVIDER" | null;
    };
  };
  recommendations: {
    lastObservedAt: string | null;
    futureHdcOdds: number;
    futureUnifiedSnapshots: number;
  };
};
```

Add `systemStatus: () => request<SystemStatusResponse>(fetchImpl, "/api/v1/system/status")`. Update both path expectations in `src/apiClient.test.ts` so the read-only call is exercised and has no CSRF header.

- [ ] **Step 2: Add banner rendering tests**

Create `src/components/SystemStatusBanner.test.tsx` using `renderToStaticMarkup`. Cover:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SystemStatusResponse } from "../apiClient";
import { SystemStatusBanner } from "./SystemStatusBanner";

const NOW = Date.parse("2026-08-09T10:00:00.000Z");

function status(
  hdc: Partial<SystemStatusResponse["providers"]["hdc"]> = {},
  recommendations: Partial<SystemStatusResponse["recommendations"]> = {},
): SystemStatusResponse {
  return {
    providers: {
      hkjc: { lastObservedAt: "2026-08-09T09:00:00.000Z" },
      hdc: {
        lastObservedAt: "2026-08-09T09:00:00.000Z",
        quotaRemaining: 49,
        quotaMinimum: 5,
        paidCollectionBlocked: false,
        paidCollectionBlockedReason: null,
        ...hdc,
      },
      apiFootball: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
    },
    recommendations: {
      lastObservedAt: "2026-08-09T09:00:00.000Z",
      futureHdcOdds: 1,
      futureUnifiedSnapshots: 1,
      ...recommendations,
    },
  };
}

describe("SystemStatusBanner", () => {
it("prioritizes quota blocking and displays the configured reserve", () => {
  const markup = renderToStaticMarkup(<SystemStatusBanner status={status({
    paidCollectionBlocked: true,
    paidCollectionBlockedReason: "quota-reserve",
    quotaMinimum: 5,
  })} now={NOW} />);
  expect(markup).toContain("system-status-banner");
  expect(markup).toContain("5");
  expect(markup).toContain('role="status"');
});

it("warns when there are no future HDC rows", () => {
  const markup = renderToStaticMarkup(<SystemStatusBanner status={status({}, { futureHdcOdds: 0 })} now={NOW} />);
  expect(markup).toContain("system-status-banner");
});

it("warns when the latest HDC row is older than three hours", () => {
  const markup = renderToStaticMarkup(<SystemStatusBanner status={status({
    lastObservedAt: "2026-08-09T06:59:59.999Z",
  })} now={NOW} />);
  expect(markup).toContain("system-status-banner");
});

it("renders nothing for healthy current HDC state", () => {
  const markup = renderToStaticMarkup(<SystemStatusBanner status={status()} now={NOW} />);
  expect(markup).toBe("");
});
});
```

- [ ] **Step 3: Run frontend unit tests and confirm missing status support**

Run:

```powershell
npm.cmd test -- src/apiClient.test.ts src/components/SystemStatusBanner.test.tsx
```

Expected: FAIL because the client method and component do not exist.

- [ ] **Step 4: Implement the focused status banner**

Create `src/components/SystemStatusBanner.tsx` with this implementation:

```tsx
import type { SystemStatusResponse } from "../apiClient";

const HDC_STATUS_STALE_MS = 3 * 60 * 60_000;

export function SystemStatusBanner({
  status,
  now = Date.now(),
}: {
  status: SystemStatusResponse | null;
  now?: number;
}): React.ReactElement | null {
  if (!status) return null;
  const hdc = status.providers.hdc;
  let message: string | null = null;

  if (hdc.paidCollectionBlockedReason === "quota-reserve") {
    message = `外圍賠率收集已暫停：需保留最後 ${hdc.quotaMinimum} 次額度。`;
  } else if (hdc.paidCollectionBlockedReason === "provider-cooldown") {
    message = "外圍賠率供應商正在冷卻，系統稍後會自動重試。";
  } else if (status.recommendations.futureHdcOdds === 0) {
    message = "暫時未有未開賽外圍盤口，現有投注建議不受影響。";
  } else {
    const lastObserved = Date.parse(hdc.lastObservedAt ?? "");
    if (!Number.isFinite(lastObserved) || now - lastObserved > HDC_STATUS_STALE_MS) {
      message = hdc.lastObservedAt
        ? `外圍賠率最後更新：${new Date(hdc.lastObservedAt).toLocaleString("zh-HK")}。`
        : "尚未收到外圍賠率更新。";
    } else if (status.providers.apiFootball.lastErrorCode === "API_FOOTBALL_AUTH") {
      message = "後備角球數據供應商認證失敗；馬會角球資料仍會照常匯入。";
    }
  }

  return message
    ? <p className="system-status-banner" role="status">{message}</p>
    : null;
}
```

- [ ] **Step 5: Generalize the existing poller without changing its timing**

Change `src/currentRecommendations.ts` to:

```ts
type CurrentRecommendationsRefreshOptions<T> = {
  load: () => Promise<T>;
  onSuccess: (response: T) => void;
  onError: (error: unknown) => void;
};

export function startCurrentRecommendationsRefresh<T>({
  load,
  onSuccess,
  onError,
}: CurrentRecommendationsRefreshOptions<T>): () => void {
```

Leave the immediate load, three-minute interval, in-flight guard, cleanup, and tests unchanged.

- [ ] **Step 6: Load status beside recommendations without hiding valid picks on status-only failure**

In `src/App.tsx`, add `systemStatus` state and clear it in `clearAuthenticatedState`. Change the recommendation effect's `load` to:

```ts
load: async () => {
  const [recommendations, systemStatus] = await Promise.all([
    apiClient.currentRecommendations(),
    apiClient.systemStatus().catch(() => null),
  ]);
  return { recommendations, systemStatus };
},
```

In `onSuccess`, validate/use `response.recommendations` exactly as before and independently call `setSystemStatus(response.systemStatus)`. Pass `systemStatus` into `LandingPage`; in `TodayPage.tsx`, add the prop and render `<SystemStatusBanner>` immediately after `<FreshnessBar>`. This keeps valid recorded opportunities visible if only the status endpoint fails.

- [ ] **Step 7: Extend the strict UI mock and degraded-status scenario**

In `tests/ui/helpers.ts`, import `SystemStatusResponse`, add scenario `"hdc-blocked"`, and mock `GET /api/v1/system/status` with a healthy default contract. For `hdc-blocked`, return HDC state `quotaRemaining: 49`, `quotaMinimum: 50`, `paidCollectionBlocked: true`, `paidCollectionBlockedReason: "quota-reserve"`.

Add to `tests/ui/today.spec.ts`:

```ts
test("today page explains when HDC collection is quota-blocked", async ({ page }) => {
  await mockApi(page, "hdc-blocked");
  await page.goto("/#/today");
  await expect(page.locator(".system-status-banner")).toBeVisible();
  await expect(page.locator(".system-status-banner")).toContainText("50");
});
```

- [ ] **Step 8: Style and verify the complete frontend slice**

Add a compact warning style to `src/styles/today.css` using existing color variables:

```css
.system-status-banner {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-accent-yellow);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-warning);
  font-size: 0.88rem;
}
```

Run:

```powershell
npm.cmd test -- src/apiClient.test.ts src/currentRecommendations.test.ts src/components/SystemStatusBanner.test.tsx
npm.cmd run build
npm.cmd exec playwright test tests/ui/today.spec.ts -- --project=desktop --reporter=line
```

Expected: all unit tests pass, TypeScript/build passes, and every desktop Today case passes with no unmocked request.

- [ ] **Step 9: Commit the frontend status slice**

```powershell
git add -- src/apiClient.ts src/apiClient.test.ts src/currentRecommendations.ts src/components/SystemStatusBanner.tsx src/components/SystemStatusBanner.test.tsx src/App.tsx src/pages/TodayPage.tsx src/styles/today.css tests/ui/helpers.ts tests/ui/today.spec.ts
git commit -m "feat(status): show degraded provider state"
```

---

### Task 7: Run the full local completion gate

**Files:**
- Verify only; modify a recovery file only if a failing check identifies a defect within this plan's scope.

**Interfaces:**
- Consumes: all six completed code slices.
- Produces: a clean, committed recovery branch with passing unit, build, self-test, database-integrity, and 76-case UI evidence.

- [ ] **Step 1: Confirm commit and worktree scope**

Run:

```powershell
git status --short
git diff --check HEAD~6..HEAD
git diff --name-only HEAD~6..HEAD
```

Expected: no whitespace errors; changed names are limited to files named in Tasks 1–6. Do not stage pre-existing user changes.

- [ ] **Step 2: Run unit and build gates**

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all Vitest files/cases pass (baseline before recovery was 20 files/131 cases) and the production build exits `0`.

- [ ] **Step 3: Run the complete Node test inventory**

```powershell
node --test
```

Expected: all non-database Node tests pass, including the previously broken `server/app.test.mjs`; database-dependent cases either pass when the disposable database is reachable or use their established skip behavior.

- [ ] **Step 4: Run all five executable self-tests**

```powershell
node server/entry.mjs --self-test
node scripts/hdc-collector.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/odds-monitor.mjs --self-test
node scripts/unified-sampler.mjs --self-test
```

Expected: five explicit `self-test passed` messages.

- [ ] **Step 5: Run database-backed integrity locally when the approved test database is reachable**

Run:

```powershell
$env:DATABASE_URL = 'postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test'
node --test server/db/repositories.test.mjs server/db/system-status-repository.test.mjs scripts/hdc-collector-pg.test.mjs scripts/hkjc-import-pg.test.mjs scripts/check-data-integrity.test.mjs
node scripts/check-data-integrity.mjs --database
Remove-Item Env:DATABASE_URL
```

Expected: all database-backed Node tests pass and the disposable database integrity command exits `0`. The analyzer assertions still prove that genuine future input and late unified fixtures are detected.

- [ ] **Step 6: Run the full UI suite**

```powershell
npm.cmd run test:ui
```

Expected: `76 passed` across desktop, tablet, tablet landscape, and phone; no `Unmocked app data request` output.

- [ ] **Step 7: Review the final branch and create a verification commit only if evidence documentation changed**

```powershell
git log --oneline -7
git status --short
```

Expected: six scoped implementation commits after the approved design/plan commits; user-owned dirty files remain uncommitted and untouched.

---

### Task 8: Deploy, rotate the supplemental key, and verify production

**Files:**
- Deploy committed recovery files only to `/opt/odds-tool/build`.
- Update secret: `/opt/odds-tool/secrets/api_football_key` through stdin without displaying its value.

**Interfaces:**
- Consumes: a fully verified recovery commit and the valid local `.env.local` `API_FOOTBALL_KEY`.
- Produces: production HDC reserve `5`, accepted API-Football key, healthy API/Caddy/collector, and green production integrity/smoke evidence.

- [ ] **Step 1: Record the exact deployment commit and archive only committed content**

```powershell
$recoveryCommit = git rev-parse HEAD
$recoveryBase = '28bc47b'
$recoveryFiles = @(git diff --name-only "$recoveryBase..$recoveryCommit")
git archive --format=tar.gz --output="$env:TEMP\odds-system-recovery.tar.gz" $recoveryCommit -- $recoveryFiles
tar -tf "$env:TEMP\odds-system-recovery.tar.gz"
```

Expected: the archive is from one immutable commit and contains only the approved plan plus files changed by Tasks 1–6. It contains no `public/team-logos.json`, local `data/`, Playwright output, or diagnostic scripts.

- [ ] **Step 2: Copy the archive and valid key without printing the key**

Use these PowerShell commands; none of them print the key:

```powershell
scp -P 169 -i "$HOME/.ssh/astra_vm_ed25519" "$env:TEMP/odds-system-recovery.tar.gz" 'hugo@118.140.60.206:/tmp/odds-system-recovery.tar.gz'
$apiFootballLine = Get-Content -LiteralPath '.env.local' | Where-Object { $_ -match '^\s*API_FOOTBALL_KEY\s*=' } | Select-Object -First 1
$apiFootballKey = ($apiFootballLine -replace '^\s*API_FOOTBALL_KEY\s*=\s*', '').Trim('"', "'")
if ([string]::IsNullOrWhiteSpace($apiFootballKey)) { throw 'API_FOOTBALL_KEY is missing from .env.local' }
$apiFootballKey | ssh -p 169 -i "$HOME/.ssh/astra_vm_ed25519" 'hugo@118.140.60.206' 'sudo -A install -m 0400 -o root -g root /dev/stdin /opt/odds-tool/secrets/api_football_key'
$apiFootballKey = $null
```

Expected: remote `stat` reports owner `root:root` and mode `400`; neither local nor remote output contains the secret value.

- [ ] **Step 3: Stage the committed build and validate Compose before service mutation**

On the VM, list the archive and confirm every entry is one of `$recoveryFiles`, then overlay those scoped entries directly into `/opt/odds-tool/build`; do not replace the build directory as a whole and do not use `--delete`:

```sh
tar -tzf /tmp/odds-system-recovery.tar.gz
sudo -A tar -xzf /tmp/odds-system-recovery.tar.gz -C /opt/odds-tool/build
cd /opt/odds-tool
sed 's|context: \.\.|context: ./build|' /opt/odds-tool/build/deploy/compose.yaml | sudo -A tee /opt/odds-tool/compose.yaml >/dev/null
sudo -A docker compose config --quiet
sudo -A docker compose config | grep -A4 HDC_MIN_QUOTA
```

Expected: the root Compose file is deterministically regenerated from the committed file with both build contexts changed from `..` to `./build`; config validation exits `0` and collector renders `HDC_MIN_QUOTA: "5"`. Stop if validation fails.

- [ ] **Step 4: Tag rollback images, build, and recreate only affected services**

```sh
cd /opt/odds-tool
sudo -A docker tag odds-tool-api:latest odds-tool-api:rollback
sudo -A docker tag odds-tool-caddy:latest odds-tool-caddy:rollback
sudo -A docker compose build api caddy
sudo -A docker compose up -d --no-deps --force-recreate api caddy collector
sudo -A docker compose ps
```

Expected: PostgreSQL, API, and Caddy are healthy; collector and cloudflared are running. If API/Caddy health fails, restore `:rollback` tags and recreate the affected services using `docs/runbooks/production-deployment.md`.

- [ ] **Step 5: Verify the mounted API-Football key with a sanitized provider probe**

Run a one-shot command inside the collector image that reads `/run/secrets/api_football_key`, calls `https://v3.football.api-sports.io/status`, and prints only HTTP status plus whether `errors` is empty.

Expected: HTTP `200`, errors empty, and no `API_FOOTBALL_AUTH`. Never print the key, account email, or full provider payload.

- [ ] **Step 6: Verify the HDC 49/5 feedback loop and collector cycles**

Query only selected JSON fields from `collector_state`:

```sql
SELECT state->>'quotaRemaining' AS remaining,
       state->>'quotaMinimum' AS minimum,
       state->>'paidCollectionBlocked' AS blocked,
       state->>'paidCollectionBlockedReason' AS reason
FROM collector_state
WHERE state_key = 'hdc-collector';
```

Expected after a collector cycle: `remaining=49`, `minimum=5`, `blocked=false`, `reason` null. Wait through at least one HDC cycle and one HKJC/API-Football cycle; collector logs must not contain `API_FOOTBALL_AUTH`.

- [ ] **Step 7: Verify data freshness or a truthful no-call state**

Query future The Odds API live rows, future unified snapshots, latest provider observations, and current collector due-state. Expected: fresh The Odds API rows exist when a tracked event is inside the collection window; otherwise the persisted state is allowed and the dry-run/due list proves no event is due. Do not consume provider credits solely to manufacture a freshness timestamp.

- [ ] **Step 8: Run production integrity and public/private smoke**

Inside the API image/network, run:

```sh
node scripts/check-data-integrity.mjs --database
```

Then verify public statuses in order:

```text
GET /                              200
GET /api/v1/session                200
GET /api/v1/results                401
GET /internal/health/ready         404
```

Also verify internal API readiness returns `200`, HSTS is present, API/Caddy/PostgreSQL remain healthy, collector/tunnel remain running, and authenticated `/api/v1/system/status` reports the same collector/database facts.

- [ ] **Step 9: Remove only the deployment archive and record final evidence**

After verifying `readlink -f /tmp/odds-system-recovery.tar.gz` is exactly `/tmp/odds-system-recovery.tar.gz`, remove that one archive. Leave rollback images in place. Record the deployed commit, test counts, provider-state fields, smoke codes, container states, and whether fresh HDC input was due.
