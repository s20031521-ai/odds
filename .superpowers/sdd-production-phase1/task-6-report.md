# Task 6 Report: Secure Injected `/api/v1` Application

## Scope

Implemented the server-side same-origin `/api/v1` application boundary for Phase 1.

Created:

- `server/http/body.mjs`
- `server/http/cookies.mjs`
- `server/http/responses.mjs`
- `server/http/security.mjs`
- `server/app.mjs`
- `server/app.test.mjs`
- `server/entry.mjs`

Modified:

- `package.json`
- `server.mjs`

No frontend Task 7 migration, archive mutation, provider API call, VM filesystem change, DNS, Cloudflare, or paid-quota action was performed.

## Route Inventory

Public:

- `POST /api/v1/auth/login`
- `GET /api/v1/session`
- `GET /internal/health/ready`

Authenticated:

- `POST /api/v1/auth/logout`
- `GET /api/v1/odds/live`
- `GET /api/v1/results`
- `GET /api/v1/backtest`
- `POST /api/v1/predictions`

Explicitly denied legacy routes:

- `/api/import/*`
- `/api/odds`
- `/api/hdc-live`
- `/api/backtest`
- `/api/predictions`
- `/health`

Unsupported known-method paths return safe `405`; unknown paths return safe `404` before auth.

## Security Decisions Implemented

- App is injected and framework-free through `createApp({ repositories, auth, publicOrigin, readinessCheck, clock, logger })`.
- Runtime entry is `server/entry.mjs`; package `server` and `server:self-test` scripts now point there.
- Login sets only `__Host-odds_session` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain`.
- Logout clears the same cookie and revokes the server session.
- `GET /api/v1/session` restores authenticated UI state and rotates a raw CSRF token.
- Mutation routes require exact `Origin` and session-bound `x-csrf-token`.
- New app emits no wildcard CORS.
- JSON body parsing is bounded: 16 KiB for auth and 1 MiB for predictions.
- Malformed JSON returns safe `400`; oversized body returns safe `413`.
- Internal errors return safe `500` with no stack/path/SQL/env leakage.
- Public session responses expose only `username`, `idleExpiresAt`, and `absoluteExpiresAt`.
- Readiness is unauthenticated and injected; production wiring probes PostgreSQL with `SELECT 1`.
- New runtime files contain no provider fetch, importer route, or `child_process` invocation.

## Review

Formal review found these Important issues:

- `/internal/health/ready` was behind owner auth and did not prove DB/app readiness.
- Unknown `/api/v1` and later unknown non-API paths could return `401` instead of `404`/`405`.
- Required Task 6 report was missing.

Fixes:

- Readiness moved before auth and now uses injected `readinessCheck`.
- `server/entry.mjs` readiness check runs `SELECT 1`.
- Route inventory now returns `404`/`405` before auth for unsupported paths/methods.
- `GET /unknown` and `GET /api/v1/unknown` are covered.
- Public session output no longer includes session/internal owner identifiers.
- This report records route/security/test/review evidence.

Final reviewer pass reported no Critical or Important issues.

## Controller Verification

Verification results:

- `node --test server/app.test.mjs`: 2/2 passed.
- `npm.cmd run server:self-test`: passed through `server/entry.mjs`.
- `node --test server/auth/auth.test.mjs`: 13/13 passed.
- `node --test server/db/migrate.test.mjs`: 16/16 passed.
- `node --test server/db/repositories.test.mjs`: 11/11 passed.
- `node --test scripts/legacy-import.test.mjs`: 6 passed / 1 skipped because Windows symlink privilege is unavailable.
- `node --test server/domain/backtest.test.mjs`: 8/8 passed.
- `npm.cmd run test`: 22 files / 139 tests passed.
- `npm.cmd run check:data`: passed with 183 snapshots, 853 results, 180 legacy/backfilled snapshots missing `commenceTime`, 3 valid current, 93 legacy, 87 invalid.
- `npm.cmd run build`: passed.
- `npm.cmd audit --audit-level=high`: found 0 vulnerabilities.
- Test DB leftover schema check: `task6_%` returned `[]`.

## Archive Hashes

Archive hashes remained unchanged:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `data/background-hdc-snapshots.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `data/background-result-archive.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `public/hkjc-odds.json`: `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

## Known Limitations

- `server/http/body.mjs` returns safe `413` for oversized bodies but does not explicitly destroy the request stream, to preserve stable JSON responses in the current Node test harness. This is fail-closed but can be tightened later.
- The old `server.mjs` legacy router code still exists below an early handoff because Windows refused delete/replace through `apply_patch`. It is neutralized for normal execution: package scripts use `server/entry.mjs`, and direct non-self-test `node server.mjs` imports `server/entry.mjs` before parking. Remove or replace `server.mjs` with a tiny shim when file deletion/replacement is unblocked.
- Frontend still calls legacy/local endpoints; authenticated `/api/v1` browser migration is Task 7.
