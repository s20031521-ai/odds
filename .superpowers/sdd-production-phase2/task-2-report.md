# Phase 2 Task 2 Report: Application Images and Caddy Edge

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 2.

## Step 1 — Trusted-proxy decision: **D2-A implemented (TDD)**

- `server/http/client-ip.mjs`: `resolveClientIp(socketAddress, xForwardedFor, trustedCidrs)` — trusts `X-Forwarded-For` (leftmost) only when the socket peer is inside a trusted CIDR; malformed/spoofed values fall back to the socket address; `::ffff:` normalization.
- `server/config.mjs`: `TRUSTED_PROXY_CIDRS` (comma-separated CIDRs, malformed → startup error; default empty = trust nothing) and `RUN_MIGRATIONS` (exact `"false"` disables startup migrations).
- `server/app.mjs`: login throttle now resolves client IP through the helper; `server/entry.mjs` passes config and skips migrations when disabled (log line proves it at container start).
- RED→GREEN: `server/config.test.mjs` 5/5, `server/http/client-ip.test.mjs` 7/7, `server/app.test.mjs` trusted/untrusted proxy cases 3/3.
- Gates after code change: node tests 29/29 + DB-backed suites re-run through the disposable tunnel **49 pass / 1 Windows-privilege skip / 0 fail** (auth, migrate, repositories, app, legacy-import); Vitest 149/149; build; check:data 183/853; archive SHA-256 unchanged.
- Compose wires `TRUSTED_PROXY_CIDRS=172.16.0.0/12` (Docker user-bridge pool; only caddy can reach api — no published ports — so spoofed headers cannot be delivered).

## Step 2 — Images and stack

- `.dockerignore` blocks `.env*`, `data/`, `node_modules`, `.git`, `.superpowers/` etc. from the build context.
- `deploy/api.Dockerfile` — `node:24-bookworm-slim@sha256:6f7b03f7…1452d` (24.18.0), `npm ci --omit=dev` (argon2 prebuilt installed fine), `deploy/api-entrypoint.sh` composes `DATABASE_URL`/`SESSION_SECRET` from `/run/secrets` at start.
- `deploy/web.Dockerfile` — multi-stage: node build (`npm run build`) → `caddy:2-alpine@sha256:5f5c8640…8648` (2.11.4) with `dist/` + Caddyfile baked in.
- `deploy/compose.yaml` — api (app_net+db_net, no ports, 512m, fetch healthcheck on `/internal/health/ready`), caddy (tunnel_net+app_net, no ports, 128m). VM copy uses build context `./build` (repo layout uses `..`; compose file sits above the build tree on the VM).
- Secret scans: `docker history` + env inspection of both images — no secret-shaped strings; host listeners unchanged (`:22`, `10.80.10.85:2222`, `127.0.0.1:55432` only).

### Deviations / incidents fixed during bring-up

1. **Secrets unreadable for non-root** (same Docker limitation as Task 1 — uid/gid/mode ignored, root-only mounts): api crash-looped (`Permission denied` reading secrets). Fix: entrypoint starts as root, reads secrets, then `exec setpriv --reuid=1000 --regid=1000 --init-groups node server/entry.mjs` (stays PID 1; build asserts `setpriv` exists). `USER node` removed from the Dockerfile.
2. **Caddy directive-order bug**: original Caddyfile's site-level `try_files` rewrote `/api/v1/*` and `/internal/*` to `/index.html` before `respond`/`reverse_proxy` were evaluated (probe caught it: session returned HTML, internal returned 200 HTML). Fix: rewrote routing with ordered, mutually exclusive `handle` blocks (`/internal/*` → 404, `/api/v1/*` → reverse_proxy, SPA fallback last). Added `X-Frame-Options: DENY` alongside CSP `frame-ancestors 'none'`.

## Step 3 — Private-network verification (throwaway container on `app_net`)

| Probe | Expected | Actual |
|---|---|---|
| `GET http://caddy/` | 200 PWA shell | **PASS** 200 `<!doctype html>` |
| `GET http://caddy/api/v1/session` | 200 JSON | **PASS** `{"authenticated":false}` |
| `GET http://caddy/internal/health/ready` | **404** | **PASS** 404 |
| `GET http://api:8787/internal/health/ready` (direct) | 200 | **PASS** `{"ok":true,"database":"ok"}` |
| Security headers | HSTS, nosniff, no-referrer, DENY, CSP | **PASS** all present |

## Gate

- Images build reproducibly (digest-pinned bases): **PASS**
- `/internal/*` denied at caddy, reachable inside network: **PASS**
- No secrets in images: **PASS**
- D2-A recorded with tests: **PASS**

Stack state: postgres / api / caddy all healthy; api log confirms `RUN_MIGRATIONS=false, skipping migrations` and `listening on 0.0.0.0:8787`. Ready for Task 3 (archive migration).
