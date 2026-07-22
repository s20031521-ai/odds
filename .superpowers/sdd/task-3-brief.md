### Task 3: PostgreSQL-only unified sampler

**Files:**
- Create: `scripts/unified-sampler.mjs`
- Create: `scripts/unified-sampler-pg.test.mjs`
- Modify: `scripts/lib/postgres-sink.mjs`

**Interfaces:**
- Export `runUnifiedSampler({ sink, now })` and `createUnifiedEvaluation(liveRows, resolvedFixtures, now)`.
- Sink gains `listLiveOdds(now)`, `resolveFixtures(rows)`, and `recordRecommendationEvaluation(value)`.

- [ ] **Step 1: Write failing sampler tests**

  Test advisory lock miss, DB-only execution, stale-provider exclusion without global shutdown, canonical bookmaker dedupe, one opportunity with multiple buyable quotes, changed peer odds producing a new fingerprint, unchanged input extending the observation, and a later no-buy/empty batch being recorded for an already-created sample.

- [ ] **Step 2: Run RED sampler tests**

  Run: `node --test scripts/unified-sampler-pg.test.mjs`

  Expected: FAIL because the sampler does not exist.

- [ ] **Step 3: Implement the sampler**

  Acquire the existing session advisory-lock mechanism with lock name `unified-buyable-sampler`. Read only PostgreSQL live odds, resolve fixture aliases, call the pure engine once per cycle, and persist each evaluation transactionally. Never call `fetch`, HKJC, The Odds API, or API-Football.

- [ ] **Step 4: Add a self-test and GREEN verification**

  `node scripts/unified-sampler.mjs --self-test` must exercise thresholding and fingerprint idempotency without a database.

  Run: `node --test scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.test.mjs`

- [ ] **Step 5: Commit**

  ```powershell
  git add scripts/unified-sampler.mjs scripts/unified-sampler-pg.test.mjs scripts/lib/postgres-sink.mjs scripts/lib/postgres-sink.test.mjs
  git commit -m "feat: sample unified buyable odds from postgres"
  ```

