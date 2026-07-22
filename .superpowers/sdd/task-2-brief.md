### Task 2: Additive fixture and opportunity persistence

**Files:**
- Create: `db/migrations/004_unified_buyable.sql`
- Create: `server/db/fixture-repository.mjs`
- Create: `server/db/opportunity-repository.mjs`
- Modify: `server/db/odds-repository.mjs`, `server/db/snapshot-repository.mjs`, `server/domain/identity.mjs`, `server/entry.mjs`
- Test: `server/db/migrate.test.mjs`, `server/db/repositories.test.mjs`

**Interfaces:**
- `fixtureRepository.resolveBatch(liveRows)` returns `{ fixtures, unmatched }` and persists provider aliases.
- `opportunityRepository.recordEvaluation(evaluation)` upserts immutable samples and fingerprinted observations in one transaction.
- `opportunityRepository.listCurrent(now)`, `.listObservations(sampleId)`, and `.listForBacktest()` support later API tasks.

- [ ] **Step 1: Write failing migration and repository tests**

  Assert additive tables/columns, old snapshot raw remains byte-for-byte unchanged, null strategy maps to legacy, alias uniqueness, exact alias reuse, unique ±10-minute team match, ambiguous match audit, strategy/selection-aware identity, identical fingerprint extending only `last_evaluated_at`, changed fingerprint inserting a row, and empty qualifying quote arrays remaining valid observations after a sample exists.

- [ ] **Step 2: Run RED database tests**

  Run: `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs`

  Expected: FAIL on missing migration columns/tables/modules.

- [ ] **Step 3: Add the migration**

  Add source-neutral `fixtures`, `fixture_aliases`, and `fixture_match_audit`; add nullable `strategy_version`, `fixture_id`, `first_qualified_at`, and `last_qualified_at` to `prediction_snapshots`; add `recommendation_observations` with unique `(snapshot_id, fingerprint)`, `first_evaluated_at`, `last_evaluated_at`, `inputs jsonb`, and `buyable_quotes jsonb`. Add indexes for current strategy, kickoff, sample history, and alias lookup. Do not update existing rows.

- [ ] **Step 4: Implement fixture resolution**

  Match exact aliases first. For unseen aliases, normalize team names with the existing fixture normalization, require same home/away direction, kickoff difference no greater than ten minutes, and compatible league when both leagues exist. Auto-link only one candidate; create a new internal UUID fixture when zero candidates exist; write `fixture_match_audit` and leave the row unmatched when multiple candidates exist.

- [ ] **Step 5: Implement opportunity persistence**

  Insert the parent snapshot only on first qualification. Store the first batch's best quote in legacy scalar columns for compatibility, but make new reads use observation JSON. On conflict, preserve the parent's first-write fields and update only `last_qualified_at`. For observations, identical fingerprints update only `last_evaluated_at`; new fingerprints insert a row. Reject `unified-buyable-v1` through legacy `insertBatch`.

- [ ] **Step 6: Return live metadata**

  Change `listLive` to merge trusted DB columns into raw output so `provider`, `observedAt`, source `matchId`, and expiry cannot be lost or spoofed by nested raw data. Preserve existing field names consumed by the UI.

- [ ] **Step 7: Run GREEN database tests and commit**

  Run: `node --test server/db/migrate.test.mjs server/db/repositories.test.mjs`

  ```powershell
  git add db/migrations/004_unified_buyable.sql server/db server/domain/identity.mjs server/entry.mjs
  git commit -m "feat: persist unified fixtures and quote observations"
  ```

