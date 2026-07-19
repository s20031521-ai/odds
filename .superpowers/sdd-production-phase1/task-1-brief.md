### Task 1: Extract and freeze file-independent domain behavior

**Files:**
- Create: `server/domain/backtest.mjs`
- Create: `server/domain/identity.mjs`
- Create: `server/domain/backtest.test.mjs`
- Modify: `server.mjs`
- Create: `.superpowers/sdd-production-phase1/task-1-report.md`

**Interfaces:**
- Produces: `buildBacktest(snapshots, results, now)`, `buildHealth(updatedAtBySource, now)`, `flattenLiveCache(cached)`, `mergeSnapshots(existing, incoming)`, `mergeResults(existing, incoming)`, `oddsScoreRows(events)`, `selectBacktestResults(liveResults, archivedResults)`, plus canonical `snapshotIdentity(snapshot)`, `resultIdentity(result)`, and `liveOddsIdentity(entry)` shared by later repositories and importers.
- Preserves: all current `server.mjs --self-test` assertions and output shapes.

- [ ] **Step 1: Write the failing import/parity tests**

Create `server/domain/backtest.test.mjs` with Node's test runner. Import the future module and reproduce the existing server self-test fixtures, including Asian quarter lines, push exclusion, distinct-match readiness, legacy/current separation, invalid snapshot classification, and result-source priority.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildBacktest, mergeSnapshots } from "./backtest.mjs";

test("preserves quarter-line settlement and push denominators", () => {
  const response = buildBacktest(quarterLineSnapshots, quarterLineResults, NOW);
  assert.deepEqual(response.rows.map((row) => row.settlement), [
    "win", "half-win", "push", "half-loss", "loss",
  ]);
  assert.equal(response.summary.hitRate, 3 / 6);
});

test("keeps immutable versioned snapshot identities", () => {
  const merged = mergeSnapshots([], duplicateIdentitySnapshots);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].odds, duplicateIdentitySnapshots[0].odds);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test server/domain/backtest.test.mjs`

Expected: fail because `server/domain/backtest.mjs` does not exist.

- [ ] **Step 3: Extract without rewriting algorithms**

Move the named pure functions and constants from `server.mjs` into `server/domain/backtest.mjs`. Move the existing snapshot/result/provider key construction into `server/domain/identity.mjs`; make the extracted domain module and `server.mjs` import those identities. Export them and import them back into `server.mjs`. Do not change function bodies except imports/exports required by extraction.

- [ ] **Step 4: Verify parity**

Run:

```powershell
node --test server/domain/backtest.test.mjs
npm.cmd run server:self-test
npm.cmd test
npm.cmd run check:data
```

Expected: new tests pass; existing 139 Vitest tests, server self-test, and integrity check pass with unchanged archive hashes.

- [ ] **Step 5: Independent review gate**

Reviewer checks the diff for any changed domain formula, sort, identity, readiness, or settlement branch. Record approval and exact commands in the task report.

---

