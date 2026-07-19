# Phase 2: Isolated VM Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the completed Phase 1 application as a secure, single-owner production service at `https://odds.ballballchu.com.hk` on the company Ubuntu VM (`10.80.10.85`), using an independent `/opt/odds-tool` Compose stack (caddy, api, postgres, collector, cloudflared, backup), without changing any model, settlement, Kelly, ROI, or threshold behavior.

**Architecture:** Approved design: `docs/superpowers/specs/2026-07-18-production-postgres-deployment-design.md`. Request path: Browser/PWA → Cloudflare edge → dedicated outbound tunnel → `caddy` (private Compose network) → static PWA + same-origin `/api/v1` → `api:8787` → `postgres` (database-only network). `collector` runs the existing quota-aware scripts in `STORAGE_BACKEND=postgres`. No application or database host ports are published; the only inbound path is the outbound tunnel. Cloudflare Tunnel and DNS are created **last**, after private-network smoke tests pass.

**Tech Stack:** Docker Engine 29.6.1 + Compose 5.3.1 (already on VM), Node.js 24 ESM, PostgreSQL 18, Caddy 2, cloudflared, Docker secrets.

**Phase 1 contract:** `.superpowers/sdd-production-phase1/final-report.md` — schema migration version **003**, port **8787**, env/secret names, readiness exposure rule, cutover preconditions, trusted-proxy decision (§7b), archive hashes (§9). This plan implements that contract; it does not renegotiate it.

## Global Constraints

- No model retuning, threshold reduction, Kelly changes, settlement changes, ROI changes, or manufactured picks. `BUY_EDGE_THRESHOLD` stays `0.03`.
- **No paid-provider quota spend** from smoke tests, health checks, migrations, CI, or browser startup. The paid collector stays disabled until explicitly enabled by the owner after go-live; smoke tests use single-run/dry discipline with fixture-level verification where possible.
- JSON/JSONL archives are **immutable**: record SHA-256 before and after every task that touches them (baseline hashes: final-report §9).
- Existing VM Compose projects (`astra`, `store-network-dashboard`) must remain untouched and healthy; the odds-tool stack never joins their networks or reuses their tunnel/credentials.
- Secrets appear as **names only** in every file, log, and report: `DATABASE_URL` composition parts, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ODDS_API_KEY`, `API_FOOTBALL_KEY`, tunnel token, owner password. Docker-mounted secrets under `/opt/odds-tool`; nothing in images, git, or `VITE_` variables.
- Every task is **fail-closed**: a failed gate stops before the next trust boundary opens. No public exposure until private smoke passes.
- The disclosed VM SSH password is treated as compromised (Task 0 precondition).
- This workspace has no usable Git metadata; record task reports under `.superpowers/` instead of pretending commits exist.

---

### Task 0: VM preconditions and safety inventory

**Files:**
- Create: `.superpowers/sdd-production-phase2/task-0-report.md`
- (VM-side only; no repo files)

**Interfaces:**
- Produces: verified SSH key access, rotated password, inventory of existing stacks, and a restore point before any odds-tool change.

- [x] **Step 1: Verify SSH key authentication for the `hugo` account in a second independent session**

Generate/install the key, confirm key-only login works from a fresh session, then rotate the current password. Disable SSH password authentication **only after** key login is independently verified. Keep direct root login disabled and preserve a VMware console recovery path before touching SSH config. This is an explicitly owner-confirmed operational action, executed by the owner/operator, not autonomously.

- [x] **Step 2: Inventory existing VM stacks**

Record `docker compose ls`, running containers, networks, volumes, and published ports for `astra` and `store-network-dashboard`. Confirm Docker Engine 29.6.1 / Compose 5.3.1 are active. Confirm outbound HTTPS (tunnel) reachability from the VM.

- [x] **Step 3: Snapshot/backup anything the new stack will touch**

Create `/opt/odds-tool` (empty) and take a VM snapshot or filesystem-level backup of any pre-existing content under that path; verify free disk ≥ 20 GiB of the ~61 GiB available. Record the restore point in the task report.

**Gate:** key-only SSH login verified from a second session; password rotated; existing stacks listed and confirmed healthy; restore point recorded. **Fail-closed:** if key login cannot be verified, stop — do not disable password auth, do not proceed to any deployment task.

---

### Task 1: Compose stack skeleton — postgres, networks, volumes, secrets

**Files:**
- Create: `deploy/compose.yaml`
- Create: `deploy/secrets/README.md` (names and creation procedure only, never values)
- Create: `deploy/postgres/init/01-roles.sql` (least-privilege app role; migration/backup roles separate)
- Create: `.superpowers/sdd-production-phase2/task-1-report.md`

**Interfaces:**
- Compose project `odds-tool` with three networks: `tunnel_net` (cloudflared ↔ caddy), `app_net` (caddy ↔ api ↔ collector), `db_net` (api, collector, migration, backup ↔ postgres). One named volume `pgdata`. No `ports:` on any service.
- Secret names (files under `/opt/odds-tool/secrets`, mode 0400, owner root): `pg_app_password`, `pg_migration_password`, `session_secret`, `odds_api_key`, `api_football_key`, `owner_password`, `cloudflared_tunnel_token`. `DATABASE_URL` is composed at runtime from the app role + secret, never stored whole.

- [x] **Step 1: Author compose.yaml with postgres first**

Pin `postgres:18` to a specific patch digest at implementation time. Database-only network attachment, named volume, no published port, healthcheck (`pg_isready`), restart policy, bounded log rotation, memory limits consistent with the < 3 GiB stack target.

- [x] **Step 2: Create the secrets directory and role init SQL**

`01-roles.sql` creates the least-privilege application role (CRUD on application tables only) and a separate migration role (DDL); passwords come from mounted secrets at bootstrap, not from the SQL file.

- [x] **Step 3: Boot postgres alone and validate**

`docker compose -f deploy/compose.yaml config` validates; bring up only the postgres service; confirm it is unreachable from the VM host (`ss -tlnp` shows no new listener) and reachable only from `db_net`. Run `db/migrations` 001–003 via a one-shot migration container on `db_net` using the migration role; confirm schema version 003.

**Gate:** postgres healthy on `db_net` with schema 003; zero published host ports; `docker compose config` clean. **Fail-closed:** any published port or failed migration → tear down the stack, fix, re-run; do not start dependent services.

---

### Task 2: Application images and Caddy edge (incl. `/internal/*` deny + trusted-proxy decision)

**Files:**
- Create: `deploy/api.Dockerfile` (Node 24, non-root user, production deps only)
- Create: `deploy/web.Dockerfile` (multi-stage: `npm run build` → static `dist/`)
- Create: `deploy/Caddyfile`
- Modify (only if Decision D2-A is taken): `server/config.mjs`, `server/app.mjs` + tests — strict TDD
- Create: `.superpowers/sdd-production-phase2/task-2-report.md`

**Interfaces:**
- `api` image: `node:24` base, runs `server/entry.mjs`, binds `0.0.0.0:8787` **inside the container only** (no published port), env `DATABASE_URL` (composed from secret), `SESSION_SECRET`, `PUBLIC_ORIGIN=https://odds.ballballchu.com.hk`, `NODE_ENV=production`. Non-root where practical.
- `web` image: builds the PWA `dist/`; served by caddy.
- Caddyfile responsibilities:
  1. Serve static PWA, proxy `/api/v1/*` → `api:8787`.
  2. **Deny `/internal/*` at the public route** (Phase 1 review blocker / final-report §3) — respond 404; `/internal/health/ready` reachable only inside the Compose networks.
  3. Security headers: HSTS, `X-Content-Type-Options`, restrictive CSP, `Referrer-Policy`, frame denial.
  4. No public VM socket; Cloudflare terminates public HTTPS.

- [x] **Step 1: Decide the trusted-proxy question (final-report §7b) — DECISION POINT**

The login throttle reads `req.socket.remoteAddress`; behind caddy/cloudflared every request shares one IP scope, so 5 failures from anyone would cooldown everyone, and 5 failures on the owner username lock the owner account.

- **D2-A (recommended default):** implement trusted-proxy support — caddy passes `X-Forwarded-For`; the API trusts it **only** when the peer address belongs to the Compose `app_net` range (direct origin access is already impossible: no published ports). Strict TDD: failing tests first (spoofed header from untrusted peer ignored; forwarded IP used for throttle scope when peer is the proxy), then minimal code change, then re-run the full Phase 1 verification matrix and the black-box probe table.
- **D2-B (documented acceptance):** keep the single-bucket throttle and record the owner-lockout risk + operational unlock procedure (clear `login_attempts` via migration role) in the production runbook.

Record the decision and evidence in the task report. Default to D2-A unless the owner rules otherwise.

- [x] **Step 2: Build images and wire the stack**

Add `web`, `api`, and `caddy` services to `deploy/compose.yaml` with healthchecks, restart policies, log rotation, and resource limits. `api` healthcheck uses `GET /internal/health/ready` from inside the network. Verify no secrets in image layers (`docker history`, env inspection) and no loopback URLs in the built frontend bundle.

- [x] **Step 3: Verify the Caddy edge inside the private network**

From a throwaway container on `app_net`: static PWA loads; `/api/v1/session` returns `{"authenticated":false}`; `/internal/health/ready` through caddy → **404**; direct `api:8787/internal/health/ready` → 200; security headers present on responses.

**Gate:** images build reproducibly; `/internal/*` denied at caddy (404) while reachable inside the network; no secrets in images; trusted-proxy decision recorded with tests (D2-A) or runbook acceptance (D2-B). **Fail-closed:** if `/internal/*` leaks through caddy, the stack does not proceed to migration or tunnel tasks.

---

### Task 3: Archive bundle migration into production PostgreSQL

**Files:**
- Create: `deploy/migration-bundle/.gitkeep` (procedure documented; bundle itself stays out of any VCS)
- Create: `.superpowers/sdd-production-phase2/task-3-report.md`

**Interfaces:**
- Dated, read-only migration bundle on the VM containing the 9 archive files; importer/parity/integrity run against **production** PostgreSQL via the migration role.

- [x] **Step 1: Copy archives to the VM read-only and hash**

`sha256sum` locally, copy `data/*.jsonl data/*.json public/hkjc-odds.json` into a dated bundle directory, `chmod -R a-w`, hash again on the VM. Both listings must match final-report §9 exactly (re-computed at execution time, not assumed).

- [x] **Step 2: Import, re-import, parity, integrity**

One-shot containers on `db_net`:
1. `node scripts/import-legacy-to-postgres.mjs --source-root <bundle>` → expect 96 snapshots inserted, 87 invalid → audit, 853 results.
2. Same command again → every file `already-complete`, zero additions.
3. `node scripts/check-postgres-parity.mjs --source-root <bundle>` → `status=ok`, 183/853, 3 valid-current / 93 legacy / 87 invalid, distinctMatches=286, settlements=0.
4. `node scripts/check-data-integrity.mjs --database` → exit 0, all failure counters 0.

- [x] **Step 3: Archive hash verification after migration**

`sha256sum` the bundle and the local originals; byte-identical to Step 1.

**Gate:** parity `status=ok` with the exact Phase 1 numbers; integrity exit 0; hashes unchanged. **Fail-closed:** any mismatch leaves production traffic disabled (no tunnel), source files untouched; investigate before retry.

---

### Task 4: Owner bootstrap inside the stack

**Files:**
- Create: `.superpowers/sdd-production-phase2/task-4-report.md`

**Interfaces:**
- One-time `node scripts/create-owner.mjs` run in a one-shot api container on `db_net`.

- [x] **Step 1: Create the owner**

`OWNER_USERNAME` + `OWNER_PASSWORD_FILE` (mounted secret, deleted from the secrets directory immediately after success). Password ≥ 14 chars, entered via the secret file — never CLI, logs, or reports. Verify exactly one row in `owners`.

- [x] **Step 2: Verify login end-to-end privately**

From a throwaway container on `app_net`: wrong password → generic 401; correct password → 200 + `__Host-odds_session` cookie with the Phase 1 flags; logout revokes. Then clear the test `sessions`/`login_attempts` rows.

**Gate:** single owner exists; login/logout verified privately; owner password file deleted; throttle/session test rows cleaned. **Fail-closed:** bootstrap failure → no tunnel task; investigate with the migration role.

---

### Task 5: Private-network smoke tests (before any tunnel)

**Files:**
- Create: `.superpowers/sdd-production-phase2/task-5-report.md`

**Interfaces:**
- Black-box probe table re-run from inside `app_net` against caddy, mirroring the Phase 1 Step 2 table.

- [x] **Step 1: Security probes**

Unauthenticated denial on all four protected routes; login; cookie flags; Origin/CSRF matrix on logout; body limits (16 KiB / 1 MiB); malformed JSON safe errors; unknown route 404 / wrong method 405; legacy paths 404; `/internal/*` 404 through caddy. Expected results identical to the Phase 1 probe table.

- [x] **Step 2: Data probes**

Authed `GET /api/v1/results` and `/api/v1/backtest` return the imported 853 results and parity-consistent backtest output (3 valid-current snapshots, 0 settlements); `GET /api/v1/odds/live` returns a valid (possibly empty) payload.

- [x] **Step 3: Collector posture check (no paid quota)**

Confirm `collector` service starts with `STORAGE_BACKEND=postgres`, `NODE_ENV=production`, provider keys mounted as secrets, and the paid cycle **disabled by default** (explicit enable flag/schedule left off). Prove startup runs no provider call: run each collector's `--self-test` inside the container (offline) and verify the service makes zero outbound provider connections while disabled. A single owner-approved one-shot collector run (e.g. one `hkjc-import` cycle) may be executed to prove the pg write path, with quota headers recorded — nothing beyond that until go-live.

- [x] **Step 4: PWA shell check**

Static shell loads over the private network; service worker registers; no runtime caching of API/JSON (re-verify against the built `dist/sw.js`).

**Gate:** every probe matches the Phase 1 table; collector spends zero paid quota while disabled; PWA loads. **Fail-closed:** any failure → stack stays private; no tunnel credentials are created.

---

### Task 6: Cloudflare Tunnel + DNS (LAST), then public verification

**Files:**
- Create: `deploy/cloudflared/config.yaml` (ingress: hostname → caddy; catch-all 404)
- Create: `.superpowers/sdd-production-phase2/task-6-report.md`

**Interfaces:**
- Dedicated `cloudflared` service with its own tunnel token secret; routes only `odds.ballballchu.com.hk` → `caddy`; catch-all ingress returns 404. Shares no credentials or failure domain with the existing Astra tunnel.

- [x] **Step 1: Create the dedicated tunnel and DNS route**

Owner-approved Cloudflare action: create the `odds-tool` tunnel, store the token as a Compose secret, create the `odds.ballballchu.com.hk` DNS route. `10.80.10.85` must never appear as a public A record.

- [x] **Step 2: Public verification matrix**

Through `https://odds.ballballchu.com.hk`: unauthenticated protected routes → 401; login works; cookie flags intact over HTTPS; unknown hostname/path → tunnel 404 fallback; PWA installable and functional on **desktop, iPhone, and iPad** viewports with authenticated Dashboard/Fixtures/History/Model-Health flows; `/internal/*` → 404 publicly.

- [x] **Step 3: Exposure audit**

`ss -tlnp` on the VM: no new application/database host listeners; `docker port` empty for all services; existing `astra`/`store-network-dashboard` stacks confirmed healthy and unchanged.

- [x] **Step 4: Enable the paid collector (explicit owner action)**

Only after Steps 1–3 pass and the owner explicitly approves: enable the collector schedule. Record quota headers from the first cycles.

**Gate (Phase 2 gate per the design):** unauthenticated data access denied publicly; authenticated desktop/iPhone/iPad flows pass; no app/DB host ports published; existing VM stacks healthy. **Fail-closed:** any exposure or auth failure → disable the tunnel route (traffic returns to 404) while preserving the stack for diagnosis.

---

### Task 7: Production deployment runbook

**Files:**
- Create: `docs/runbooks/production-deployment.md`
- Create: `.superpowers/sdd-production-phase2/task-7-report.md`

**Interfaces:**
- Operator-facing runbook covering: deploy procedure (pin image digests, `docker compose up -d --no-deps` per service), readiness checks (`/internal/health/ready` from inside the network, caddy 404 check, public smoke subset), log access (`docker compose logs`, rotation limits), rollback procedure, and secret rotation procedure.

- [ ] **Step 1: Write deploy + readiness sections**

Exact commands, expected outputs, and the order (postgres → migrate → api/web/caddy → smoke → cloudflared).

- [ ] **Step 2: Write the rollback section**

Rollback runs a **tested previous image**; database migrations are never reversed blindly — restore the verified pre-deploy backup per the migration runbook if the previous image is incompatible. Include the tunnel-disable step as the fastest exposure kill-switch.

- [ ] **Step 3: Rehearse rollback once**

Deploy the stack, roll back to the previous api image, confirm the previous release serves and readiness passes, roll forward again. Record evidence.

**Gate:** runbook complete; rollback rehearsed with evidence. **Fail-closed:** no go-live claim without a rehearsed rollback.

---

## Explicitly out of scope (Phase 3)

- Restic encrypted S3-compatible backups, daily schedule, retention pruning, and the monthly **restore rehearsal** (the `backup` service is declared in the design but implemented in Phase 3; Phase 2 relies on the Task 0/3 restore points and does not claim backup coverage).
- Private GitHub repository, secret scan, CI pipeline, GHCR image publishing, image vulnerability scanning, and manual-approval deployment automation.
- No MFA, multi-user, signup, push notifications, Kubernetes, Redis, or public database access.

## Required external inputs checklist (from the design spec)

- [x] Cloudflare permission to create a dedicated Tunnel and the `odds.ballballchu.com.hk` DNS route.
- [x] Newly rotated SSH credential + verified SSH public key for the VM (Task 0).
- [x] Owner username/password entered through the internal bootstrap process (Task 4).
- [x] Paid-provider keys supplied as VM secrets (`ODDS_API_KEY`, `API_FOOTBALL_KEY`).
- [ ] (Phase 3 only) S3-compatible endpoint/bucket/region/keys + Restic repository password.
- [ ] (Phase 3 only) Private GitHub repository + deployment approval environment.

## Standing invariants (visible at every task)

- No paid-provider quota except the explicitly owner-approved enablement in Task 6 Step 4 and the optional single one-shot in Task 5 Step 3.
- Archives immutable; SHA-256 before/after every task that touches them.
- No model/threshold/Kelly/settlement/ROI changes anywhere in Phase 2.
- Existing VM stacks (`astra`, `store-network-dashboard`) untouched and verified healthy at Tasks 0, 6.
- Every gate fail-closed: a failed check stops before the next trust boundary opens.

## Plan self-review

- **Spec coverage:** every element of the design's "Phase 2 — Isolated VM deployment" section is assigned: Compose stack (Tasks 1–2), Caddy/`/internal/*` deny + security headers (Task 2), trusted-proxy decision with recommended default D2-A (Task 2 Step 1), archive migration with parity/hashes (Task 3), owner bootstrap (Task 4), private smoke (Task 5), tunnel+DNS last with tunnel 404 fallback (Task 6), rollback/runbook (Task 7), preconditions incl. SSH rotation and Astra/store-dashboard preservation (Task 0), Phase 3 deferrals and external inputs (explicit sections).
- **Phase 1 contract conformance:** schema 003, port 8787, secret names only, readiness exposure rule, cutover preconditions (`STORAGE_BACKEND=postgres`, file mode impossible under `NODE_ENV=production`), I1 price-history limitation (unchanged, accepted), throttle boundary (documented; D2-A optionally changes scoping input only, not thresholds) — all carried, none renegotiated.
- **Scope discipline:** no VM contact, no code changes, and no secrets are produced by this document itself; the only code change contemplated anywhere is the D2-A trusted-proxy patch, gated behind strict TDD and the full Phase 1 matrix.
- **Fail-closed ordering:** SSH → stack → private migration/bootstrap/smoke → tunnel last; every gate names its stop condition; rollback rehearsed before go-live claims.
- **Placeholder scan:** no unassigned requirement remains; Phase 3 items are explicitly excluded rather than silently dropped.
