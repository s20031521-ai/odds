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

