# Task 5 Report: Owner Auth, Sessions, CSRF, and Login Throttle

## Scope

Implemented the Phase 1 owner-only authentication foundation for the production API/Postgres path:

- Approved Argon2id password hashing and verification.
- Owner username/password validation.
- DB-backed session and CSRF token lifecycle using digest-only storage.
- DB-backed login throttling for account and IP scopes.
- Owner bootstrap CLI and password benchmark CLI.
- PostgreSQL auth invariants in migration `003_auth_constraints.sql`.
- Exact dependency pinning for direct auth/database runtime dependencies.

No archive files, model parameters, paid API calls, or VM filesystem state were modified.

## Files Changed

- `server/auth/password.mjs`
- `server/auth/session.mjs`
- `server/auth/login-throttle.mjs`
- `server/auth/auth-service.mjs`
- `server/auth/auth.test.mjs`
- `scripts/create-owner.mjs`
- `scripts/benchmark-password.mjs`
- `db/migrations/003_auth_constraints.sql`
- `package.json`
- `package-lock.json`

## Security Decisions Implemented

- Password policy: minimum 14 Unicode code points.
- Password hashing: Argon2id v19, memoryCost 19456 KiB, timeCost 2, parallelism 1, outputLen 32.
- Approved password hashes must match the exact Argon2id PHC shape and parameters.
- Missing, disabled, malformed-hash, and wrong-password owners return the same generic login result.
- Missing, disabled, and malformed-hash owner paths verify against `DUMMY_PASSWORD_HASH` to preserve one real Argon2 verification path.
- Login throttle uses HMAC-SHA256 scope keys derived from an injected 32-byte-or-longer secret.
- Account and IP scopes lock in sorted order inside one transaction.
- 5 failures in a 15-minute window create a 30-minute cooldown, with exact boundary tests.
- Session and CSRF raw tokens are 32-byte random base64url strings.
- Database stores only SHA-256 digests for session and CSRF tokens.
- Sessions use 14-day idle expiry and 30-day absolute expiry; exact expiry boundaries are invalid.
- Owner bootstrap rejects argv and `OWNER_PASSWORD`, accepts a password file or hidden TTY prompt, uses a transaction-scoped advisory lock, refuses overwrites, and sanitizes failure output.
- Owner bootstrap treats post-commit cleanup/output failures as success once the owner row is durable.

## Review

Formal review subagent found two Important issues:

- Post-commit owner bootstrap cleanup/output failure could be reported as `status=failed`.
- Enabled owner rows with malformed `password_hash` could take a cheaper verify path.

Both were fixed and re-reviewed. Follow-up review reported no Critical or Important findings.

Remaining reviewer suggestions were resolved:

- Added this Task 5 report.
- Pinned `@node-rs/argon2` to `2.0.2` and `pg` to `8.22.0`.

## Controller Verification

All commands used the approved disposable PostgreSQL URL:

`postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test`

Verification results:

- `node --test server/auth/auth.test.mjs`: 13/13 passed.
- `node --test server/db/migrate.test.mjs`: 16/16 passed.
- `node --test server/db/repositories.test.mjs`: 11/11 passed.
- `node --test scripts/legacy-import.test.mjs`: 6 passed / 1 skipped because Windows symlink privilege is unavailable.
- `node --test server/domain/backtest.test.mjs`: 8/8 passed.
- `npm.cmd run test`: 22 files / 139 tests passed.
- `npm.cmd run server:self-test`: passed.
- `npm.cmd run check:data`: passed with 183 snapshots, 853 results, 180 legacy/backfilled snapshots missing `commenceTime`, 3 valid current, 93 legacy, 87 invalid.
- `npm.cmd run build`: passed.
- `npm.cmd audit --audit-level=high`: found 0 vulnerabilities.
- `npm.cmd run auth:benchmark`: passed; latest observed elapsedMs=15 for approved config.
- Test DB leftover schema check: `task5_%` returned `[]`.
- Secret scan for posted VM password, VM IP, and `THE_ODDS_API_KEY`: no matches in reviewed production/source paths.

## Archive Hashes

Archive hashes remained unchanged:

- `data/prediction-snapshots.jsonl`: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/result-archive.jsonl`: `DF9B758D5EA22BA656B97B3C78F366F3120EBC4D6BFDA6F535AE0CE94DFBA424`
- `data/background-hdc-snapshots.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `data/background-result-archive.jsonl`: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`
- `public/hkjc-odds.json`: `2B33822E22AEF9C112287C56613401774592313DE047DC5FF16699D8BBF2EB8E`

## Known Limitations

- No HTTP cookie/API route wiring is implemented in Task 5; that belongs to Task 6.
- The VM test tunnel was restarted locally after the previous tunnel exited. No VM filesystem or existing services were modified during Task 5 controller verification.
- There is still no usable Git metadata, so evidence is recorded in this report and the progress ledger.
