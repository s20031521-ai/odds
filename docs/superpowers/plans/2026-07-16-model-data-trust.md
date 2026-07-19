# Odds Tool Model Data Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure current-model statistics use only valid pre-kick snapshots, count each match once, and never merge ambiguous fixtures, while preserving every archive row unchanged.

**Architecture:** Put the canonical snapshot rules in one dependency-free ESM module consumed by Node and the Vite frontend. The backend classifies snapshots at read time and validates them at write time; the frontend only stores valid snapshots and computes model performance from one deterministic representative pick per match. Fixture matching becomes exact after safe normalization, with gender preserved.

**Tech Stack:** Node.js ESM, React 19, TypeScript 5.7, Vite 6, Vitest 4, JSON/JSONL archives.

**Archive baseline (before Task 1):**

- `data/prediction-snapshots.jsonl`: 42,922 bytes; SHA-256 `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`.
- `data/background-hdc-snapshots.jsonl`: 0 bytes; SHA-256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`.

## Global Constraints

- Do not rewrite, delete, backfill, or reorder existing JSON/JSONL archives.
- Do not change the 3% edge threshold or any model parameter.
- Do not call The Odds API or consume paid quota.
- A current snapshot requires pre-kick timestamps, `odds > 1`, `chance` in `[0, 1]`, and a quarter-step line for totals, corners, and Asian handicap.
- Statistics and calibration count one representative pick per `market + modelVersion + matchId`.
- No new runtime dependency.
- This workspace is not a valid Git repository; replace commit steps with explicit verification checkpoints.

---

### Task 1: Canonical snapshot policy and frontend storage validation

**Files:**
- Create: `shared/snapshot-policy.mjs`
- Create: `shared/snapshot-policy.d.mts`
- Modify: `src/predictionSnapshots.ts`
- Modify: `src/predictionSnapshots.test.ts`

**Interfaces:**
- Produces: `classifySnapshot(value): { status: "valid-current" | "legacy" | "invalid"; reason: string | null }`
- Produces: `summarizeSnapshotQuality(values): { raw; validCurrent; legacy; invalid; invalidReasons }`
- Consumes later: `server.mjs`, `scripts/check-data-integrity.mjs`.

- [ ] **Step 1: Write failing policy tests**

Add table-driven tests to `src/predictionSnapshots.test.ts` and import the wished-for API:

```ts
import { classifySnapshot } from "../shared/snapshot-policy.mjs";

const valid = {
  matchId: "m1", market: "大細波", prediction: "大", line: 2.5,
  odds: 2, chance: 0.55, edge: 0.1,
  savedAt: "2026-07-09T00:00:00Z", commenceTime: "2026-07-10T00:00:00Z",
  modelVersion: "totals-loo-v1", source: "test",
};

expect(classifySnapshot(valid).status).toBe("valid-current");
expect(classifySnapshot({ ...valid, commenceTime: undefined }).reason).toBe("missing-commence-time");
expect(classifySnapshot({ ...valid, savedAt: valid.commenceTime }).reason).toBe("post-kickoff");
expect(classifySnapshot({ ...valid, odds: 1 }).reason).toBe("invalid-odds");
expect(classifySnapshot({ ...valid, chance: 1.1 }).reason).toBe("invalid-chance");
expect(classifySnapshot({ ...valid, line: undefined }).reason).toBe("missing-line");
expect(classifySnapshot({ ...valid, line: 2.3 }).reason).toBe("invalid-line");
expect(classifySnapshot({ ...valid, modelVersion: undefined }).status).toBe("legacy");
```

Also assert `savePredictionSnapshots()` persists `valid` but rejects each invalid variant. Update existing storage fixtures to include valid modelVersion, odds, and chance so they express the new contract.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- --run src/predictionSnapshots.test.ts
```

Expected: FAIL because `shared/snapshot-policy.mjs` does not exist.

- [ ] **Step 3: Implement the dependency-free policy**

Create `shared/snapshot-policy.mjs` with stable reason priority:

```js
const LINE_MARKETS = new Set(["大細波", "角球", "亞洲讓球"]);

export function classifySnapshot(value) {
  if (!value || typeof value !== "object") return invalid("invalid-snapshot");
  if (!nonEmpty(value.matchId)) return invalid("missing-match-id");
  if (!nonEmpty(value.market)) return invalid("missing-market");
  if (!nonEmpty(value.prediction) || isPlaceholder(value.prediction)) return invalid("invalid-prediction");
  if (!nonEmpty(value.savedAt)) return invalid("missing-saved-at");
  if (!nonEmpty(value.modelVersion) || value.modelVersion === "legacy-v0") return { status: "legacy", reason: "legacy-model" };
  if (!nonEmpty(value.commenceTime)) return invalid("missing-commence-time");
  const savedAt = Date.parse(value.savedAt);
  const commenceTime = Date.parse(value.commenceTime);
  if (!Number.isFinite(savedAt)) return invalid("invalid-saved-at");
  if (!Number.isFinite(commenceTime)) return invalid("invalid-commence-time");
  if (savedAt >= commenceTime) return invalid("post-kickoff");
  if (!Number.isFinite(value.odds) || value.odds <= 1) return invalid("invalid-odds");
  if (!Number.isFinite(value.chance) || value.chance < 0 || value.chance > 1) return invalid("invalid-chance");
  if (value.edge !== undefined && !Number.isFinite(value.edge)) return invalid("invalid-edge");
  if (LINE_MARKETS.has(value.market)) {
    if (!Number.isFinite(value.line)) return invalid("missing-line");
    if (Math.abs(value.line * 4 - Math.round(value.line * 4)) > 1e-9) return invalid("invalid-line");
  }
  return { status: "valid-current", reason: null };
}
```

Add `summarizeSnapshotQuality()` using the classifier, plus matching declarations in `shared/snapshot-policy.d.mts`. Change `savePredictionSnapshots()` to persist only `valid-current` rows.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: all `predictionSnapshots` tests pass.

- [ ] **Step 5: Verification checkpoint**

Run `npm.cmd run build`. Expected: TypeScript resolves the `.mjs` declarations and Vite builds successfully.

---

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

### Task 3: Distinct-match representative selection and priced-only ROI

**Files:**
- Modify: `src/marketDisplay.ts`
- Modify: `src/marketDisplay.test.ts`
- Modify: `server.mjs`

**Interfaces:**
- Produces: `selectDistinctPerformanceRows<T extends PerformanceRow>(rows: T[]): T[]`.
- Representative order: highest finite edge, then earliest valid savedAt, then numeric line, then stable input order.
- `summarizePerformanceRows()`, `predictionDistribution()`, and `calibrationBuckets()` consume representatives.

- [ ] **Step 1: Add failing frontend statistic tests**

Use two settled lines for one match and one line for another:

```ts
const rows = [
  { matchId: "m1", market: "大細波", modelVersion: "v1", prediction: "大", settlement: "loss", odds: 2, edge: 0.04, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
  { matchId: "m1", market: "大細波", modelVersion: "v1", prediction: "細", settlement: "win", odds: 2.2, edge: 0.08, savedAt: "2026-07-09T02:00:00Z", line: 3 },
  { matchId: "m2", market: "大細波", modelVersion: "v1", prediction: "大", settlement: "half-loss", odds: 1.9, edge: 0.05, savedAt: "2026-07-09T01:00:00Z", line: 2.5 },
];
```

Assert `finished === 2`, `matches === 2`, the m1 win is selected, and ROI equals `(1.2 - 0.5) / 2`. Add a push case and a missing-odds case proving only priced representatives enter ROI.

- [ ] **Step 2: Run `npm.cmd test -- --run src/marketDisplay.test.ts` and verify RED**

Expected: FAIL because current summaries count all three lines.

- [ ] **Step 3: Implement deterministic representative selection**

Extend `PerformanceRow` with `edge`, `savedAt`, and `line`. Group only rows with non-empty `matchId` by:

```ts
`${row.market ?? ""}|${row.modelVersion ?? ""}|${row.matchId}`
```

Select the representative using the specified order. Call this helper before performance, direction, and calibration calculations.

- [ ] **Step 4: Make server top-level summaries distinct-match aware**

Add the same small representative selector in `server.mjs` and call it before `summarize()`, `groupSummary()`, and chance buckets. Add self-test rows where the lower-edge and higher-edge lines settle differently; assert one finished match and priced-only ROI.

- [ ] **Step 5: Verify frontend and backend GREEN**

Run:

```powershell
npm.cmd test -- --run src/marketDisplay.test.ts
npm.cmd run server:self-test
```

Expected: both pass, including half-win/half-loss/push behavior.

---

### Task 4: Fail-closed fixture matching

**Files:**
- Create: `src/fixtureMatch.test.ts`
- Modify: `src/fixtureMatch.ts`

**Interfaces:**
- Keeps: `sameFixture(left, right): boolean` and `groupByFixture(entries): Map<string, entries[]>`.
- Canonical team identity includes normalized name plus gender marker.

- [ ] **Step 1: Write failing matching regressions**

Test:

```ts
expect(sameFixture(fixture("Manchester", "Liverpool"), fixture("Manchester United", "Liverpool"))).toBe(false);
expect(sameFixture(fixture("Arsenal Women", "Chelsea Women"), fixture("Arsenal", "Chelsea"))).toBe(false);
expect(sameFixture(fixture("Djurgardens", "Halmstads"), fixture("Djurgårdens IF", "Halmstads BK", 5))).toBe(true);
expect(sameFixture(fixture("A", "B"), fixture("A", "B", 11))).toBe(false);
```

Use unique match IDs and kickoff offsets in minutes.

- [ ] **Step 2: Run `npm.cmd test -- --run src/fixtureMatch.test.ts` and verify RED**

Expected: Manchester substring and women/men cases incorrectly return true.

- [ ] **Step 3: Replace substring matching with canonical exact matching**

Normalize accents, case, punctuation, and the club suffix tokens `fc`, `afc`, `cf`, `bk`, `if`, `sk`. Detect `women`, `w`, `ladies`, and `女足` before suffix removal. Compare exact normalized base plus equal gender marker; never use `includes()`.

- [ ] **Step 4: Verify matching and existing odds tests GREEN**

Run:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts src/odds.test.ts src/handicap.test.ts
```

Expected: all tests pass; HKJC accent/suffix merge remains intact.

---

### Task 5: UI quality audit summary and full verification

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/marketDisplay.ts`
- Modify: `src/marketDisplay.test.ts`

**Interfaces:**
- Consumes: `/api/backtest.snapshotQuality`.
- Produces: `snapshotQualityMessage(quality): string | null` and an Analysis/History warning.

- [ ] **Step 1: Add failing quality-message test**

```ts
expect(snapshotQualityMessage({ raw: 183, validCurrent: 3, legacy: 90, invalid: 90, invalidReasons: { "missing-commence-time": 87 } }))
  .toBe("已隔離 90 個 legacy 同 90 個無效 snapshots；current 統計只使用 3 個有效 snapshots。");
expect(snapshotQualityMessage({ raw: 3, validCurrent: 3, legacy: 0, invalid: 0, invalidReasons: {} })).toBeNull();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run `npm.cmd test -- --run src/marketDisplay.test.ts`. Expected: FAIL because the formatter is absent.

- [ ] **Step 3: Wire additive API data into React**

Add a `SnapshotQuality` type and state in `App.tsx`. In `loadBacktest()`, accept a well-shaped `body.snapshotQuality`; default to `null` for backward compatibility. Render the formatter result as a `sample-warning` with `role="status"` on History and Analysis. Change comparable/current helpers to accept only `snapshotStatus === "valid-current"` when the field is present.

- [ ] **Step 4: Run all automated verification**

Run, without starting the paid collector:

```powershell
node server.mjs --self-test
node scripts/hdc-collector.mjs --self-test
node scripts/odds-monitor.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/check-data-integrity.mjs
npm.cmd test
npm.cmd run build
```

Expected: four self-tests pass, data check exits 0, all Vitest tests pass, production build exits 0.

- [ ] **Step 5: Black-box verification**

Start only `server.mjs` and Vite. Confirm `/api/backtest` exposes `snapshotQuality`; Analysis displays the isolation message; no legacy/invalid row contributes to current hit rate/ROI/readiness. Confirm Dashboard still shows stale-data warning and no expired fixtures. Stop both local processes afterward.

- [ ] **Step 6: Final archive immutability check**

Compare size and SHA-256 for `data/prediction-snapshots.jsonl` and `data/background-hdc-snapshots.jsonl` against values recorded before Task 1. Expected: hashes unchanged.
