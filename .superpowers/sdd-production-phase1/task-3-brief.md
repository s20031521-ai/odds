### Task 3: Implement PostgreSQL repositories and immutable identities

**Files:**
- Modify: `server/domain/identity.mjs`
- Modify: `server/domain/backtest.test.mjs`
- Modify: `server.mjs`
- Create: `server/db/snapshot-repository.mjs`
- Create: `server/db/result-repository.mjs`
- Create: `server/db/odds-repository.mjs`
- Create: `server/db/collector-state-repository.mjs`
- Create: `server/db/repositories.test.mjs`
- Create: `.superpowers/sdd-production-phase1/task-3-report.md`

**Interfaces:**

```js
createSnapshotRepository(pool) -> {
  insertBatch(snapshots): Promise<{ inserted, duplicate, rejected, rejectedByReason }>;
  listAll(): Promise<object[]>;
  listCurrent(): Promise<object[]>;
}

createResultRepository(pool) -> {
  upsertBatch(results): Promise<{ inserted, updated, ignored }>;
  listAll(): Promise<object[]>;
}

createOddsRepository(pool) -> {
  replaceProviderSnapshot(provider, observedAt, entries): Promise<void>;
  listLive(now): Promise<object[]>;
}
```

- [ ] **Step 1: Write failing repository integration tests**

Cover immutable first-snapshot wins, exact versioned identity, repeated batch idempotency, partial rejection counts, legacy/invalid preservation, result source priority, live-provider replacement in one transaction, expired odds exclusion, rollback on malformed row, and concurrent duplicate insert behavior.

Run: `node --test server/db/repositories.test.mjs`

Expected: fail because repositories do not exist.

- [ ] **Step 2: Reuse the canonical identities extracted in Task 1**

Rename the extracted provider-result fallback to `providerResultIdentity` without changing its behavior in `server.mjs`. Add canonical `liveOddsIdentity(entry)` as `provider|matchId|market|selection|finite-line-or-empty`, with exact-string semantics and no observed-time component. Import `snapshotIdentity`, `resultIdentity`, and `liveOddsIdentity` from `server/domain/identity.mjs`. Extend tests for null line, quarter line, model version, provider, selection, and saved-time boundaries; do not create a second identity implementation.

- [ ] **Step 3: Implement parameterized transactional repositories**

- Classify snapshots with `shared/snapshot-policy.mjs` before insertion.
- Persist accepted valid-current and legacy snapshots in `prediction_snapshots`. Persist invalid/rejected source rows only in the Task 4 `import_rows` audit ledger so invalid numeric values cannot conflict with database constraints. `listAll()` returns accepted current and legacy rows for migration parity; `listCurrent()` is the only snapshot query used by current readiness and selects `snapshot_status = 'valid-current'`.
- Use `ON CONFLICT DO NOTHING` for immutable predictions.
- Allow result updates only when incoming `source_priority` is greater than the stored value.
- Replace one provider's live snapshot within a single transaction; never delete another provider's rows.

- [ ] **Step 4: Run GREEN, concurrency, and baseline checks**

Run repository tests twice, once serially and once with the explicit concurrent test. Then run all existing tests and archive hash verification.

- [ ] **Step 5: Independent review gate**

Reviewer compares every identity and source-priority rule with current `server.mjs`, `shared/snapshot-policy.mjs`, and integrity checks.

---

