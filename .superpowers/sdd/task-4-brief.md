### Task 4: Server-authoritative recommendations and audit API

**Files:**
- Modify: `server/app.mjs`, `server/app.test.mjs`, `server/domain/backtest.mjs`, `server/domain/backtest.test.mjs`
- Modify: `src/apiClient.ts`, `src/apiClient.test.ts`

**Interfaces:**
- `GET /api/v1/recommendations/current`
- `GET /api/v1/predictions/observations?sampleId=<positive integer>`
- Extended `GET /api/v1/backtest`

- [ ] **Step 1: Write failing route and domain tests**

  Assert authentication, method inventory, required positive `sampleId`, no-store JSON response, current filtering by future kickoff/latest non-empty observation/45-minute freshness, quote-range sorting, per-bookmaker fields, legacy POST rejection for the new strategy, legacy POST compatibility, distinct fixture+market readiness, opportunity-level settlement, lower/upper unit return, and closing benchmark `N/A` when the last pre-kick observation is empty.

- [ ] **Step 2: Run RED tests**

  Run: `node --test server/app.test.mjs server/domain/backtest.test.mjs`

  Run: `npm.cmd test -- src/apiClient.test.ts`

- [ ] **Step 3: Implement API response contracts**

  Current response:

  ```ts
  type CurrentRecommendationsResponse = {
    generatedAt: string;
    strategyVersion: "unified-buyable-v1";
    opportunities: BuyableOpportunity[];
  };
  ```

  Each `BuyableOpportunity` exposes `sampleId`, fixture/team/league/kickoff metadata, market, selection, optional line, `quoteRange { min, max, count }`, `bestQuote`, sorted `quotes`, and latest evaluation time. Observation history includes `firstEvaluatedAt`, `lastEvaluatedAt`, inputs, and buyable quotes.

- [ ] **Step 4: Extend backtest semantics**

  Filter active readiness to `unified-buyable-v1`. Count settled distinct fixture+market values. Settle each opportunity selection/line separately; compute its minimum/maximum unit profit across all qualifying quotes, aggregate lower/upper ROI with one unit per opportunity, and compute closing benchmark from the final pre-kick evaluation only. Exclude `void` and `unsettleable`; count push as settled but not win/loss.

- [ ] **Step 5: Run GREEN tests and commit**

  Run: `node --test server/app.test.mjs server/domain/backtest.test.mjs`

  Run: `npm.cmd test -- src/apiClient.test.ts`

  ```powershell
  git add server/app.mjs server/app.test.mjs server/domain/backtest.mjs server/domain/backtest.test.mjs src/apiClient.ts src/apiClient.test.ts
  git commit -m "feat: expose recorded buyable recommendation ranges"
  ```

