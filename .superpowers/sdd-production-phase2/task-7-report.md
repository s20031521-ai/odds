# Phase 2 Task 7 Report: Production Deployment Runbook + Rehearsed Rollback

Date: 2026-07-19. Plan: `docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md` Task 7.

## Steps 1+2 — Runbook written

`docs/runbooks/production-deployment.md` covers, with exact commands and expected outputs:

- **Deploy procedure** in dependency order (postgres → roles → migrations → api/caddy → smoke → collector → cloudflared), incl. the VM-specific notes: sudo askpass pattern, Docker ignoring secret uid/gid/mode, build context `./build` on the VM vs `..` in the repo, per-service `up -d --no-deps`.
- **Readiness checks**: container health, internal readiness probe (api 200 / caddy 404 / session 200), public smoke subset, tunnel connection count, collector quota check.
- **Logs**: `docker compose logs` + the 10m×3 rotation caps.
- **Rollback**: tunnel kill-switch first for exposure incidents; tag-based image rollback (the rehearsed procedure); DB never reversed blindly — pre-deploy `pg_dump` restore points until Phase 3 Restic.
- **Secret rotation** table for all 7 secrets incl. the session-invalidating nature of `session_secret` and the role-first ordering for DB passwords.
- **Failure playbook**: 502/1033, mass 401s, throttle lockout, silent collector, DB down.

## Step 3 — Rollback rehearsal (executed 2026-07-19, evidence below)

1. Tagged current good image: `odds-tool-api:latest` → `odds-tool-api:rollback` (image **A** `sha256:057fce31…d89b`).
2. Simulated a new release: added `ENV RELEASE_MARK=task7-rehearsal` to `deploy/api.Dockerfile`, rebuilt → image **B** `sha256:4305d48e…3670`, deployed via `up -d --no-deps --force-recreate api collector`. Verified: running image = B, `RELEASE_MARK=task7-rehearsal` visible inside the container, readiness `{"ok":true,"database":"ok"}`.
3. **Roll back**: `docker tag odds-tool-api:rollback odds-tool-api:latest` + force-recreate. Verified: running image = **A**, `RELEASE_MARK` empty, readiness OK.
   - *Rehearsal caught a real operator error:* the first attempt ran `docker compose up` without `cd /opt/odds-tool` → `no configuration file provided`, container silently stayed on B. The runbook already prefixes commands with `cd /opt/odds-tool`; the incident is recorded here as evidence of why.
4. **Roll forward**: re-tag B → latest, force-recreate. Verified: running = B, readiness OK.
5. **Restore clean state**: removed the rehearsal ENV from the Dockerfile, rebuilt, deployed, verified `RELEASE_MARK` empty + readiness OK; re-pointed `odds-tool-api:rollback` at the final latest; removed the rehearsal tag (image B deleted).
6. Post-rehearsal public smoke: `home=200 session=200 results-unauth=401 internal=404` — all correct. All 5 odds-tool containers healthy; other stacks untouched.

## Gate

- Runbook complete: **PASS** (`docs/runbooks/production-deployment.md`)
- Rollback rehearsed with evidence: **PASS** (steps 1–6 above)

**Phase 2 complete.** The stack is live at `https://odds.ballballchu.com.hk` with a rehearsed rollback path, zero published host ports, and all gates from Tasks 0–7 green.

## Post-Task-7 addendum (2026-07-19 live-watch incident)

Collector loop was crash-cycling: (1) api image missing `src/` (Vite SSR runtime load in hdc-collector) — Dockerfile now ships `src/`; (2) `liveOddsIdentity` missing bookmaker caused `live_odds_identity_key_key` 23505 on multi-bookmaker Odds-API batches — identity now appends `|<bookmaker>` when present (TDD: exact 23505 reproduced RED in disposable DB, then GREEN; domain 20/20, repositories 12/12, suites 49/49). Verified live: `the-odds-api:soccer_mexico_ligamx` 32 rows, quota 500→491. See progress.md tail.
