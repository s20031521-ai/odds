# Task 6 Brief: Secure Injected `/api/v1` Application

## Objective

Replace the legacy file-backed router surface with a small injected same-origin `/api/v1` Node HTTP application, while keeping Task 7 frontend migration separate.

The implementation must not call providers, run importers, mutate archives, or spend quota. It must be test-first and review-gated.

## Scope

Create:

- `server/http/body.mjs`
- `server/http/cookies.mjs`
- `server/http/responses.mjs`
- `server/http/security.mjs`
- `server/app.mjs`
- `server/app.test.mjs`
- `.superpowers/sdd-production-phase1/task-6-report.md`

Modify:

- `server.mjs`
- `package.json` only if a script is genuinely needed

Do not modify frontend files in Task 6 except if a server-only test requires reading them. Frontend auth/API migration is Task 7.

## Existing Interfaces

Use existing modules:

- `loadServerConfig(env)` from `server/config.mjs`.
- `createPool(databaseUrl)` from `server/db/pool.mjs`.
- `runMigrations(pool, migrationsDir)` from `server/db/migrate.mjs`.
- `createSnapshotRepository(pool)`.
- `createResultRepository(pool)`.
- `createOddsRepository(pool)`.
- `createAuthService({ pool, throttleSecret, clock, randomBytes })`.
- Domain `buildBacktest`, `buildHealth` if needed.

Create this app interface:

```js
createApp({ repositories, auth, publicOrigin, clock, logger }) -> (req, res) => Promise<void>
```

Recommended repository shape:

```js
repositories = {
  snapshots,
  results,
  odds,
}
```

## Required Route Contract

Public routes:

- `POST /api/v1/auth/login`
- `GET /api/v1/session`

Authenticated routes:

- `POST /api/v1/auth/logout`
- `GET /api/v1/odds/live`
- `GET /api/v1/results`
- `GET /api/v1/backtest`
- `POST /api/v1/predictions`

Internal route:

- `GET /internal/health/ready` may exist only as a DB/app readiness check and must not expose secrets. If private-listener enforcement cannot be implemented cleanly before Phase 2 listener config exists, keep it minimal and document the limitation in the report.

Legacy routes must return 404:

- `/api/import/*`
- `/api/odds`
- `/api/hdc-live`
- `/api/backtest`
- `/api/predictions`
- `/health`

No route may invoke `child_process`, `fetch` to providers, or importer scripts.

## Auth and Cookie Requirements

- Session cookie name: `__Host-odds_session`.
- Cookie attributes on login: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`.
- Logout clears the same cookie and revokes the DB session idempotently.
- `GET /api/v1/session` with a valid cookie returns authenticated session state and a newly rotated raw CSRF token from `auth.issueCsrf(session.id)`.
- Protected routes without a valid session return 401 with a safe JSON body.
- Mutation routes, including logout and predictions, require exact `Origin: {publicOrigin}` and valid session-bound CSRF header.
- Use one explicit CSRF header name, preferably `x-csrf-token`.
- Do not reflect arbitrary cookie input.
- No `Access-Control-Allow-Origin: *` anywhere.

## Body and Error Requirements

- Parse JSON bodies by streaming and counting bytes.
- Auth body limit: 16 KiB.
- Prediction body limit: 1 MiB.
- Oversized bodies fail closed with safe 413 JSON.
- Malformed JSON returns safe 400 JSON.
- Internal errors return safe 500 JSON without stack, path, SQL, env, or filesystem details.
- Unsupported method/path returns safe 404/405 as appropriate.

## Data Route Requirements

- `/api/v1/odds/live` returns live odds from `repositories.odds.listLive(now)`.
- `/api/v1/results` returns `{ resultEntries }` from `repositories.results.listAll()`.
- `/api/v1/backtest` runs extracted pure domain logic over DB-backed snapshot/result repositories and returns the same backtest shape as current domain output.
- `/api/v1/predictions` accepts one snapshot or an array, uses `repositories.snapshots.insertBatch`, and preserves immutable/pre-kickoff/current-model validation already enforced by repository/policy. It must expose inserted/rejected counts without leaking raw internals.

## Required RED Tests

`server/app.test.mjs` must start the injected app on an ephemeral local port and cover at least:

- unauthenticated login/session/minimal liveness;
- authenticated session refresh returns newly rotated CSRF after reload;
- 401 for odds/results/backtest/predictions without a session;
- login cookie exact attributes;
- authenticated odds/results/backtest response shapes using fake repositories or disposable DB fixtures;
- logout revocation and cookie clearing;
- exact Origin and session-bound CSRF required on predictions/logout;
- malformed JSON;
- auth body over 16 KiB;
- prediction body over 1 MiB;
- invalid/duplicate/post-kickoff prediction batches;
- safe 4xx/5xx bodies without stack/path/SQL leakage;
- no wildcard CORS;
- all legacy routes listed above return 404;
- no route invokes `child_process` or provider `fetch`.

Use dependency injection and local fake repositories for HTTP contract tests unless a specific route needs the real disposable DB. Do not start VM/SSH/provider work inside the implementer.

## Verification Gates

Controller will run:

- `node --test server/app.test.mjs`
- `node --test server/auth/auth.test.mjs`
- `node --test server/db/migrate.test.mjs`
- `node --test server/db/repositories.test.mjs`
- `node --test scripts/legacy-import.test.mjs`
- `node --test server/domain/backtest.test.mjs`
- `npm.cmd run server:self-test`
- `npm.cmd run check:data`
- `npm.cmd run test`
- `npm.cmd run build`
- `npm.cmd audit --audit-level=high`
- archive SHA-256 comparison

## Report Requirements

Create `.superpowers/sdd-production-phase1/task-6-report.md` with:

- route inventory;
- security decisions;
- test results;
- review findings/fixes;
- known limitations;
- archive hashes unchanged.
