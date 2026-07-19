# Task 8 Brief: PostgreSQL Collector Sinks Without Paid Automation

## Objective

Add PostgreSQL-backed persistence sinks for collector/import scripts without enabling live paid automation.

Phase 1 must keep all provider/API quota untouched unless explicitly mocked by tests. Browser/public routes must not be able to invoke collector scripts.

## Files

Create:

- `scripts/lib/postgres-sink.mjs`
- `scripts/lib/postgres-sink.test.mjs`
- `.superpowers/sdd-production-phase1/task-8-report.md`

Modify:

- `scripts/hdc-collector.mjs`
- `scripts/hkjc-import.mjs`
- `scripts/odds-monitor.mjs`
- `scripts/check-data-integrity.mjs`

## Interface

Implement:

```js
createPostgresSink({ pool }) -> {
  acquireCollectorLock(name, callback): Promise<"ran" | "busy">;
  saveLiveOdds(provider, observedAt, entries): Promise<void>;
  saveSnapshots(snapshots): Promise<InsertSummary>;
  saveResults(results): Promise<UpsertSummary>;
  loadCollectorState(key): Promise<object | null>;
  saveCollectorState(key, state): Promise<void>;
}
```

Use Task 3 repositories and PostgreSQL advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock`) around each named collector cycle. Always release locks in `finally`.

## Required Steps

1. Write RED sink tests with all provider networks denied.
   - Use fixture inputs only.
   - Prove advisory lock exclusion.
   - Prove transaction rollback.
   - Prove immutable snapshots.
   - Prove source-priority results.
   - Prove provider-scoped live replacement.
   - Prove state persistence.
   - Prove zero JSON/JSONL writes in PostgreSQL mode.

2. Separate collection from persistence.
   - Refactor each script so parsing/decision logic accepts an injected sink.
   - Keep existing file sink only as a temporary local compatibility path.
   - Production configuration requires `STORAGE_BACKEND=postgres` and refuses startup without `DATABASE_URL`.

3. Implement PostgreSQL sink.
   - Use Task 3 repository modules rather than duplicating identity or model math.
   - A failed provider response or write leaves previous rows present but stale.

4. Extend integrity checking to PostgreSQL.
   - Add explicit `--database` mode.
   - Database mode reads repository data and applies the same identity, timing, negative-score, classification, and duplicate checks.
   - Default file mode remains read-only.

5. Run self-tests and DB fixture tests only.
   - Run the three script self-tests.
   - Run sink tests.
   - Run database integrity mode against fixture data.
   - Run all previous gates.
   - Do not run live collector/import commands and do not load provider keys.

6. Independent review gate.
   - Reviewer verifies no browser/public route can invoke scripts.
   - Network tests deny external access.
   - Advisory locks are released.
   - File compatibility cannot be selected accidentally in production.

## Global Constraints

- Do not modify archive JSON/JSONL files.
- Do not modify model formulas, market thresholds, readiness logic, or settlement math.
- Do not call live providers or consume paid quota.
- Do not modify VM, DNS, Cloudflare, SSH config, or production services.
- Use only the disposable PostgreSQL test database when DB access is required.
- PostgreSQL test URL: `postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`.
- Do not print production secrets or previously posted VM credentials.

## Report Requirements

Create `.superpowers/sdd-production-phase1/task-8-report.md` with:

- changed files;
- sink interface behavior;
- script storage-backend behavior;
- database integrity mode behavior;
- all tests/commands run and exact results;
- source/network safety evidence;
- archive hashes unchanged;
- any remaining limitations.
