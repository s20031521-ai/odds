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
