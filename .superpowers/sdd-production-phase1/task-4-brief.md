### Task 4: Build the idempotent legacy importer and parity verifier

**Files:**
- Create: `db/migrations/002_import_row_audit.sql`
- Modify: `server/db/snapshot-repository.mjs`
- Modify: `server/db/result-repository.mjs`
- Modify: `server/db/repositories.test.mjs`
- Create: `scripts/import-legacy-to-postgres.mjs`
- Create: `scripts/check-postgres-parity.mjs`
- Create: `scripts/legacy-import.test.mjs`
- Modify: `package.json`
- Create: `.superpowers/sdd-production-phase1/task-4-report.md`

**Interfaces:**

```text
npm run db:migrate
npm run db:import:legacy -- --source-root <path>
npm run db:check:parity -- --source-root <path>
```

The scripts read `DATABASE_URL` from environment, accept a source root, print counts/hashes only, never print secrets, and never call providers.

Repository transaction contract: `createSnapshotRepository(db)` and `createResultRepository(db)` accept either a pool or an already-open transaction client. Pool-backed calls own their transaction; client-backed calls participate in the caller's existing transaction and must not issue nested `BEGIN`/`COMMIT`.

- [ ] **Step 1: Write fixture-based RED tests**

Use temporary copies containing valid-current, legacy missing-commence, invalid odds, duplicate snapshot keys within one file and across two source files, duplicate result identities, and higher-priority results. Tests prove first import counts, second import zero additions, failed run rollback, source hash ledger, every source row retained in the audit ledger even when canonical identities duplicate, row-level classification, and unchanged source bytes.

`002_import_row_audit.sql` removes the global uniqueness constraint from `import_rows.idempotency_key`, makes it a non-unique lookup index, and adds non-null `record_kind` (`snapshot` or `result`). The primary key `(import_run_id, source_row)` remains the row audit identity; repository/domain identities, not the audit table, deduplicate accepted data.

- [ ] **Step 2: Implement import run/row ledger**

For every source file:

1. stream/read bytes and compute SHA-256;
2. create or reuse the unique `import_runs` identity;
3. parse each row without rewriting source;
4. record `import_rows` classification and idempotency key;
5. insert through client-backed repositories inside the same per-file transaction as `import_rows`;
6. mark the run complete only after transaction commit.

- [ ] **Step 3: Implement parity checks**

The verifier loads file-backed and DB-backed data through the same pure domain functions and fails on any mismatch in:

- source SHA-256 and row counts;
- identity sets and classifications;
- valid-current/legacy/invalid counts and rejection reasons;
- distinct matches, readiness, settlements, hit rate, ROI/profit, buckets, and representative backtest rows.

- [ ] **Step 4: Run against isolated fixtures**

Run: `node --test scripts/legacy-import.test.mjs`

Expected: all fixture imports and repeated imports pass.

- [ ] **Step 5: Run read-only parity against the real local archives**

Reset only the disposable test database, migrate it, import the real workspace data, run the importer a second time, and execute parity. Expected baseline: 183 snapshots, 853 results, no late snapshots, no duplicate keys, and unchanged archive hashes. If the computed result differs, stop and report rather than changing an archive or the expected count.

- [ ] **Step 6: Independent review gate**

Reviewer verifies source files were opened read-only, import reruns are idempotent, invalid/legacy rows cannot contaminate current statistics, and parity uses actual domain functions rather than duplicated formulas.

---

