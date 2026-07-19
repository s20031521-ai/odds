# Phase 2 Task 3 Report: Archive Bundle Migration into Production PostgreSQL

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 3.

## Step 1 — Bundle staged read-only, hashes verified

- 9 archive files hashed locally (`data/*.jsonl` ×4 + `data/*.json` ×4 + `public/hkjc-odds.json`); listing saved to `task3-archive-sha256-local.txt`.
  - Note: `data/background-hdc-snapshots.jsonl` and `data/background-result-archive.jsonl` are 0-byte files (empty-sha `e3b0c442…b855`) — expected, background collectors never wrote locally.
- Copied via scp to dated VM bundle `/opt/odds-tool/migration-bundle-2026-07-19/{data,public}/`, `chmod -R a-w`, re-hashed on VM (`task3-archive-sha256-vm.txt`) → **9/9 byte-identical** (`HASHES-MATCH`).
- `deploy/migration-bundle/.gitkeep` created locally documenting the procedure (bundle contents never enter VCS).

## Step 2 — Import ×2, parity, integrity (one-shot containers on `db_net`, migration role)

Runner: `odds-tool-api:latest` image with `--entrypoint node`, bundle mounted `:ro` at `/bundle`, `DATABASE_URL=postgres://odds_migration:***@postgres:5432/odds` composed from the VM secret at run time (never printed/stored).

1. **Import #1** — `status=complete`: sourceRows=1036, snapshotInserted=**96**, snapshotRejected=**87** (→ audit, auditRowsAdded=1036), resultInserted=**853**, all duplicate/update/ignore counters 0. File hashes reported by the importer match the sha256 listings exactly.
2. **Import #2 (idempotency)** — all 4 files `already-complete`; every insertion/rejection/audit counter **0**.
3. **Parity** — `status=ok`: snapshotRows=**183**, resultRows=**853**, validCurrent=**3** / legacy=**93** / invalid=**87**, distinctMatches=**286**, settlements=**0** — exact Phase 1 numbers.
4. **Integrity** (`--database`) — exit **0**: snapshots=96, results=853; lateSnapshots / duplicateSnapshotKeys / duplicateResultKeys / negativeScores all 0; `snapshotsMissingCommenceTime=93` flagged as expected for legacy/backfilled rows.

## Step 3 — Post-migration hash verification

- Local originals and VM bundle re-hashed after all DB work → **byte-identical to Step 1** (`ALL-HASHES-UNCHANGED`). Sources untouched, as required by the fail-closed gate.

## Gate

- Parity `status=ok` with exact Phase 1 numbers: **PASS**
- Integrity exit 0, failure counters 0: **PASS**
- Archive hashes unchanged end-to-end: **PASS**

Production PostgreSQL now holds the full archive dataset. Stack still has zero published ports; tunnel remains disabled until Task 6. Ready for Task 4 (owner bootstrap).
