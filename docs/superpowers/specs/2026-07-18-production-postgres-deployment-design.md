# Odds Tool Production PostgreSQL Deployment Design

## Goal

Deploy the existing responsive Odds Tool PWA as a secure, single-owner production service at `https://odds.ballballchu.com.hk`, hosted on the company's Ubuntu VM without changing the model, settlement rules, Kelly calculations, ROI calculations, or the fixed `0.03` buy threshold.

## Approved deployment target

- Public hostname: `odds.ballballchu.com.hk`.
- VM private address: `10.80.10.85/24`.
- VM operating system: Ubuntu 26.04 LTS on VMware.
- Capacity observed on 2026-07-18: 4 vCPU, 7.2 GiB RAM, 4 GiB swap, 76 GiB root filesystem with approximately 61 GiB available.
- Docker Engine 29.6.1 and Docker Compose 5.3.1 are already installed and active.
- Existing `astra` and `store-network-dashboard` Compose projects must remain untouched.
- The new stack lives under `/opt/odds-tool` and uses its own Compose project, networks, volumes, PostgreSQL database, Cloudflare Tunnel, secrets, logs, backups, and release history.
- The currently working Astra Cloudflare connector proves that outbound Cloudflare Tunnel traffic is permitted, but its tunnel and credentials will not be reused.

## Network and trust boundaries

`10.80.10.85` is an RFC1918 private address and must never be published as a public DNS A record. The external request path is:

```text
Browser / installed PWA
  -> Cloudflare edge for odds.ballballchu.com.hk
  -> dedicated outbound Cloudflare Tunnel
  -> odds-tool Caddy service on the private Compose network
  -> static PWA or same-origin /api/v1 Node API
  -> PostgreSQL on a database-only Compose network
```

- The `cloudflared` service initiates the outbound connection. The company router does not need a public A record, a static public IP, or inbound port forwarding for the application.
- `cloudflared` routes only `odds.ballballchu.com.hk` to the Caddy service. A catch-all ingress rule returns HTTP 404.
- Caddy, Node, PostgreSQL, collector, and backup services publish no host ports. Caddy is reachable only from the tunnel network; PostgreSQL is reachable only from the API, collector, migration, and backup services.
- The only application traffic exposed to the Internet is same-origin HTTPS through Cloudflare. Wildcard CORS is removed.
- The production API binds `0.0.0.0` inside its container, but is not reachable from the VM host or public network through a published port.
- Cloudflare Tunnel and DNS are created only after authentication, database migration, and production smoke tests pass on the private Compose network.

## SSH precondition

The existing public SSH password was supplied in conversation and must be considered disclosed.

Before production exposure:

1. Create and verify an SSH key login for the `hugo` account in a second session.
2. Rotate the current password.
3. Disable SSH password authentication only after key login has been independently verified.
4. Keep direct root login disabled.
5. Preserve a console or VMware recovery path before changing SSH configuration.

These changes are a separate, explicitly confirmed operational action. The design never stores SSH credentials in the repository, Compose files, logs, or reports.

## Compose architecture

The independent `odds-tool` project contains six long-running responsibilities:

### `caddy`

- Serves the built PWA and proxies `/api/v1/*` to `api:8787`.
- Returns security headers including HSTS, `X-Content-Type-Options`, a restrictive Content Security Policy, `Referrer-Policy`, and frame denial.
- Does not terminate a public VM socket; Cloudflare provides the public HTTPS edge and connects through the private tunnel network.

### `api`

- Runs the Node API and domain services.
- Exposes health endpoints to Caddy and Compose only.
- Uses PostgreSQL repositories rather than JSON/JSONL files.
- Never spawns collectors or paid-provider importers from a public route.

### `postgres`

- PostgreSQL 18, pinned to a specific image patch version during implementation.
- Uses a named volume and database-only network.
- Has no published port.
- Uses a least-privilege application role; migration and backup credentials are separate.

### `collector`

- Runs the existing quota-aware collection policies inside the VM.
- Performs HDC discovery on the existing three-minute cadence and preserves the existing HKJC/focused-market cadence.
- Uses PostgreSQL transactions and advisory locks so only one collector cycle can write at a time.
- Reads paid-provider keys only from mounted secrets.
- Is not reachable over HTTP from outside the private Compose network.

### `cloudflared`

- Uses a dedicated `odds-tool` tunnel token or credentials file supplied as a Compose secret.
- Routes `odds.ballballchu.com.hk` to Caddy.
- Shares no credentials or failure domain with the existing Astra tunnel.

### `backup`

- Creates an encrypted PostgreSQL backup and Restic snapshot to an S3-compatible bucket every day.
- Performs retention pruning and scheduled restore verification.
- Has read-only access to immutable legacy archive copies and the minimum PostgreSQL backup permissions.

All services use restart policies, health checks, bounded log rotation, and explicit resource limits appropriate for the audited VM. The design target is below 3 GiB steady-state memory for the complete new stack.

## Same-origin API contract

The frontend stops using `http://127.0.0.1:8787`. All browser requests use relative `/api/v1` URLs.

Unauthenticated same-origin endpoints are limited to:

- `POST /api/v1/auth/login`
- `GET /api/v1/session`
- `GET /api/v1/health/live`

`GET /api/v1/session` returns only authentication state when no valid session exists. The public liveness response contains no database, migration, provider, path, version, or secret detail.

Authenticated browser endpoints include:

- `POST /api/v1/auth/logout`
- `GET /api/v1/odds/live`
- `GET /api/v1/results`
- `GET /api/v1/backtest`
- `POST /api/v1/predictions`

`GET /internal/health/ready` is reachable only inside the Compose network for Caddy and container health checks; Caddy does not route `/internal/*` from the public hostname.

The static `public/hkjc-odds.json` data feed is removed from the public build and replaced by the protected live-odds endpoint. Collector/importer execution has no public endpoint.

API errors use stable codes and safe messages. Internal exceptions, paths, SQL, provider responses, and secrets are logged server-side but never returned to browsers. JSON body limits are 16 KiB for authentication and 1 MiB for prediction batches. Malformed JSON, oversized bodies, invalid fields, duplicate submissions, and post-kickoff snapshots fail closed.

## Single-owner authentication

- There is one pre-provisioned owner account and no signup route.
- The owner is created through a one-time internal CLI after the database is ready.
- Passwords require at least 14 characters and are hashed with Argon2id using implementation-time parameters that meet the current OWASP minimum and are benchmarked on this VM.
- Authentication uses a cryptographically random opaque session token. Only a SHA-256 hash of the token is stored in PostgreSQL.
- The cookie is named `__Host-odds_session` and is `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, with no `Domain` attribute.
- Sessions expire after 14 days of inactivity and 30 days absolute. Logout revokes the server-side session.
- Login is rate-limited by both account and trusted client IP: five failures in fifteen minutes cause a thirty-minute cooldown.
- Authenticated mutation requests require a session-bound CSRF token and an exact same-origin `Origin` check.
- `CF-Connecting-IP` is trusted only because the API is reachable solely through the dedicated tunnel/Caddy network. Direct host exposure is prohibited.
- No MFA, multi-user roles, public invitations, password reset email, social login, or API tokens are included in production v1.

## PostgreSQL source of truth

PostgreSQL replaces JSON/JSONL files as the production write target. The schema is split by responsibility:

- `owners`: owner identity, Argon2id password hash, status, and timestamps.
- `sessions`: token hash, owner reference, CSRF hash, creation, last-seen, expiry, and revocation timestamps.
- `prediction_snapshots`: the existing immutable prediction fields, model version, saved time, kickoff, source, snapshot classification, and raw JSONB.
- `results`: match/market result identity, actual outcome, source priority, completion time, and raw JSONB.
- `live_odds`: provider/market/line identity, numeric prices, fixture aliases, observed time, expiry, and raw JSONB.
- `collector_state`: quota, cooldown, discovery, retry, and last-success state.
- `import_runs`: source filename, SHA-256, importer version, counts, status, and timestamps.
- `import_rows`: source file hash, source row number, idempotency key, accepted classification or rejection reason, and raw JSONB.

Unique constraints encode the same versioned snapshot, result, and provider-market identities currently enforced by the integrity checker. Accepted rows are inserted with idempotent conflict handling; immutable prediction rows are never silently updated.

## Legacy archive migration

The local archives remain the audit baseline and are never rewritten during migration.

1. Copy the source files to a dated, read-only migration bundle and record SHA-256 hashes.
2. Run the existing integrity checker against the bundle.
3. Import rows idempotently into a non-production PostgreSQL database.
4. Preserve every legacy and invalid classification, including missing `commenceTime`; invalid rows remain queryable for audit but cannot enter current-model readiness, hit-rate, ROI, or active-buy calculations.
5. Re-run the importer and prove zero new rows.
6. Compare source counts, idempotency keys, classifications, distinct matches, readiness, settlement, hit-rate, ROI, and backtest output with the file-backed baseline.
7. Import into production only after parity succeeds.

The approved current baseline is 183 prediction snapshots and 853 results. The exact file hashes are captured again immediately before migration rather than assumed from documentation.

## Collector migration

- Existing provider parsing, quota reserve, cooldown, kickoff windows, fixture matching, snapshot policy, and settlement logic are reused.
- File writes are replaced with repository calls inside PostgreSQL transactions.
- PostgreSQL advisory locks replace process-local or filesystem-only overlap protection.
- A collector failure does not erase the last valid live data or mark it fresh.
- Each provider and market records last attempt, last success, data age, error category, and quota state.
- Browser startup never triggers paid-provider requests.
- Automated tests use fixtures and network denial; CI cannot access paid provider endpoints.

## Backups and restore

- Restic encrypts backups before upload to an S3-compatible repository.
- Required deployment inputs are the S3 endpoint, region, bucket, access key, secret key, and Restic repository password. These are mounted as secrets and never committed.
- Daily backup time is 02:30 `Asia/Hong_Kong`.
- Retention is seven daily, four weekly, and six monthly snapshots.
- A database dump is validated before upload. A failed dump, upload, prune, or integrity check exits non-zero.
- A monthly restore rehearsal restores the newest backup into an isolated temporary database, runs migrations, integrity checks, row-count checks, and a representative backtest parity check, then removes the temporary database.
- Backup success is not claimed until a restore rehearsal has passed.

## Logging, health, and operations

- Application logs are structured JSON and never contain passwords, cookies, CSRF tokens, provider keys, raw authorization headers, or tunnel credentials.
- Docker logging uses rotation limits so logs cannot consume the VM disk.
- `/api/v1/health/live` proves only that the process event loop is responsive.
- `/internal/health/ready` verifies database connectivity, expected migration version, owner existence, and required collector state without spending provider quota.
- Compose health checks depend on readiness where appropriate.
- Deployments retain the previous application image and migration metadata for rollback decisions.
- Database migrations run only after a verified backup and use a dedicated migration role.

## Private GitHub and CI/CD

The current workspace has no usable Git metadata. Before CI/CD:

1. Initialize a real local Git repository after expanding `.gitignore` for environment files, secrets, database volumes, migration bundles, Playwright output, and production data.
2. Run a secret scan before the first commit. The disclosed SSH password and any `VITE_`-prefixed provider secret must be rotated or removed before history is created.
3. Create a private GitHub repository and push source only; live JSON/JSONL data and secrets are excluded.
4. CI runs unit tests, Playwright, API integration tests, migration parity fixtures, production build, dependency audit, container build, and image vulnerability scanning.
5. Images are published to private GHCR with immutable commit tags.
6. Production deployment requires manual approval and pulls a pinned image digest.

## Delivery phases and gates

### Phase 1 — Application and database hardening

- Add `/api/v1`, repository boundaries, PostgreSQL schema/migrations, owner authentication, CSRF/rate/body limits, protected odds data, and idempotent archive importer.
- Gate: all existing model tests plus new auth/API/migration tests pass; file/DB backtest parity passes; archive hashes remain unchanged.

### Phase 2 — Isolated VM deployment

- Build the independent `/opt/odds-tool` Compose stack, migrate a verified archive bundle, create the owner, run private-network smoke tests, then create the dedicated Cloudflare Tunnel and hostname.
- Gate: unauthenticated data access is denied; authenticated desktop/iPhone/iPad PWA flows pass; no application or database host ports are published; existing VM stacks remain healthy.

### Phase 3 — Backup and delivery automation

- Configure encrypted S3-compatible Restic backups, complete a restore rehearsal, initialize the private GitHub repository, add CI/image scanning, and document manual deployment/rollback.
- Gate: scheduled backup and isolated restore both pass; CI is green; production image digest and rollback procedure are recorded.

## Error handling and rollback

- Every phase is fail-closed and stops before the next trust boundary is opened.
- A failed archive migration leaves source files untouched and production traffic disabled.
- A failed readiness check prevents Cloudflare exposure or removes the new release from service while preserving the previous release.
- Authentication or database failure never falls back to public static odds data.
- Collector failure preserves the last known data as stale and removes active-buy eligibility.
- Rollback never reverses a database migration blindly; the operator either runs a tested compatible previous image or restores the verified pre-deploy backup according to the migration runbook.

## Verification matrix

- Domain/model: existing unit tests, settlement self-tests, threshold invariants, snapshot integrity, distinct-match metrics, and DB/file parity.
- API/security: unauthenticated denial, login success/failure, cooldown, session expiry/revocation, CSRF, Origin, body limits, malformed JSON, safe errors, duplicate and post-kickoff writes.
- Migration: first import, repeated import, invalid/legacy preservation, counts, hashes, identities, backtest/ROI parity.
- Collector: advisory lock, provider timeout/429/quota reserve, stale data, restart recovery, and strict network mocks.
- PWA: existing four responsive viewport projects, login/logout, offline shell, protected data failure, service-worker no-data-cache inspection.
- Infrastructure: Compose config validation, non-root containers where practical, no public ports, health/readiness, secret absence from images/logs, image scan, tunnel 404 fallback.
- Backup: encrypted upload, retention, failed-upload alert status, isolated restore, migrations, integrity and parity.
- Production smoke: authenticated Dashboard, Fixtures/detail, History, Model Health, offline fail-closed behavior, and existing Astra/store-dashboard health.

## Non-goals and invariants

- No model retuning, threshold reduction, Kelly changes, settlement changes, ROI changes, or manufactured picks.
- No paid-provider calls from CI, browser startup, health checks, migrations, or smoke tests.
- No MFA, multiple users, roles, signup, native app, push notification, Kubernetes, Redis, or public database access in production v1.
- Existing JSON/JSONL archives remain immutable audit artifacts after import.
- Production availability is not claimed until authentication, migration parity, private smoke tests, Tunnel routing, encrypted backup, and restore rehearsal all pass.

## Required external inputs at deployment time

- Cloudflare permission to create a dedicated Tunnel and the `odds.ballballchu.com.hk` DNS route.
- A newly rotated SSH credential and verified SSH public key for the VM.
- The owner username and password entered through the internal bootstrap process.
- Paid-provider keys supplied as VM secrets.
- S3-compatible endpoint, bucket, region, access key, secret key, and Restic repository password.
- A private GitHub repository and deployment approval environment for Phase 3.
