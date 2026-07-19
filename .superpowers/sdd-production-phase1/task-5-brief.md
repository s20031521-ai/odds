# Task 5 implementation brief: owner auth, sessions, CSRF, throttle

Implement Task 5 from `docs/superpowers/plans/2026-07-18-production-api-postgres-auth.md` with test-driven development against only the disposable database URL below.

## Safety boundary

- No Git metadata is usable; do not initialize Git or claim commits.
- Do not modify archives, the VM, Astra, Cloudflare, DNS, SSH configuration, or production services.
- Database tests may use only the exact disposable URL `postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test` through the existing loopback tunnel.
- Every real-database test must create a UUID-named schema, set its `search_path`, register cleanup before risky work, and remove it on success or failure.
- Never print a password, raw session token, raw CSRF token, database URL, stack, or filesystem path from a CLI failure.

## Files

- Create `server/auth/password.mjs`
- Create `server/auth/session.mjs`
- Create `server/auth/login-throttle.mjs`
- Create `server/auth/auth-service.mjs`
- Create `server/auth/auth.test.mjs`
- Create `scripts/create-owner.mjs`
- Create `scripts/benchmark-password.mjs`
- Create `db/migrations/003_auth_constraints.sql` if needed to make auth invariants database-enforced
- Modify focused migration tests and `package.json` only as required
- Create `.superpowers/sdd-production-phase1/task-5-report.md`

## Locked security decisions

- Password minimum is 14 Unicode characters. Use `@node-rs/argon2`, Argon2id, version 19, `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, `outputLen: 32`. Export the immutable approved options from one module. Never lower them dynamically.
- The benchmark uses a generated throwaway value, prints only configuration and elapsed milliseconds, and never accepts or logs a password.
- Normalize usernames as `trim().toLowerCase()` and reject empty/invalid username input. Return one generic login failure shape for missing owner, wrong password, and disabled owner. A missing/disabled owner must still execute one real Argon2 verification against a valid dummy hash path.
- Track both account and client-IP throttle scopes. Store only HMAC-SHA-256 scope keys using an injected secret of at least 32 bytes; never persist raw username or IP. Sort scope keys before locking/updating to prevent deadlocks.
- Five failures inside a 15-minute window set a 30-minute cooldown. The fifth request fails and establishes the cooldown. At exactly the window end it is a new window; at exactly `blocked_until` login may proceed. A successful login clears both applicable scope rows.
- Use transactions and row locking/upsert so concurrent failures cannot lose increments or bypass the fifth-attempt block.
- Session and CSRF raw values are independent 32-byte random base64url tokens. Store only their SHA-256 `bytea` digests. Raw values may appear only in the successful login/CSRF-rotation return required by the future HTTP layer and must never be logged or persisted.
- Sessions expire after 14 days idle and 30 days absolute. Authentication at an exact expiry boundary fails. Valid authentication updates `last_seen_at` and slides idle expiry, capped by absolute expiry. Revoked/expired/disabled-owner sessions fail.
- `issueCsrf(sessionId)` rotates the digest only for a currently valid session and returns the fresh raw token once. Provide a constant-time session-bound CSRF verification method for Task 6. `logout(sessionId)` revokes idempotently.
- Inject clock, random bytes, and throttle HMAC secret into the service. The public service must support `login`, `authenticate`, `issueCsrf`, `verifyCsrf`, and `logout` without exposing password hashes or stored token hashes.
- Owner bootstrap reads `DATABASE_URL`, a normalized username from `OWNER_USERNAME`, and password either from an explicitly named `OWNER_PASSWORD_FILE` or a genuinely hidden TTY prompt. Reject all CLI arguments so plaintext cannot be supplied in argv. Require exactly one password source, enforce the password policy, create exactly one owner transactionally, and refuse any overwrite/second owner. Failure output is a fixed sanitized line and nonzero status; success does not reveal credentials.

## Required RED/GREEN coverage

- Password length boundary, exact Argon2id encoding/parameters, correct/wrong verify, and benchmark non-disclosure.
- Generic constant-work missing/wrong/disabled login path.
- Account and IP throttling, fifth failure, 15/30-minute exact boundaries, cooldown expiry, success clearing, concurrent failures, and no raw scope data in DB.
- Token length/randomness/independence, digest-only DB storage, login return allowlist, 14/30-day boundaries, capped sliding expiry, last-seen update, disabled owner, revocation, CSRF rotation and mismatch.
- Owner CLI password-file and injected hidden-prompt flows, argv refusal, existing-owner refusal, atomic concurrency, cleanup, and sanitized output.
- Test errors and cleanup must preserve primary failures.

## Verification

Run focused auth tests first, then migration/repository/domain/import tests, `npm.cmd run test`, `npm.cmd run server:self-test`, `npm.cmd run check:data`, `npm.cmd run build`, and `npm.cmd audit --audit-level=high`. Scan production files for test credentials and confirm no disposable schemas remain. Record exact evidence and archive hashes in the Task 5 report.
