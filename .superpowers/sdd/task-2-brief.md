### Task 2: Backend write validation, read-time classification, and quality audit

**Files:**
- Modify: `server.mjs`
- Modify: `scripts/check-data-integrity.mjs`

**Interfaces:**
- Consumes: `classifySnapshot()` and `summarizeSnapshotQuality()` from Task 1.
- Produces: `/api/backtest.snapshotQuality` and row field `snapshotStatus: "valid-current"`.
- Produces: `/api/predictions` response `{ saved, rejected, rejectedByReason }`.

- [ ] **Step 1: Add failing server self-test assertions**

Add valid current fixtures with complete timestamps/odds/chance/modelVersion. Assert:

```js
const qualityBacktest = buildBacktest([
  validSnapshot({ matchId: "valid" }),
  validSnapshot({ matchId: "bad-time", commenceTime: undefined }),
  { matchId: "legacy", market: "大細波", prediction: "大", savedAt: "x" },
], [{ matchId: "valid", market: "大細波", actual: "3 球" }], now);
assert(qualityBacktest.snapshotQuality.validCurrent === 1, "counts valid current snapshots");
assert(qualityBacktest.snapshotQuality.invalid === 1, "counts invalid current snapshots");
assert(qualityBacktest.snapshotQuality.legacy === 1, "counts legacy snapshots");
assert(qualityBacktest.rows.filter((row) => row.snapshotStatus === "valid-current").length === 1, "settles only valid current snapshots");
```

Add direct classification assertions for missing time, post-kickoff, invalid odds/chance, and missing line.

- [ ] **Step 2: Run `npm.cmd run server:self-test` and verify RED**

Expected: FAIL because `snapshotQuality` and `snapshotStatus` are absent.

- [ ] **Step 3: Filter backtest inputs without changing archives**

Import the policy. In `buildBacktest()`:

```js
const stored = mergeSnapshots([], snapshots);
const snapshotQuality = summarizeSnapshotQuality(stored);
const usable = stored.filter((item) => classifySnapshot(item).status === "valid-current");
```

Use `usable` for settlement and readiness. Copy `edge`, `savedAt`, and `snapshotStatus: "valid-current"` to settled rows. Return `snapshotQuality` alongside rows and summaries. Keep unmatched raw result rows, but never attach an invalid prediction to them.

- [ ] **Step 4: Enforce the policy at `POST /api/predictions`**

Classify every incoming row. Persist only `valid-current`; if none are valid return 400. For partial acceptance return:

```js
{
  saved,
  rejected: incoming.length - snapshots.length,
  rejectedByReason: { "invalid-odds": 1 }
}
```

Do not alter immutable merge identity or existing archive rows.

- [ ] **Step 5: Add actual archive quality output**

Import `summarizeSnapshotQuality()` in `scripts/check-data-integrity.mjs` and print:

```text
snapshotQualityValidCurrent=<n>
snapshotQualityLegacy=<n>
snapshotQualityInvalid=<n>
snapshotQualityInvalidReasons=<json>
```

The script remains read-only.

- [ ] **Step 6: Run backend checks and verify GREEN**

Run:

```powershell
npm.cmd run server:self-test
npm.cmd run check:data
```

Expected: self-test passes; data check reports 183 raw snapshots, all 180 missing-commence rows excluded from valid-current.

---

