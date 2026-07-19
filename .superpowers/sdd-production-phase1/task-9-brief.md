# Task 9 Brief: Phase 1 Final Parity, Security, and Handoff Gate

## Objective

Prove Phase 1 is complete and safe to hand to Phase 2 (VM/Compose/Tunnel deployment). This task produces verification evidence, a security black-box pass, runbooks, and the final report. It does NOT deploy anything and does NOT change application behavior.

Source plan: `docs/superpowers/plans/2026-07-18-production-api-postgres-auth.md` (Task 9 section).

## Files

Modify:

- `README.md` (point at new architecture/runbooks; keep safety rules intact)
- `.superpowers/sdd-production-phase1/progress.md` (orchestrator updates after completion)

Create:

- `docs/runbooks/local-postgres-development.md`
- `docs/runbooks/legacy-migration.md`
- `.superpowers/sdd-production-phase1/final-report.md`
- `.superpowers/sdd-production-phase1/task-9-report.md`

Do not modify application code under `server/`, `src/`, `shared/`, `scripts/` unless the whole-phase review finds a Critical/Important issue; any such fix follows strict TDD and re-runs all gates.

## Required Steps

### Step 1: Fresh complete verification matrix

Run without paid provider keys (never load `.env.local` into commands; never call live providers):

```powershell
npm.cmd run server:self-test
node scripts/odds-monitor.mjs --self-test
node scripts/hkjc-import.mjs --self-test
node scripts/hdc-collector.mjs --self-test
npm.cmd run check:data
npm.cmd test
node --test server/app.test.mjs server/auth/auth.test.mjs   (plus any other pure server tests)
npm.cmd run build
npm.cmd run test:ui:only
npm.cmd audit --omit=dev
npm.cmd audit
```

Note: the plan mentions `npm run test:server`; no such script exists — server node tests are run directly via `node --test` as above (DB-backed server tests use the disposable DATABASE_URL).

Additionally, against the disposable PostgreSQL ONLY (`postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`, via the open SSH tunnel; never production):

1. Run migrations twice (idempotent).
2. Run the legacy import twice into the disposable DB (`npm run db:import:legacy`); second run must add zero rows.
3. Run file/DB parity (`npm run db:check:parity`).
4. Run `node scripts/check-data-integrity.mjs --database` against the imported data.
5. Run all DB-backed test files (sink, collector pg tests, repositories, migrations, integrity).
6. Inspect the built service worker (`dist/`) for forbidden runtime caching of API/JSON/odds/results.
7. Source scan: no loopback API URLs in the frontend bundle, no wildcard CORS, no public importer/collector routes in `server/app.mjs`.
8. Archive SHA-256 comparison before/after everything (`data/*.jsonl data/*.json public/hkjc-odds.json`).

### Step 2: Security black-box pass

Run the real server (`server/entry.mjs`) against the disposable DB with throwaway `SESSION_SECRET`/`PUBLIC_ORIGIN` and a throwaway owner created via `npm run auth:create-owner` (password via hidden prompt or a temp secret file deleted afterwards; never in command lines, logs, or reports). Black-box probe with curl (or equivalent) only — no source changes:

- unauthenticated requests to every protected route are denied;
- login throttling: 5 failures in 15 minutes → cooldown; verify lockout response;
- session revocation on logout; cookie flags (`__Host-` prefix, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain);
- mutation without Origin / with foreign Origin / without CSRF → 403;
- body limits: auth >16 KiB rejected, predictions >1 MiB rejected;
- error responses contain no SQL, paths, or secrets;
- `/internal/health/ready` not mounted on the public API surface (document how it must stay private in Phase 2);
- `public/hkjc-odds.json` is not served as live data by the new server;
- no provider network traffic during any of the above.

For local black-box only, an `http://127.0.0.1` origin is acceptable if `server/config.mjs` supports it; if it requires HTTPS, document the constraint and use a local TLS proxy or a config-supported loopback exception — do not weaken production checks.

### Step 3: Whole-phase independent review

A fresh reviewer (separate agent) reads the Phase 1 surface — `server/`, `scripts/lib/`, the three collector scripts, `shared/`, auth, frontend API client, DB migrations — plus all task reports, and reports Critical/Important/Minor findings. Fix every Critical/Important with systematic debugging and strict TDD, then re-run all gates.

### Step 4: Runbooks + Phase 2 contract

- `docs/runbooks/local-postgres-development.md`: tunnel/compose disposable DB, env vars (names only), migrations, import, parity, integrity `--database`, test commands.
- `docs/runbooks/legacy-migration.md`: idempotent import, audit ledger, parity expectations, archive immutability, priority-0 semantics vs collector priorities.
- `final-report.md`: schema migration version (003), runtime/image requirements, environment/secret NAMES only (`DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `OWNER_USERNAME`, `OWNER_PASSWORD_FILE`, `STORAGE_BACKEND`, provider keys), internal ports, readiness path (`/internal/health/ready` must stay private), owner bootstrap command, exact archive hashes/counts, resource expectations, decision on Task 8 review item I1 (odds-monitor pg history: document accepted limitation or required follow-up), and all remaining limitations.
- Update `README.md` Quick Start for the new architecture (server needs PostgreSQL + env; file mode still default for collectors) and link the runbooks. Keep every safety rule.

## Global Constraints

- Do not modify archive JSON/JSONL files; hashes must match before/after.
- Do not call live providers or consume paid quota; do not read/print `.env.local` values.
- Do not modify model formulas, thresholds, readiness, or settlement math.
- Do not touch VM, DNS, Cloudflare, SSH config, or production services; disposable DB only.
- Do not enable production collector automation; file mode remains default.
- Passwords/secrets never appear in command lines, reports, logs, or chat transcripts.

## Report Requirements

`task-9-report.md`: every command run with exact results; black-box probe table (probe → expected → actual); parity/integrity results; service-worker scan result; source-scan result; archive hashes; review findings and resolutions; final-report location; remaining limitations.
