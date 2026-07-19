# Runbook: Legacy Archive Migration to PostgreSQL

One-way, idempotent migration of the local JSON/JSONL archives into PostgreSQL. The archives remain the immutable audit baseline; the database is the new runtime source of truth.

## Scope and safety

- **Disposable/test database only.** Never run the importer or parity checker against production.
- The importer is read-only on the archives. Verify before and after any migration work:

  ```bash
  sha256sum data/*.jsonl data/*.json public/hkjc-odds.json
  ```

  Hashes must be identical before and after. Current known-good values are recorded in `.superpowers/sdd-production-phase1/final-report.md`.

## Working commands

⚠️ Both npm scripts require `--source-root`; the bare invocations fail with `status=failed`.

```bash
export DATABASE_URL="postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test"
npm run db:migrate
npm run db:import:legacy -- --source-root .
npm run db:check:parity -- --source-root .
node scripts/check-data-integrity.mjs --database
```

## Imported sources

| File | Record kind | Notes |
|---|---|---|
| `data/prediction-snapshots.jsonl` | snapshot | 183 rows |
| `data/background-hdc-snapshots.jsonl` | snapshot | currently empty |
| `data/result-archive.jsonl` | result | 853 rows |
| `data/background-result-archive.jsonl` | result | currently empty |

## Idempotency

Each source file is tracked in `import_runs` keyed by `(source_name, source_sha256, importer_version)`:

- **First run** imports and marks the run `complete`.
- **Second run** (same file hash) reports `already-complete` for every file with **zero additions** — safe to re-run.
- Changing an archive file (never do this) changes its SHA-256 and creates a *new* import run.

Verified 2026-07-19: run 1 inserted 96 snapshots + 853 results (87 invalid snapshot rows rejected to the audit ledger); run 2 added nothing.

## Audit ledger

Every source row is recorded in `import_rows` with its classification. Rows classified `invalid` by `shared/snapshot-policy.mjs` (e.g. missing `commenceTime`) are **not** written to `prediction_snapshots` — they exist only in the audit ledger. This is why the DB holds 96 snapshot rows (3 valid-current + 93 legacy) while the archive holds 183.

## Parity expectations

`npm run db:check:parity -- --source-root .` must print:

```text
status=ok
snapshotRows=183        # file-side total (DB stores 96 valid+legacy; 87 invalid are audit-only)
resultRows=853
resultRejected=0
snapshotValidCurrent=3
snapshotLegacy=93
snapshotInvalid=87
distinctMatches=286
settlements=0
```

`node scripts/check-data-integrity.mjs --database` must exit 0 with `lateSnapshots=0`, `duplicateSnapshotKeys=0`, `duplicateResultKeys=0`, `negativeScores=0` (the DB cannot contain late/duplicate/invalid rows by construction — identity unique constraint plus insert-time classification).

## Result source priorities

- Legacy-imported rows carry **priority 0** (the importer assigns none; the repository defaults to 0).
- Collector-written rows carry **10–40** (HKJC live 10, HKJC historic 20, API-Football 30, manual:FOTMOB 40).
- The results table upserts only when the incoming priority is strictly higher, so **collector rows always outrank legacy-imported rows** for the same `matchId|market`, and re-running the legacy import can never clobber fresh collector results.

## Re-run checklist

1. Confirm `DATABASE_URL` points at the disposable DB (the test helpers hard-assert the exact URL).
2. `sha256sum` the archives → record.
3. `npm run db:migrate` (idempotent).
4. `npm run db:import:legacy -- --source-root .` → expect `already-complete` on re-runs.
5. `npm run db:check:parity -- --source-root .` → expect `status=ok` with the numbers above.
6. `node scripts/check-data-integrity.mjs --database` → exit 0.
7. `sha256sum` the archives → must match step 2.
